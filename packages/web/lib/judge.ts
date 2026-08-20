/**
 * Judge Mode — server-side sponsored hire engine (TESTNET ONLY).
 *
 * One click on an agent profile drives the full ERC-8183 lifecycle with a
 * relayer wallet paying gas: negotiate → createJob → registerJob(policy) →
 * setBudget(0) → fund(0) → wait for the provider's submission. Zero-budget
 * jobs escrow nothing, so the relayer risks only testnet gas.
 *
 * Enabled only when JUDGE_RELAYER_KEY is set in the web app's environment
 * (a FRESH testnet-only key holding a little tBNB — never a real-funds key).
 */
import { createPublicClient, createWalletClient, http, parseAbi, getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { randomUUID } from "node:crypto";

// ---- chain config (testnet only, by design) ----
const RPC = process.env.BSC_TESTNET_RPC ?? "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
const ADDR = {
  commerce: "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address,
  router: "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25" as Address,
  policy: "0xd6a4217588f6b1f5657a92a3e94e6422ad771cea" as Address, // rotated 2026-08
};
const COMMERCE_ABI = parseAbi([
  "function createJob(address provider, address evaluator, uint256 expiredAt, string description, address hook) returns (uint256)",
  "function setBudget(uint256 jobId, uint256 amount, bytes optParams)",
  "function fund(uint256 jobId, uint256 expectedBudget, bytes optParams)",
]);
const ROUTER_ABI = parseAbi(["function registerJob(uint256 jobId, address policy)"]);
const JOB_STATUS = ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"] as const;

export function judgeModeEnabled(): boolean {
  return typeof process.env.JUDGE_RELAYER_KEY === "string" && process.env.JUDGE_RELAYER_KEY.startsWith("0x");
}

function chainClients() {
  const key = process.env.JUDGE_RELAYER_KEY as `0x${string}`;
  const account = privateKeyToAccount(key);
  const publicClient = createPublicClient({ chain: bscTestnet, transport: http(RPC) });
  const walletClient = createWalletClient({ chain: bscTestnet, transport: http(RPC), account });
  return { publicClient, walletClient, account };
}

// ---- canonical job description (must byte-match the Python SDK's build_job_description) ----
function sanitizeForClaim(s: unknown): string {
  const str = typeof s === "string" ? s : String(s);
  let r = str.replace(/\[/g, "(").replace(/\]/g, ")");
  let out = "";
  for (const ch of r) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x20 || ch === "\t" || ch === "\n") out += ch;
  }
  return out;
}

/** JSON.stringify with recursively sorted keys, compact separators, and \uXXXX
 *  escapes for non-ASCII — byte-identical to python json.dumps(sort_keys=True,
 *  separators=(",",":")) with default ensure_ascii. */
function pyDumps(v: unknown): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === "object") {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(x as object).sort()) o[k] = sort((x as Record<string, unknown>)[k]);
      return o;
    }
    return x;
  };
  const json = JSON.stringify(sort(v));
  return json.replace(/[\u0080-\uffff]/g, (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
}

export function buildJobDescription(neg: Record<string, any>): string {
  const response = neg.response ?? {};
  const request = neg.request ?? {};
  if (!response.accepted) throw new Error("negotiation was not accepted by the agent");
  const rt = response.terms ?? {};
  const price = rt.price ?? "";
  const currency = rt.currency ?? "";
  if (!price) throw new Error("negotiation response missing price");
  if (!currency) throw new Error("negotiation response missing currency");

  const terms: Record<string, unknown> = {
    deliverables: sanitizeForClaim(rt.deliverables ?? ""),
    quality_standards: sanitizeForClaim(rt.quality_standards ?? ""),
  };
  if (rt.success_criteria) terms.success_criteria = (rt.success_criteria as unknown[]).map(sanitizeForClaim);

  const content: Record<string, unknown> = {
    version: 1,
    negotiated_at: neg.negotiated_at ?? response.negotiated_at ?? Math.floor(Date.now() / 1000),
    task: sanitizeForClaim(request.task_description ?? ""),
    terms,
    price,
    currency,
  };
  const qexp = neg.quote_expires_at ?? response.quote_expires_at;
  if (qexp !== undefined && qexp !== null) content.quote_expires_at = qexp;
  if (neg.chain_id !== undefined && neg.chain_id !== null) content.chain_id = neg.chain_id;
  if (neg.verifying_contract) content.verifying_contract = getAddress(neg.verifying_contract);
  if (neg.negotiation_hash) content.negotiation_hash = neg.negotiation_hash;
  if (neg.provider_sig) content.provider_sig = neg.provider_sig;

  const description = pyDumps(content);
  if (description.length > 2048) throw new Error("job description exceeds 2048 bytes");
  return description;
}

// ---- endpoint guard (Judge Mode hires arbitrary indexed agents) ----
export function validateEndpoint(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("endpoint must be https");
  const h = url.hostname;
  if (/^(\d+\.){3}\d+$/.test(h) || h.includes(":")) throw new Error("IP-literal endpoints not allowed");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) throw new Error("private hostname");
  return url.toString().replace(/\/$/, "");
}

// ---- session store (in-memory; single Next.js server process) ----
export interface JudgeSession {
  id: string;
  agentId: number;
  agentName: string;
  provider: Address;
  phase: "negotiating" | "creating" | "registering" | "budget" | "funding" | "waiting_submission" | "submitted" | "error";
  txs: { label: string; hash: string }[];
  jobId?: string;
  jobStatus?: string;
  error?: string;
  startedAt: number;
  updatedAt: number;
}
const sessions = new Map<string, JudgeSession>();
const ipLast = new Map<string, number>();
let dayKey = "";
let dayCount = 0;
let chainQueue: Promise<unknown> = Promise.resolve(); // serialize txs → no nonce races

const MAX_PER_DAY = 40;
const IP_COOLDOWN_MS = 60_000;

export function getSession(id: string): JudgeSession | undefined {
  return sessions.get(id);
}

export async function refreshJob(s: JudgeSession): Promise<void> {
  if (!s.jobId) return;
  try {
    const { publicClient } = chainClients();
    const res = await publicClient.call({
      to: ADDR.commerce,
      data: ("0xbf22c457" + BigInt(s.jobId).toString(16).padStart(64, "0")) as Hex,
    });
    const hex = (res.data ?? "0x").slice(2);
    const words: string[] = [];
    for (let i = 0; i + 64 <= hex.length; i += 64) words.push(hex.slice(i, i + 64));
    if (words.length >= 11) {
      const base = parseInt(words[0], 16) === 32 ? 1 : 0;
      const st = parseInt(words[base + 7], 16);
      s.jobStatus = JOB_STATUS[st] ?? `status ${st}`;
      if ((st === 2 || st === 3) && s.phase === "waiting_submission") {
        s.phase = "submitted";
      }
      s.updatedAt = Date.now();
    }
  } catch {
    /* transient RPC issue — keep last known state */
  }
}

export function startJudgeHire(
  agent: { agent_id: number; name: string | null; owner: string; endpoint: string },
  ip: string,
): { ok: true; sessionId: string } | { ok: false; error: string } {
  if (!judgeModeEnabled()) return { ok: false, error: "Judge Mode is not enabled on this deployment" };

  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayKey) { dayKey = today; dayCount = 0; }
  if (dayCount >= MAX_PER_DAY) return { ok: false, error: "Daily sponsored-hire quota reached — try tomorrow or use the CLI" };
  const last = ipLast.get(ip) ?? 0;
  if (Date.now() - last < IP_COOLDOWN_MS) return { ok: false, error: "One hire per minute — give the last one a moment" };
  const running = [...sessions.values()].filter((s) => !["submitted", "error"].includes(s.phase));
  if (running.length >= 2) return { ok: false, error: "Two sponsored hires already in flight — try again in a minute" };

  let endpoint: string;
  try { endpoint = validateEndpoint(agent.endpoint); } catch (e) { return { ok: false, error: (e as Error).message }; }

  ipLast.set(ip, Date.now());
  dayCount++;

  const s: JudgeSession = {
    id: randomUUID(),
    agentId: agent.agent_id,
    agentName: agent.name ?? `Agent #${agent.agent_id}`,
    provider: getAddress(agent.owner),
    phase: "negotiating",
    txs: [],
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  sessions.set(s.id, s);
  // GC: drop finished sessions older than 2h
  for (const [k, v] of sessions) if (Date.now() - v.updatedAt > 7_200_000) sessions.delete(k);

  chainQueue = chainQueue.then(() => runHire(s, endpoint)).catch(() => {});
  return { ok: true, sessionId: s.id };
}

async function runHire(s: JudgeSession, endpoint: string): Promise<void> {
  const touch = (phase: JudgeSession["phase"]) => { s.phase = phase; s.updatedAt = Date.now(); };
  try {
    // 1. negotiate (off-chain)
    const negRes = await fetch(new URL("/erc8183/negotiate", endpoint).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_description:
          "AgentCensus Judge Mode demo hire: perform your standard service once and submit the deliverable. Zero-budget verification job. Demo account 0x0475c8fa8ac94888eab9b4329b93c263708a9a07",
        terms: {
          deliverables: "The agent's standard service output, submitted on-chain per ERC-8183",
          quality_standards: "Deliverable produced from live data at time of execution",
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!negRes.ok) throw new Error(`agent negotiate endpoint returned HTTP ${negRes.status}`);
    const neg = (await negRes.json()) as Record<string, any>;
    const description = buildJobDescription(neg);

    const { publicClient, walletClient } = chainClients();
    const wait = async (label: string, hash: Hex) => {
      s.txs.push({ label, hash }); s.updatedAt = Date.now();
      const rcpt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
      if (rcpt.status !== "success") throw new Error(`${label} reverted`);
      return rcpt;
    };

    // 2. createJob
    touch("creating");
    const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 48 * 3600);
    const rcpt = await wait("createJob", await walletClient.writeContract({
      address: ADDR.commerce, abi: COMMERCE_ABI, functionName: "createJob",
      args: [s.provider, ADDR.router, expiredAt, description, ADDR.router],
    }));
    const created = rcpt.logs.find((l) => l.address.toLowerCase() === ADDR.commerce.toLowerCase());
    if (!created?.topics[1]) throw new Error("JobCreated event not found");
    const jobId = BigInt(created.topics[1]);
    s.jobId = jobId.toString();

    // 3. bind arbitration policy
    touch("registering");
    await wait("registerJob", await walletClient.writeContract({
      address: ADDR.router, abi: ROUTER_ABI, functionName: "registerJob", args: [jobId, ADDR.policy],
    }));

    // 4. zero budget + fund (no tokens move; flips status to FUNDED for the provider's watcher)
    touch("budget");
    await wait("setBudget", await walletClient.writeContract({
      address: ADDR.commerce, abi: COMMERCE_ABI, functionName: "setBudget", args: [jobId, 0n, "0x"],
    }));
    touch("funding");
    await wait("fund", await walletClient.writeContract({
      address: ADDR.commerce, abi: COMMERCE_ABI, functionName: "fund", args: [jobId, 0n, "0x"],
    }));

    // 5. wait for the provider to submit (their watcher polls FUNDED jobs)
    touch("waiting_submission");
    const deadline = Date.now() + 15 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 15_000));
      await refreshJob(s);
      if (s.phase === "submitted") return;
    }
    // Not an error — the job stays valid on-chain; agent may just be slow.
    s.error = "Provider hasn't submitted yet — the job remains live on-chain; check its status on the jobs page.";
    s.updatedAt = Date.now();
  } catch (e) {
    s.phase = "error";
    s.error = (e as Error).message;
    s.updatedAt = Date.now();
  }
}
