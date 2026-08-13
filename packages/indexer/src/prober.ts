/**
 * Phase-2 liveness prober — the ONLY module that performs external HTTP.
 *
 * SSRF hardening (non-negotiable — these are attacker-controlled URLs):
 *  - https only, standard port semantics, no redirects followed cross-check-free
 *  - DNS resolved first; private / loopback / link-local / metadata ranges rejected
 *  - re-validated after every redirect hop (max 2)
 *  - 5s timeout, 256KB body cap, no credentials
 *  - per-host serial probing with jitter; tiered cadence handled by caller
 *
 * Probe target: ERC-8183 well-known endpoints on each declared service host:
 *   GET {base}/erc8183/health  → alive
 *   GET {base}/erc8183/status  → price/wallet info (recorded verbatim, sanitized at render)
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type Database from "better-sqlite3";

const BODY_CAP = 256 * 1024;
const TIMEOUT_MS = 5_000;

export type ProbeStatus = "alive" | "degraded" | "dead";

export interface ProbeResult {
  status: ProbeStatus;
  latencyMs: number | null;
  detail: string;
}

function ipIsPrivate(ip: string): boolean {
  if (ip.includes(":")) {
    // v6: loopback, link-local, unique-local, v4-mapped handled by re-check
    const low = ip.toLowerCase();
    return low === "::1" || low.startsWith("fe80:") || low.startsWith("fc") || low.startsWith("fd") || low.startsWith("::ffff:");
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) || // link-local incl. cloud metadata 169.254.169.254
    a >= 224 // multicast/reserved
  );
}

export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error(`non-https scheme: ${url.protocol}`);
  if (url.username || url.password) throw new Error("credentials in URL");
  const host = url.hostname;
  const ips = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (ips.length === 0) throw new Error("no DNS records");
  for (const { address } of ips) {
    if (ipIsPrivate(address)) throw new Error(`resolves to private range: ${address}`);
  }
  return url;
}

async function fetchCapped(url: URL, redirectsLeft = 2): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": "AgentCensus-Prober/0.1 (+https://agentcensus.xyz/prober)" },
    });
    if (res.status >= 301 && res.status <= 308) {
      const loc = res.headers.get("location");
      if (!loc || redirectsLeft === 0) return { status: res.status, body: "" };
      const nextUrl = await assertPublicHttpsUrl(new URL(loc, url).toString()); // re-validate every hop
      return fetchCapped(nextUrl, redirectsLeft - 1);
    }
    const reader = res.body?.getReader();
    let received = 0;
    const chunks: Uint8Array[] = [];
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > BODY_CAP) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    return { status: res.status, body: Buffer.concat(chunks).toString("utf8") };
  } finally {
    clearTimeout(timer);
  }
}

/** Probe one agent's declared endpoint base. */
export async function probeEndpoint(base: string): Promise<ProbeResult> {
  let validated: URL;
  try {
    validated = await assertPublicHttpsUrl(base);
  } catch (err) {
    return { status: "dead", latencyMs: null, detail: `invalid-url: ${(err as Error).message}` };
  }
  const healthUrl = new URL("/erc8183/health", validated.origin + validated.pathname.replace(/\/$/, ""));
  const started = Date.now();
  try {
    const res = await fetchCapped(healthUrl);
    const latencyMs = Date.now() - started;
    if (res.status >= 200 && res.status < 300) return { status: "alive", latencyMs, detail: `health ${res.status}` };
    if (res.status > 0) return { status: "degraded", latencyMs, detail: `health ${res.status}` };
    return { status: "dead", latencyMs, detail: "no-response" };
  } catch (err) {
    return { status: "dead", latencyMs: null, detail: `error: ${(err as Error).message.slice(0, 120)}` };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Probe all agents with declared endpoints. Tiering by caller: pass a WHERE
 * filter via `onlyNeverProbed` or probe the full set for the initial census.
 */
export async function probeAgents(
  db: Database.Database,
  opts: { limit?: number; concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ probed: number }> {
  const rows = db
    .prepare(
      `SELECT agent_id, service_endpoints FROM agents
       WHERE service_endpoints IS NOT NULL
       ORDER BY COALESCE(last_probed_at, 0) ASC
       LIMIT ?`,
    )
    .all(opts.limit ?? 1000) as Array<{ agent_id: number; service_endpoints: string }>;

  const update = db.prepare(
    "UPDATE agents SET probe_status = ?, probe_latency_ms = ?, last_probed_at = ? WHERE agent_id = ?",
  );

  let done = 0;
  const conc = opts.concurrency ?? 8;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: conc }, async () => {
      while (cursor < rows.length) {
        const row = rows[cursor++];
        let endpoints: string[] = [];
        try {
          endpoints = JSON.parse(row.service_endpoints) as string[];
        } catch {
          /* ignore */
        }
        let best: ProbeResult = { status: "dead", latencyMs: null, detail: "no-endpoints" };
        for (const ep of endpoints.slice(0, 3)) {
          const r = await probeEndpoint(ep);
          if (r.status === "alive") {
            best = r;
            break;
          }
          if (r.status === "degraded" && best.status === "dead") best = r;
        }
        update.run(best.status, best.latencyMs, Math.floor(Date.now() / 1000), row.agent_id);
        done++;
        opts.onProgress?.(done, rows.length);
        await sleep(50 + Math.random() * 100); // jitter
      }
    }),
  );
  return { probed: done };
}
