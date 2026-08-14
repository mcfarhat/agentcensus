/** Public JSON API — list agents. Same index the site renders; build anything on it. */
import { NextRequest, NextResponse } from "next/server";
import { listAgents, parseNet } from "../../../lib/data";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const net = parseNet(sp.get("net") ?? undefined);
  const { rows, total } = listAgents(net, {
    category: sp.get("category") ?? undefined,
    status: (sp.get("status") as never) ?? undefined,
    q: sp.get("q") ?? undefined,
    page: parseInt(sp.get("page") ?? "1", 10),
    pageSize: parseInt(sp.get("pageSize") ?? "25", 10),
  });
  return NextResponse.json(
    { network: net, total, agents: rows.map((a) => ({ ...a, metadata_json: undefined })) },
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=30" } },
  );
}
