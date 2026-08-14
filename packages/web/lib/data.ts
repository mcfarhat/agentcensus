/**
 * Read-side data access over the indexer's SQLite databases.
 * The web tier is read-only: it never writes to the census dbs.
 */
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import path from "node:path";

export type Net = "testnet" | "mainnet";

export const EXPLORER: Record<Net, string> = {
  testnet: "https://testnet.bscscan.com",
  mainnet: "https://bscscan.com",
};

export const JOB_STATUS = ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"] as const;

export const CATEGORIES = [
  { slug: "monitoring", label: "Monitoring & Rebalancing" },
  { slug: "grid-trading", label: "Grid Trading" },
  { slug: "health-factor", label: "Health Factor" },
  { slug: "yield", label: "Yield" },
  { slug: "other", label: "Other" },
] as const;

const cache = new Map<Net, Database.Database>();

export function db(net: Net): Database.Database | null {
  if (cache.has(net)) return cache.get(net)!;
  const file = path.resolve(process.cwd(), "..", "indexer", "data", `census-${net}.db`);
  if (!existsSync(file)) return null;
  const d = new Database(file, { readonly: true, fileMustExist: true });
  cache.set(net, d);
  return d;
}

export function parseNet(v: string | string[] | undefined): Net {
  return v === "mainnet" ? "mainnet" : "testnet";
}

export interface AgentRow {
  agent_id: number;
  owner: string | null;
  uri_kind: string;
  external_url: string | null;
  name: string | null;
  description: string | null;
  category: string;
  active_flag: number | null;
  x402_support: number | null;
  service_endpoints: string | null;
  metadata_json: string | null;
  probe_status: string | null;
  probe_latency_ms: number | null;
  last_probed_at: number | null;
  indexed_at: number;
}

export interface JobRow {
  job_id: number;
  client: string;
  provider: string;
  budget_wei: string;
  expired_at: number;
  status: number;
  deliverable: string | null;
  submitted_at: number;
  indexed_at: number;
}

export interface AgentFilters {
  category?: string;
  status?: "alive" | "degraded" | "dead" | "declared" | "all";
  q?: string;
  page?: number;
  pageSize?: number;
}

export function listAgents(net: Net, f: AgentFilters) {
  const d = db(net);
  if (!d) return { rows: [] as AgentRow[], total: 0 };
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (f.category && f.category !== "all") {
    where.push("category = @category");
    params.category = f.category;
  }
  if (f.status === "alive" || f.status === "degraded" || f.status === "dead") {
    where.push("probe_status = @status");
    params.status = f.status;
  } else if (f.status === "declared") {
    where.push("service_endpoints IS NOT NULL");
  }
  if (f.q) {
    where.push("(name LIKE @q OR description LIKE @q OR CAST(agent_id AS TEXT) = @qexact OR owner = @qlower)");
    params.q = `%${f.q}%`;
    params.qexact = f.q;
    params.qlower = f.q.toLowerCase();
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (d.prepare(`SELECT COUNT(*) AS n FROM agents ${clause}`).get(params) as { n: number }).n;
  const pageSize = Math.min(f.pageSize ?? 25, 100);
  const page = Math.max(f.page ?? 1, 1);
  const rows = d
    .prepare(
      `SELECT * FROM agents ${clause}
       ORDER BY (probe_status = 'alive') DESC, (probe_status = 'degraded') DESC,
                (service_endpoints IS NOT NULL) DESC, agent_id DESC
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as AgentRow[];
  return { rows, total };
}

export function getAgent(net: Net, id: number): AgentRow | null {
  const d = db(net);
  if (!d) return null;
  return (d.prepare("SELECT * FROM agents WHERE agent_id = ?").get(id) as AgentRow) ?? null;
}

/** Jobs where this agent's owner wallet is the provider (best-effort join). */
export function agentJobs(net: Net, owner: string | null, limit = 50): JobRow[] {
  const d = db(net);
  if (!d || !owner) return [];
  return d
    .prepare("SELECT * FROM jobs WHERE provider = ? COLLATE NOCASE ORDER BY job_id DESC LIMIT ?")
    .all(owner, limit) as JobRow[];
}

export function listJobs(net: Net, opts: { provider?: string; status?: number; page?: number; pageSize?: number }) {
  const d = db(net);
  if (!d) return { rows: [] as JobRow[], total: 0 };
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (opts.provider) {
    where.push("provider = @provider COLLATE NOCASE");
    params.provider = opts.provider;
  }
  if (opts.status !== undefined && !Number.isNaN(opts.status)) {
    where.push("status = @status");
    params.status = opts.status;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (d.prepare(`SELECT COUNT(*) AS n FROM jobs ${clause}`).get(params) as { n: number }).n;
  const pageSize = Math.min(opts.pageSize ?? 25, 100);
  const page = Math.max(opts.page ?? 1, 1);
  const rows = d
    .prepare(`SELECT * FROM jobs ${clause} ORDER BY job_id DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as JobRow[];
  return { rows, total };
}

export function stats(net: Net) {
  const d = db(net);
  if (!d) return null;
  const one = (sql: string) => (d.prepare(sql).get() as { n: number }).n;
  const byCat = d.prepare("SELECT category AS k, COUNT(*) AS n FROM agents GROUP BY category").all() as Array<{
    k: string;
    n: number;
  }>;
  return {
    agents: one("SELECT COUNT(*) AS n FROM agents"),
    declared: one("SELECT COUNT(*) AS n FROM agents WHERE service_endpoints IS NOT NULL"),
    alive: one("SELECT COUNT(*) AS n FROM agents WHERE probe_status = 'alive'"),
    dead: one("SELECT COUNT(*) AS n FROM agents WHERE probe_status = 'dead'"),
    degraded: one("SELECT COUNT(*) AS n FROM agents WHERE probe_status = 'degraded'"),
    jobs: one("SELECT COUNT(*) AS n FROM jobs"),
    completed: one("SELECT COUNT(*) AS n FROM jobs WHERE status = 3"),
    stuckSubmitted: one("SELECT COUNT(*) AS n FROM jobs WHERE status = 2"),
    providers: one("SELECT COUNT(DISTINCT provider) AS n FROM jobs"),
    byCategory: Object.fromEntries(byCat.map((r) => [r.k, r.n])),
    lastIndexed: (d.prepare("SELECT value FROM meta WHERE key = 'agents_indexed_at'").get() as
      | { value: string }
      | undefined)?.value,
  };
}

export const fmtU = (wei: string): string => {
  try {
    const v = Number(BigInt(wei)) / 1e18;
    return v === 0 ? "0" : v < 0.001 ? "<0.001" : v.toLocaleString(undefined, { maximumFractionDigits: 3 });
  } catch {
    return "?";
  }
};

export const ago = (unixSec: number | null | undefined): string => {
  if (!unixSec) return "never";
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unixSec);
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

export const short = (addr: string | null | undefined): string =>
  addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—";
