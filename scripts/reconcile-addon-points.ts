// Reconcile the addon channel's 7-day snapshot history against the plugin's
// in-game Point record (the authority). Idempotent — safe to re-run anytime:
//   1. insert SV points the DB is missing (watcher-downtime backfill)
//   2. delete addon snapshot rows the plugin's points no longer carry
//      (pre-reset residue like the 09-24 scans), scoped to items the plugin
//      still tracks, so stale items keep their history.
// The deal radar must classify a scan identically to the in-game panel; that
// only holds when the DB window equals the point series.
// Run: npx tsx scripts/reconcile-addon-points.ts
import { readFileSync } from "node:fs";
import { parseSavedVariables } from "../src/lib/addon-scan";
import { prisma } from "../src/lib/prisma";

const svPath = process.env.AQT_SAVEDVARS_PATH ?? "C:/Program Files (x86)/World of Warcraft/_classic_beta_/WTF/Account/1120133458#1/SavedVariables/WoWderhoiAH.lua";
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function pointArray(raw: unknown): Array<{ t: number; c: number; q?: number }> {
  if (Array.isArray(raw)) return raw as Array<{ t: number; c: number; q?: number }>;
  return Object.values((raw ?? {}) as Record<string, { t: number; c: number; q?: number }>);
}

async function main() {
  const raw = parseSavedVariables(readFileSync(svPath, "utf8"));
  const db = raw.WoWderhoiAHDB as Record<string, unknown>;
  const scan = db.scanData as { scannedAt: number; server: string; faction: string };
  const points = (db.points ?? {}) as Record<string, Array<{ t: number; c: number; q?: number }>>;
  const cutoff = new Date(Date.now() - WINDOW_MS);

  // Build the authoritative point set: itemId -> Map(tsSec -> {price, qty})
  const authoritative = new Map<number, Map<number, { price: number; qty: number }>>();
  for (const [itemIdStr, rawPts] of Object.entries(points)) {
    const arr = pointArray(rawPts);
    const byTs = new Map<number, { price: number; qty: number }>();
    for (const p of arr) {
      if (typeof p?.t !== "number" || typeof p?.c !== "number") continue;
      byTs.set(p.t, { price: Math.round(p.c), qty: Math.round(p.q ?? 0) });
    }
    if (byTs.size > 0) authoritative.set(Number(itemIdStr), byTs);
  }
  console.log("authoritative items:", authoritative.size);

  // 1) Insert missing points
  const allPts: Array<{ itemId: number; tsSec: number; price: number; qty: number }> = [];
  for (const [itemId, byTs] of authoritative) {
    for (const [tsSec, v] of byTs) allPts.push({ itemId, tsSec, price: v.price, qty: v.qty });
  }
  const existing = await prisma.auctionSnapshot.findMany({
    where: { source: "addon", timestamp: { gte: cutoff } },
    select: { itemId: true, timestamp: true }
  });
  const existingKeys = new Set(existing.map((r) => `${r.itemId}|${Math.floor(r.timestamp.getTime() / 1000)}`));
  const missing = allPts.filter((p) => !existingKeys.has(`${p.itemId}|${p.tsSec}`));
  console.log("missing points to insert:", missing.length);
  if (missing.length > 0) {
    const itemIds = [...new Set(missing.map((m) => m.itemId))];
    const known = await prisma.item.findMany({ where: { itemId: { in: itemIds } }, select: { itemId: true } });
    const knownSet = new Set(known.map((k) => k.itemId));
    const unknown = itemIds.filter((id) => !knownSet.has(id));
    if (unknown.length > 0) {
      await prisma.item.createMany({
        data: unknown.map((itemId) => ({ itemId, name: `Item ${itemId}`, quality: "unknown", category: "unknown", subCategory: "unknown", vendorPrice: 0 }))
      });
      console.log("placeholder items created:", unknown.length);
    }
    await prisma.auctionSnapshot.createMany({
      data: missing.map((m) => ({
        itemId: m.itemId,
        timestamp: new Date(m.tsSec * 1000),
        server: scan.server,
        faction: scan.faction,
        source: "addon",
        minPrice: m.price,
        marketPrice: m.price,
        quantity: m.qty,
        numAuctions: 0
      }))
    });
    console.log("inserted:", missing.length);
  }

  // 2) Delete within-window addon rows for tracked items that the points no
  //    longer carry (pre-reset residue), and rows older than the point span.
  const trackedIds = [...authoritative.keys()];
  const trackedRows = await prisma.auctionSnapshot.findMany({
    where: { source: "addon", itemId: { in: trackedIds }, timestamp: { gte: cutoff } },
    select: { id: true, itemId: true, timestamp: true }
  });
  const extras = trackedRows.filter((r) => {
    const byTs = authoritative.get(r.itemId);
    const tsSec = Math.floor(r.timestamp.getTime() / 1000);
    return !byTs?.has(tsSec);
  });
  console.log("stale rows to delete:", extras.length);
  if (extras.length > 0) {
    await prisma.auctionSnapshot.deleteMany({ where: { id: { in: extras.map((e) => e.id) } } });
    console.log("deleted:", extras.length);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
