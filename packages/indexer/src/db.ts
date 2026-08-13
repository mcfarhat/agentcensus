/**
 * SQLite persistence (better-sqlite3). One file per network under ./data.
 * Simple by design: the indexer is restartable/checkpointed via the agents
 * table itself (max indexed id), and census stats are computed with SQL.
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Network } from "./config.js";

export function openDb(net: Network, dataDir = "data"): Database.Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, `census-${net}.db`));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      agent_id INTEGER PRIMARY KEY,
      owner TEXT,
      uri_kind TEXT NOT NULL,           -- onchain-json | https | ipfs | empty | unparseable
      external_url TEXT,                -- for https/ipfs, fetched by prober only
      name TEXT,
      description TEXT,
      category TEXT NOT NULL DEFAULT 'other',
      active_flag INTEGER,              -- metadata "active" field (self-declared)
      x402_support INTEGER,
      service_endpoints TEXT,           -- JSON array of declared endpoints
      metadata_json TEXT,               -- full parsed metadata (sanitized at render, not here)
      indexed_at INTEGER NOT NULL,      -- unix seconds of indexing pass
      probe_status TEXT,                -- alive | degraded | dead | never-probed
      probe_latency_ms INTEGER,
      last_probed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_agents_category ON agents(category);
    CREATE INDEX IF NOT EXISTS idx_agents_probe ON agents(probe_status);

    CREATE TABLE IF NOT EXISTS jobs (
      job_id INTEGER PRIMARY KEY,
      client TEXT NOT NULL,
      provider TEXT NOT NULL,
      evaluator TEXT,
      budget_wei TEXT NOT NULL,
      expired_at INTEGER,
      status INTEGER NOT NULL,
      deliverable TEXT,
      submitted_at INTEGER,
      indexed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_provider ON jobs(provider);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

export function setMeta(db: Database.Database, key: string, value: string): void {
  db.prepare("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export function getMeta(db: Database.Database, key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}
