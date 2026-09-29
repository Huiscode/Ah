import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Ledger import (Stage D). The addon appends buy/sell/expired records to
// WoWderhoiAHDB.ledger and the SavedVariables watcher forwards them here.
// Each record carries a stable uid so repeated scans of the same file are
// idempotent; we upsert on uid.

type LedgerRow = {
  uid?: unknown;
  kind?: unknown;
  itemId?: unknown;
  qty?: unknown;
  unitPrice?: unknown;
  total?: unknown;
  ts?: unknown;
  note?: unknown;
};

function asInt(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  const rows = Array.isArray(body.ledger) ? (body.ledger as LedgerRow[]) : [];
  if (rows.length === 0) {
    return NextResponse.json({ imported: 0, skipped: 0 });
  }

  let imported = 0;
  let skipped = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object") { skipped++; continue; }
    const uid = typeof row.uid === "string" && row.uid ? row.uid : null;
    const kind = typeof row.kind === "string" ? row.kind : "";
    if (!uid || !["buy", "sell", "expired"].includes(kind)) { skipped++; continue; }
    const ts = asInt(row.ts);
    try {
      await prisma.tradeRecord.upsert({
        where: { uid },
        update: {},
        create: {
          uid,
          kind,
          itemId: asInt(row.itemId),
          qty: asInt(row.qty),
          unitPrice: BigInt(Math.max(0, asInt(row.unitPrice))),
          total: BigInt(Math.max(0, asInt(row.total))),
          ts: new Date((ts > 0 ? ts : Math.floor(Date.now() / 1000)) * 1000),
          note: typeof row.note === "string" ? row.note : null,
        }
      });
      imported++;
    } catch {
      skipped++;
    }
  }

  return NextResponse.json({ imported, skipped });
}

// GET: return recent records for the ledger page.
export async function GET() {
  const records = await prisma.tradeRecord.findMany({
    orderBy: { ts: "desc" },
    take: 500
  });
  // Resolve names/icons for known itemIds.
  const itemIds = [...new Set(records.map((r) => r.itemId).filter((id) => id > 0))];
  const items = itemIds.length
    ? await prisma.item.findMany({ where: { itemId: { in: itemIds } } })
    : [];
  const byId = new Map(items.map((i) => [i.itemId, i]));
  return NextResponse.json({
    records: records.map((r) => {
      const it = byId.get(r.itemId);
      return {
        uid: r.uid,
        kind: r.kind,
        itemId: r.itemId,
        name: it?.name ?? r.note ?? `item:${r.itemId}`,
        icon: it?.icon ?? null,
        quality: it?.quality ?? "common",
        qty: r.qty,
        unitPrice: r.unitPrice.toString(),
        total: r.total.toString(),
        ts: r.ts.toISOString(),
        note: r.note
      };
    })
  });
}
