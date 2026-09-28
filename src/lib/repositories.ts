import { prisma } from "@/lib/prisma";
import { type MarketHistory } from "@/lib/market-data";
import type { DbRecipe, RecipeMaterial } from "@/lib/recipe-profits";

export async function getMarketUniverse(): Promise<MarketHistory[]> {
  const rows = await prisma.item.findMany({
    include: {
      snapshots: { orderBy: { timestamp: "asc" }, take: -48 },
      dailySummaries: { orderBy: { date: "asc" }, take: -30 }
    },
    orderBy: { name: "asc" }
  });
  for (const row of rows as any[]) {
    for (const s of row.snapshots) { s.minPrice = Number(s.minPrice); s.marketPrice = Number(s.marketPrice); }
    for (const d of row.dailySummaries) { d.openPrice = Number(d.openPrice); d.closePrice = Number(d.closePrice); d.highPrice = Number(d.highPrice); d.lowPrice = Number(d.lowPrice); }
  }
  return rows as any;
}


export async function getItemDetail(itemId: number): Promise<MarketHistory | null> {
  const row = await prisma.item.findUnique({
    where: { itemId },
    include: {
      snapshots: { orderBy: { timestamp: "asc" }, take: -96 },
      dailySummaries: { orderBy: { date: "asc" }, take: -60 }
    }
  });
  if (row) {
    for (const s of (row as any).snapshots) { s.minPrice = Number(s.minPrice); s.marketPrice = Number(s.marketPrice); }
    for (const d of (row as any).dailySummaries) { d.openPrice = Number(d.openPrice); d.closePrice = Number(d.closePrice); d.highPrice = Number(d.highPrice); d.lowPrice = Number(d.lowPrice); }
  }
  return row as any;
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

// P0-B: the recipe library. category filters "craft" (professional crafts,
// from /wahrecipes dumps and the wx-wow seed) or "merchant" (merchant-favor
// exchanges); omit for everything. reagents/outputs are JSON columns that
// mirror the addon's field names (itemId/name/quantity/vendorPrice), so the
// profit engine consumes them without reshaping.
export async function getRecipes(category?: "craft" | "merchant"): Promise<DbRecipe[]> {
  const rows = await prisma.recipe.findMany({
    where: category ? { category } : undefined,
    orderBy: { name: "asc" }
  });
  return rows.map((row) => ({
    name: row.name,
    profession: row.profession,
    skillLevel: row.skillLevel,
    category: row.category as "craft" | "merchant",
    favorCost: row.favorCost,
    difficulty: row.difficulty ? (row.difficulty as unknown as number[]) : undefined,
    categoryName: row.categoryName ?? undefined,
    spellId: row.spellId ?? undefined,
    reagents: (row.reagents as unknown as RecipeMaterial[]) ?? [],
    outputs: (row.outputs as unknown as RecipeMaterial[]) ?? []
  }));
}

// Vendor floors the import pipeline picked up from the addon scan channel
// (Item.vendorPrice, currently populated from classic-era vendor data); the
// profit engine merges them under the addon-dumped recipe vendorP.
export async function getItemVendorPrices(): Promise<Map<number, number>> {
  const rows = await prisma.item.findMany({
    where: { vendorPrice: { gt: 0 } },
    select: { itemId: true, vendorPrice: true }
  });
  return new Map(rows.map((row) => [row.itemId, row.vendorPrice]));
}
