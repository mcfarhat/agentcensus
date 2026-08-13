/**
 * Census statistics — the "State of the Agent Economy" numbers, computed
 * from indexed data with plain SQL so anyone can reproduce them.
 * This is the deterministic, publishable core of the AgentCensus narrative.
 */
import type Database from "better-sqlite3";
import { JOB_STATUS_NAMES } from "./config.js";

export interface CensusReport {
  generatedAt: string;
  agents: {
    total: number;
    byUriKind: Record<string, number>;
    byCategory: Record<string, number>;
    withDeclaredEndpoints: number;
    selfDeclaredActive: number;
    x402Support: number;
    byProbeStatus: Record<string, number>;
  };
  jobs: {
    total: number;
    byStatus: Record<string, number>;
    distinctProviders: number;
    distinctClients: number;
    /** Share of all jobs held by the top-N providers — the authenticity headline. */
    topProviders: Array<{ provider: string; jobs: number; shareOfAll: number }>;
    budget: { medianWei: string; maxWei: string };
  };
}

const tally = (rows: Array<{ k: string | number | null; n: number }>): Record<string, number> =>
  Object.fromEntries(rows.map((r) => [String(r.k ?? "unknown"), r.n]));

export function computeCensus(db: Database.Database): CensusReport {
  const one = <T>(sql: string): T => db.prepare(sql).get() as T;
  const all = <T>(sql: string): T[] => db.prepare(sql).all() as T[];

  const agentsTotal = one<{ n: number }>("SELECT COUNT(*) AS n FROM agents").n;
  const jobsTotal = one<{ n: number }>("SELECT COUNT(*) AS n FROM jobs").n;

  const topProviders = all<{ provider: string; jobs: number }>(
    "SELECT provider, COUNT(*) AS jobs FROM jobs GROUP BY provider ORDER BY jobs DESC LIMIT 10",
  ).map((r) => ({ ...r, shareOfAll: jobsTotal ? +(r.jobs / jobsTotal).toFixed(4) : 0 }));

  const budgets = all<{ b: string }>("SELECT budget_wei AS b FROM jobs ORDER BY CAST(budget_wei AS INTEGER)");
  const medianWei = budgets.length ? budgets[Math.floor(budgets.length / 2)].b : "0";
  const maxWei = budgets.length ? budgets[budgets.length - 1].b : "0";

  return {
    generatedAt: new Date().toISOString(),
    agents: {
      total: agentsTotal,
      byUriKind: tally(all("SELECT uri_kind AS k, COUNT(*) AS n FROM agents GROUP BY uri_kind")),
      byCategory: tally(all("SELECT category AS k, COUNT(*) AS n FROM agents GROUP BY category")),
      withDeclaredEndpoints: one<{ n: number }>(
        "SELECT COUNT(*) AS n FROM agents WHERE service_endpoints IS NOT NULL",
      ).n,
      selfDeclaredActive: one<{ n: number }>("SELECT COUNT(*) AS n FROM agents WHERE active_flag = 1").n,
      x402Support: one<{ n: number }>("SELECT COUNT(*) AS n FROM agents WHERE x402_support = 1").n,
      byProbeStatus: tally(
        all("SELECT COALESCE(probe_status, 'never-probed') AS k, COUNT(*) AS n FROM agents GROUP BY probe_status"),
      ),
    },
    jobs: {
      total: jobsTotal,
      byStatus: tally(
        all<{ k: number; n: number }>("SELECT status AS k, COUNT(*) AS n FROM jobs GROUP BY status").map((r) => ({
          k: JOB_STATUS_NAMES[r.k] ?? String(r.k),
          n: r.n,
        })),
      ),
      distinctProviders: one<{ n: number }>("SELECT COUNT(DISTINCT provider) AS n FROM jobs").n,
      distinctClients: one<{ n: number }>("SELECT COUNT(DISTINCT client) AS n FROM jobs").n,
      topProviders,
      budget: { medianWei, maxWei },
    },
  };
}
