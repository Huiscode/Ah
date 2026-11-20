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
  nameEn?: string | null; // 英文名（Item.name_en 回填）；EN 模式优先，缺失回退 name
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
      nameEn: item.nameEn,
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
    nameEn: item.nameEn,
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

export type DealKind = "vendor" | "flip" | "cross" | "band";
export type PriceTier = { price: number; qty: number };

export type DealRadarRow = {
  key: string; // kind:itemId（同一物品可同时出现在扫货与跨市场两行）
  kind: DealKind;
  itemId: number;
  name: string;
  nameEn?: string | null;
  quality: string;
  category: string;
  icon?: string | null; // in-game icon texture name, when known
  source?: SnapshotSource; // channel backing this deal's reference; absent = auctionator
  buyPrice: number; // 最便宜一档单价（买入起点）
  buyQty: number; // 建议买入数量（扫到的档位合计；无档位数据时按 1）
  buyCost: number; // 买入总花费
  depthKnown: boolean; // true = 有前五档真实档位；false = 只知道最低价
  sellPrice: number; // 目标卖价（NPC 收购价 / 回挂价 / 另一市场挂价）
  sellMarket?: "faction" | "neutral"; // 跨市场：去哪个市场卖
  unitProfit: number; // 最贵一件买入的税后单件净利（保守口径）
  totalProfit: number; // 全部买入量的税后总净利
  roiPercent: number; // totalProfit / buyCost
  reference: number; // vendorPrice / med7 / 另一市场最低价
  minPrice: number; // = buyPrice（兼容旧字段）
  profit: number; // = unitProfit（兼容旧字段）
  vendor: boolean; // = kind === "vendor"
  discountPercent: number;
  changePercent: number;
  quantity: number; // 本市场在售总量
  numAuctions: number;
  turnoverScore: number; // #recipes that use this item as reagent; higher = faster sell-through
};

export type DealRadarContext = {
  /** 本市场前五档（升序）。缺失的物品按"只知道最低价、可买量 1"处理。 */
  tiersByItemId?: Map<number, PriceTier[]>;
  /** 另一市场的信号（跨市场策略）。 */
  otherSignals?: MarketSignal[];
  otherMarket?: "faction" | "neutral";
  spreadRules?: SpreadRules;
};

// 可买的订单簿：档位里低于当前最低价的已成交/撤单（档位比快照旧），丢掉；
// 最低价那一档不在档位里时补一条数量未知（按 1）的。
function orderBook(signal: MarketSignal, tiers: PriceTier[] | undefined): { book: PriceTier[]; depthKnown: boolean } {
  const min = signal.minPrice;
  if (!tiers || tiers.length === 0) return { book: [{ price: min, qty: 1 }], depthKnown: false };
  const live = tiers.filter((t) => t.price >= min && t.qty > 0).sort((a, b) => a.price - b.price);
  if (live.length === 0 || live[0].price > min) live.unshift({ price: min, qty: 1 });
  return { book: live, depthKnown: true };
}

type Sweep = { k: number; target: number; qty: number; cost: number; unitProfit: number; totalProfit: number };

// 扫货：买下前 k 档，在 target（由 targetFor(k) 给出）卖出。逐个 k 试，取总利润最大且
// 最贵一档仍过单件门槛的方案。unitGate(price) 返回该买入价需要的最低单件净利。
function bestSweep(
  book: PriceTier[],
  targetFor: (k: number) => number,
  netOf: (target: number) => number,
  unitGate: (price: number) => number
): Sweep | null {
  let best: Sweep | null = null;
  let qty = 0;
  let cost = 0;
  for (let k = 1; k <= book.length; k++) {
    const tier = book[k - 1];
    qty += tier.qty;
    cost += tier.price * tier.qty;
    const target = targetFor(k);
    if (!(target > 0)) continue;
    const net = netOf(target);
    const unitProfit = Math.floor(net - tier.price);
    // 第 k 档是已买入里最贵的一档，它的单件净利就是整笔的最差单件；不达标时
    // 继续试更深的 k（下一档更远 → 回挂价更高）。
    if (unitProfit < unitGate(tier.price)) continue;
    const totalProfit = Math.floor(net * qty - cost);
    if (!best || totalProfit > best.totalProfit) best = { k, target, qty, cost, unitProfit, totalProfit };
  }
  return best;
}

function baseRow(signal: MarketSignal) {
  return {
    itemId: signal.itemId,
    name: signal.name,
    nameEn: signal.nameEn,
    quality: signal.quality,
    category: signal.category,
    icon: signal.icon,
    source: signal.source,
    discountPercent: signal.discountPercent,
    changePercent: signal.changePercent,
    quantity: signal.quantity,
    numAuctions: signal.numAuctions,
    turnoverScore: signal.turnoverScore
  };
}

function makeRow(
  signal: MarketSignal,
  kind: DealKind,
  sweep: Sweep,
  book: PriceTier[],
  depthKnown: boolean,
  reference: number,
  sellMarket?: "faction" | "neutral"
): DealRadarRow {
  return {
    ...baseRow(signal),
    key: `${kind}:${signal.itemId}`,
    kind,
    buyPrice: book[0].price,
    buyQty: sweep.qty,
    buyCost: sweep.cost,
    depthKnown,
    sellPrice: sweep.target,
    sellMarket,
    unitProfit: sweep.unitProfit,
    totalProfit: sweep.totalProfit,
    roiPercent: sweep.cost > 0 ? (sweep.totalProfit / sweep.cost) * 100 : 0,
    reference,
    minPrice: book[0].price,
    profit: sweep.unitProfit,
    vendor: kind === "vendor"
  };
}

// Deal radar（2026-11-20 重构，规则见 market-rules.ts 顶部注释）。
// 价格口径 = 当前最低买入价（Auctionator m / 转录有效最低价）；参考价 = 同源 7 日收盘中位数。
export function buildDealRadar(
  signals: MarketSignal[],
  rules: DealRadarRules = dealRadarRules,
  now: Date = new Date(),
  context: DealRadarContext = {}
): DealRadarRow[] {
  const deals: DealRadarRow[] = [];
  const tiersByItemId = context.tiersByItemId;
  const otherById = new Map((context.otherSignals ?? []).map((s) => [s.itemId, s]));
  const spread = context.spreadRules ?? spreadRules;
  const flipGate = (price: number) => Math.max(rules.flipMinUnitProfit, (price * rules.flipMinUnitRatio) / 100);
  const afterCut = (target: number) => target * (1 - AH_CUT);
  const passesTotal = (sweep: Sweep, depthKnown: boolean, floor: number) => !depthKnown || sweep.totalProfit >= floor;

  for (const signal of signals) {
    // NPC 卖的容器/消耗品（空瓶、染料、线）：AH 价被商人价封顶，倒卖永远不赚钱。
    if (signal.isVendorItem) continue;
    if (signal.minPrice <= 0) continue;
    // isStale 默认 2 小时是给实时数据的，这里必须显式传雷达窗口。
    if (isStale(signal.latestAt, now, rules.staleWindowMs)) continue;
    const { book, depthKnown } = orderBook(signal, tiersByItemId?.get(signal.itemId));

    // 必赚：所有低于 NPC 收购价的档位都买，NPC 必收、不扣拍卖行税，无需历史。
    let vendorRow = false;
    if (signal.vendorPrice > 0 && signal.minPrice < signal.vendorPrice) {
      const sweep = bestSweep(book, () => signal.vendorPrice, (t) => t, () => 1);
      if (sweep && passesTotal(sweep, depthKnown, rules.vendorMinTotalProfit)) {
        deals.push(makeRow(signal, "vendor", sweep, book, depthKnown, signal.vendorPrice));
        vendorRow = true;
      }
    }

    // 扫货回挂：7 日参考可信时，买下便宜档位，挂在"下一档 −1 铜"（不超过 7 日参考）。
    const med7Credible = signal.med7 > 0 && signal.med7Samples >= rules.minHistory && signal.med7Distinct >= rules.minMed7Distinct;
    let flipRow = false;
    if (!vendorRow && med7Credible) {
      const targetFor = (k: number) => (k < book.length ? Math.min(signal.med7, book[k].price - 1) : signal.med7);
      const sweep = bestSweep(book, targetFor, afterCut, flipGate);
      if (sweep && passesTotal(sweep, depthKnown, rules.flipMinTotalProfit)) {
        deals.push(makeRow(signal, "flip", sweep, book, depthKnown, signal.med7));
        flipRow = true;
      }
    }

    // 波段（原"可做差价"）：高波动 × 需求广 × 有货，且已跌破 7 日带下沿 → 回到参考价卖出。
    if (!vendorRow && !flipRow && signal.zone === "buy" && signal.med7 > 0
      && signal.volatilityRatio >= spread.minVolatilityRatio
      && signal.turnoverScore >= spread.minTurnover
      && signal.quantity >= spread.minQuantity) {
      const sweep = bestSweep(book, () => signal.med7, afterCut, () => 1);
      if (sweep) deals.push(makeRow(signal, "band", sweep, book, depthKnown, signal.med7));
    }

    // 跨市场：本市场买 → 另一市场以其最低价 −1 铜挂出（另一市场 7 日参考可信时不超过它）。
    const other = otherById.get(signal.itemId);
    if (other && context.otherMarket && other.minPrice > 0
      && now.getTime() - signal.latestAt.getTime() <= rules.crossMaxAgeMs
      && now.getTime() - other.latestAt.getTime() <= rules.crossMaxAgeMs) {
      const otherMedCredible = other.med7 > 0 && other.med7Samples >= rules.minHistory && other.med7Distinct >= rules.minMed7Distinct;
      const target = otherMedCredible ? Math.min(other.minPrice - 1, other.med7) : other.minPrice - 1;
      const sweep = bestSweep(book, () => target, afterCut, flipGate);
      if (sweep && passesTotal(sweep, depthKnown, rules.flipMinTotalProfit)) {
        deals.push(makeRow(signal, "cross", sweep, book, depthKnown, other.minPrice, context.otherMarket));
      }
    }
  }
  // 单一排序指标：总利润（可在表头切换）。
  return deals.sort((left, right) => right.totalProfit - left.totalProfit || right.unitProfit - left.unitProfit);
}

export type SpreadCandidateRow = {
  itemId: number;
  name: string;
  nameEn?: string | null;
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

// 可做差价候选：起伏大 × 需求广 × 有人在卖 = 均值回归标的池。独立榜单已并入雷达
// （buildDealRadar 的 band 策略复用同一组 spreadRules 门槛）。
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
      nameEn: signal.nameEn,
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
  nameEn?: string | null;
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
      nameEn: signal.nameEn,
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
  nameEn?: string | null;
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
