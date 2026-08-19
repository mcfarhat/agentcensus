/** Judge Mode — start a sponsored zero-budget hire (testnet only). */
import { NextRequest, NextResponse } from "next/server";
import { getAgent } from "../../../../lib/data";
import { judgeModeEnabled, startJudgeHire } from "../../../../lib/judge";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!judgeModeEnabled()) {
    return NextResponse.json({ error: "Judge Mode is not enabled on this deployment" }, { status: 503 });
  }
  let body: { agentId?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const id = Number(body.agentId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "agentId required" }, { status: 400 });
  }
  const agent = getAgent("testnet", id);
  if (!agent) return NextResponse.json({ error: "agent not in testnet index" }, { status: 404 });
  if (agent.probe_status !== "alive" && agent.probe_status !== "degraded") {
    return NextResponse.json({ error: "agent is not responding to probes — hire an alive agent" }, { status: 409 });
  }
  let endpoints: string[] = [];
  try {
    const parsed = JSON.parse(agent.service_endpoints ?? "[]");
    endpoints = Array.isArray(parsed) ? parsed : [String(parsed)];
  } catch {
    endpoints = (agent.service_endpoints ?? "").split(/[,\s]+/).filter(Boolean);
  }
  const endpoint = endpoints.find((e) => typeof e === "string" && e.startsWith("https://"));
  if (!endpoint) return NextResponse.json({ error: "agent has no https endpoint" }, { status: 409 });
  if (!agent.owner) return NextResponse.json({ error: "agent owner unknown" }, { status: 409 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const res = startJudgeHire(
    { agent_id: agent.agent_id, name: agent.name, owner: agent.owner, endpoint },
    ip,
  );
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 429 });
  return NextResponse.json({ sessionId: res.sessionId });
}
