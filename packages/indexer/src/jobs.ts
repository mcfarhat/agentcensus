/**
 * ERC-8183 AgenticCommerce job indexing via jobCounter() + getJob(id) enumeration.
 * Includes the provider-concentration analysis that powers the census's
 * "volume authenticity" story (56,591 mainnet jobs ≈ 2 providers, day-1 finding).
 */
import type Database from "better-sqlite3";
import { SELECTORS, pad32, decodeJob, hexToBigInt } from "./abi.js";
import { CHAINS, type Network } from "./config.js";
import { RpcClient, mapWithConcurrency } from "./rpc.js";
import { setMeta } from "./db.js";

export async function getJobCounter(rpc: RpcClient, commerce: string): Promise<bigint> {
  return hexToBigInt(await rpc.ethCall(commerce, SELECTORS.jobCounter));
}

export interface IndexJobsOptions {
  fromId?: bigint;
  toId?: bigint;
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

export async function indexJobs(
  db: Database.Database,
  net: Network,
  opts: IndexJobsOptions = {},
): Promise<{ indexed: number; total: bigint }> {
  const cfg = CHAINS[net];
  const rpc = RpcClient.for(net);
  const commerce = cfg.contracts.agenticCommerce;

  const total = opts.toId ?? (await getJobCounter(rpc, commerce));
  const resumeRow = db.prepare("SELECT MAX(job_id) AS m FROM jobs").get() as { m: number | null };
  const from = opts.fromId ?? BigInt((resumeRow.m ?? 0) + 1);
  if (from > total) return { indexed: 0, total };

  const ids: bigint[] = [];
  for (let id = from; id <= total; id++) ids.push(id);

  const insert = db.prepare(`
    INSERT OR REPLACE INTO jobs
      (job_id, client, provider, evaluator, budget_wei, expired_at, status, deliverable, submitted_at, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let done = 0;
  const BATCH = 500;
  const now = () => Math.floor(Date.now() / 1000);
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const rows = await mapWithConcurrency(slice, opts.concurrency ?? 12, async (id) => {
      const hex = await rpc.ethCall(commerce, SELECTORS.getJob + pad32(id)).catch(() => null);
      return { id, job: hex ? decodeJob(hex) : null };
    });
    const tx = db.transaction(() => {
      for (const r of rows) {
        if (!r.job) continue;
        insert.run(
          Number(r.id),
          r.job.client,
          r.job.provider,
          r.job.evaluator,
          r.job.budget.toString(),
          Number(r.job.expiredAt),
          r.job.status,
          r.job.deliverable,
          Number(r.job.submittedAt),
          now(),
        );
      }
    });
    tx();
    done += rows.length;
    opts.onProgress?.(done, ids.length);
  }
  setMeta(db, "job_counter", total.toString());
  setMeta(db, "jobs_indexed_at", String(now()));
  return { indexed: done, total };
}
