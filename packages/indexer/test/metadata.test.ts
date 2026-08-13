import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTokenUri, classify, sanitizeForDisplay } from "../src/metadata.js";
import { decodeJob } from "../src/abi.js";

// Real on-chain fixture (agent #100, BSC mainnet, 2026-08-14)
const REG_V1 = {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  name: "8004AI",
  description: "test agent",
  services: [
    {
      name: "OASF",
      endpoint: "https://example.org/agent",
      skills: ["advanced_reasoning_planning/chain_of_thought_structuring"],
      domains: ["agriculture/crop_management"],
    },
  ],
  supportedTrusts: ["reputation", "crypto-economic", "tee-attestation"],
  active: false,
  x402support: true,
};

test("parses on-chain base64 data URI (dominant mainnet pattern)", () => {
  const uri = "data:application/json;base64," + Buffer.from(JSON.stringify(REG_V1)).toString("base64");
  const parsed = parseTokenUri(uri);
  assert.equal(parsed.kind, "onchain-json");
  assert.equal(parsed.metadata?.name, "8004AI");
  assert.equal(parsed.metadata?.x402support, true);
  assert.equal(parsed.metadata?.active, false);
  assert.equal(parsed.metadata?.services[0]?.endpoint, "https://example.org/agent");
  assert.deepEqual(parsed.metadata?.supportedTrusts, ["reputation", "crypto-economic", "tee-attestation"]);
});

test("parses raw JSON tokenURI (seen in the wild, agent #5000)", () => {
  const parsed = parseTokenUri('{"name":"raw-agent","description":"直接存储"}');
  assert.equal(parsed.kind, "onchain-json");
  assert.equal(parsed.metadata?.name, "raw-agent");
});

test("records external https URI for prober, does not fetch (agent #260000 pattern)", () => {
  const parsed = parseTokenUri("https://termix-platform-prod.s3.ap-southeast-1.amazonaws.com/x.json");
  assert.equal(parsed.kind, "https");
  assert.equal(parsed.externalUrl?.startsWith("https://"), true);
  assert.equal(parsed.metadata, null);
});

test("classifies the four judged categories", () => {
  const meta = (desc: string) => parseTokenUri(`{"name":"a","description":"${desc}"}`).metadata;
  assert.equal(classify(meta("watches your Venus loan health factor before liquidation")), "health-factor");
  assert.equal(classify(meta("automated grid trading within a set range")), "grid-trading");
  assert.equal(classify(meta("finds the best stablecoin APY vaults")), "yield");
  assert.equal(classify(meta("monitors wallets and sends alerts")), "monitoring");
  assert.equal(classify(meta("generates poetry")), "other");
});

test("sanitizes control characters for display", () => {
  assert.equal(sanitizeForDisplay("hello\x00\x1fworld"), "hello  world");
  assert.equal(sanitizeForDisplay(null), null);
});

test("decodes getJob tuple return (status slot 7)", () => {
  // Synthetic blob: outer offset + 11-slot head, status=3 (COMPLETED), budget=10^16
  const w: string[] = [];
  w.push(BigInt(32).toString(16).padStart(64, "0")); // outer offset
  w.push(BigInt(42).toString(16).padStart(64, "0")); // id
  w.push("11".repeat(20).padStart(64, "0")); // client
  w.push("22".repeat(20).padStart(64, "0")); // provider
  w.push("33".repeat(20).padStart(64, "0")); // evaluator
  w.push(BigInt(11 * 32).toString(16).padStart(64, "0")); // desc offset
  w.push(BigInt(10n ** 16n).toString(16).padStart(64, "0")); // budget
  w.push(BigInt(1_760_000_000).toString(16).padStart(64, "0")); // expiredAt
  w.push(BigInt(3).toString(16).padStart(64, "0")); // status
  w.push("00".repeat(32)); // hook
  w.push("ab".repeat(32)); // deliverable
  w.push(BigInt(1_755_000_000).toString(16).padStart(64, "0")); // submittedAt
  const job = decodeJob("0x" + w.join(""));
  assert.ok(job);
  assert.equal(job.id, 42n);
  assert.equal(job.status, 3);
  assert.equal(job.budget, 10n ** 16n);
  assert.equal(job.provider, "0x" + "22".repeat(20));
});
