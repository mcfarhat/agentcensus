/**
 * Shared viem clients + contract handles for the hire loop.
 * Testnet-first: the 1-day dispute window makes full-lifecycle testing feasible.
 */
import { createPublicClient, createWalletClient, http, type Abi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc, bscTestnet } from "viem/chains";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const loadAbi = (name: string): Abi => {
  const raw = JSON.parse(readFileSync(path.join(__dirname, "..", "abis", `${name}.json`), "utf8"));
  return (Array.isArray(raw) ? raw : raw.abi) as Abi;
};

export const ABIS = {
  commerce: loadAbi("AgenticCommerce"),
  router: loadAbi("EvaluatorRouter"),
  registry: loadAbi("IdentityRegistry"),
  erc20: loadAbi("ERC20"),
  policy: loadAbi("OptimisticPolicy"),
};

export type Network = "mainnet" | "testnet";

export const ADDR: Record<Network, {
  registry: Address; commerce: Address; router: Address; policy: Address; token: Address;
}> = {
  mainnet: {
    registry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    commerce: "0xea4daa3100a767e86fded867729ae7446476eba6",
    router: "0x51895229e12f9876011789b04f8698af06ccd6da",
    policy: "0x9c01845705b3078aa2e8cff7520a6376fd766de5",
    token: "0xce24439f2d9c6a2289f741120fe202248b666666",
  },
  testnet: {
    registry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    commerce: "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de",
    router: "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25",
    policy: "0xd6A4217588F6B1F5657a92A3e94E6422Ad771cEa", // rotated 2026-08; old 0x4f4678... de-whitelisted
    token: "0xc70b8741b8b07a6d61e54fd4b20f22fa648e5565",
  },
};

export function clients(net: Network, privateKey?: `0x${string}`) {
  const chain = net === "mainnet" ? bsc : bscTestnet;
  const rpc =
    net === "mainnet"
      ? (process.env.BSC_MAINNET_RPC ?? "https://bsc-dataseed.bnbchain.org")
      : (process.env.BSC_TESTNET_RPC ?? "https://data-seed-prebsc-1-s1.bnbchain.org:8545");
  const publicClient = createPublicClient({ chain, transport: http(rpc) });
  const account = privateKey ? privateKeyToAccount(privateKey) : undefined;
  const walletClient = account ? createWalletClient({ chain, transport: http(rpc), account }) : undefined;
  return { publicClient, walletClient, account, chain };
}

export const JOB_STATUS = ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"] as const;
