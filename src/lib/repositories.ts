import { Prisma, prisma } from "@/lib/prisma";
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
  market: string;
  source: string;
  min_price: bigint | number;
  market_price: bigint | number;
  alt_price: bigint | number | null;
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
// ALL snapshot rows through the ORM just to truncate in JS — measured ~5s;
// the window-function version is a few hundred ms.
// med7 = 近 7 日 DailySummary 收盘中位数（Auctionator 最低价口径，按每物品
// 最新 daily 的 source 过滤，避免新旧口径混算）。每个物品一个聚合。
// Median = JS median() convention: sorted[ceil(n/2)-1], i.e. the upper
// middle element — implemented as rn = (cnt+1)/2 (integer division matches
// ceil for the median index).
type Med7Raw = { item_id: number; med7: bigint | number; samples: number; distinct_cnt: number };

async function getMed7Aggregates(itemIds?: number[]): Promise<Map<number, { med7: number; samples: number; distinct: number }>> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  // 单品页只关心一个物品的 med7：把窗口聚合限定到目标物品。
  const idCond = itemIds && itemIds.length > 0 ? Prisma.sql`AND "item_id" IN (${Prisma.join(itemIds)})` : Prisma.empty;
  const rows = await prisma.$queryRaw<Med7Raw[]>`
    WITH latest AS (
      SELECT "item_id", "source",
             ROW_NUMBER() OVER (PARTITION BY "item_id" ORDER BY "date" DESC) AS rn
      FROM "DailySummary"
      WHERE "date" >= ${cutoff} ${idCond}
    ),
    lsrc AS (SELECT "item_id", "source" FROM latest WHERE rn = 1),
    win AS (
      SELECT d."item_id", d."close_price"
      FROM "DailySummary" d
      JOIN lsrc ON lsrc."item_id" = d."item_id" AND lsrc."source" = d."source"
      WHERE d."date" >= ${cutoff}
    ),
    med AS (
      SELECT "item_id", "close_price" AS "market_price",
             ROW_NUMBER() OVER (PARTITION BY "item_id" ORDER BY "close_price") AS rn,
             COUNT(*) OVER (PARTITION BY "item_id") AS cnt
      FROM win
    )
    SELECT "item_id",
           MAX(CASE WHEN rn = (cnt + 1) / 2 THEN "market_price" END) AS "med7",
           MAX(cnt) AS "samples",
           COUNT(DISTINCT "market_price") AS "distinct_cnt"
    FROM med
    GROUP BY "item_id"
  `;
  const out = new Map<number, { med7: number; samples: number; distinct: number }>();
  for (const r of rows) {
    out.set(Number(r.item_id), { med7: toNumber(r.med7), samples: Number(r.samples), distinct: Number(r.distinct_cnt) });
  }
  return out;
}

export async function getMarketUniverse(): Promise<MarketHistory[]> {
  const [items, snaps, dailies, med7s] = await Promise.all([
    prisma.$queryRaw<ItemRaw[]>`SELECT * FROM "Item" ORDER BY "name" ASC`,
    prisma.$queryRaw<SnapshotRaw[]>`
      WITH ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY "item_id" ORDER BY "timestamp" DESC) AS rn
        FROM "AuctionSnapshot"
        WHERE "market" = 'faction'
      )
      SELECT "id", "item_id", "timestamp", "server", "faction", "market", "source",
             "min_price", "market_price", "alt_price", "quantity", "num_auctions"
      FROM ranked WHERE rn <= 48 ORDER BY "item_id", "timestamp" ASC`,
    prisma.$queryRaw<DailyRaw[]>`
      WITH ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY "item_id" ORDER BY "date" DESC) AS rn
        FROM "DailySummary"
      )
      SELECT * FROM ranked WHERE rn <= 30 ORDER BY "item_id", "date" ASC`,
    getMed7Aggregates()
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
    med7Info: med7s.get(Number(i.item_id)),
    snapshots: (snapsByItem.get(Number(i.item_id)) ?? []).map((s) => ({
      id: s.id,
      itemId: Number(s.item_id),
      timestamp: toDate(s.timestamp),
      server: s.server,
      faction: s.faction,
      market: s.market,
      source: s.source,
      minPrice: toNumber(s.min_price),
      marketPrice: toNumber(s.market_price),
      altPrice: s.alt_price === null ? undefined : toNumber(s.alt_price),
      quantity: toNumber(s.quantity),
      numAuctions: toNumber(s.num_auctions)
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
    for (const s of (row as any).snapshots) { s.minPrice = Number(s.minPrice); s.marketPrice = Number(s.marketPrice); s.altPrice = s.altPrice === null ? undefined : Number(s.altPrice); }
    for (const d of (row as any).dailySummaries) { d.openPrice = Number(d.openPrice); d.closePrice = Number(d.closePrice); d.highPrice = Number(d.highPrice); d.lowPrice = Number(d.lowPrice); }
    const med7s = await getMed7Aggregates([itemId]);
    (row as any).med7Info = med7s.get(itemId) ?? null;
  }
  return row as any;
}

export async function getWatchedItemIds() {
  const rows = await prisma.watchlist.findMany({ select: { itemId: true } });
  return new Set(rows.map((row) => row.itemId));
}

export async function getAlertRules() {
  return prisma.alertRule.findMany({ orderBy: { itemId: "asc" } });
}


export async function getLatestSnapshotTime(market: string = "faction") {
  const row = await prisma.auctionSnapshot.findFirst({
    where: { market },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true }
  });
  return row?.timestamp ?? null;
}

// Metadata version of the item universe (MAX updated_at). The market-signal
// cache keys on (latest snapshot, this) so backfills of name/quality/category
// invalidate the in-memory signals without waiting for the next scan.
export async function getItemMetaVersion(): Promise<number> {
  const row = await prisma.item.aggregate({ _max: { updatedAt: true } });
  return row._max.updatedAt?.getTime() ?? 0;
}

// M2 跨市场倒卖与中立市场（/neutral /arbitrage）随中立市场整体下线，相关
// 查询已归档（archive/lib/cross-market.ts、archive/pages/）。中立/账本数据
// 不再新进；旧行保留在库中供历史模式展示。

// 最新一轮 Auctionator 扫描的物品宇宙。雷达的 universe 与游戏内当前在售
// 一致：没有数据源的物品不能被买入，也不应作为捡漏推荐。返回 null 表示
// 尚无 Auctionator 快照——雷达此时无宇宙、保持空态。
export async function getLatestRoundItemIds(): Promise<Set<number> | null> {
  const latest = await prisma.auctionSnapshot.findFirst({
    where: { source: "auctionator", market: "faction" },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true }
  });
  if (!latest) return null;
  const rows = await prisma.auctionSnapshot.findMany({
    where: { source: "auctionator", market: "faction", timestamp: latest.timestamp },
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

// 按 itemId 批量取每个物品最新快照的市场价（Auctionator m，即最低买入价）。
// 配方利润只需要这些价，不需要全市场信号。
export async function getLatestPricesByItemIds(itemIds: number[]): Promise<Map<number, number>> {
  if (itemIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<Array<{ itemId: bigint | number; marketPrice: bigint | number }>>`
    WITH ranked AS (
      SELECT "item_id" AS "itemId", "market_price" AS "marketPrice",
             ROW_NUMBER() OVER (PARTITION BY "item_id" ORDER BY "timestamp" DESC) AS rn
      FROM "AuctionSnapshot"
      WHERE "source" = 'auctionator' AND "item_id" IN (${Prisma.join(itemIds)})
    )
    SELECT "itemId", "marketPrice" FROM ranked WHERE rn = 1
  `;
  const out = new Map<number, number>();
  for (const r of rows) out.set(Number(r.itemId), toNumber(r.marketPrice));
  return out;
}

// P0-B: the recipe library. category filters "craft" (professional crafts,
// from /wahrecipes dumps and the wx-wow seed) or "merchant" (merchant-favor
// exchanges); omit for everything. reagents/outputs are JSON columns that
// mirror the addon's field names (itemId/name/quantity/vendorPrice), so the
// profit engine consumes them without reshaping.
function mapRecipeRow(row: {
  name: string;
  profession: string;
  skillLevel: number;
  category: string;
  favorCost: number;
  difficulty: unknown;
  categoryName: string | null;
  spellId: number | null;
  reagents: unknown;
  outputs: unknown;
}): DbRecipe {
  return {
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
  };
}

export async function getRecipes(category?: "craft" | "merchant"): Promise<DbRecipe[]> {
  const rows = await prisma.recipe.findMany({
    where: category ? { category } : undefined,
    orderBy: { name: "asc" }
  });
  return rows.map(mapRecipeRow);
}

// 产出指定物品的配方：outputs JSON 数组含该 itemId（商品终端"制作配方"
// 面板用）。只取匹配行，避免每次单品页加载全量配方库。
export async function getRecipesProducing(itemId: number): Promise<DbRecipe[]> {
  const rows = await prisma.$queryRaw<Array<{
    name: string;
    profession: string;
    skillLevel: number;
    category: string;
    favorCost: number;
    difficulty: unknown;
    categoryName: string | null;
    spellId: number | null;
    reagents: unknown;
    outputs: unknown;
  }>>`
    SELECT "name", "profession", "skill_level" AS "skillLevel", "category", "favor_cost" AS "favorCost",
           "difficulty", "category_name" AS "categoryName", "spell_id" AS "spellId", "reagents", "outputs"
    FROM "Recipe"
    WHERE EXISTS (
      SELECT 1 FROM json_each("Recipe"."outputs") AS e
      WHERE json_extract(e.value, '$.itemId') = ${itemId}
    )
    ORDER BY "name" ASC
  `;
  return rows.map(mapRecipeRow);
}

// 按 itemId 批量取 NPC 保底价（Item.vendorPrice > 0），供配方利润引擎兜底。
export async function getItemVendorPricesByIds(itemIds: number[]): Promise<Map<number, number>> {
  if (itemIds.length === 0) return new Map();
  const rows = await prisma.item.findMany({
    where: { itemId: { in: itemIds }, vendorPrice: { gt: 0 } },
    select: { itemId: true, vendorPrice: true }
  });
  return new Map(rows.map((row) => [row.itemId, Number(row.vendorPrice)]));
}

// Vendor floors picked up from the Auctionator VENDOR_PRICE_CACHE channel
// (Item.vendorPrice, silver→copper converted at import); the profit engine
// merges them under the recipe vendorP floor.
export async function getItemVendorPrices(): Promise<Map<number, number>> {
  const rows = await prisma.item.findMany({
    where: { vendorPrice: { gt: 0 } },
    select: { itemId: true, vendorPrice: true }
  });
  return new Map(rows.map((row) => [row.itemId, row.vendorPrice]));
}
