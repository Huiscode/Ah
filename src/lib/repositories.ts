import { prisma } from "@/lib/prisma";
import { type MarketHistory } from "@/lib/market-data";

export async function getMarketUniverse(): Promise<MarketHistory[]> {
  return prisma.item.findMany({
    include: {
      snapshots: { orderBy: { timestamp: "asc" }, take: -48 },
      dailySummaries: { orderBy: { date: "asc" }, take: -30 }
    },
    orderBy: { name: "asc" }
  });
}


export async function getItemDetail(itemId: number) {
  return prisma.item.findUnique({
    where: { itemId },
    include: {
      snapshots: { orderBy: { timestamp: "asc" }, take: -96 },
      dailySummaries: { orderBy: { date: "asc" }, take: -60 }
    }
  });
}

export async function getUpcomingEvents() {
  return prisma.event.findMany({
    where: { endTime: { gte: new Date() } },
    orderBy: { startTime: "asc" },
    take: 6
  });
}

export async function getWatchedItemIds() {
  const rows = await prisma.watchlist.findMany({ select: { itemId: true } });
  return new Set(rows.map((row) => row.itemId));
}

export async function getAlertRules() {
  return prisma.alertRule.findMany({ orderBy: { itemId: "asc" } });
}


export async function getLatestSnapshotTime() {
  const row = await prisma.auctionSnapshot.findFirst({ orderBy: { timestamp: "desc" }, select: { timestamp: true } });
  return row?.timestamp ?? null;
}

// Metadata version of the item universe (MAX updated_at). The market-signal
// cache keys on (latest snapshot, this) so backfills of name/quality/category
// invalidate the in-memory signals without waiting for the next scan.
export async function getItemMetaVersion(): Promise<number> {
  const row = await prisma.item.aggregate({ _max: { updatedAt: true } });
  return row._max.updatedAt?.getTime() ?? 0;
}

// The item universe of the latest in-game scan round. The addon only ever
// iterates the items it just scanned, so the terminal's deal radar must do
// the same: an item the game is not currently listing cannot be bought, and
// offering it as a deal would promise a trade that does not exist. Returns
// null when no addon scan has ever been imported — the website channel is
// then the only data and its whole universe applies.
export async function getLatestAddonRoundItemIds(): Promise<Set<number> | null> {
  const latest = await prisma.auctionSnapshot.findFirst({
    where: { source: "addon" },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true }
  });
  if (!latest) return null;
  const rows = await prisma.auctionSnapshot.findMany({
    where: { source: "addon", timestamp: latest.timestamp },
    select: { itemId: true }
  });
  return new Set(rows.map((row) => row.itemId));
}

// Route-2 authority mirror: the in-game options panel owns the deal-radar
// thresholds; the import route replays them into the single RadarRule row
// (id=1). Returns null until the first scan with rules arrives — callers
// then fall back to the compiled defaults in market-rules.ts.
export async function getRadarRules(): Promise<unknown> {
  const row = await prisma.radarRule.findFirst({ orderBy: { updatedAt: "desc" } });
  return row?.rules ?? null;
}