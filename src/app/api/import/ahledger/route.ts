import { NextResponse } from "next/server";
import { importSnapshot, ImportConflictError, type ImportScanItem } from "@/lib/import-common";

// AHledger channel import endpoint. The ahledger-importer script fetches
// the public AHL1 pricetable for the user's market (forever.pvp.alliance.us)
// every 15 minutes and POSTs the parsed rows here. Unlike addon scans there
// is no game panel and no metadata: rows carry only prices/quantity, the
// shared pipeline creates placeholder Item rows and the next addon scan
// backfills real names.

function requirePositiveInt(value: unknown, field: string, index: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error(`ahledger item ${index}: ${field} must be a positive number, got ${JSON.stringify(value)}`);
  }
  return Math.round(num);
}

export async function POST(request: Request) {
  let rawBody: Record<string, unknown>;
  try {
    rawBody = (await request.json()) as Record<string, unknown>;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  if (typeof rawBody.scannedAt !== "number" || rawBody.scannedAt <= 0) {
    return NextResponse.json({ error: "ahledger payload scannedAt must be a positive epoch" }, { status: 400 });
  }
  if (typeof rawBody.server !== "string" || rawBody.server === "") {
    return NextResponse.json({ error: "ahledger payload server must be a non-empty string" }, { status: 400 });
  }
  if (typeof rawBody.faction !== "string" || rawBody.faction === "") {
    return NextResponse.json({ error: "ahledger payload faction must be a non-empty string" }, { status: 400 });
  }
  if (!Array.isArray(rawBody.items) || rawBody.items.length === 0) {
    return NextResponse.json({ error: "ahledger payload items must be a non-empty array" }, { status: 400 });
  }

  const items: ImportScanItem[] = [];
  try {
    rawBody.items.forEach((entry, index) => {
      if (typeof entry !== "object" || entry === null) {
        throw new Error(`ahledger item ${index} must be an object`);
      }
      const row = entry as Record<string, unknown>;
      const itemId = requirePositiveInt(row.itemId, "itemId", index);
      const quantity = typeof row.quantity === "number" && Number.isFinite(row.quantity) && row.quantity >= 0
        ? Math.round(row.quantity)
        : 0;
      items.push({
        itemId,
        minPrice: requirePositiveInt(row.minPrice, "minPrice", index),
        marketPrice: requirePositiveInt(row.marketPrice, "marketPrice", index),
        quantity,
        numAuctions: 0 // AHL1 pricetable has no auctions field; liquidity is unknown
      });
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  try {
    const result = await importSnapshot({
      source: "ahledger",
      scannedAt: new Date(rawBody.scannedAt * 1000),
      server: rawBody.server,
      faction: rawBody.faction,
      items
    });
    return NextResponse.json({ imported: result.imported, points: result.points, scannedAt: result.scannedAt });
  } catch (error) {
    if (error instanceof ImportConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
