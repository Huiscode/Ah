import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeAddonScan, normalizeAddonPoints } from "@/lib/addon-scan";
import { mergeScanIntoDailySummaries, mergePointsIntoDailySummaries } from "@/lib/daily-summary";
import { diffScanItems } from "@/lib/scan-import";

export async function POST(request: Request) {
  let scan;
  let rawBody: Record<string, unknown> | null = null;
  try {
    rawBody = (await request.json()) as Record<string, unknown>;
    scan = normalizeAddonScan(rawBody);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  const duplicate = await prisma.auctionSnapshot.findFirst({
    where: { timestamp: scan.scannedAt, server: scan.server, faction: scan.faction },
    select: { id: true }
  });
  if (duplicate) {
    return NextResponse.json({ error: `Scan at ${scan.scannedAt.toISOString()} already imported` }, { status: 409 });
  }

  // In-game history points (one per item per completed scan, 7-day window).
  // The snapshot import is the anchor: points strictly older than the last
  // imported scan (`after`) and strictly newer than this scan are dropped —
  // the snapshot row itself covers the scan's own timestamp, and anything at
  // or before `after` was already imported by an earlier file write. The
  // database is probed as a second dedupe fence in case the watcher restarted
  // with a stale `after`.
  const after = typeof rawBody?.after === "number" && rawBody.after > 0 ? rawBody.after : 0;
  const scannedAtSec = Math.floor(scan.scannedAt.getTime() / 1000);
  let points = normalizeAddonPoints(rawBody?.points) ?? [];
  if (after > 0 || scannedAtSec > 0) {
    points = points.filter(
      (point) => Math.floor(point.timestamp.getTime() / 1000) > after && Math.floor(point.timestamp.getTime() / 1000) < scannedAtSec
    );
  }
  let freshPoints: typeof points = [];
  if (points.length > 0) {
    const existingAfter = await prisma.auctionSnapshot.findMany({
      where: { server: scan.server, faction: scan.faction, timestamp: { gt: new Date(after * 1000) } },
      select: { itemId: true, timestamp: true }
    });
    const seen = new Set(existingAfter.map((row) => `${row.itemId}|${row.timestamp.getTime()}`));
    freshPoints = points.filter((point) => !seen.has(`${point.itemId}|${point.timestamp.getTime()}`));
  }

  // Full-table reads instead of `in` filters: the item table is small and
  // this keeps the statements clear of SQLite's bound-parameter limit even
  // at 100x-scale scans.
  const existingItems = await prisma.item.findMany({ select: { itemId: true, name: true, quality: true, vendorPrice: true } });
  const itemDiff = diffScanItems(scan.items, existingItems);

  // Daily OHLCV: fold history points first (they carry the whole night's
  // per-round prices, possibly across midnight), then fold the snapshot so
  // the day's close/high/low/volume land on the latest scan and the day's
  // open stays the first observed round.
  const affectedDates = new Set<number>([scan.scannedAt.getTime()]);
  for (const point of freshPoints) {
    affectedDates.add(new Date(Date.UTC(point.timestamp.getUTCFullYear(), point.timestamp.getUTCMonth(), point.timestamp.getUTCDate())).getTime());
  }
  const existingDayRows = await prisma.dailySummary.findMany({
    where: { date: { in: Array.from(affectedDates).map((ms) => new Date(ms)) } },
    select: { itemId: true, date: true, highPrice: true, lowPrice: true }
  });
  const pointDayResult = mergePointsIntoDailySummaries(freshPoints, existingDayRows);
  const dayProbe = mergeScanIntoDailySummaries(scan.items, scan.scannedAt, []);
  // Rows the points pass will create count as existing for the snapshot fold
  // ONLY when they belong to the snapshot's own day — points that fell on an
  // earlier day (a scan just after midnight) are separate rows the snapshot
  // must not update.
  const dayMs = dayProbe.date.getTime();
  const effectiveExisting = [
    ...existingDayRows.filter((row) => row.date.getTime() === dayMs),
    ...pointDayResult.creates.filter((row) => row.date.getTime() === dayMs)
  ];
  const { date, creates, updates } = mergeScanIntoDailySummaries(scan.items, scan.scannedAt, effectiveExisting);

  // Route 2: replay the in-game radar rules (single authority row id=1) in
  // the same commit as the scan, so the terminal's deal radar can never
  // drift from what the addon is actually using.
  const rulesPayload = scan.rules !== undefined
    ? [prisma.radarRule.upsert({
        where: { id: 1 },
        update: { rules: scan.rules as object },
        create: { id: 1, rules: scan.rules as object }
      })]
    : [];

  // One transaction for the whole import: a single commit instead of one
  // autocommit fsync per row, and everything lands all-or-nothing.
  await prisma.$transaction([
    ...(itemDiff.creates.length > 0 ? [prisma.item.createMany({ data: itemDiff.creates })] : []),
    ...itemDiff.updates.map((update) => prisma.item.update({ where: { itemId: update.itemId }, data: update.data })),
    prisma.auctionSnapshot.createMany({
      data: scan.items.map((item) => ({
        itemId: item.itemId,
        timestamp: scan.scannedAt,
        server: scan.server,
        faction: scan.faction,
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
            server: scan.server,
            faction: scan.faction,
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
      where: { itemId_date: { itemId: update.itemId, date: update.date } },
      data: update.data
    })),
    ...(creates.length > 0 ? [prisma.dailySummary.createMany({ data: creates })] : []),
    ...updates.map((update) => prisma.dailySummary.update({ where: { itemId_date: { itemId: update.itemId, date } }, data: update.data })),
    ...rulesPayload
  ]);

  return NextResponse.json({ imported: scan.items.length, points: freshPoints.length, scannedAt: scan.scannedAt.toISOString() });
}
