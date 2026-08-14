/**
 * ERC-8004 registration for AgentCensus reference agents.
 * Stores metadata ON-CHAIN as a base64 data URI (registration-v1 schema) so the
 * agent is fully indexable with zero external fetches — exactly what our own
 * census rewards. Gas-free on testnet via MegaFuel is handled upstream; this
 * script pays normal gas if sponsorship isn't available.
 */
import { ABIS, ADDR, clients, type Network } from "./chain.js";

export interface AgentRegistration {
  name: string;
  description: string;
  endpoint: string; // public https base, e.g. https://health.agentcensus.xyz
  skills: string[];
  domains: string[];
}

export function buildAgentUri(reg: AgentRegistration): string {
  const doc = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: reg.name,
    description: reg.description,
    image: "",
    services: [
      {
        name: reg.name,
        endpoint: reg.endpoint,
        skills: reg.skills,
        domains: reg.domains,
      },
    ],
    registrations: [],
    supportedTrusts: ["reputation"],
    active: true,
    x402support: false,
  };
  return "data:application/json;base64," + Buffer.from(JSON.stringify(doc)).toString("base64");
}

export async function registerAgent(
  network: Network,
  privateKey: `0x${string}`,
  reg: AgentRegistration,
): Promise<{ txHash: `0x${string}`; agentUri: string }> {
  const { publicClient, walletClient } = clients(network, privateKey);
  if (!walletClient) throw new Error("private key required");
  const agentUri = buildAgentUri(reg);
  const hash = await walletClient.writeContract({
    address: ADDR[network].registry,
    abi: ABIS.registry,
    functionName: "register",
    args: [agentUri],
  });
  const rcpt = await publicClient.waitForTransactionReceipt({ hash });
  if (rcpt.status !== "success") throw new Error(`register reverted (${hash})`);
  return { txHash: hash, agentUri };
}
