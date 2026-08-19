/** Judge Mode — poll a sponsored hire's progress. */
import { NextRequest, NextResponse } from "next/server";
import { getSession, refreshJob } from "../../../../lib/judge";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const s = getSession(id);
  if (!s) return NextResponse.json({ error: "unknown session" }, { status: 404 });
  if (s.jobId && s.phase === "waiting_submission" && Date.now() - s.updatedAt > 10_000) {
    await refreshJob(s);
  }
  return NextResponse.json({
    phase: s.phase,
    txs: s.txs,
    jobId: s.jobId ?? null,
    jobStatus: s.jobStatus ?? null,
    error: s.error ?? null,
    agentId: s.agentId,
    agentName: s.agentName,
    elapsedSec: Math.round((Date.now() - s.startedAt) / 1000),
  });
}
