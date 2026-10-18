import { NextResponse } from "next/server";
import { buildMarketSignal } from "@/lib/analytics";
import { getItemDetail } from "@/lib/repositories";
import { parseServer } from "@/lib/servers";

export async function GET(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const server = parseServer(new URL(request.url).searchParams.get("server"));
  const item = await getItemDetail(Number(itemId), "current", "faction", server);
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });
  const signal = item.snapshots.length > 0 ? buildMarketSignal(item, new Date()) : null;
  return NextResponse.json({ item, signal });
}
