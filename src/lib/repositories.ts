import { prisma } from "@/lib/prisma";
import { type MarketHistory } from "@/lib/market-data";
import type { DbRecipe, RecipeMaterial } from "@/lib/recipe-profits";

type ItemRaw = {
  id: string;
  item_id: number;
  name: string;
  quality: string;
  category: string;
  sub_category: string;
  icon: string | null;
  vendor_price: number;
  turnover_score: number;
  is_vendor_item: number;
  created_at: number | string | Date;
  updated_at: number | string | Date;
};

type SnapshotRaw = {
  id: string;
  item_id: number;
  timestamp: number | string | Date;
  server: string;
  faction: string;
  source: string;
  min_price: bigint | number;
  market_price: bigint | number;
  quantity: number;
  num_auctions: number;
  raw_payload: string | null;
  rn?: number;
};

type DailyRaw = {
  id: string;
  item_id: number;
  date: number | string | Date;
  source: string;
  open_price: bigint | number;
  close_price: bigint | number;
  high_price: bigint | number;
  low_price: bigint | number;
  volume: number;
  rn?: number;
};

function toDate(v: number | string | Date): Date {
  return v instanceof Date ? v : new Date(v);
}

function toNumber(v: bigint | number): number {
  return typeof v === "bigint" ? Number(v) : v;
}

// The homepage universe: every item plus its most recent 48 snapshots and 30
// daily summaries. Written as raw SQL because the Prisma include form pulls
// ALL snapshot rows (37x10^4+) through the ORM just to truncate in JS —
// measured ~5s; the window-function version is a few hundred ms.
export async function getMarketUniverse(): Promise<MarketHistory[]> {
  const [items, snaps, dailies] = await Promise.all([
    prisma.$queryRaw<ItemRaw[]>`SELECT * FROM "Item" ORDER BY "name" ASC`,
    prisma.$queryRaw<SnapshotRaw[]>`
      WITH ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY "item_id" ORDER BY "timestamp" DESC) AS rn
        FROM "AuctionSnapshot"
      )
      SELECT "id", "item_id", "timestamp", "server", "faction", "source",
             "min_price", "market_price", "quantity", "num_auctions"
      FROM ranked WHERE rn <= 48 ORDER BY "item_id", "timestamp" ASC`,
    prisma.$queryRaw<DailyRaw[]>`
      WITH ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY "item_id" ORDER BY "date" DESC) AS rn
        FROM "DailySummary"
      )
      SELECT * FROM ranked WHERE rn <= 30 ORDER BY "item_id", "date" ASC`
  ]);

  const snapsByItem = new Map<number, SnapshotRaw[]>();
  for (const s of snaps) {
    const list = snapsByItem.get(s.item_id);
    if (list) list.push(s);
    else snapsByItem.set(s.item_id, [s]);
  }
  const dailyByItem = new Map<number, DailyRaw[]>();
  for (const d of dailies) {
    const list = dailyByItem.get(d.item_id);
    if (list) list.push(d);
    else dailyByItem.set(d.item_id, [d]);
  }

  return items.map((i) => ({
    id: i.id,
    itemId: Number(i.item_id),
    name: i.name,
    quality: i.quality,
    category: i.category,
    subCategory: i.sub_category,
    icon: i.icon,
    vendorPrice: toNumber(i.vendor_price),
    turnoverScore: toNumber(i.turnover_score),
    isVendorItem: Boolean(i.is_vendor_item),
    createdAt: toDate(i.created_at),
    updatedAt: toDate(i.updated_at),
    snapshots: (snapsByItem.get(Number(i.item_id)) ?? []).map((s) => ({
      id: s.id,
      itemId: Number(s.item_id),
      timestamp: toDate(s.timestamp),
      server: s.server,
      faction: s.faction,
      source: s.source,
      minPrice: toNumber(s.min_price),
      marketPrice: toNumber(s.market_price),
      quantity: toNumber(s.quantity),
      numAuctions: toNumber(s.num_auctions),
      rawPayload: (s.raw_payload ?? null) as unknown
    })),
    dailySummaries: (dailyByItem.get(Number(i.item_id)) ?? []).map((d) => ({
      id: d.id,
      itemId: Number(d.item_id),
      date: toDate(d.date),
      source: d.source,
      openPrice: toNumber(d.open_price),
      closePrice: toNumber(d.close_price),
      highPrice: toNumber(d.high_price),
      lowPrice: toNumber(d.low_price),
      volume: toNumber(d.volume)
    }))
  }));
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
