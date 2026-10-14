import { Prisma, prisma } from "@/lib/prisma";
import { type MarketHistory } from "@/lib/market-data";
import type { DbRecipe, RecipeMaterial } from "@/lib/recipe-profits";
import { filterThinDays } from "@/lib/bait-filter";
import { effectiveLowestPrice } from "@/lib/tier-filter";

// M4 常量：转录合成快照的行标识（server/faction 与 transcript 导入一致）。
const TRANSCRIPT_SERVER = "Classic Beta PvP 2";
const TRANSCRIPT_FACTION = "Alliance";

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

// 数据源模式："current" = Auctionator 最低价（默认）；"history" = 旧自研插件
// 的 Beta 删档 P10 数据（开服后供历史参考，主页面加开关切换）。
export type MarketMode = "current" | "history";

async function getMed7Aggregates(itemIds?: number[], mode: MarketMode = "current"): Promise<Map<number, { med7: number; samples: number; distinct: number }>> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const idCond = itemIds && itemIds.length > 0 ? Prisma.sql`AND "item_id" IN (${Prisma.join(itemIds)})` : Prisma.empty;
  if (mode === "history") {
    // 历史模式 = 旧口径：addon 快照在 7 天窗口内的 P10 (market_price) 中位数。
    const rows = await prisma.$queryRaw<Med7Raw[]>`
      WITH win AS (
        SELECT "item_id", "market_price"
        FROM "AuctionSnapshot"
        WHERE "source" = 'addon' AND "market" = 'faction' AND "timestamp" >= ${cutoff} ${idCond}
      ),
      med AS (
        SELECT "item_id", "market_price",
               ROW_NUMBER() OVER (PARTITION BY "item_id" ORDER BY "market_price") AS rn,
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
  // 当前模式：近 7 日 DailySummary 收盘中位数（优先 transcript 每日——档位
  // 过滤后的有效最低价；无 transcript 的物品回退 auctionator；**绝不含 addon
  // 旧 Beta 数据**——"最新 daily 选源"曾把 addon 的更新日期误选为源，导致
  // med7 混入删档旧价）。med7 只反映正常流动性下的价格中枢：剔除所有极少
  // 挂单日（不论价格高低，bait-filter.ts）——少量日价格不可靠，低价个例计入
  // 会拉低参考价制造假捡漏，高价钓单会拉高。样本不足时不过滤。
  const rows = await prisma.$queryRaw<Array<{ itemId: number | bigint; date: Date; closePrice: number | bigint; volume: number | bigint }>>(
    Prisma.sql`
    WITH latest AS (
      SELECT "item_id", "source",
             ROW_NUMBER() OVER (
               PARTITION BY "item_id"
               ORDER BY CASE WHEN "source" = 'transcript' THEN 0 ELSE 1 END, "date" DESC
             ) AS rn
      FROM "DailySummary"
      WHERE "date" >= ${cutoff} AND "source" <> 'addon' ${idCond}
    ),
    lsrc AS (SELECT "item_id", "source" FROM latest WHERE rn = 1)
    SELECT d."item_id" AS "itemId", d."date" AS "date",
           d."close_price" AS "closePrice", d."volume" AS "volume"
    FROM "DailySummary" d
    JOIN lsrc ON lsrc."item_id" = d."item_id" AND lsrc."source" = d."source"
    WHERE d."date" >= ${cutoff}
  `
  );
  const byItem = new Map<number, Array<{ date: Date; closePrice: number; volume: number }>>();
  for (const r of rows) {
    const id = Number(r.itemId);
    let list = byItem.get(id);
    if (!list) byItem.set(id, (list = []));
    list.push({ date: r.date, closePrice: toNumber(r.closePrice), volume: Number(r.volume) });
  }
  const out = new Map<number, { med7: number; samples: number; distinct: number }>();
  for (const [itemId, days] of byItem) {
    const kept = filterThinDays(days);
    const prices = kept.map((d) => d.closePrice).sort((a, b) => a - b);
    out.set(itemId, {
      med7: prices.length > 0 ? prices[Math.floor(prices.length / 2)] : 0,
      samples: kept.length,
      distinct: new Set(prices).size
    });
  }
  return out;
}

// M4：当前模式"转录合成快照"——取每物品最新一轮 AuctionTier 档位，经
// tier-filter 算有效最低价（剔除稀薄+断层钓单档）。返回按 itemId 索引的
// 合成快照行；transcript 没有的物品不返回（调用方回退 auctionator）。
async function getTranscriptLatestSnapshots(itemIds?: number[]): Promise<Map<number, SnapshotRaw>> {
  const idCond = itemIds && itemIds.length > 0 ? Prisma.sql`AND t."item_id" IN (${Prisma.join(itemIds)})` : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{ itemId: number | bigint; ts: Date; price: number | bigint; qty: number | bigint }>>(
    Prisma.sql`
    WITH latest AS (
      SELECT "item_id" AS "itemId", MAX("ts") AS "ts"
      FROM "AuctionTier"
      WHERE "source" = 'transcript' AND "market" = 'faction'
      GROUP BY "item_id"
    )
    SELECT t."item_id" AS "itemId", t."ts" AS "ts", t."price" AS "price", t."qty" AS "qty"
    FROM "AuctionTier" t
    JOIN latest l ON l."itemId" = t."item_id" AND l."ts" = t."ts"
    WHERE t."source" = 'transcript' AND t."market" = 'faction' ${idCond}
  `
  );
  const byItem = new Map<number, Array<{ price: number; qty: number }>>();
  for (const r of rows) {
    const id = Number(r.itemId);
    const list = byItem.get(id);
    if (list) list.push({ price: toNumber(r.price), qty: Number(r.qty) });
    else byItem.set(id, [{ price: toNumber(r.price), qty: Number(r.qty) }]);
  }
  const out = new Map<number, SnapshotRaw>();
  const tsByItem = new Map<number, Date>();
  for (const r of rows) tsByItem.set(Number(r.itemId), toDate(r.ts));
  for (const [itemId, tiers] of byItem) {
    const result = effectiveLowestPrice(tiers);
    if (result.effectivePrice === null) continue;
    out.set(itemId, {
      id: `tr-${itemId}`,
      item_id: itemId,
      timestamp: tsByItem.get(itemId) ?? new Date(),
      server: TRANSCRIPT_SERVER,
      faction: TRANSCRIPT_FACTION,
      market: "faction",
      source: "transcript",
      min_price: result.effectivePrice,
      market_price: result.effectivePrice,
      alt_price: null,
      quantity: result.effectiveQty,
      num_auctions: 0,
      raw_payload: null
    });
  }
  return out;
}

export async function getMarketUniverse(mode: MarketMode = "current"): Promise<MarketHistory[]> {
  // current 模式排除 addon（旧 Beta 删档数据不得进入当前口径的任意查询层）；
  // history 模式只看 addon。
  const srcCond = mode === "history" ? Prisma.sql`AND "source" = 'addon'` : Prisma.sql`AND "source" <> 'addon'`;
  const [items, snaps, dailies, med7s, transcriptSnaps] = await Promise.all([
    prisma.$queryRaw<ItemRaw[]>`SELECT * FROM "Item" ORDER BY "name" ASC`,
    prisma.$queryRaw<SnapshotRaw[]>`
      WITH ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY "item_id" ORDER BY "timestamp" DESC) AS rn
        FROM "AuctionSnapshot"
        WHERE "market" = 'faction' ${srcCond}
      )
      SELECT "id", "item_id", "timestamp", "server", "faction", "market", "source",
             "min_price", "market_price", "alt_price", "quantity", "num_auctions"
      FROM ranked WHERE rn <= 48 ORDER BY "item_id", "timestamp" ASC`,
    prisma.$queryRaw<DailyRaw[]>`
      WITH ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY "item_id" ORDER BY "date" DESC) AS rn
        FROM "DailySummary"
        WHERE 1 = 1 ${srcCond}
      )
      SELECT * FROM ranked WHERE rn <= 30 ORDER BY "item_id", "date" ASC`,
    getMed7Aggregates(undefined, mode),
    mode === "history" ? Promise.resolve(new Map<number, SnapshotRaw>()) : getTranscriptLatestSnapshots()
  ]);

  const snapsByItem = new Map<number, SnapshotRaw[]>();
  for (const s of snaps) {
    const list = snapsByItem.get(s.item_id);
    if (list) list.push(s);
    else snapsByItem.set(s.item_id, [s]);
  }
  // M4：transcript 有档位的物品，其"最新快照"替换为档位有效最低价合成行
  // （雷达/行情表读取的最新价与在售量从此以钓单过滤后的口径为准）。
  for (const [itemId, snap] of transcriptSnaps) {
    snapsByItem.set(itemId, [snap]);
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


export async function getItemDetail(itemId: number, mode: MarketMode = "current"): Promise<MarketHistory | null> {
  const srcCond = mode === "history" ? { source: "addon" } : { source: { not: "addon" } };
  const row = await prisma.item.findUnique({
    where: { itemId },
    include: {
      snapshots: { where: srcCond, orderBy: { timestamp: "asc" }, take: -96 },
      dailySummaries: { where: srcCond, orderBy: { date: "asc" }, take: -60 }
    }
  });
  if (row) {
    for (const s of (row as any).snapshots) { s.minPrice = Number(s.minPrice); s.marketPrice = Number(s.marketPrice); s.altPrice = s.altPrice === null ? undefined : Number(s.altPrice); }
    for (const d of (row as any).dailySummaries) { d.openPrice = Number(d.openPrice); d.closePrice = Number(d.closePrice); d.highPrice = Number(d.highPrice); d.lowPrice = Number(d.lowPrice); }
    // M4：当前模式且该物品有 transcript 档位 → 快照替换为有效最低价合成行。
    if (mode === "current") {
      const transcriptSnaps = await getTranscriptLatestSnapshots([itemId]);
      const snap = transcriptSnaps.get(itemId);
      if (snap) {
        (row as any).snapshots = [{
          id: snap.id,
          itemId,
          timestamp: toDate(snap.timestamp),
          server: snap.server,
          faction: snap.faction,
          market: snap.market,
          source: snap.source,
          minPrice: toNumber(snap.min_price),
          marketPrice: toNumber(snap.market_price),
          altPrice: undefined,
          quantity: toNumber(snap.quantity),
          numAuctions: 0
        }];
      }
    }
    const med7s = await getMed7Aggregates([itemId], mode);
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


export async function getLatestSnapshotTime(market: string = "faction", mode: MarketMode = "current") {
  if (mode === "current") {
    // M4：当前模式新鲜度锚点优先 transcript 最新轮（档位扫描时间）。
    const tr = await prisma.auctionTier.findFirst({
      where: { source: "transcript", market },
      orderBy: { ts: "desc" },
      select: { ts: true }
    });
    if (tr) return tr.ts;
  }
  const row = await prisma.auctionSnapshot.findFirst({
    where: { market, ...(mode === "history" ? { source: "addon" } : {}) },
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

// 最新一轮扫描的物品宇宙（雷达 universe）。当前模式 = transcript 最新轮 ∪
// Auctionator 最新轮（**并集**：转录是渐进覆盖，部分扫描时不能让雷达宇宙缩水
// 到只含已转录物品；transcript 无数据时退化回纯 auctionator）；历史模式 =
// addon 最新轮。返回 null 表示该模式尚无快照——雷达保持空态。
export async function getLatestRoundItemIds(mode: MarketMode = "current"): Promise<Set<number> | null> {
  const out = new Set<number>();
  if (mode === "current") {
    const latest = await prisma.auctionTier.findFirst({
      where: { source: "transcript", market: "faction" },
      orderBy: { ts: "desc" },
      select: { ts: true }
    });
    if (latest) {
      const rows = await prisma.auctionTier.findMany({
        where: { source: "transcript", market: "faction", ts: latest.ts },
        distinct: ["itemId"],
        select: { itemId: true }
      });
      for (const row of rows) out.add(row.itemId);
    }
  }
  const src = mode === "history" ? "addon" : "auctionator";
  const latest = await prisma.auctionSnapshot.findFirst({
    where: { source: src, market: "faction" },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true }
  });
  if (!latest) {
    return out.size > 0 ? out : null;
  }
  const rows = await prisma.auctionSnapshot.findMany({
    where: { source: src, market: "faction", timestamp: latest.timestamp },
    select: { itemId: true }
  });
  for (const row of rows) out.add(row.itemId);
  return out;
}

// Route-2 authority mirror: the in-game options panel owns the deal-radar
// thresholds; the import route replays them into the single RadarRule row
// (id=1). Returns null until the first scan with rules arrives — callers
// then fall back to the compiled defaults in market-rules.ts.
export async function getRadarRules(): Promise<unknown> {
  const row = await prisma.radarRule.findFirst({ orderBy: { updatedAt: "desc" } });
  return row?.rules ?? null;
}

// 按 itemId 批量取每个物品最新快照的市场价。当前模式 = transcript 档位
// 有效最低价（钓单过滤后；无 transcript 回退 Auctionator m）；历史模式 =
// addon 最新 P10。配方利润按模式取价。
export async function getLatestPricesByItemIds(itemIds: number[], mode: MarketMode = "current"): Promise<Map<number, number>> {
  if (itemIds.length === 0) return new Map();
  const out = new Map<number, number>();
  if (mode === "current") {
    const transcriptSnaps = await getTranscriptLatestSnapshots(itemIds);
    for (const [itemId, snap] of transcriptSnaps) out.set(itemId, toNumber(snap.market_price));
    itemIds = itemIds.filter((id) => !out.has(id)); // 剩余物品回退 auctionator
    if (itemIds.length === 0) return out;
  }
  const srcCond = mode === "history" ? Prisma.sql`"source" = 'addon' AND` : Prisma.sql`"source" = 'auctionator' AND`;
  const rows = await prisma.$queryRaw<Array<{ itemId: bigint | number; marketPrice: bigint | number }>>`
    WITH ranked AS (
      SELECT "item_id" AS "itemId", "market_price" AS "marketPrice",
             ROW_NUMBER() OVER (PARTITION BY "item_id" ORDER BY "timestamp" DESC) AS rn
      FROM "AuctionSnapshot"
      WHERE ${srcCond} "item_id" IN (${Prisma.join(itemIds)})
    )
    SELECT "itemId", "marketPrice" FROM ranked WHERE rn = 1
  `;
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
