#!/usr/bin/env node
/**
 * Standalone chain sanity check — no dependencies, runs anywhere with Node 18+.
 * Reproduces the day-1 verification (docs/day1-findings.md) from primary sources.
 *
 *   node scripts/verify-chain.mjs [mainnet|testnet]
 */
const NETS = {
  mainnet: {
    rpcs: ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.bnbchain.org"],
    identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    commerce: "0xea4daa3100a767e86fded867729ae7446476eba6",
    policy: "0x9c01845705b3078aa2e8cff7520a6376fd766de5",
  },
  testnet: {
    rpcs: ["https://bsc-testnet-rpc.publicnode.com"],
    identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    commerce: "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de",
    policy: "0x4f4678d4439fec812ac7674bb3efb4c8f5fb78a6",
  },
};

const net = process.argv[2] ?? "testnet";
const cfg = NETS[net];
if (!cfg) throw new Error("usage: verify-chain.mjs [mainnet|testnet]");

async function rpc(method, params) {
  let lastErr;
  for (const url of cfg.rpcs) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      return json.result;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

const pad = (n) => BigInt(n).toString(16).padStart(64, "0");
const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);

async function exists(id) {
  try {
    const r = await call(cfg.identity, "0x6352211e" + pad(id));
    return r && r !== "0x" && BigInt(r) !== 0n;
  } catch {
    return false;
  }
}

let hi = 1n;
while (await exists(hi)) hi *= 2n;
let lo = hi / 2n;
while (lo + 1n < hi) {
  const mid = (lo + hi) / 2n;
  (await exists(mid)) ? (lo = mid) : (hi = mid);
}

const [jobs, dw, fee, block] = await Promise.all([
  call(cfg.commerce, "0x50355d76").then(BigInt),
  call(cfg.policy, "0x117f5f92").then(BigInt),
  call(cfg.commerce, "0xff96092a").then(BigInt),
  rpc("eth_blockNumber", []).then((h) => parseInt(h, 16)),
]);

console.log(
  JSON.stringify(
    {
      network: net,
      block,
      maxAgentId: lo.toString(),
      jobCounter: jobs.toString(),
      disputeWindowDays: Number(dw) / 86400,
      platformFeeBP: fee.toString(),
    },
    null,
    2,
  ),
);
