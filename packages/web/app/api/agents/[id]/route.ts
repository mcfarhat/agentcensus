/** Public JSON API — one agent + its indexed job history. */
import { NextRequest, NextResponse } from "next/server";
import { agentJobs, getAgent, parseNet } from "../../../../lib/data";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const net = parseNet(req.nextUrl.searchParams.get("net") ?? undefined);
  const agent = getAgent(net, parseInt(id, 10));
  if (!agent) {
    return NextResponse.json({ error: "not indexed" }, { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
  }
  return NextResponse.json(
    { network: net, agent, jobs: agentJobs(net, agent.owner) },
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=30" } },
  );
}
