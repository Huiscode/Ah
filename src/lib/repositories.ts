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
  sell_price: number;
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
  market: string;
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

async function getMed7Aggregates(itemIds?: number[], mode: MarketMode = "current", market: string = "faction"): Promise<Map<number, { med7: number; samples: number; distinct: number }>> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const idCond = itemIds && itemIds.length > 0 ? Prisma.sql`AND "item_id" IN (${Prisma.join(itemIds)})` : Prisma.empty;
  if (mode === "history") {
    // 历史模式 = 旧口径：addon 快照在 7 天窗口内的 P10 (market_price) 中位数。
    const rows = await prisma.$queryRaw<Med7Raw[]>`
      WITH win AS (
        SELECT "item_id", "market_price"
        FROM "AuctionSnapshot"
        WHERE "source" = 'addon' AND "market" = ${market} AND "timestamp" >= ${cutoff} ${idCond}
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
      WHERE "date" >= ${cutoff} AND "source" <> 'addon' AND "market" = ${market} ${idCond}
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

// 单品价格档位（真档位）：该物品最新转录轮（source='transcript'）的挂单档位
// （单价升序 + 数量），供商品终端右侧"价格档位"面板展示。无档位数据返回空数组。
export async function getItemPriceTiers(itemId: number, market: string = "faction"): Promise<Array<{ price: number; qty: number }>> {
  const rows = await prisma.$queryRaw<Array<{ price: number | bigint; qty: number | bigint }>>(
    Prisma.sql`
    WITH latest AS (
      SELECT MAX("ts") AS "ts"
      FROM "AuctionTier"
      WHERE "source" = 'transcript' AND "market" = ${market} AND "item_id" = ${itemId}
    )
    SELECT t."price" AS "price", t."qty" AS "qty"
    FROM "AuctionTier" t
    JOIN latest l ON l."ts" = t."ts"
    WHERE t."source" = 'transcript' AND t."market" = ${market} AND t."item_id" = ${itemId}
    ORDER BY t."price" ASC
    `
  );
  return rows
    .map((r) => ({ price: Number(r.price), qty: Number(r.qty) }))
    .filter((t) => t.price > 0 && t.qty > 0);
}

export async function getMarketUniverse(market: string = "faction", mode: MarketMode = "current"): Promise<MarketHistory[]> {
  // current 模式排除 addon（旧 Beta 删档数据不得进入当前口径的任意查询层）；
  // history 模式只看 addon。
  const srcCond = mode === "history" ? Prisma.sql`AND "source" = 'addon'` : Prisma.sql`AND "source" <> 'addon'`;
  const [items, snaps, dailies, med7s, transcriptSnaps] = await Promise.all([
    prisma.$queryRaw<ItemRaw[]>`SELECT * FROM "Item" ORDER BY "name" ASC`,
    prisma.$queryRaw<SnapshotRaw[]>`
      WITH ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY "item_id" ORDER BY "timestamp" DESC) AS rn
        FROM "AuctionSnapshot"
        WHERE "market" = ${market} ${srcCond}
      )
      SELECT "id", "item_id", "timestamp", "server", "faction", "market", "source",
             "min_price", "market_price", "alt_price", "quantity", "num_auctions"
      FROM ranked WHERE rn <= 48 ORDER BY "item_id", "timestamp" ASC`,
    prisma.$queryRaw<DailyRaw[]>`
      WITH ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY "item_id" ORDER BY "date" DESC) AS rn
        FROM "DailySummary"
        WHERE "market" = ${market} ${srcCond}
      )
      SELECT * FROM ranked WHERE rn <= 30 ORDER BY "item_id", "date" ASC`,
    getMed7Aggregates(undefined, mode, market),
    // 转录档位只有联盟市场数据；中立市场无档位，跳过转录合成。
    mode === "history" || market !== "faction" ? Promise.resolve(new Map<number, SnapshotRaw>()) : getTranscriptLatestSnapshots()
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
    sellPrice: toNumber(i.sell_price),
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
      market: d.market,
      openPrice: toNumber(d.open_price),
      closePrice: toNumber(d.close_price),
      highPrice: toNumber(d.high_price),
      lowPrice: toNumber(d.low_price),
      volume: toNumber(d.volume)
    }))
  }));
}


export async function getItemDetail(itemId: number, mode: MarketMode = "current", market: string = "faction"): Promise<MarketHistory | null> {
  const srcCond = mode === "history" ? { source: "addon" } : { source: { not: "addon" } };
  const row = await prisma.item.findUnique({
    where: { itemId },
    include: {
      snapshots: { where: { ...srcCond, market }, orderBy: { timestamp: "asc" }, take: -96 },
      dailySummaries: { where: { ...srcCond, market }, orderBy: { date: "asc" }, take: -60 }
    }
  });
  if (row) {
    for (const s of (row as any).snapshots) { s.minPrice = Number(s.minPrice); s.marketPrice = Number(s.marketPrice); s.altPrice = s.altPrice === null ? undefined : Number(s.altPrice); }
    for (const d of (row as any).dailySummaries) { d.openPrice = Number(d.openPrice); d.closePrice = Number(d.closePrice); d.highPrice = Number(d.highPrice); d.lowPrice = Number(d.lowPrice); }
    // M4：当前模式且该物品有 transcript 档位 → 快照替换为有效最低价合成行（转录只扫联盟市场）。
    if (mode === "current" && market === "faction") {
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
    const med7s = await getMed7Aggregates([itemId], mode, market);
    (row as any).med7Info = med7s.get(itemId) ?? null;
  }
  return row as any;
}

export async function getWatchedItemIds() {
  const rows = await prisma.watchlist.findMany({ select: { itemId: true } });
  return new Set(rows.map((row) => row.itemId));
}

/** 取候选时间戳中最新的一个；剔除 null/undefined（如某市场通道无数据），全空返回 null。 */
export function pickLatestDate(...candidates: Array<Date | null | undefined>): Date | null {
  const dates = candidates.filter((t): t is Date => t instanceof Date);
  if (dates.length === 0) return null;
  return dates.reduce((max, t) => (t.getTime() > max.getTime() ? t : max));
}

export async function getLatestSnapshotTime(market: string = "faction", mode: MarketMode = "current") {
  if (mode === "history") {
    const row = await prisma.auctionSnapshot.findFirst({
      where: { market, source: "addon" },
      orderBy: { timestamp: "desc" },
      select: { timestamp: true }
    });
    return row?.timestamp ?? null;
  }
  // M4.2：新鲜度锚点取 transcript 档位与 Auctionator 快照的**较新者**。
  // M4 时 transcript 是唯一最新数据源，锚点只取档位；用户改用 Auctionator
  // 扫描后 transcript 停更，若仍只取档位会把新鲜度钉在旧扫描上（误报
  // "1 天前"）。两个通道的扫描时间取较新者：只用 Auctionator 时锚点 =
  // 快照最新；若以后 transcript 也扫，锚点 = 档位最新（更精确）。
  const [tier, snapshot] = await Promise.all([
    prisma.auctionTier.findFirst({
      where: { source: "transcript", market },
      orderBy: { ts: "desc" },
      select: { ts: true }
    }),
    prisma.auctionSnapshot.findFirst({
      where: { market },
      orderBy: { timestamp: "desc" },
      select: { timestamp: true }
    })
  ]);
  const candidates = pickLatestDate(tier?.ts, snapshot?.timestamp);
  if (candidates === null) return null;
  return candidates;
}

// 价格档位差距（真档位口径）：最新转录轮（AuctionTier, source='transcript'）里每物品
// 取最低的 5 个不同挂单价位（前 5 档），差距 = (第 5 档 − 第 1 档) / 第 1 档 × 100（%）。
// 挂单阶梯越分散，该值越大；只有 1 档或全同价的物品无差距（不计入）。
// 数据由插件扫描完成后对候选物品自动补档（Transcript 搜索采集）产生；
// 无档位数据的物品不在 Map 中，筛选时自然被排除。历史模式（addon）无档位，
// 沿用近似口径（marketPrice vs minPrice）。
export async function getPriceTierGaps(mode: MarketMode, market: string = "faction"): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (mode === "history") {
    const source = "addon";
    const latest = await prisma.auctionSnapshot.findFirst({
      where: { market, source },
      orderBy: { timestamp: "desc" },
      select: { timestamp: true }
    });
    if (!latest) return out;
    const rows = await prisma.auctionSnapshot.findMany({
      where: { market, source, timestamp: latest.timestamp },
      select: { itemId: true, marketPrice: true, minPrice: true }
    });
    for (const row of rows) {
      const min = Number(row.minPrice);
      if (min <= 0) continue;
      const gap = ((Number(row.marketPrice) - min) / min) * 100;
      if (gap >= 0) out.set(row.itemId, Math.round(gap * 100) / 100);
    }
    return out;
  }
  // 每物品取各自最新转录轮（补档逐物品完成，时间不同；用全局 MAX(ts) 会漏掉
  // 较早完成的其他候选）。与 getTranscriptLatestSnapshots 同口径。
  const rows = await prisma.$queryRaw<Array<{ itemId: number | bigint; price: number | bigint; qty: number | bigint }>>(
    Prisma.sql`
    WITH latest AS (
      SELECT "item_id" AS "itemId", MAX("ts") AS "ts"
      FROM "AuctionTier"
      WHERE "source" = 'transcript' AND "market" = ${market}
      GROUP BY "item_id"
    )
    SELECT t."item_id" AS "itemId", t."price" AS "price", t."qty" AS "qty"
    FROM "AuctionTier" t
    JOIN latest l ON l."itemId" = t."item_id" AND l."ts" = t."ts"
    WHERE t."source" = 'transcript' AND t."market" = ${market}
    `
  );
  const byItem = new Map<number, number[]>();
  for (const row of rows) {
    const p = Number(row.price);
    if (p <= 0 || Number(row.qty) <= 0) continue;
    const id = Number(row.itemId);
    const list = byItem.get(id);
    if (list) list.push(p);
    else byItem.set(id, [p]);
  }
  for (const [itemId, prices] of byItem) {
    const distinct = [...new Set(prices)].sort((a, b) => a - b).slice(0, 5);
    if (distinct.length < 2) continue;
    const low = distinct[0];
    const gap = ((distinct[distinct.length - 1] - low) / low) * 100;
    if (gap > 0) out.set(itemId, Math.round(gap * 100) / 100);
  }
  return out;
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
export async function getLatestRoundItemIds(mode: MarketMode = "current", market: string = "faction"): Promise<Set<number> | null> {
  const out = new Set<number>();
  if (mode === "current") {
    // 转录档位只扫联盟市场；中立市场不合并转录宇宙。
    if (market === "faction") {
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
  }
  const src = mode === "history" ? "addon" : "auctionator";
  const latest = await prisma.auctionSnapshot.findFirst({
    where: { source: src, market },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true }
  });
  if (!latest) {
    return out.size > 0 ? out : null;
  }
  const rows = await prisma.auctionSnapshot.findMany({
    where: { source: src, market, timestamp: latest.timestamp },
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
export async function getLatestPricesByItemIds(itemIds: number[], mode: MarketMode = "current", market: string = "faction"): Promise<Map<number, number>> {
  if (itemIds.length === 0) return new Map();
  const out = new Map<number, number>();
  if (mode === "current") {
    // 转录档位只扫联盟市场；中立市场直接走 auctionator 快照。
    if (market === "faction") {
      const transcriptSnaps = await getTranscriptLatestSnapshots(itemIds);
      for (const [itemId, snap] of transcriptSnaps) out.set(itemId, toNumber(snap.market_price));
      itemIds = itemIds.filter((id) => !out.has(id)); // 剩余物品回退 auctionator
      if (itemIds.length === 0) return out;
    }
  }
  const srcCond = mode === "history" ? Prisma.sql`"source" = 'addon' AND` : Prisma.sql`"source" = 'auctionator' AND`;
  const rows = await prisma.$queryRaw<Array<{ itemId: bigint | number; marketPrice: bigint | number }>>`
    WITH ranked AS (
      SELECT "item_id" AS "itemId", "market_price" AS "marketPrice",
             ROW_NUMBER() OVER (PARTITION BY "item_id" ORDER BY "timestamp" DESC) AS rn
      FROM "AuctionSnapshot"
      WHERE ${srcCond} "market" = ${market} AND "item_id" IN (${Prisma.join(itemIds)})
    )
    SELECT "itemId", "marketPrice" FROM ranked WHERE rn = 1
  `;
  for (const r of rows) out.set(Number(r.itemId), toNumber(r.marketPrice));
  return out;
}

// P0-B: the recipe library. category filters "craft" (professional crafts,
// from /wahrecipes dumps and the recipe library seed) or "merchant" (merchant-favor
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

// NPC 卖给玩家的单价（Item.sellPrice > 0，来源：游戏内商人窗口转录 M4.2）。
// 配方利润引擎用它做**材料成本兜底**：材料无 AH 价时按 NPC 卖价算成本，
// 比用收购价兜底更接近真实（收购价会低估成本、虚高利润）。
export async function getItemSellerPrices(): Promise<Map<number, number>> {
  const rows = await prisma.item.findMany({
    where: { sellPrice: { gt: 0 } },
    select: { itemId: true, sellPrice: true }
  });
  return new Map(rows.map((row) => [row.itemId, row.sellPrice]));
}

// 图纸/公式卷轴物品（"设计图：/公式：/图纸：/图样：/食谱：/结构图：/配方：/手册：/指南：/地图：" 前缀
// 的物品）→ 去前缀后的基础名 → itemId。配方库用它判断该制造配方是否有可拍卖的图纸卷轴
// （掉落图纸），并显示图纸拍卖行价值；训练师/NPC 直接学会的配方没有卷轴物品，不标图纸价。
const SCROLL_PREFIX_RE = /^(设计图|公式|图纸|图样|食谱|结构图|配方|手册|指南|地图)：/;
export async function getScrollItemIds(): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ name: string; item_id: number }>>`
    SELECT "name", "item_id"
    FROM "Item"
    WHERE "name" LIKE '设计图：%' OR "name" LIKE '公式：%' OR "name" LIKE '图纸：%'
       OR "name" LIKE '图样：%' OR "name" LIKE '食谱：%' OR "name" LIKE '结构图：%'
       OR "name" LIKE '配方：%' OR "name" LIKE '手册：%' OR "name" LIKE '指南：%'
       OR "name" LIKE '地图：%'
  `;
  const map = new Map<string, number>();
  for (const row of rows) {
    const base = row.name.replace(SCROLL_PREFIX_RE, "").trim();
    if (base && !map.has(base)) map.set(base, row.item_id);
  }
  return map;
}

export async function getItemSellerPricesByIds(itemIds: number[]): Promise<Map<number, number>> {
  if (itemIds.length === 0) return new Map();
  const rows = await prisma.item.findMany({
    where: { itemId: { in: itemIds }, sellPrice: { gt: 0 } },
    select: { itemId: true, sellPrice: true }
  });
  return new Map(rows.map((row) => [row.itemId, Number(row.sellPrice)]));
}

// 购物清单全量读取（/lists 页与各"加入清单"入口共用）：
// 清单 + 物品（按创建顺序）；物品的 itemId 有值时附带 Item 的 icon/quality 供展示。
export type ShoppingListWithItems = {
  id: string;
  name: string;
  items: Array<{
    id: string;
    name: string;
    itemId: number | null;
    quantity: number;
    icon: string | null;
    quality: string | null;
  }>;
};

export async function getShoppingLists(): Promise<ShoppingListWithItems[]> {
  const lists = await prisma.shoppingList.findMany({
    orderBy: { createdAt: "asc" },
    include: { items: { orderBy: { createdAt: "asc" } } }
  });
  const itemIds = Array.from(new Set(lists.flatMap((list) => list.items.map((i) => i.itemId).filter((v): v is number => v !== null))));
  const meta = itemIds.length
    ? await prisma.item.findMany({ where: { itemId: { in: itemIds } }, select: { itemId: true, icon: true, quality: true } })
    : [];
  const metaById = new Map(meta.map((m) => [m.itemId, m]));
  return lists.map((list) => ({
    id: list.id,
    name: list.name,
    items: list.items.map((item) => {
      const m = item.itemId === null ? undefined : metaById.get(item.itemId);
      return {
        id: item.id,
        name: item.name,
        itemId: item.itemId,
        quantity: item.quantity,
        icon: m?.icon ?? null,
        quality: m?.quality ?? null
      };
    })
  }));
}

