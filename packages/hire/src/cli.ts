#!/usr/bin/env node
/**
 * AgentCensus hire-loop CLI (testnet-first).
 *
 * Env: HIRE_PRIVATE_KEY (buyer wallet; needs tBNB gas + testnet U tokens)
 *
 *   npm run cli -- register --name "AgentCensus Health Factor Monitor" \
 *       --endpoint https://health.agentcensus.xyz --desc "Venus position monitor" \
 *       --skills health-factor,monitoring --network testnet
 *
 *   npm run cli -- hire --provider 0xAGENT_WALLET --endpoint https://health.agentcensus.xyz \
 *       --task '{"account":"0x...","network":"testnet"}' --budget 0.01 --network testnet
 *
 *   npm run cli -- status --job 123 --network testnet
 *   npm run cli -- settle --job 123 --network testnet        (after dispute window)
 *   npm run cli -- sweep  --network testnet --max 20         (settle-sweeper: pays stuck providers)
 */
import { negotiate, hire, getJob, settle, waitForSubmission } from "./hire.js";
import { registerAgent } from "./register-agent.js";
import { buildJobDescription } from "./describe.js";
import { ABIS, ADDR, clients, type Network } from "./chain.js";

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}
const pk = (): `0x${string}` => {
  const k = process.env.HIRE_PRIVATE_KEY;
  if (!k) throw new Error("set HIRE_PRIVATE_KEY");
  return (k.startsWith("0x") ? k : `0x${k}`) as `0x${string}`;
};

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const net = arg("network", "testnet") as Network;

  switch (cmd) {
    case "register": {
      const res = await registerAgent(net, pk(), {
        name: arg("name"),
        description: arg("desc"),
        endpoint: arg("endpoint"),
        skills: arg("skills", "").split(",").filter(Boolean),
        domains: arg("domains", "defi").split(",").filter(Boolean),
      });
      console.log(JSON.stringify(res, null, 2));
      break;
    }
    case "hire": {
      const endpoint = arg("endpoint", "");
      let description = arg("task");
      if (endpoint) {
        const quote = await negotiate(endpoint, {
          task_description: description,
          terms: {
            deliverables: arg("deliverables", "The agent's standard service output, submitted on-chain per ERC-8183"),
            quality_standards: arg("quality", "Deliverable produced from live data at time of execution"),
          },
        });
        console.error("negotiated quote:", JSON.stringify(quote).slice(0, 400));
        description = buildJobDescription(quote); // canonical — provider verifies byte-for-byte
      }
      const res = await hire({
        network: net,
        privateKey: pk(),
        provider: arg("provider") as `0x${string}`,
        description,
        budgetU: arg("budget", "0.01"),
      });
      console.log(JSON.stringify({ jobId: res.jobId.toString(), txs: res.txs }, null, 2));
      if (process.argv.includes("--wait")) {
        const job = await waitForSubmission(net, res.jobId);
        console.log(JSON.stringify({ status: job.status, deliverable: job.deliverable }, null, 2));
      }
      break;
    }
    case "status": {
      const job = await getJob(net, BigInt(arg("job")));
      console.log(
        JSON.stringify(
          { ...job, id: job.id.toString(), budget: job.budget.toString(), submittedAt: job.submittedAt.toString() },
          null,
          2,
        ),
      );
      break;
    }
    case "settle": {
      const hash = await settle(net, pk(), BigInt(arg("job")));
      console.log(JSON.stringify({ settled: arg("job"), tx: hash }, null, 2));
      break;
    }
    case "sweep": {
      // Settle-sweeper: find SUBMITTED jobs whose dispute window has elapsed and settle them.
      // Scans backward from jobCounter; settles up to --max jobs. Anyone can run this;
      // it releases escrow to providers who did the work. (27,169 candidates on mainnet.)
      const { publicClient } = clients(net);
      const a = ADDR[net];
      const max = Number(arg("max", "10"));
      const disputeWindow = (await publicClient.readContract({
        address: a.policy, abi: ABIS.policy, functionName: "disputeWindow",
      })) as bigint;
      const counter = (await publicClient.readContract({
        address: a.commerce, abi: ABIS.commerce, functionName: "jobCounter",
      })) as bigint;
      const nowSec = BigInt(Math.floor(Date.now() / 1000));
      let settled = 0;
      for (let id = counter; id >= 1n && settled < max; id--) {
        const job = await getJob(net, id);
        if (job.status !== "SUBMITTED") continue;
        if (job.submittedAt === 0n || nowSec < job.submittedAt + disputeWindow) continue;
        try {
          const hash = await settle(net, pk(), id);
          settled++;
          console.log(JSON.stringify({ job: id.toString(), tx: hash }));
        } catch (err) {
          console.error(`job ${id}: settle failed — ${(err as Error).message.slice(0, 120)}`);
        }
      }
      console.error(`swept ${settled} job(s)`);
      break;
    }
    case "faucet": {
      // Testnet U token is a proxy whose implementation exposes mint(uint256) and
      // mint(address,uint256). Whether minting is permissionless is undocumented —
      // this tries both; if both revert, get U another way (BNB Chain Discord).
      if (net !== "testnet") throw new Error("faucet is testnet-only");
      const { publicClient, walletClient, account } = clients(net, pk());
      if (!walletClient || !account) throw new Error("wallet required");
      const amount = BigInt(Math.round(Number(arg("amount", "10")) * 1e6)) * 10n ** 12n; // U, 18 dec
      const mintAbi = [
        { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
        { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
      ] as const;
      for (const args of [[amount] as const, [account.address, amount] as const]) {
        try {
          const hash = await walletClient.writeContract({
            address: ADDR[net].token, abi: mintAbi, functionName: "mint", args: args as never,
          });
          const rcpt = await publicClient.waitForTransactionReceipt({ hash });
          if (rcpt.status === "success") {
            console.log(JSON.stringify({ minted: arg("amount", "10") + " U", tx: hash }));
            return;
          }
        } catch (err) {
          console.error(`mint variant failed: ${(err as Error).message.slice(0, 100)}`);
        }
      }
      throw new Error("both mint variants reverted — token minting is likely restricted; ask in BNB Chain Discord for testnet U");
    }
    default:
      console.error("usage: cli <register|hire|status|settle|sweep|faucet> --network <testnet|mainnet> [...]");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
