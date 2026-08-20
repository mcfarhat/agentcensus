/**
 * Canonical ERC-8183 job description — byte-identical to the Python SDK's
 * build_job_description (json.dumps sort_keys separators ensure_ascii).
 * The provider verifies the on-chain description against the negotiation it
 * signed, so serialization must match exactly.
 */
import { getAddress } from "viem";

function sanitizeForClaim(s: unknown): string {
  const str = typeof s === "string" ? s : String(s);
  const r = str.replace(/\[/g, "(").replace(/\]/g, ")");
  let out = "";
  for (const ch of r) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x20 || ch === "\t" || ch === "\n") out += ch;
  }
  return out;
}

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
