/** Public JSON API — list ERC-8183 jobs. */
import { NextRequest, NextResponse } from "next/server";
import { listJobs, parseNet } from "../../../lib/data";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const net = parseNet(sp.get("net") ?? undefined);
  const status = sp.get("status");
  const { rows, total } = listJobs(net, {
    provider: sp.get("provider") ?? undefined,
    status: status !== null ? parseInt(status, 10) : undefined,
    page: parseInt(sp.get("page") ?? "1", 10),
    pageSize: parseInt(sp.get("pageSize") ?? "30", 10),
  });
  return NextResponse.json(
    { network: net, total, jobs: rows },
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=30" } },
  );
}
