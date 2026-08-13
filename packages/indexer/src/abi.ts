/**
 * Hand-rolled ABI helpers for the handful of view calls we need.
 * Selectors precomputed with keccak-256 (verified against bnbagent SDK ABIs).
 */

export const SELECTORS = {
  // IdentityRegistry (ERC-8004, ERC-721)
  ownerOf: "0x6352211e", // ownerOf(uint256)
  tokenURI: "0xc87b56dd", // tokenURI(uint256)
  getAgentWallet: "0x50cd4df2", // getAgentWallet(uint256) — recompute if call reverts unexpectedly
  // AgenticCommerce (ERC-8183 kernel)
  jobCounter: "0x50355d76", // jobCounter()
  getJob: "0xbf22c457", // getJob(uint256)
  platformFeeBP: "0xff96092a", // platformFeeBP()
  paymentToken: "0x3013ce29", // paymentToken()
  // OptimisticPolicy
  disputeWindow: "0x117f5f92", // disputeWindow()
} as const;

export const pad32 = (n: bigint | number): string =>
  BigInt(n).toString(16).padStart(64, "0");

export const hexToBigInt = (hex: string): bigint => BigInt(hex);

/** Split a 0x-prefixed return blob into 32-byte words. */
export const words = (hex: string): string[] => hex.slice(2).match(/.{64}/g) ?? [];

export const wordToAddress = (w: string): `0x${string}` =>
  `0x${w.slice(24)}` as `0x${string}`;

/** Decode a solo `string` return value (offset + length + data). */
export function decodeString(hex: string): string | null {
  if (!hex || hex === "0x") return null;
  try {
    const w = hex.slice(2);
    const len = parseInt(w.slice(64, 128), 16);
    const bytes = w.slice(128, 128 + len * 2).match(/.{2}/g) ?? [];
    return Buffer.from(bytes.map((b) => parseInt(b, 16))).toString("utf8");
  } catch {
    return null;
  }
}

export interface RawJob {
  id: bigint;
  client: `0x${string}`;
  provider: `0x${string}`;
  evaluator: `0x${string}`;
  budget: bigint;
  expiredAt: bigint;
  status: number;
  deliverable: string; // bytes32 hex
  submittedAt: bigint;
}

/**
 * Decode getJob(uint256) → IACP.Job tuple.
 * Tuple head (after the outer offset word when present):
 * [0]=id [1]=client [2]=provider [3]=evaluator [4]=desc offset [5]=budget
 * [6]=expiredAt [7]=status [8]=hook [9]=deliverable [10]=submittedAt
 */
export function decodeJob(hex: string): RawJob | null {
  const w = words(hex);
  if (w.length < 11) return null;
  const base = parseInt(w[0], 16) === 32 ? 1 : 0;
  if (w.length < base + 11) return null;
  return {
    id: hexToBigInt(`0x${w[base]}`),
    client: wordToAddress(w[base + 1]),
    provider: wordToAddress(w[base + 2]),
    evaluator: wordToAddress(w[base + 3]),
    budget: hexToBigInt(`0x${w[base + 5]}`),
    expiredAt: hexToBigInt(`0x${w[base + 6]}`),
    status: parseInt(w[base + 7], 16),
    deliverable: `0x${w[base + 9]}`,
    submittedAt: hexToBigInt(`0x${w[base + 10]}`),
  };
}
