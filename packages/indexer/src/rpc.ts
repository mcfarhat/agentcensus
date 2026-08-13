/**
 * Minimal JSON-RPC client with ordered-fallback endpoints, retry, and
 * bounded concurrency. No provider SDK — we only need eth_call/eth_blockNumber
 * for the enumeration strategy (sequential agent IDs, direct view calls).
 */
import { CHAINS, type Network } from "./config.js";

interface RpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown[];
}

let idCounter = 1;

export class RpcClient {
  constructor(
    private readonly urls: string[],
    private readonly timeoutMs = 10_000,
  ) {}

  static for(net: Network): RpcClient {
    return new RpcClient(CHAINS[net].rpcs);
  }

  async request<T = string>(method: string, params: unknown[]): Promise<T> {
    let lastError: unknown;
    for (const url of this.urls) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const body: RpcRequest = { jsonrpc: "2.0", id: idCounter++, method, params };
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), this.timeoutMs);
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
          const json = (await res.json()) as { result?: T; error?: { code: number; message: string } };
          if (json.error) {
            // execution reverts are semantic results (e.g. ownerOf on a burned id) — surface them
            throw new RpcError(json.error.code, json.error.message);
          }
          return json.result as T;
        } catch (err) {
          lastError = err;
          if (err instanceof RpcError) throw err; // don't retry semantic errors
          await sleep(250 * (attempt + 1));
        }
      }
    }
    throw new Error(`All RPC endpoints failed for ${method}: ${String(lastError)}`);
  }

  ethCall(to: string, data: string): Promise<string> {
    return this.request("eth_call", [{ to, data }, "latest"]);
  }

  async blockNumber(): Promise<number> {
    return parseInt(await this.request("eth_blockNumber", []), 16);
  }
}

export class RpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run `fn` over `items` with at most `concurrency` in flight. Preserves order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}
