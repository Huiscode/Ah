// Snapshot-based market signals. Statistics follow the Auctionator data
// model: the latest snapshot's m (最低买入价) is the current price; the 7-day
// reference (med7) is the median of recent DailySummary closes on the same
// source channel — never a blend of the legacy addon P10 and the new
// auctionator lowest-buy channel.
import type { MarketHistory, SnapshotSource } from "@/lib/market-data";
import { dealRadarRules, spreadRules, moverRules, disenchantRules, AH_CUT, type DealRadarRules, type SpreadRules, type MoverRules, type DisenchantRules } from "@/lib/market-rules";
import { findDisenchantBand, equipKind, DISENCHANT_MAT_NAMES } from "@/lib/disenchant-table";
import { isStale } from "@/lib/freshness";

export type MarketSignal = {
  itemId: number;
  name: string;
  category: string;
  subCategory?: string;
  quality: string;
  icon?: string | null; // in-game icon texture name, when known
  source?: SnapshotSource; // channel of the latest snapshot; "auctionator" is produced now
  price: number; // latest snapshot's 最低买入价 (Auctionator m), copper
  minPrice: number; // latest snapshot's minimum listed unit price (= m)
  quantity: number; // latest scan's listed quantity (supply, NOT sales)
  numAuctions: number; // Auctionator 无挂单数 → 恒 0，仅保留字段兼容旧数据
  vendorPrice: number; // NPC sell price, copper; 0 = unsellable
  itemLevel?: number; // 物品等级（分解分段用）；0/缺省 = 未补抓
  med7: number; // 7-day median of DailySummary closes, SAME source only
  med7Samples: number; // same-source days inside the 7d window backing med7
  med7Distinct: number; // distinct closes in that window; 1 = flat series
  discountPercent: number; // how far the current price sits below med7
  changePercent: number; // latest daily close vs the previous same-source close
  latestAt: Date; // timestamp of the latest observation backing this signal
  turnoverScore: number; // #recipes that use this item as a reagent (higher = faster turnover)
  isVendorItem: boolean; // true = NPC sells this container/consumable (bottles, dyes, thread)
  bandLow: number; // 近 7 日每日收盘最低（≈P10，7 点近似）；0 = 数据不足
  bandHigh: number; // 近 7 日每日收盘最高（≈P90，7 点近似）；0 = 数据不足
  volatilityRatio: number; // 起伏比 = (bandHigh − bandLow) / med7 × 100；0 = 数据不足
  zone: Zone; // 当前价相对 7 日带的位置：跌破下沿=买入区，冲穿上沿=卖出区，带内=均衡
};

/** 价格区间（7 日带）位置：buy = 低于带下沿（买入区）；sell = 高于带上沿（卖出区）；flat = 带内；none = 数据不足/无波动。 */
export type Zone = "buy" | "sell" | "flat" | "none";

const DAY_MS = 24 * 60 * 60 * 1000;
const MED_WINDOW_DAYS = 7;

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length / 2) - 1];
}

function snapshotSource(snapshot: { source?: string }): SnapshotSource {
  return snapshot.source === "addon" ? "addon" : "auctionator";
}

// 近 7 日价格带（7 点近似 P10/P90）：起伏比 + 当前价位置。
// 样本 < 2 或参考价无效时不产出带（zone=none），避免单日噪声冒充区间。
export function computeBand(prices: number[], current: number, med7: number): { bandLow: number; bandHigh: number; volatilityRatio: number; zone: Zone } {
  if (prices.length < 2 || med7 <= 0 || current <= 0) {
    return { bandLow: 0, bandHigh: 0, volatilityRatio: 0, zone: "none" };
  }
  let low = Infinity;
  let high = -Infinity;
  for (const price of prices) {
    if (price < low) low = price;
    if (price > high) high = price;
  }
  const volatilityRatio = high > low ? ((high - low) / med7) * 100 : 0;
  let zone: Zone;
  if (high === low) zone = "none";
  else if (current < low) zone = "buy";
  else if (current > high) zone = "sell";
  else zone = "flat";
  return { bandLow: low, bandHigh: high, volatilityRatio, zone };
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
    const windowStart = now.getTime() - MED_WINDOW_DAYS * DAY_MS;
    const windowPrices = sameSource
      .filter((snapshot) => snapshot.timestamp.getTime() >= windowStart)
      .map((snapshot) => snapshot.marketPrice);
    let med7: number;
    let med7Samples: number;
    let med7Distinct: number;
    if (item.med7Info && item.med7Info.samples > 0) {
      med7 = item.med7Info.med7;
      med7Samples = item.med7Info.samples;
      med7Distinct = item.med7Info.distinct;
    } else {
      med7 = windowPrices.length > 0 ? median(windowPrices) : latest.marketPrice;
      med7Samples = windowPrices.length;
      med7Distinct = new Set(windowPrices).size;
    }
    const band = computeBand(windowPrices, latest.marketPrice, med7);
    return {
      itemId: item.itemId,
      name: item.name,
      category: item.category,
      subCategory: item.subCategory ?? undefined,
      quality: item.quality,
      icon: item.icon,
      source: "addon",
      price: latest.marketPrice,
      minPrice: latest.minPrice,
      quantity: latest.quantity,
      numAuctions: latest.numAuctions,
      vendorPrice: item.vendorPrice,
      itemLevel: item.itemLevel ?? 0,
      med7,
      med7Samples,
      med7Distinct,
      discountPercent: med7 > 0 ? (1 - latest.minPrice / med7) * 100 : 0,
      changePercent: previous && previous.marketPrice > 0 ? ((latest.marketPrice - previous.marketPrice) / previous.marketPrice) * 100 : 0,
      latestAt: latest.timestamp,
      turnoverScore: item.turnoverScore ?? 0,
      isVendorItem: item.isVendorItem ?? false,
      ...band
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
  // fixture（无 med7Info）回退到本地的 daily 计算。近 7 日带（bandLow/
  // bandHigh/volatilityRatio/zone）同理从同源 daily close 计算。
  const windowStart = now.getTime() - MED_WINDOW_DAYS * DAY_MS;
  const closePrices = daily
    .filter((summary) => summary.date.getTime() >= windowStart)
    .map((summary) => summary.closePrice);
  let med7: number;
  let med7Samples: number;
  let med7Distinct: number;
  if (item.med7Info && item.med7Info.samples > 0) {
    med7 = item.med7Info.med7;
    med7Samples = item.med7Info.samples;
    med7Distinct = item.med7Info.distinct;
  } else {
    med7 = closePrices.length > 0 ? median(closePrices) : latest.marketPrice;
    med7Samples = closePrices.length;
    med7Distinct = new Set(closePrices).size;
  }
  const band = computeBand(closePrices, latest.marketPrice, med7);
  return {
    itemId: item.itemId,
    name: item.name,
    category: item.category,
    subCategory: item.subCategory ?? undefined,
    quality: item.quality,
    icon: item.icon,
    source,
    price: latest.marketPrice,
    minPrice: latest.minPrice,
    quantity: latest.quantity,
    numAuctions: latest.numAuctions,
    vendorPrice: item.vendorPrice,
    itemLevel: item.itemLevel ?? 0,
    med7,
    med7Samples,
    med7Distinct,
    discountPercent: med7 > 0 ? (1 - latest.minPrice / med7) * 100 : 0,
    changePercent: previousDaily && previousDaily.closePrice > 0 ? ((latest.marketPrice - previousDaily.closePrice) / previousDaily.closePrice) * 100 : 0,
    latestAt: latest.timestamp,
    turnoverScore: item.turnoverScore ?? 0,
    isVendorItem: item.isVendorItem ?? false,
    ...band
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

export type SpreadCandidateRow = {
  itemId: number;
  name: string;
  quality: string;
  category: string;
  icon?: string | null;
  price: number;
  med7: number;
  bandLow: number;
  bandHigh: number;
  volatilityRatio: number;
  turnoverScore: number;
  quantity: number;
  zone: Zone;
  changePercent: number;
  discountPercent: number;
};

// 可做差价榜：起伏大 × 需求广 × 有人在卖 = 均值回归最赚钱的标的池。
// 门槛在 market-rules.ts（spreadRules，可配）：起伏比 ≥ minVolatilityRatio
// （7 日带宽 ÷ 参考价）、流通分 ≥ minTurnover（被 N 个配方使用）、
// 在售量 ≥ minQuantity（买得到）。zone 非 none（有真实波动带）才上榜。
export function buildSpreadCandidates(
  signals: MarketSignal[],
  rules: SpreadRules = spreadRules,
  now: Date = new Date()
): SpreadCandidateRow[] {
  const out: SpreadCandidateRow[] = [];
  for (const signal of signals) {
    if (signal.isVendorItem) continue;
    if (isStale(signal.latestAt, now, rules.staleWindowMs)) continue;
    if (signal.price <= 0) continue;
    if (signal.volatilityRatio < rules.minVolatilityRatio) continue;
    if (signal.turnoverScore < rules.minTurnover) continue;
    if (signal.quantity < rules.minQuantity) continue;
    if (signal.zone === "none") continue;
    out.push({
      itemId: signal.itemId,
      name: signal.name,
      quality: signal.quality,
      category: signal.category,
      icon: signal.icon,
      price: signal.price,
      med7: signal.med7,
      bandLow: signal.bandLow,
      bandHigh: signal.bandHigh,
      volatilityRatio: signal.volatilityRatio,
      turnoverScore: signal.turnoverScore,
      quantity: signal.quantity,
      zone: signal.zone,
      changePercent: signal.changePercent,
      discountPercent: signal.discountPercent
    });
  }
  // 综合分 = 起伏比 × (1 + 流通分)：起伏越大、需求越广越靠前；同分按在售量。
  return out.sort((left, right) => {
    const scoreLeft = left.volatilityRatio * (1 + left.turnoverScore);
    const scoreRight = right.volatilityRatio * (1 + right.turnoverScore);
    if (scoreLeft !== scoreRight) return scoreRight - scoreLeft;
    return right.quantity - left.quantity;
  });
}

export type MoverRow = {
  itemId: number;
  name: string;
  quality: string;
  category: string;
  icon?: string | null;
  price: number;
  med7: number;
  changePercent: number;
  quantity: number;
  turnoverScore: number;
  zone: Zone;
};

// 异动榜：两次扫描/两日之间价格大幅变动（|changePercent| ≥ minMovePercent，
// 默认 20%）。大跌 = 甩货/错杀 → 买点候选；大涨 = 需求脉冲/抬价 → 卖点候选。
// 需要 previousDaily 存在（否则 changePercent 为 0，自然落榜），开服初期
// daily 不足时榜为空是预期。
export function buildMoverBoard(
  signals: MarketSignal[],
  rules: MoverRules = moverRules,
  now: Date = new Date()
): MoverRow[] {
  const out: MoverRow[] = [];
  for (const signal of signals) {
    if (isStale(signal.latestAt, now, rules.staleWindowMs)) continue;
    if (signal.price <= 0) continue;
    if (signal.quantity < rules.minQuantity) continue;
    if (Math.abs(signal.changePercent) < rules.minMovePercent) continue;
    out.push({
      itemId: signal.itemId,
      name: signal.name,
      quality: signal.quality,
      category: signal.category,
      icon: signal.icon,
      price: signal.price,
      med7: signal.med7,
      changePercent: signal.changePercent,
      quantity: signal.quantity,
      turnoverScore: signal.turnoverScore,
      zone: signal.zone
    });
  }
  return out.sort((left, right) => Math.abs(right.changePercent) - Math.abs(left.changePercent));
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

// ---- 分解榜：买绿/蓝装 → 分解 → 材料挂 AH 的套利评估 ----

export type DisenchantMatLine = {
  matItemId: number;
  matName: string;
  chance: number;   // 概率 %
  qty: number;      // 该概率下数量
  matPrice: number; // 材料 AH 当前单价（铜），0 = 无价
  expected: number; // chance/100 × qty × matPrice（铜，毛贡献）
  priced: boolean;   // 材料是否有 AH 价
  breakEvenQty: number | null; // 单靠该材料回本需出个数（扣5%手续费，向上取整）；无价=null
};

export type DisenchantRow = {
  itemId: number;
  name: string;
  quality: string;
  category: string;
  subCategory?: string;
  icon?: string | null;
  itemLevel: number;
  bandLabel: string;          // 如 绿·护甲·26-30
  buyPrice: number;          // 装备当前最低买入价（铜）
  expectedValue: number;     // 毛期望分解值（扣手续费前，铜）
  disenchantNet: number;     // 分解到手(×(1−AH_CUT)) − 买入价
  vendorNet: number;         // 卖店回收 − 买入价（兜底参照，无手续费）
  bestNet: number;           // max(分解净, 卖店净)
  quantity: number;
  hasMissingMatPrice: boolean;
  mainBestLabel: string;      // 主档较好结果，如 "灵魂之尘×2"（同材料合计概率最高组里数量最大一档）
  mainBestTake: number;       // 该档到手 = qty×材料现价×(1−AH_CUT)（铜）
  mainBestNet: number;        // 该档到手 − 买入价（铜）；入选硬门槛 = mainBestTake ≥ 买入价
  mats: DisenchantMatLine[];
};

const QUALITY_LABEL: Record<string, string> = { uncommon: "绿", rare: "蓝" };
const EQUIP_LABEL: Record<string, string> = { armor: "护甲", weapon: "武器" };

// materialPrices: 材料最新单价（铜）Map；matNames: 材料名 Map（页面从 universe 构建，
// 缺名回退内置经典中文名）。材料无价 → 贡献按 0 并标记，不直接剔除（避免漏看高段机会）。
export function buildDisenchantBoard(
  signals: MarketSignal[],
  materialPrices: Map<number, number>,
  matNames: Map<number, string>,
  rules: DisenchantRules = disenchantRules,
  now: Date = new Date()
): DisenchantRow[] {
  const out: DisenchantRow[] = [];
  for (const signal of signals) {
    if (signal.isVendorItem) continue;
    if (isStale(signal.latestAt, now, rules.staleWindowMs)) continue;
    if (signal.price <= 0) continue;
    if (signal.quantity < rules.minQuantity) continue;
    if (signal.quality !== "uncommon" && signal.quality !== "rare") continue;
    const equip = equipKind(signal.category, signal.subCategory);
    if (!equip) continue;
    if ((signal.itemLevel ?? 0) <= 0) continue; // 未补抓 ilvl，无法分段，跳过
    const ilvl = signal.itemLevel ?? 0;
    const band = findDisenchantBand(signal.quality, equip, ilvl);
    if (!band) continue; // 超出经典 1-65 表覆盖，跳过

    let expectedValue = 0;
    let hasMissingMatPrice = false;
    const mats: DisenchantMatLine[] = band.outcomes.map((o) => {
      const matPrice = materialPrices.get(o.matItemId) ?? 0;
      const priced = matPrice > 0;
      if (!priced) hasMissingMatPrice = true;
      const expected = (o.chance / 100) * o.qty * matPrice;
      expectedValue += expected;
      // 单靠该材料回本需出个数 = 买入价 ÷（材料到手单价 matPrice×(1−AH_CUT)），向上取整；无价=null
      const breakEvenQty = priced
        ? Math.ceil(signal.price / (matPrice * (1 - AH_CUT)))
        : null;
      return {
        matItemId: o.matItemId,
        matName: matNames.get(o.matItemId) ?? DISENCHANT_MAT_NAMES[o.matItemId] ?? `材料#${o.matItemId}`,
        chance: o.chance,
        qty: o.qty,
        matPrice,
        expected,
        priced,
        breakEvenQty
      };
    });

    // 主档：同材料合计概率最高的一组（绿装即最常见的尘/精华档，合计约75%）；
    // 主档较好结果 = 该材料下数量最大的一档（如 26-30护甲的 灵魂之尘×2）。
    // 入选硬门槛：这一档到手 ≥ 买入价（保本有赚）；第一档（数量较小的主档）不强求。
    // 只靠小概率精华/碎片拉高期望、主档较好结果也不保本的"抽奖型"直接过滤。
    const chanceSum = new Map<number, number>();
    for (const o of band.outcomes) chanceSum.set(o.matItemId, (chanceSum.get(o.matItemId) ?? 0) + o.chance);
    let mainMatId = -1;
    let mainChance = -1;
    for (const [id, c] of chanceSum) {
      if (c > mainChance) { mainChance = c; mainMatId = id; }
    }
    let mainBestQty = 0;
    for (const o of band.outcomes) {
      if (o.matItemId === mainMatId && o.qty > mainBestQty) mainBestQty = o.qty;
    }
    const mainMatPrice = materialPrices.get(mainMatId) ?? 0;
    const mainBestTake = mainBestQty * mainMatPrice * (1 - AH_CUT);
    const mainBestNet = mainBestTake - signal.price;
    if (mainBestTake < signal.price) continue; // 主档较好结果都不保本 → 直接过滤

    const disenchantGross = expectedValue * (1 - AH_CUT);
    const disenchantNet = disenchantGross - signal.price;
    const vendorNet = signal.vendorPrice - signal.price;
    const bestNet = Math.max(disenchantNet, vendorNet);
    if (disenchantNet < rules.minNetProfit) continue;

    out.push({
      itemId: signal.itemId,
      name: signal.name,
      quality: signal.quality,
      category: signal.category,
      subCategory: signal.subCategory,
      icon: signal.icon,
      itemLevel: ilvl,
      bandLabel: `${QUALITY_LABEL[signal.quality]}·${EQUIP_LABEL[equip]}·${band.ilvlLow}-${band.ilvlHigh}`,
      buyPrice: signal.price,
      expectedValue,
      disenchantNet,
      vendorNet,
      bestNet,
      quantity: signal.quantity,
      hasMissingMatPrice,
      mainBestLabel: `${matNames.get(mainMatId) ?? DISENCHANT_MAT_NAMES[mainMatId] ?? `材料#${mainMatId}`}×${mainBestQty}`,
      mainBestTake,
      mainBestNet,
      mats
    });
  }
  // 净赚高的在前；同分按在售量。卖店兜底更好但分解为负时也列出（bestNet 排序）。
  return out.sort((left, right) => {
    if (right.bestNet !== left.bestNet) return right.bestNet - left.bestNet;
    return right.quantity - left.quantity;
  });
}

// 实际分解记账：实填材料数量 × 材料现价 = 毛额；扣 5% 手续费为到手；到手 − 买入价 = 实际净赚。
export type LedgerMat = { matItemId: number; matPrice: number; priced: boolean };
export function computeDisenchantLedger(
  mats: LedgerMat[],
  qty: Record<number, number>,
  buyPrice: number
): { gross: number; afterCut: number; net: number } {
  let gross = 0;
  for (const m of mats) {
    const n = qty[m.matItemId] ?? 0;
    if (m.priced && Number.isFinite(n) && n > 0) gross += n * m.matPrice;
  }
  const afterCut = gross * (1 - AH_CUT);
  return { gross, afterCut, net: afterCut - buyPrice };
}

// 独立分解计算器汇总：材料行带最终单价（AH现价优先，无价用手填参考价）；
// 买入行带件数×单件价，可一次批量录多件同名装备。gross=材料毛额，
// afterCut=扣5%到手，totalBuy=Σ(件数×单件)，net=到手−总买入。
export type CalcMaterialLine = { qty: number; unit: number };
export type CalcBuyLine = { count: number; unit: number };
export type CalcSummary = { gross: number; afterCut: number; totalBuy: number; net: number };

export function computeCalcSummary(materials: CalcMaterialLine[], buys: CalcBuyLine[]): CalcSummary {
  const gross = materials.reduce(
    (sum, m) => sum + (Number.isFinite(m.qty) && m.qty > 0 && m.unit > 0 ? m.qty * m.unit : 0),
    0
  );
  const afterCut = gross * (1 - AH_CUT);
  const totalBuy = buys.reduce(
    (sum, b) =>
      sum + (Number.isFinite(b.count) && b.count > 0 && b.unit > 0 ? b.count * b.unit : 0),
    0
  );
  return { gross, afterCut, totalBuy, net: afterCut - totalBuy };
}
