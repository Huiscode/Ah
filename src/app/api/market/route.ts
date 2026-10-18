import { NextResponse } from "next/server";
import { getMarketSignals } from "@/lib/market-signals";
import { parseServer } from "@/lib/servers";

export async function GET(request: Request) {
  // Reuse the per-snapshot-generation cache instead of rebuilding the whole
  // market on every request (previously ~12-17s each hit).
  const server = parseServer(new URL(request.url).searchParams.get("server"));
  const { signals } = await getMarketSignals("faction", "current", server);
  return NextResponse.json({ signals });
}
