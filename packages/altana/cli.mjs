#!/usr/bin/env node
/**
 * AgentCensus × Altana — scoped-session hiring demo (BSC testnet).
 *
 * An Altana smart wallet owned by a human admin grants a SCOPED SESSION KEY
 * (call allowlist + daily $U spend cap + expiry, registered in Keystore).
 * The session key — never the admin — then hires AgentCensus agents through
 * the official ERC-8183 kernel, with every constraint enforced on-chain and
 * verifiable in the Altana explorer. Revocation is instant and atomic.
 *
 * Commands:
 *   node cli.mjs setup             create wallet, faucet $U, grant + register session
 *   node cli.mjs hire <provider>   hire an agent via the SESSION key (1 $U budget)
 *   node cli.mjs job <jobId>       show an ERC-8183 job's status
 *   node cli.mjs status            wallet, balances, session state
 *   node cli.mjs revoke            revoke the session (Keystore + account, atomic)
 *
 * Env (../..\.env-altana or environment):
 *   ALTANA_ADMIN_KEY=0x...   fresh admin key (the human owner)
 * Session state persists to .altana-session.json (gitignored).
 */
import {
  createClient,
  BNB_TESTNET,
  TESTNET_RELAY_URL,
  ERC8183_ADDRESSES,
  signerFromPrivateKey,
  buildHireCalls,
  getErc8183Job,
  settleErc8183Job,
  fundNative,
  waitForBalance,
  JOB_STATUS,
} from "@altananetwork/sdk";
import { createClient as viemClient, createPublicClient, http } from "viem";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = join(HERE, ".altana-session.json");
const CHAIN_ID = 97;
const A = ERC8183_ADDRESSES[CHAIN_ID];
const U_FAUCET = "0x86e9197CC0F76E4e4aaa7082180945196bBAb5D3";
// The SDK's default testnet policy (0x4F4678...) has been DE-WHITELISTED on the
// router (registerJob reverts PolicyNotWhitelisted). Use the currently
// whitelisted OptimisticPolicy instead — same one our Judge Mode uses.
const WHITELISTED_POLICY = "0xd6a4217588f6b1f5657a92a3e94e6422ad771cea";
const ONE_U = 10n ** 18n;
const SPEND_CAP_U = 5n * ONE_U; // 5 $U per day — the session can NEVER escrow more
const SESSION_DAYS = 7;

// Default provider: AgentCensus Health Factor Monitor (testnet #1822)
const DEFAULT_PROVIDER = "0x0475c8fa8ac94888eab9b4329b93c263708a9a07";

function env(name) {
  if (process.env[name]) return process.env[name];
  for (const p of [join(HERE, ".env"), join(HERE, "..", "..", ".env-altana")]) {
    if (existsSync(p)) {
      const m = readFileSync(p, "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
      if (m) return m[1].trim();
    }
  }
  return undefined;
}

// BigInt-safe persistence: bigints saved as "123n" strings, revived on load.
function loadState() {
  if (!existsSync(SESSION_FILE)) return null;
  return JSON.parse(readFileSync(SESSION_FILE, "utf8"), (k, v) =>
    typeof v === "string" && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v,
  );
}

function saveState(s) {
  writeFileSync(
    SESSION_FILE,
    JSON.stringify(s, (k, v) => (typeof v === "bigint" ? v.toString() + "n" : v), 2),
  );
}

function rebuildSession(state) {
  return {
    walletAddress: state.walletAddress,
    signer: signerFromPrivateKey(state.sessionKey),
    publicKey: state.publicKey,
    permissions: state.permissions,
    expiry: state.expiry,
  };
}

const client = createClient({ chains: [BNB_TESTNET] });
const adminKey = env("ALTANA_ADMIN_KEY");
const cmd = process.argv[2] ?? "status";

if (cmd === "setup") {
  if (!adminKey) throw new Error("Set ALTANA_ADMIN_KEY (fresh testnet key) in env or .env-altana");
  const admin = signerFromPrivateKey(adminKey);

  console.log("1/4 creating Altana smart wallet (admin-owned)...");
  const wallet = await client.createWallet({ signer: admin, chainId: CHAIN_ID });
  console.log("    wallet:", wallet.address);

  console.log("1b/4 funding the smart wallet with relay-faucet tBNB (covers relay fees)...");
  try {
    const relay = viemClient({ chain: BNB_TESTNET.chain, transport: http(TESTNET_RELAY_URL, { timeout: 60_000 }) });
    await fundNative(relay, wallet.address, 30_000_000_000_000_000n); // 0.03 tBNB
    const pub = createPublicClient({ chain: BNB_TESTNET.chain, transport: http(BNB_TESTNET.publicRpcUrl) });
    const bal = await waitForBalance(pub, wallet.address, 1_000_000_000_000_000n);
    console.log("    wallet native balance:", (Number(bal) / 1e18).toFixed(4), "tBNB");
  } catch (e) {
    console.log("    relay faucet failed:", String(e.message ?? e).slice(0, 120));
    console.log("    -> send ~0.05 tBNB manually to", wallet.address, "then re-run setup.");
  }

  console.log("2/4 requesting 10 testnet $U from the faucet...");
  try {
    await client.execute({
      wallet,
      signer: admin,
      chainId: CHAIN_ID,
      calls: [{ to: U_FAUCET, data: "0x359cf2b7" /* requestTokens() */ }],
    });
    console.log("    faucet ok");
  } catch (e) {
    console.log("    faucet skipped:", String(e.message ?? e).slice(0, 90), "(cooldown? continuing)");
  }

  console.log("3/4 granting scoped session (allowlist + 5 $U/day cap + 7d expiry, Keystore-registered)...");
  const sessionKey = "0x" + randomBytes(32).toString("hex");
  const grant = await client.grantSession({
    wallet,
    signer: admin,
    chainId: CHAIN_ID,
    sessionSigner: signerFromPrivateKey(sessionKey),
    permissions: {
      // The session may ONLY talk to the ERC-8183 kernel, its router, the
      // $U token (approve for escrow), and the faucet. Nothing else.
      calls: [
        { to: A.commerce },
        { to: A.router },
        { to: A.paymentToken },
        { to: U_FAUCET },
      ],
      spend: [
        { limit: SPEND_CAP_U, period: "day", token: A.paymentToken },
        // Native tBNB allowance for relay fees — the SDK's own guidance:
        // "alongside a small native spend limit for gas".
        { limit: 20_000_000_000_000_000n, period: "day" }, // 0.02 tBNB/day
      ],
    },
    expiry: Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 3600,
    register: true, // Keystore registration — authority provable by anyone
  });
  const session = grant.session ?? grant;
  console.log("    session key:", session.publicKey);
  if (grant.transactionHash) console.log("    grant tx:", grant.transactionHash);

  saveState({
    walletAddress: wallet.address,
    wallet, // full wallet object for later admin ops
    sessionKey,
    publicKey: session.publicKey,
    permissions: session.permissions,
    expiry: session.expiry,
  });
  console.log("4/4 saved .altana-session.json");
  console.log("\nVerify in the Altana testnet explorer: https://testnet.altana.network");
} else if (cmd === "hire") {
  const state = loadState();
  if (!state) throw new Error("run setup first");
  const provider = process.argv[3] ?? DEFAULT_PROVIDER;
  const session = rebuildSession(state);
  console.log(`hiring ${provider} via SESSION key (budget 1 $U, cap ${SPEND_CAP_U / ONE_U} $U/day)...`);
  // Replicates the SDK's hireErc8183Agent, but binds the WHITELISTED policy
  // instead of the SDK's stale default.
  const addresses = { ...A, policy: WHITELISTED_POLICY };
  const pub = createPublicClient({ chain: BNB_TESTNET.chain, transport: http(BNB_TESTNET.publicRpcUrl) });
  const [disputeWindow, jobCounter] = await Promise.all([
    pub.readContract({ address: WHITELISTED_POLICY, abi: [{ name: "disputeWindow", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }], functionName: "disputeWindow" }),
    pub.readContract({ address: A.commerce, abi: [{ name: "jobCounter", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }], functionName: "jobCounter" }),
  ]);
  const jobId = jobCounter + 1n;
  // Pad expiry generously: the provider agent derives its submit deadline as
  // expiredAt - ITS OWN policy preset's window (1 day on testnet), which can
  // exceed the bound policy's actual window (900s). +48h keeps the deadline
  // in the future under any interpretation.
  const expiredAt = BigInt(Math.floor(Date.now() / 1000)) + BigInt(disputeWindow) + 172800n;
  const calls = buildHireCalls({
    addresses,
    jobId,
    provider,
    description:
      "Altana scoped-session hire: report Venus Protocol health for account " +
      `${provider} at the current block and submit the signed report on-chain.`,
    budget: ONE_U, // 1 $U — well inside the session's spend cap
    expiredAt,
  });
  const exec = await client.execute({ session, calls, chainId: CHAIN_ID });
  const job = await getErc8183Job(BNB_TESTNET, jobId);
  if (job.client.toLowerCase() !== state.walletAddress.toLowerCase())
    throw new Error(`predicted jobId ${jobId} was taken by a concurrent job — re-run hire`);
  const res = { jobId, budget: ONE_U, expiredAt, tx: exec.transactionHash ?? exec.status };
  console.log("jobId:", res.jobId.toString(), "budget:", res.budget.toString(), "expiredAt:", res.expiredAt.toString(), "tx:", res.tx);
  state.lastJobId = res.jobId.toString();
  saveState(state);
  console.log("The AgentCensus agent will pick this up and submit on-chain within ~a minute.");
  console.log(`Track: node cli.mjs job ${res.jobId}`);
} else if (cmd === "job") {
  const jobId = BigInt(process.argv[3] ?? loadState()?.lastJobId ?? 0);
  const job = await getErc8183Job(BNB_TESTNET, jobId);
  const status = Object.entries(JOB_STATUS).find(([, v]) => v === job.status)?.[0] ?? job.status;
  console.log(JSON.stringify({ ...job, status }, (k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
} else if (cmd === "settle") {
  const state = loadState();
  const jobId = BigInt(process.argv[3] ?? state?.lastJobId ?? 0);
  const session = rebuildSession(state);
  console.log(`settling job ${jobId} via session key (releases escrow to the agent)...`);
  const res = await settleErc8183Job(session, { jobId, action: "approve" }, { network: BNB_TESTNET });
  console.log("settled:", res.transactionHash ?? res.status);
} else if (cmd === "refund") {
  // Reclaim escrow from an expired job the provider never delivered.
  const state = loadState();
  const jobId = BigInt(process.argv[3] ?? state?.lastJobId ?? 0);
  const { buildClaimRefundCall } = await import("@altananetwork/sdk");
  const session = rebuildSession(state);
  console.log(`claiming refund for expired job ${jobId} via session key...`);
  const res = await client.execute({ session, calls: [buildClaimRefundCall(CHAIN_ID, jobId)], chainId: CHAIN_ID });
  console.log("refund:", res.transactionHash ?? res.status);
} else if (cmd === "status") {
  const state = loadState();
  if (!state) throw new Error("run setup first");
  const bal = await client.balances({
    wallet: state.walletAddress,
    tokens: [A.paymentToken],
    chainId: CHAIN_ID,
  });
  console.log(JSON.stringify(
    {
      wallet: state.walletAddress,
      sessionPublicKey: state.publicKey,
      sessionExpiry: new Date(state.expiry * 1000).toISOString(),
      expired: state.expiry < Date.now() / 1000,
      permissions: state.permissions,
      balances: bal,
      lastJobId: state.lastJobId ?? null,
      explorer: "https://testnet.altana.network",
    },
    (k, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ));
} else if (cmd === "revoke") {
  if (!adminKey) throw new Error("Set ALTANA_ADMIN_KEY — revocation is an ADMIN action");
  const state = loadState();
  if (!state) throw new Error("run setup first");
  const admin = signerFromPrivateKey(adminKey);
  console.log("revoking session (Keystore + account authority, one atomic userOp)...");
  const res = await client.revokeSession({
    wallet: state.wallet,
    signer: admin,
    chainId: CHAIN_ID,
    session: state.publicKey,
  });
  console.log("revoked:", res.transactionHash ?? res.status);
  console.log("From the next block, isValidKey(sessionKey) = false — the agent is powerless.");
} else {
  console.log("commands: setup | hire [provider] | job [id] | settle [id] | refund [id] | status | revoke");
}
