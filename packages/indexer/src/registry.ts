/**
 * ERC-8004 Identity Registry indexing.
 *
 * Key simplification discovered on day 1: agent IDs are sequential, so we
 * binary-search the head (ownerOf reverts past the tip) and enumerate by ID —
 * no eth_getLogs scanning, no chunking heuristics. Metadata is mostly
 * on-chain base64 JSON, so a full pass is pure RPC.
 */
import type Database from "better-sqlite3";
import { SELECTORS, pad32, decodeString, wordToAddress, words } from "./abi.js";
import { CHAINS, type Network } from "./config.js";
import { classify, parseTokenUri } from "./metadata.js";
import { RpcClient, RpcError, mapWithConcurrency } from "./rpc.js";
import { setMeta } from "./db.js";

export async function ownerExists(rpc: RpcClient, registry: string, id: bigint): Promise<boolean> {
  try {
    const res = await rpc.ethCall(registry, SELECTORS.ownerOf + pad32(id));
    return typeof res === "string" && res !== "0x" && BigInt(res) !== 0n;
  } catch (err) {
    if (err instanceof RpcError) return false; // revert => nonexistent (or burned; fine for head-finding)
    throw err;
  }
}

/** Find the highest existing agentId via exponential + binary search (~2·log2(N) calls). */
export async function findMaxAgentId(rpc: RpcClient, registry: string): Promise<bigint> {
  let hi = 1n;
  if (!(await ownerExists(rpc, registry, hi))) return 0n;
  while (await ownerExists(rpc, registry, hi)) {
    hi *= 2n;
    if (hi > 1_000_000_000n) throw new Error("implausible registry size");
  }
  let lo = hi / 2n;
  while (lo + 1n < hi) {
    const mid = (lo + hi) / 2n;
    if (await ownerExists(rpc, registry, mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

export interface IndexAgentsOptions {
  fromId?: bigint; // resume point; defaults to max(agent_id) in db + 1
  toId?: bigint; // defaults to current on-chain head
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

/** Index agents [fromId..toId] into SQLite: owner, tokenURI decode, category. */
export async function indexAgents(
  db: Database.Database,
  net: Network,
  opts: IndexAgentsOptions = {},
): Promise<{ indexed: number; head: bigint }> {
  const cfg = CHAINS[net];
  const rpc = RpcClient.for(net);
  const registry = cfg.contracts.identityRegistry;

  const head = opts.toId ?? (await findMaxAgentId(rpc, registry));
  const resumeRow = db.prepare("SELECT MAX(agent_id) AS m FROM agents").get() as { m: number | null };
  const from = opts.fromId ?? BigInt((resumeRow.m ?? 0) + 1);
  if (from > head) return { indexed: 0, head };

  const ids: bigint[] = [];
  for (let id = from; id <= head; id++) ids.push(id);

  // UPSERT that leaves probe_status / probe_latency_ms / last_probed_at untouched —
  // a full metadata re-index must never erase liveness history.
  const insert = db.prepare(`
    INSERT INTO agents
      (agent_id, owner, uri_kind, external_url, name, description, category,
       active_flag, x402_support, service_endpoints, metadata_json, raw_uri, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET
      owner = excluded.owner,
      uri_kind = excluded.uri_kind,
      external_url = excluded.external_url,
      name = excluded.name,
      description = excluded.description,
      category = excluded.category,
      active_flag = excluded.active_flag,
      x402_support = excluded.x402_support,
      service_endpoints = excluded.service_endpoints,
      metadata_json = excluded.metadata_json,
      raw_uri = excluded.raw_uri,
      indexed_at = excluded.indexed_at
  `);

  const now = () => Math.floor(Date.now() / 1000);
  let done = 0;
  const BATCH = 500;
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const rows = await mapWithConcurrency(slice, opts.concurrency ?? 12, async (id) => {
      const [ownerHex, uriHex] = await Promise.all([
        rpc.ethCall(registry, SELECTORS.ownerOf + pad32(id)).catch(() => null),
        rpc.ethCall(registry, SELECTORS.tokenURI + pad32(id)).catch(() => null),
      ]);
      const owner = ownerHex && ownerHex !== "0x" ? wordToAddress(words(ownerHex)[0] ?? "") : null;
      const uri = uriHex ? decodeString(uriHex) : null;
      const parsed = parseTokenUri(uri);
      const category = classify(parsed.metadata);
      const rawUri = uri ? uri.slice(0, 2048) : null;
      const endpoints = parsed.metadata?.services
        ?.map((s) => s.endpoint)
        .filter((e): e is string => typeof e === "string" && e.length > 0);
      return { id, owner, parsed, category, endpoints, rawUri };
    });
    const tx = db.transaction(() => {
      for (const r of rows) {
        insert.run(
          Number(r.id),
          r.owner,
          r.parsed.kind,
          r.parsed.externalUrl,
          r.parsed.metadata?.name ?? null,
          r.parsed.metadata?.description ?? null,
          r.category,
          r.parsed.metadata?.active == null ? null : r.parsed.metadata.active ? 1 : 0,
          r.parsed.metadata?.x402support == null ? null : r.parsed.metadata.x402support ? 1 : 0,
          r.endpoints?.length ? JSON.stringify(r.endpoints) : null,
          r.parsed.metadata ? JSON.stringify(r.parsed.metadata.raw).slice(0, 16_384) : null,
          r.rawUri,
          now(),
        );
      }
    });
    tx();
    done += rows.length;
    opts.onProgress?.(done, ids.length);
  }
  setMeta(db, "head_agent_id", head.toString());
  setMeta(db, "agents_indexed_at", String(now()));
  return { indexed: done, head };
}
