// Shared import pipeline for both data channels. The addon-scan route
// (game plugin) and the ahledger route (AHledger public API) both land here;
// `source` is stamped on every AuctionSnapshot/DailySummary row so the two
// channels stay separate price metrics (addon P10 vs ahledger median) and
// can never pollute each other's med7 window or OHLCV row. Dedupe, item-row
// backfill, history-point fencing and the daily fold are identical for both.
import { prisma } from "@/lib/prisma";
import { diffScanItems, type ExistingItemRow, type ItemUpdateData } from "@/lib/scan-import";
import { mergePointsIntoDailySummaries, mergeScanIntoDailySummaries } from "@/lib/daily-summary";
import type { AddonRadarRules } from "@/lib/addon-scan";
import type { SnapshotSource } from "@/lib/market-data";

export type ImportScanItem = {
  itemId: number;
  // addon scans carry the full metadata; ahledger rows only carry prices,
  // so name/quality/category/subCategory/vendorPrice are optional here and
  // the ahledger channel creates placeholder Item rows instead.
  name?: string;
  quality?: string;
  category?: string;
  subCategory?: string;
  vendorPrice?: number;
  minPrice: number;
  marketPrice: number;
  quantity: number;
  numAuctions: number;
};

export type ImportPoint = { itemId: number; timestamp: Date; marketPrice: number; quantity: number };

export type ImportPayload = {
  source: SnapshotSource;
  scannedAt: Date;
  server: string;
  faction: string;
  items: ImportScanItem[];
  // addon-only: the accumulated in-game 7-day point series riding along
  // with the snapshot; ahledger imports have no history points.
  points?: ImportPoint[];
  // addon-only: deprecated — the watcher still sends it, but the import no
  // longer trusts it as "already imported" (see the self-healing fence below).
  after?: number;
  // addon-only: replay of the in-game radar thresholds (route-2 authority).
  rules?: AddonRadarRules;
};

// Thrown when the exact (timestamp, server, faction, source) snapshot row
// already exists; the caller maps this to HTTP 409, never a 500.
export class ImportConflictError extends Error {}

export type ImportResult = { imported: number; points: number; scannedAt: string };

export async function importSnapshot(payload: ImportPayload): Promise<ImportResult> {
  const { source, scannedAt, server, faction, rules } = payload;
  const items = payload.items;
  const points = payload.points ?? [];

  // Channel-scoped dedupe: the same wall-clock timestamp can legitimately
  // exist once per source (a game scan and an ahledger round are different
  // observations even at the same minute), so source joins the key.
  const duplicate = await prisma.auctionSnapshot.findFirst({
    where: { timestamp: scannedAt, server, faction, source },
    select: { id: true }
  });
  if (duplicate) {
    throw new ImportConflictError(`Scan at ${scannedAt.toISOString()} already imported`);
  }

  // In-game history points (one per item per completed scan, 7-day window).
  // The snapshot import is the anchor: points at or after this scan are
  // dropped because the snapshot rows themselves cover the scan's timestamp.
  // The old `after` fence (skip everything <= last imported scan) is
  // deliberately NOT trusted: a watcher that was down, or an import that
  // failed while the watcher advanced its state, leaves gaps that the fence
  // would skip forever (observed: whole evening scans missing from the DB).
  // Every point below the scan time is therefore probed against the database
  // and only genuinely missing (itemId, timestamp) pairs are inserted — the
  // import is self-healing and the next scan after downtime backfills
  // everything the plugin's point series carries.
  const scannedAtSec = Math.floor(scannedAt.getTime() / 1000);
  const candidates = points.filter((point) => Math.floor(point.timestamp.getTime() / 1000) < scannedAtSec);
  let freshPoints = candidates;
  if (candidates.length > 0) {
    const minTs = new Date(Math.min(...candidates.map((point) => point.timestamp.getTime())));
    const existing = await prisma.auctionSnapshot.findMany({
      where: { server, faction, source, timestamp: { gte: minTs } },
      select: { itemId: true, timestamp: true }
    });
    const seen = new Set(existing.map((row) => `${row.itemId}|${row.timestamp.getTime()}`));
    freshPoints = candidates.filter((point) => !seen.has(`${point.itemId}|${point.timestamp.getTime()}`));
  }

  // Full-table reads instead of `in` filters: the item table is small and
  // this keeps the statements clear of SQLite's bound-parameter limit even
  // at 100x-scale scans.
  const existingItems = await prisma.item.findMany({ select: { itemId: true, name: true, quality: true, category: true, subCategory: true, vendorPrice: true } });
  const existingItemIdSet = new Set(existingItems.map((row) => row.itemId));

  // Item-table policy differs by channel:
  // - addon: create missing rows with real metadata and backfill name/
  //   quality/vendorPrice changes (diffScanItems).
  // - ahledger: rows carry no metadata, so they may only create placeholder
  //   Item rows (name "Item {id}", unknown quality) for items the store has
  //   never seen; they must never overwrite a real name the addon recorded.
  //   The next addon scan backfills placeholders via diffScanItems.
  const creates: Array<{ itemId: number; name: string; quality: string; category: string; subCategory: string; vendorPrice: number }> = [];
  const updates: Array<{ itemId: number; data: ItemUpdateData }> = [];
  if (source === "addon") {
    const diff = diffScanItems(items as Parameters<typeof diffScanItems>[0], existingItems as ExistingItemRow[]);
    creates.push(...diff.creates);
    updates.push(...diff.updates);
  } else {
    for (const item of items) {
      if (!existingItemIdSet.has(item.itemId)) {
        creates.push({
          itemId: item.itemId,
          name: `Item ${item.itemId}`,
          quality: "unknown",
          category: "unknown",
          subCategory: "unknown",
          vendorPrice: 0
        });
      }
    }
  }

  // History points can reference items that were listed in an earlier round
  // but had expired before this scan and are unknown to the store. Their
  // AuctionSnapshot rows would violate the Item FK, so create placeholder
  // Item rows for exactly those ids (same convention as above).
  const scanItemIdSet = new Set(items.map((item) => item.itemId));
  const pointOnlyItemIds = [...new Set(freshPoints.map((point) => point.itemId))]
    .filter((itemId) => !existingItemIdSet.has(itemId) && !scanItemIdSet.has(itemId));
  for (const itemId of pointOnlyItemIds) {
    creates.push({ itemId, name: `Item ${itemId}`, quality: "unknown", category: "unknown", subCategory: "unknown", vendorPrice: 0 });
  }

  // Daily OHLCV: fold history points first (they carry the whole night's
  // per-round prices, possibly across midnight), then fold the snapshot so
  // the day's close/high/low/volume land on the latest scan and the day's
  // open stays the first observed round. Rows are scoped by source so the
  // two channels keep independent candles.
  const affectedDates = new Set<number>([
    new Date(Date.UTC(scannedAt.getUTCFullYear(), scannedAt.getUTCMonth(), scannedAt.getUTCDate())).getTime()
  ]);
  for (const point of freshPoints) {
    affectedDates.add(new Date(Date.UTC(point.timestamp.getUTCFullYear(), point.timestamp.getUTCMonth(), point.timestamp.getUTCDate())).getTime());
  }
  const existingDayRows = await prisma.dailySummary.findMany({
    where: { source, date: { in: Array.from(affectedDates).map((ms) => new Date(ms)) } },
    select: { itemId: true, date: true, highPrice: true, lowPrice: true }
  });
  const pointDayResult = mergePointsIntoDailySummaries(freshPoints, existingDayRows, source);
  const dayProbe = mergeScanIntoDailySummaries(items, scannedAt, [], source);
  // Rows the points pass will create count as existing for the snapshot fold
  // ONLY when they belong to the snapshot's own day — points that fell on an
  // earlier day (a scan just after midnight) are separate rows the snapshot
  // must not update.
  const dayMs = dayProbe.date.getTime();
  const effectiveExisting = [
    ...existingDayRows.filter((row) => row.date.getTime() === dayMs),
    ...pointDayResult.creates.filter((row) => row.date.getTime() === dayMs)
  ];
  const { date, creates: dayCreates, updates: dayUpdates } = mergeScanIntoDailySummaries(items, scannedAt, effectiveExisting, source);

  // Route 2: replay the in-game radar rules (single authority row id=1) in
  // the same commit as the scan, so the terminal's deal radar can never
  // drift from what the addon is actually using. Only the addon channel has
  // a game panel; ahledger imports leave the stored rules untouched.
  const rulesPayload = source === "addon" && rules !== undefined
    ? [prisma.radarRule.upsert({
        where: { id: 1 },
        update: { rules: rules as object },
        create: { id: 1, rules: rules as object }
      })]
    : [];

  // One transaction for the whole import: a single commit instead of one
  // autocommit fsync per row, and everything lands all-or-nothing.
  await prisma.$transaction([
    ...(creates.length > 0 ? [prisma.item.createMany({ data: creates })] : []),
    ...updates.map((update) => prisma.item.update({ where: { itemId: update.itemId }, data: update.data })),
    prisma.auctionSnapshot.createMany({
      data: items.map((item) => ({
        itemId: item.itemId,
        timestamp: scannedAt,
        server,
        faction,
        source,
        minPrice: item.minPrice,
        marketPrice: item.marketPrice,
        quantity: item.quantity,
        numAuctions: item.numAuctions
      }))
    }),
    ...(freshPoints.length > 0
      ? [prisma.auctionSnapshot.createMany({
          data: freshPoints.map((point) => ({
            itemId: point.itemId,
            timestamp: point.timestamp,
            server,
            faction,
            source,
            // History points only carry the P10 close; mirror it into
            // minPrice so the column stays populated. The radar reads
            // minPrice from the latest snapshot row (this scan), never from
            // these older points.
            minPrice: point.marketPrice,
            marketPrice: point.marketPrice,
            quantity: point.quantity,
            numAuctions: 0
          }))
        })]
      : []),
    ...(pointDayResult.creates.length > 0 ? [prisma.dailySummary.createMany({ data: pointDayResult.creates })] : []),
    ...pointDayResult.updates.map((update) => prisma.dailySummary.update({
      where: { itemId_date_source: { itemId: update.itemId, date: update.date, source } },
      data: update.data
    })),
    ...(dayCreates.length > 0 ? [prisma.dailySummary.createMany({ data: dayCreates })] : []),
    ...dayUpdates.map((update) => prisma.dailySummary.update({
      where: { itemId_date_source: { itemId: update.itemId, date, source } },
      data: update.data
    })),
    ...rulesPayload
  ]);

  return { imported: items.length, points: freshPoints.length, scannedAt: scannedAt.toISOString() };
}
