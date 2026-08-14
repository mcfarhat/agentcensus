/**
 * EIP-8004 registration-v1 metadata parsing + category classification.
 *
 * Verified on-chain reality (2026-08-14): most tokenURIs are
 * `data:application/json;base64,...` — decodable with zero HTTP. External
 * URIs (https / ipfs / raw JSON) are recorded for the phase-2 prober, which
 * is the ONLY place external fetches happen (with SSRF hardening — see
 * prober.ts). This module performs no network I/O.
 */
import type { Category } from "./config.js";

export interface AgentService {
  name?: string;
  endpoint?: string;
  skills?: string[];
  domains?: string[];
}

export interface AgentMetadata {
  name: string | null;
  description: string | null;
  services: AgentService[];
  supportedTrusts: string[];
  active: boolean | null;
  x402support: boolean | null;
  raw: unknown;
}

export type UriKind = "onchain-json" | "https" | "ipfs" | "bare-label" | "empty" | "unparseable";

export interface ParsedUri {
  kind: UriKind;
  /** Set for https/ipfs — fetched later by the prober, never here. */
  externalUrl: string | null;
  metadata: AgentMetadata | null;
}

export function parseTokenUri(uri: string | null): ParsedUri {
  if (!uri || uri.trim() === "") return { kind: "empty", externalUrl: null, metadata: null };
  const trimmed = uri.trim();

  if (trimmed.startsWith("data:application/json;base64,")) {
    try {
      const json = Buffer.from(trimmed.slice("data:application/json;base64,".length), "base64").toString("utf8");
      return { kind: "onchain-json", externalUrl: null, metadata: parseMetadataJson(json) };
    } catch {
      return { kind: "unparseable", externalUrl: null, metadata: null };
    }
  }
  if (trimmed.startsWith("data:application/json,")) {
    return {
      kind: "onchain-json",
      externalUrl: null,
      metadata: parseMetadataJson(decodeURIComponent(trimmed.slice("data:application/json,".length))),
    };
  }
  if (trimmed.startsWith("{")) {
    // raw JSON stored directly in tokenURI (seen in the wild)
    return { kind: "onchain-json", externalUrl: null, metadata: parseMetadataJson(trimmed) };
  }
  if (trimmed.startsWith("ipfs://")) return { kind: "ipfs", externalUrl: trimmed, metadata: null };
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://"))
    return { kind: "https", externalUrl: trimmed, metadata: null };

  // Bare-label registrations (verified common on testnet: "sales-analyzer:analyst-01",
  // "user-a2675504", "/avatars/cz.glb"): a short single-line printable string with no
  // scheme and no JSON. Not a parser failure — the registration simply carries no
  // structured metadata. Recover the label as the display name.
  if (isBareLabel(trimmed)) {
    return {
      kind: "bare-label",
      externalUrl: null,
      metadata: {
        name: trimmed.slice(0, 120),
        description: null,
        services: [],
        supportedTrusts: [],
        active: null,
        x402support: null,
        raw: trimmed,
      },
    };
  }

  return { kind: "unparseable", externalUrl: null, metadata: null };
}

function isBareLabel(s: string): boolean {
  if (s.length === 0 || s.length > 200) return false;
  if (s.includes("\n") || s.includes("\r")) return false;
  // printable, no exotic control chars
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(s)) return false;
  return true;
}

export function parseMetadataJson(json: string): AgentMetadata | null {
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    const services = Array.isArray(obj.services)
      ? (obj.services as AgentService[]).map((s) => ({
          name: str(s?.name),
          endpoint: str(s?.endpoint),
          skills: strArr(s?.skills),
          domains: strArr(s?.domains),
        }))
      : [];
    return {
      name: strOrNull(obj.name),
      description: strOrNull(obj.description),
      services,
      supportedTrusts: strArr(obj.supportedTrusts) ?? [],
      active: typeof obj.active === "boolean" ? obj.active : null,
      x402support: typeof obj.x402support === "boolean" ? obj.x402support : null,
      raw: obj,
    };
  } catch {
    return null;
  }
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strArr = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;

/**
 * Heuristic category classification from metadata text.
 * Deliberately transparent + deterministic (published scoring spec — v2 Edge).
 * An LLM enrichment pass can refine `other` later; the heuristic result is
 * always kept alongside for reproducibility.
 */
const CATEGORY_PATTERNS: Array<[Category, RegExp]> = [
  ["health-factor", /health\s*factor|liquidat|loan\s*(position|monitor)|collateral(?!ize)|venus|kinza|aave|lending\s*position|borrow/i],
  ["grid-trading", /grid\s*(trad|bot|strateg)|range\s*order|market\s*mak|dca\b|limit\s*order/i],
  ["yield", /yield|apy|apr|staking|stake\b|farm|vault|lp\s*(position|manag)|liquidity\s*provi|restak/i],
  ["monitoring", /monitor|watch|alert|track|rebalanc|portfolio|notif|risk\s*(assess|evaluat|scor)|sentinel|surveill/i],
];

export function classify(meta: AgentMetadata | null): Category {
  if (!meta) return "other";
  const text = [
    meta.name ?? "",
    meta.description ?? "",
    ...meta.services.flatMap((s) => [s.name ?? "", ...(s.skills ?? []), ...(s.domains ?? [])]),
  ]
    .join(" ")
    .slice(0, 4000);
  for (const [cat, re] of CATEGORY_PATTERNS) {
    if (re.test(text)) return cat;
  }
  return "other";
}

/** Basic sanitization guard: metadata strings render in UI — strip control chars, cap length. */
export function sanitizeForDisplay(s: string | null | undefined, max = 500): string | null {
  if (s == null) return null;
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, max).trim() || null;
}
