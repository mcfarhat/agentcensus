/**
 * AgentCensus — chain + contract configuration.
 * Verified live 2026-08-14 (see docs/day1-findings.md).
 */

export type Network = "mainnet" | "testnet";

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcs: string[]; // ordered fallback list — first is primary
  contracts: {
    identityRegistry: `0x${string}`;
    agenticCommerce: `0x${string}`;
    evaluatorRouter: `0x${string}`;
    optimisticPolicy: `0x${string}`;
    paymentToken: `0x${string}`; // "U" token, 18 decimals
  };
  /** OptimisticPolicy.disputeWindow(), seconds — verified on-chain */
  disputeWindowSec: number;
}

export const CHAINS: Record<Network, ChainConfig> = {
  mainnet: {
    chainId: 56,
    name: "BSC Mainnet",
    rpcs: [
      process.env.BSC_MAINNET_RPC ?? "https://bsc-rpc.publicnode.com",
      "https://bsc-dataseed.bnbchain.org",
      "https://rpc.ankr.com/bsc",
    ],
    contracts: {
      identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
      agenticCommerce: "0xea4daa3100a767e86fded867729ae7446476eba6",
      evaluatorRouter: "0x51895229e12f9876011789b04f8698af06ccd6da",
      optimisticPolicy: "0x9c01845705b3078aa2e8cff7520a6376fd766de5",
      paymentToken: "0xce24439f2d9c6a2289f741120fe202248b666666",
    },
    disputeWindowSec: 604_800, // 7 days — mainnet demo jobs must be seeded ≥7d before judging
  },
  testnet: {
    chainId: 97,
    name: "BSC Testnet",
    rpcs: [
      process.env.BSC_TESTNET_RPC ?? "https://bsc-testnet-rpc.publicnode.com",
      "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
    ],
    contracts: {
      identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
      agenticCommerce: "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de",
      evaluatorRouter: "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25",
      optimisticPolicy: "0x4f4678d4439fec812ac7674bb3efb4c8f5fb78a6",
      paymentToken: "0xc70b8741b8b07a6d61e54fd4b20f22fa648e5565",
    },
    disputeWindowSec: 86_400, // 1 day
  },
};

/** ERC-8183 job lifecycle — order-critical, mirrors IACP.JobStatus (bnbagent SDK). */
export enum JobStatus {
  OPEN = 0,
  FUNDED = 1,
  SUBMITTED = 2,
  COMPLETED = 3,
  REJECTED = 4,
  EXPIRED = 5,
}

export const JOB_STATUS_NAMES = [
  "OPEN",
  "FUNDED",
  "SUBMITTED",
  "COMPLETED",
  "REJECTED",
  "EXPIRED",
] as const;

/** Reference categories judged for "agent diversity". */
export const CATEGORIES = [
  "monitoring", // rebalancing / monitoring
  "grid-trading",
  "health-factor",
  "yield",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];
