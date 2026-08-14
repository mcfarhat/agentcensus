#!/usr/bin/env node
/**
 * AgentCensus indexer CLI.
 *
 *   npm run cli -- agents  --network testnet          index registry (resumable)
 *   npm run cli -- jobs    --network testnet          index 8183 jobs (resumable)
 *   npm run cli -- probe   --network testnet          probe declared endpoints
 *   npm run cli -- census  --network testnet          print census JSON (writes data/census-<net>.json)
 *   npm run cli -- verify  --network mainnet          quick chain sanity numbers (no db)
 */
import { writeFileSync } from "node:fs";
import { CHAINS, type Network } from "./config.js";
import { openDb } from "./db.js";
import { indexAgents, findMaxAgentId } from "./registry.js";
import { classify, parseTokenUri } from "./metadata.js";
import { indexJobs, getJobCounter } from "./jobs.js";
import { probeAgents } from "./prober.js";
import { computeCensus } from "./census.js";
import { RpcClient } from "./rpc.js";
import { SELECTORS, hexToBigInt } from "./abi.js";

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}

const progress = (label: string) => {
  let last = 0;
  return (done: number, total: number) => {
    if (done - last >= 500 || done === total) {
      last = done;
      process.stderr.write(`\r${label}: ${done}/${total}`);
      if (done === total) process.stderr.write("\n");
    }
  };
};

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const net = arg("network", "testnet") as Network;
  if (!CHAINS[net]) throw new Error(`unknown network ${net}`);

  switch (cmd) {
    case "agents": {
      const db = openDb(net);
      const fromArg = arg("from", "");
      const res = await indexAgents(db, net, {
        ...(fromArg ? { fromId: BigInt(fromArg) } : {}),
        onProgress: progress("agents"),
      });
      console.log(JSON.stringify({ network: net, ...res, head: res.head.toString() }));
      break;
    }
    case "jobs": {
      const db = openDb(net);
      const fromArg = arg("from", "");
      const res = await indexJobs(db, net, {
        ...(fromArg ? { fromId: BigInt(fromArg) } : {}),
        onProgress: progress("jobs"),
      });
      console.log(JSON.stringify({ network: net, indexed: res.indexed, total: res.total.toString() }));
      break;
    }
    case "probe": {
      const db = openDb(net);
      const res = await probeAgents(db, {
        limit: Number(arg("limit", "2000")),
        onProgress: progress("probe"),
      });
      console.log(JSON.stringify({ network: net, ...res }));
      break;
    }
    case "reclassify": {
      // Re-run URI parsing + classification over stored raw_uri — no RPC needed.
      // Use after parser/classifier upgrades; rows without raw_uri are skipped
      // (re-run `agents --from 1` once to backfill raw_uri on old databases).
      const db = openDb(net);
      const rows = db.prepare("SELECT agent_id, raw_uri FROM agents WHERE raw_uri IS NOT NULL").all() as Array<{
        agent_id: number;
        raw_uri: string;
      }>;
      const update = db.prepare(
        `UPDATE agents SET uri_kind = ?, external_url = ?, name = ?, description = ?, category = ?,
         active_flag = ?, x402_support = ?, service_endpoints = ?, metadata_json = ? WHERE agent_id = ?`,
      );
      let changed = 0;
      const tx = db.transaction(() => {
        for (const row of rows) {
          const parsed = parseTokenUri(row.raw_uri);
          const category = classify(parsed.metadata);
          const endpoints = parsed.metadata?.services
            ?.map((s) => s.endpoint)
            .filter((e): e is string => typeof e === "string" && e.length > 0);
          update.run(
            parsed.kind,
            parsed.externalUrl,
            parsed.metadata?.name ?? null,
            parsed.metadata?.description ?? null,
            category,
            parsed.metadata?.active == null ? null : parsed.metadata.active ? 1 : 0,
            parsed.metadata?.x402support == null ? null : parsed.metadata.x402support ? 1 : 0,
            endpoints?.length ? JSON.stringify(endpoints) : null,
            parsed.metadata ? JSON.stringify(parsed.metadata.raw).slice(0, 16_384) : null,
            row.agent_id,
          );
          changed++;
        }
      });
      tx();
      console.log(JSON.stringify({ network: net, reclassified: changed, skippedNoRawUri: undefined }));
      const missing = db.prepare("SELECT COUNT(*) AS n FROM agents WHERE raw_uri IS NULL").get() as { n: number };
      if (missing.n > 0)
        console.error(`note: ${missing.n} rows have no raw_uri (indexed before this feature) — run: agents --network ${net} --from 1`);
      break;
    }
    case "census": {
      const db = openDb(net);
      const report = computeCensus(db);
      const out = `data/census-${net}.json`;
      writeFileSync(out, JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report, null, 2));
      console.error(`written: ${out}`);
      break;
    }
    case "verify": {
      // Day-1 style sanity read, no db — proves RPC + selectors from any machine.
      const cfg = CHAINS[net];
      const rpc = RpcClient.for(net);
      const [head, jobs, dw, fee] = await Promise.all([
        findMaxAgentId(rpc, cfg.contracts.identityRegistry),
        getJobCounter(rpc, cfg.contracts.agenticCommerce),
        rpc.ethCall(cfg.contracts.optimisticPolicy, SELECTORS.disputeWindow).then(hexToBigInt),
        rpc.ethCall(cfg.contracts.agenticCommerce, SELECTORS.platformFeeBP).then(hexToBigInt),
      ]);
      console.log(
        JSON.stringify(
          {
            network: net,
            maxAgentId: head.toString(),
            jobCounter: jobs.toString(),
            disputeWindowSec: dw.toString(),
            platformFeeBP: fee.toString(),
          },
          null,
          2,
        ),
      );
      break;
    }
    default:
      console.error("usage: cli <agents|jobs|probe|census|reclassify|verify> --network <mainnet|testnet> [--from N]");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
