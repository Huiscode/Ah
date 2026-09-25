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

// Route-2 authority mirror: the in-game options panel owns the deal-radar
// thresholds; the import route replays them into the single RadarRule row
// (id=1). Returns null until the first scan with rules arrives — callers
// then fall back to the compiled defaults in market-rules.ts.
export async function getRadarRules(): Promise<unknown> {
  const row = await prisma.radarRule.findFirst({ orderBy: { updatedAt: "desc" } });
  return row?.rules ?? null;
}