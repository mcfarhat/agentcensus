/**
 * The AgentCensus hire loop — the buyer side ERC-8183 v0.0.1 never shipped.
 *
 * Full lifecycle against any compliant agent:
 *   1. negotiate  — POST {endpoint}/erc8183/negotiate (off-chain quote, signed by provider)
 *   2. createJob  — on-chain, description anchors the negotiation JSON
 *   3. registerJob— bind the job to OptimisticPolicy via the EvaluatorRouter
 *   4. setBudget + approve + fund — escrow the agreed price in U
 *   5. wait       — provider's watcher picks the FUNDED job up, works, submit()s
 *   6. settle     — permissionless after the dispute window (testnet: 1 day)
 *
 * This module is also the engine of the marketplace "hire" button and the
 * settle-sweeper. Keep it dependency-light and auditable.
 */
import { type Address, type Hex, parseUnits } from "viem";
import { ABIS, ADDR, JOB_STATUS, clients, type Network } from "./chain.js";

export interface NegotiationRequest {
  task_description: string;
  terms?: { deliverables?: string; quality_standards?: string; success_criteria?: string };
}

export interface NegotiationResult {
  [key: string]: unknown; // signed envelope per SDK schema v1 — anchored verbatim in job.description
}

export async function negotiate(endpointBase: string, req: NegotiationRequest): Promise<NegotiationResult> {
  const url = new URL("/erc8183/negotiate", endpointBase).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`negotiate failed: HTTP ${res.status} ${await res.text().catch(() => "")}`);
  return (await res.json()) as NegotiationResult;
}

export interface HireOptions {
  network: Network;
  privateKey: `0x${string}`;
  provider: Address; // provider agent's wallet
  description: string; // negotiation JSON (from build_job_description) or plain task
  budgetU: string; // e.g. "0.01"
  expiryHours?: number; // default 48h
  log?: (msg: string) => void;
}

export interface HireResult {
  jobId: bigint;
  txs: Record<string, Hex>;
}

/** Drive create → register(policy) → setBudget → approve → fund. Returns the funded jobId. */
export async function hire(opts: HireOptions): Promise<HireResult> {
  const log = opts.log ?? console.error;
  const { publicClient, walletClient, account } = clients(opts.network, opts.privateKey);
  if (!walletClient || !account) throw new Error("private key required");
  const a = ADDR[opts.network];
  const txs: Record<string, Hex> = {};

  const wait = async (label: string, hash: Hex) => {
    txs[label] = hash;
    log(`${label}: ${hash}`);
    const rcpt = await publicClient.waitForTransactionReceipt({ hash });
    if (rcpt.status !== "success") throw new Error(`${label} reverted (${hash})`);
    return rcpt;
  };

  // 1. createJob — evaluator/hook = EvaluatorRouter (per SDK reference flow)
  // Expiry MUST exceed the policy's dispute window: providers compute their
  // submission deadline as (expiredAt - disputeWindow), so an expiry inside the
  // window means the deadline is already in the past and the job is skipped.
  // (Testnet window: 900s — invisible. Mainnet window: 7 DAYS — fatal.)
  const disputeWindow = (await publicClient.readContract({
    address: a.policy,
    abi: ABIS.policy,
    functionName: "disputeWindow",
  })) as bigint;
  const expiredAt =
    BigInt(Math.floor(Date.now() / 1000)) + disputeWindow + BigInt((opts.expiryHours ?? 48) * 3600);
  const createHash = await walletClient.writeContract({
    address: a.commerce,
    abi: ABIS.commerce,
    functionName: "createJob",
    args: [opts.provider, a.router, expiredAt, opts.description, a.router],
  });
  const rcpt = await wait("createJob", createHash);

  // jobId from JobCreated event (topic[1])
  const jobCreated = rcpt.logs.find((l) => l.address.toLowerCase() === a.commerce.toLowerCase());
  if (!jobCreated?.topics[1]) throw new Error("JobCreated event not found");
  const jobId = BigInt(jobCreated.topics[1]);
  log(`jobId: ${jobId}`);

  // 2. bind policy
  await wait(
    "registerJob",
    await walletClient.writeContract({
      address: a.router,
      abi: ABIS.router,
      functionName: "registerJob",
      args: [jobId, a.policy],
    }),
  );

  // 3. budget + approve + fund
  const budget = parseUnits(opts.budgetU, 18);
  await wait(
    "setBudget",
    await walletClient.writeContract({
      address: a.commerce,
      abi: ABIS.commerce,
      functionName: "setBudget",
      args: [jobId, budget, "0x"],
    }),
  );
  await wait(
    "approve",
    await walletClient.writeContract({
      address: a.token,
      abi: ABIS.erc20,
      functionName: "approve",
      args: [a.commerce, budget],
    }),
  );
  await wait(
    "fund",
    await walletClient.writeContract({
      address: a.commerce,
      abi: ABIS.commerce,
      functionName: "fund",
      args: [jobId, budget, "0x"],
    }),
  );

  return { jobId, txs };
}

export interface JobView {
  id: bigint;
  client: Address;
  provider: Address;
  budget: bigint;
  status: (typeof JOB_STATUS)[number];
  deliverable: Hex;
  submittedAt: bigint;
}

export async function getJob(network: Network, jobId: bigint): Promise<JobView> {
  const { publicClient } = clients(network);
  const a = ADDR[network];
  const j = (await publicClient.readContract({
    address: a.commerce,
    abi: ABIS.commerce,
    functionName: "getJob",
    args: [jobId],
  })) as {
    id: bigint; client: Address; provider: Address; budget: bigint; status: number;
    deliverable: Hex; submittedAt: bigint;
  };
  return { ...j, status: JOB_STATUS[j.status] ?? ("OPEN" as never) };
}

/** Permissionless settle — also the core of the settle-sweeper. */
export async function settle(network: Network, privateKey: `0x${string}`, jobId: bigint): Promise<Hex> {
  const { publicClient, walletClient } = clients(network, privateKey);
  if (!walletClient) throw new Error("private key required");
  const a = ADDR[network];
  const hash = await walletClient.writeContract({
    address: a.router,
    abi: ABIS.router,
    functionName: "settle",
    args: [jobId, "0x"],
  });
  const rcpt = await publicClient.waitForTransactionReceipt({ hash });
  if (rcpt.status !== "success") throw new Error(`settle reverted (${hash})`);
  return hash;
}

/** Poll until the provider submits, or timeout. */
export async function waitForSubmission(
  network: Network,
  jobId: bigint,
  timeoutMinutes = 30,
  log: (m: string) => void = console.error,
): Promise<JobView> {
  const deadline = Date.now() + timeoutMinutes * 60_000;
  for (;;) {
    const job = await getJob(network, jobId);
    log(`job ${jobId}: ${job.status}`);
    if (job.status !== "OPEN" && job.status !== "FUNDED") return job;
    if (Date.now() > deadline) throw new Error(`timeout waiting for submission on job ${jobId}`);
    await new Promise((r) => setTimeout(r, 20_000));
  }
}
