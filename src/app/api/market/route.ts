import { NextResponse } from "next/server";
import { getMarketSignals } from "@/lib/market-signals";

export async function GET() {
  // Reuse the per-snapshot-generation cache instead of rebuilding the whole
  // market on every request (previously ~12-17s each hit).
  const { signals } = await getMarketSignals();
  return NextResponse.json({ signals });
}
