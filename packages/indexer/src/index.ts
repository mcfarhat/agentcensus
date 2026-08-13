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
      const res = await indexAgents(db, net, { onProgress: progress("agents") });
      console.log(JSON.stringify({ network: net, ...res, head: res.head.toString() }));
      break;
    }
    case "jobs": {
      const db = openDb(net);
      const res = await indexJobs(db, net, { onProgress: progress("jobs") });
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
      console.error("usage: cli <agents|jobs|probe|census|verify> --network <mainnet|testnet>");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
