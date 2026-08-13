/**
 * Public census API — first slice of the "index as public infrastructure" edge.
 * Reads the indexer's SQLite db directly (same box in dev; move behind the
 * worker's snapshot export in production so the web tier degrades gracefully).
 */
import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

export async function GET() {
  const net = process.env.CENSUS_NETWORK ?? "testnet";
  try {
    const file = path.resolve(process.cwd(), "..", "indexer", "data", `census-${net}.json`);
    const report = JSON.parse(readFileSync(file, "utf8"));
    return NextResponse.json(report, {
      headers: { "Cache-Control": "public, max-age=30", "Access-Control-Allow-Origin": "*" },
    });
  } catch {
    return NextResponse.json(
      { error: "census not generated yet — run: npm run cli -- census --network " + net },
      { status: 503 },
    );
  }
}
