// Snapshot-based market signals. Statistics follow the Auctionator data
// model: the latest snapshot's m (最低买入价) is the current price; the 7-day
// reference (med7) is the median of recent DailySummary closes on the same
// source channel — never a blend of the legacy addon P10 and the new
// auctionator lowest-buy channel.
import type { MarketHistory, SnapshotSource } from "@/lib/market-data";
import { dealRadarRules, AH_CUT, type DealRadarRules } from "@/lib/market-rules";
import { isStale } from "@/lib/freshness";

export type MarketSignal = {
  itemId: number;
  name: string;
  category: string;
  quality: string;
  icon?: string | null; // in-game icon texture name, when known
  source?: SnapshotSource; // channel of the latest snapshot; "auctionator" is produced now
  price: number; // latest snapshot's 最低买入价 (Auctionator m), copper
  minPrice: number; // latest snapshot's minimum listed unit price (= m)
  quantity: number; // latest scan's listed quantity (supply, NOT sales)
  numAuctions: number; // Auctionator 无挂单数 → 恒 0，仅保留字段兼容旧数据
  vendorPrice: number; // NPC sell price, copper; 0 = unsellable
  med7: number; // 7-day median of DailySummary closes, SAME source only
  med7Samples: number; // same-source days inside the 7d window backing med7
  med7Distinct: number; // distinct closes in that window; 1 = flat series
  discountPercent: number; // how far the current price sits below med7
  changePercent: number; // latest daily close vs the previous same-source close
  latestAt: Date; // timestamp of the latest observation backing this signal
  turnoverScore: number; // #recipes that use this item as a reagent (higher = faster turnover)
  isVendorItem: boolean; // true = NPC sells this container/consumable (bottles, dyes, thread)
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MED_WINDOW_DAYS = 7;

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length / 2) - 1];
}

function snapshotSource(snapshot: { source?: string }): SnapshotSource {
  return snapshot.source === "addon" ? "addon" : "auctionator";
}

export type SignalMode = "current" | "history";

export function buildMarketSignal(item: MarketHistory, now: Date, mode: SignalMode = "current"): MarketSignal | null {
  // 数据源隔离：history 模式只看 addon（旧 Beta P10），current 模式只看
  // auctionator + transcript（**绝不含 addon**——旧删档数据混入会把 10-06
  // 的过时价格当"当前价"推进雷达/行情）。过滤后无该源快照 → null，调用方跳过。
  const snapshots = [...item.snapshots]
    .filter((snapshot) => (mode === "history" ? snapshotSource(snapshot) === "addon" : snapshotSource(snapshot) !== "addon"))
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
  if (snapshots.length === 0) {
    return null;
  }
  const latest = snapshots[snapshots.length - 1];
  const source = snapshotSource(latest);
  // 历史模式（旧 Beta P10 数据）：沿用旧口径——med7 = 7 天窗口内 addon
  // 快照 P10 中位数；环比 = 上一次扫描；折扣 = 最低挂单价 vs P10。
  if (mode === "history") {
    const sameSource = snapshots.filter((snapshot) => snapshotSource(snapshot) === "addon");
    const previous = sameSource[sameSource.length - 2];
    let med7: number;
    let med7Samples: number;
    let med7Distinct: number;
    if (item.med7Info && item.med7Info.samples > 0) {
      med7 = item.med7Info.med7;
      med7Samples = item.med7Info.samples;
      med7Distinct = item.med7Info.distinct;
    } else {
      const windowStart = now.getTime() - MED_WINDOW_DAYS * DAY_MS;
      const windowPrices = sameSource
        .filter((snapshot) => snapshot.timestamp.getTime() >= windowStart)
        .map((snapshot) => snapshot.marketPrice);
      med7 = windowPrices.length > 0 ? median(windowPrices) : latest.marketPrice;
      med7Samples = windowPrices.length;
      med7Distinct = new Set(windowPrices).size;
    }
    return {
      itemId: item.itemId,
      name: item.name,
      category: item.category,
      quality: item.quality,
      icon: item.icon,
      source: "addon",
      price: latest.marketPrice,
      minPrice: latest.minPrice,
      quantity: latest.quantity,
      numAuctions: latest.numAuctions,
      vendorPrice: item.vendorPrice,
      med7,
      med7Samples,
      med7Distinct,
      discountPercent: med7 > 0 ? (1 - latest.minPrice / med7) * 100 : 0,
      changePercent: previous && previous.marketPrice > 0 ? ((latest.marketPrice - previous.marketPrice) / previous.marketPrice) * 100 : 0,
      latestAt: latest.timestamp,
      turnoverScore: item.turnoverScore ?? 0,
      isVendorItem: item.isVendorItem ?? false
    };
  }
  // 当前模式（Auctionator）：走势与参考价来自 DailySummary，与最新快照
  // 同 source。legacy addon 行不混入：同一 med7 窗口绝不混合两种口径。
  const daily = [...(item.dailySummaries ?? [])]
    .filter((summary) => snapshotSource(summary) === source)
    .sort((left, right) => left.date.getTime() - right.date.getTime());
  const previousDaily = daily[daily.length - 2];
  // med7Info 是仓储层 SQL 聚合（近 7 日 daily close 中位数）。快照数组在
  // 首页被截断（48 行），从它重算会随截断深度漂移；优先用聚合，仅手搭
  // fixture（无 med7Info）回退到本地的 daily 计算。
  let med7: number;
  let med7Samples: number;
  let med7Distinct: number;
  if (item.med7Info && item.med7Info.samples > 0) {
    med7 = item.med7Info.med7;
    med7Samples = item.med7Info.samples;
    med7Distinct = item.med7Info.distinct;
  } else {
    const windowStart = now.getTime() - MED_WINDOW_DAYS * DAY_MS;
    const windowPrices = daily
      .filter((summary) => summary.date.getTime() >= windowStart)
      .map((summary) => summary.closePrice);
    med7 = windowPrices.length > 0 ? median(windowPrices) : latest.marketPrice;
    med7Samples = windowPrices.length;
    med7Distinct = new Set(windowPrices).size;
  }
  return {
    itemId: item.itemId,
    name: item.name,
    category: item.category,
    quality: item.quality,
    icon: item.icon,
    source,
    price: latest.marketPrice,
    minPrice: latest.minPrice,
    quantity: latest.quantity,
    numAuctions: latest.numAuctions,
    vendorPrice: item.vendorPrice,
    med7,
    med7Samples,
    med7Distinct,
    discountPercent: med7 > 0 ? (1 - latest.minPrice / med7) * 100 : 0,
    changePercent: previousDaily && previousDaily.closePrice > 0 ? ((latest.marketPrice - previousDaily.closePrice) / previousDaily.closePrice) * 100 : 0,
    latestAt: latest.timestamp,
    turnoverScore: item.turnoverScore ?? 0,
    isVendorItem: item.isVendorItem ?? false
  };
}

export type DealRadarRow = {
  itemId: number;
  name: string;
  quality: string;
  category: string;
  icon?: string | null; // in-game icon texture name, when known
  source?: SnapshotSource; // channel backing this deal's reference; absent = auctionator
  minPrice: number;
  reference: number; // vendorPrice for vendor deals, med7 otherwise
  profit: number; // copper spread between reference and current price
  vendor: boolean;
  discountPercent: number;
  changePercent: number;
  quantity: number;
  numAuctions: number;
  turnoverScore: number; // #recipes that use this item as reagent; higher = faster sell-through
};

// Deal radar. 口径 = Auctionator 最低买入价：
//   必赚（NPC 倒卖）：v[ NPC 卖价] > m[当前最低买入价]——NPC 必收，零风险。
//   捡漏：m ≤ 7日参考(med7) × discount，且满足绝对利润/利润率/历史深度/
//         参考可信度门槛。Auctionator 无挂单数（numAuctions 恒 0），
//         因此原"挂单数 ≥ N"流动性门删除（用户选择先观察，不加替代门槛）。
// 门槛来源：网页侧常量（market-rules.ts）——插件下线后不再有游戏内权威
// 面板同步。
export function buildDealRadar(signals: MarketSignal[], rules: DealRadarRules = dealRadarRules, now: Date = new Date()): DealRadarRow[] {
  const {
    minProfit: RADAR_MIN_PROFIT,
    minHistory: RADAR_MIN_HISTORY,
    minMed7Distinct: RADAR_MIN_MED7_DISTINCT,
    staleWindowMs: RADAR_STALE_WINDOW_MS
  } = rules;
  const deals: DealRadarRow[] = [];
  for (const signal of signals) {
    // Skip NPC-sold containers/consumables (empty vials, lead vials, dyes,
    // thread). Their AH price is capped at the vendor floor, so flipping them
    // never makes money; the radar should never surface them.
    if (signal.isVendorItem) continue;
    // Freshness gate: skip deals whose latest observation is older than the
    // stale window. Auctionator/transcript 扫描是手动全量，窗口默认 7 天
    // （dealRadarRules.staleWindowMs，可经网页设置面板调整；isStale 默认
    // 2 小时是给实时数据的，这里必须显式传雷达窗口）。
    if (isStale(signal.latestAt, now, RADAR_STALE_WINDOW_MS)) continue;
    // Class 1: vendor arbitrage. Listed below the NPC sell price is a
    // guaranteed profit with zero market risk — no history needed, and no
    // profit floor either: the NPC always buys, so even a 1c spread is
    // free money the moment you're already at the AH.
    if (signal.vendorPrice > 0 && signal.minPrice > 0 && signal.minPrice < signal.vendorPrice) {
      deals.push({
        itemId: signal.itemId,
        name: signal.name,
        quality: signal.quality,
        category: signal.category,
        icon: signal.icon,
        source: "auctionator",
        minPrice: signal.minPrice,
        reference: signal.vendorPrice,
        profit: signal.vendorPrice - signal.minPrice,
        vendor: true,
        discountPercent: (1 - signal.minPrice / signal.vendorPrice) * 100,
        changePercent: signal.changePercent,
        quantity: signal.quantity,
        numAuctions: signal.numAuctions,
        turnoverScore: signal.turnoverScore
      });
    // Class 2: median discount. Requires history depth (2+ days) AND a
    // worthwhile absolute spread — otherwise the list fills with illiquid
    // junk nobody ever buys. med7 credibility guard: a flat series is one
    // camper's ask. 2026-10-14 用户拍板移除：折扣线（discount）、折扣下限
    // （maxDiscount）、供应上限（supplyCap）与最低利润率（minProfitRatio）
    // ——门槛只留绝对利润、历史天数与可信度，深折扣一律视为捡漏机会。
    } else if (signal.med7Samples >= RADAR_MIN_HISTORY && signal.med7 > 0 && signal.minPrice > 0
      && signal.med7 * (1 - AH_CUT) - signal.minPrice >= RADAR_MIN_PROFIT
      && signal.med7Distinct >= RADAR_MIN_MED7_DISTINCT) {
      deals.push({
        itemId: signal.itemId,
        name: signal.name,
        quality: signal.quality,
        category: signal.category,
        icon: signal.icon,
        source: signal.source,
        minPrice: signal.minPrice,
        reference: signal.med7,
        profit: Math.floor(signal.med7 * (1 - AH_CUT) - signal.minPrice),
        vendor: false,
        discountPercent: signal.discountPercent,
        changePercent: signal.changePercent,
        quantity: signal.quantity,
        numAuctions: signal.numAuctions,
        turnoverScore: signal.turnoverScore
      });
    }
  }
  // Vendor deals first (risk-free), then by turnover score (faster sellers),
  // then by absolute profit. High-turnover items liquidate quickly; stacking
  // profit on a slow mover ties up gold that could be rotating on a fast one.
  return deals.sort((left, right) => {
    if (left.vendor !== right.vendor) return left.vendor ? -1 : 1;
    if (left.turnoverScore !== right.turnoverScore) return right.turnoverScore - left.turnoverScore;
    return right.profit - left.profit;
  });
}

export type WeekdaySeasonality = {
  weekday: number; // 0 = Sunday .. 6 = Saturday (UTC)
  priceDeviation: number; // weekday median close vs overall median, percent
  listedShare: number; // weekday share of total listed quantity, percent
  sampleCount: number;
};

// WoW trading has a weekly pulse (reset day, raid nights); weekday
// medians make the cycle visible without one spike day skewing it.
export function buildWeekdaySeasonality(
  summaries: Array<{ date: Date; closePrice: number; volume: number }>
): WeekdaySeasonality[] {
  if (summaries.length === 0) return [];
  const overallMedian = median(summaries.map((summary) => summary.closePrice));
  const totalListed = summaries.reduce((sum, summary) => sum + summary.volume, 0);
  const byWeekday = new Map<number, { closes: number[]; listed: number }>();
  for (const summary of summaries) {
    const weekday = summary.date.getUTCDay();
    const bucket = byWeekday.get(weekday) ?? { closes: [], listed: 0 };
    bucket.closes.push(summary.closePrice);
    bucket.listed += summary.volume;
    byWeekday.set(weekday, bucket);
  }
  return Array.from(byWeekday.entries())
    .sort(([left], [right]) => left - right)
    .map(([weekday, bucket]) => ({
      weekday,
      priceDeviation: overallMedian === 0 ? 0 : ((median(bucket.closes) - overallMedian) / overallMedian) * 100,
      listedShare: totalListed === 0 ? 0 : (bucket.listed / totalListed) * 100,
      sampleCount: bucket.closes.length
    }));
}
