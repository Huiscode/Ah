import { describe, expect, it } from "vitest";
import { buildDealRadar, buildMarketSignal, buildWeekdaySeasonality, type MarketSignal } from "@/lib/analytics";
import { generateDemoHistory } from "@/lib/demo-history";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-07-24T12:00:00Z");

// Auctionator 口径 fixture：快照 = 每次导入的最新一批（每物品 1 行，m =
// 最低买入价）；每日汇总 = 每扫描日一行收盘（close = 当日 m，low/high
// 按当日快照振幅）。med7/环比都从 daily 计算（与生产一致）。
function history(
  snapshots: Array<{ daysAgo: number; marketPrice: number; minPrice?: number; quantity?: number; numAuctions?: number }>,
  overrides?: { vendorPrice?: number; itemId?: number; name?: string; sellPrice?: number }
) {
  const source = "auctionator";
  return {
    itemId: overrides?.itemId ?? 2770,
    name: overrides?.name ?? "铜矿石",
    quality: "common",
    category: "矿石",
    subCategory: "采矿",
    vendorPrice: overrides?.vendorPrice ?? 0,
    sellPrice: overrides?.sellPrice ?? 0,
    icon: null,
    turnoverScore: 0,
    isVendorItem: false,
    snapshots: snapshots.map((snap) => ({
      timestamp: new Date(now.getTime() - snap.daysAgo * DAY),
      server: "Anniversary",
      faction: "Alliance",
      market: "faction",
      source,
      minPrice: snap.minPrice ?? snap.marketPrice,
      marketPrice: snap.marketPrice,
      quantity: snap.quantity ?? 100,
      numAuctions: snap.numAuctions ?? 0
    })),
    // 每天一行：close/high/low 均为当日快照价（单次导入），volume=在售量。
    dailySummaries: snapshots.map((snap) => {
      const date = new Date(now.getTime() - snap.daysAgo * DAY);
      date.setUTCHours(0, 0, 0, 0);
      return {
        date,
        source,
        openPrice: snap.marketPrice,
        closePrice: snap.marketPrice,
        highPrice: snap.marketPrice,
        lowPrice: snap.marketPrice,
        volume: snap.quantity ?? 100
      };
    })
  };
}

describe("buildMarketSignal", () => {
  it("derives auctionator-based stats: latest m, min, med7, discount", () => {
    const signal = buildMarketSignal(
      history([
        { daysAgo: 2, marketPrice: 100 },
        { daysAgo: 1, marketPrice: 120 },
        { daysAgo: 0, marketPrice: 90, minPrice: 80, quantity: 240 }
      ]),
      now
    )!;
    expect(signal.price).toBe(90); // latest 最低买入价
    expect(signal.minPrice).toBe(80);
    expect(signal.quantity).toBe(240);
    expect(signal.numAuctions).toBe(0); // Auctionator 无挂单数
    expect(signal.med7).toBe(100); // daily closes [100, 120, 90] 中位数
    expect(signal.discountPercent).toBeCloseTo((1 - 80 / 100) * 100, 5); // 折扣看可买的最低买入价
    expect(signal.changePercent).toBeCloseTo(((90 - 120) / 120) * 100, 5);
  });

  it("median ignores days older than 7 days and resists outliers", () => {
    const signal = buildMarketSignal(
      history([
        { daysAgo: 10, marketPrice: 999999 }, // outside window
        { daysAgo: 1, marketPrice: 100 },
        { daysAgo: 0.5, marketPrice: 999999 }, // bait inside window
        { daysAgo: 0.2, marketPrice: 105 },
        { daysAgo: 0, marketPrice: 95 }
      ]),
      now
    )!;
    // window daily closes [100, 999999, 105, 95] -> sorted [95,100,105,999999] -> lower middle 100
    expect(signal.med7).toBe(100);
  });

  it("reports zeros honestly with a single scan instead of fabricating", () => {
    const signal = buildMarketSignal(history([{ daysAgo: 0, marketPrice: 100 }]), now)!;
    expect(signal.changePercent).toBe(0);
    expect(signal.med7).toBe(100);
  });

  it("counts distinct closes in the window so a flat series is detectable", () => {
    const flat = buildMarketSignal(
      history([
        { daysAgo: 2, marketPrice: 49240 },
        { daysAgo: 1, marketPrice: 49240 },
        { daysAgo: 0, marketPrice: 49240 }
      ]),
      now
    )!;
    expect(flat.med7Samples).toBe(3);
    expect(flat.med7Distinct).toBe(1);
  });

  it("works over the demo fixture (test-only universe)", () => {
    const signal = buildMarketSignal(generateDemoHistory(5)[0], new Date())!;
    expect(signal.price).toBeGreaterThan(0);
    expect(signal.med7).toBeGreaterThan(0);
  });
});

describe("buildDealRadar", () => {
  // Auctionator 口径：必赚（NPC 倒卖）= 最低买入价低于 NPC 卖价，无历史
  // 要求、无利润下限；捡漏 = 最低买入价显著低于 7日参考，门控
  // 50c 绝对利润 + 2 天历史 + 参考可信度。挂单数门已删除（Auctionator 无
  // 挂单数）；折扣线/折扣下限/供应上限/最低利润率 2026-10-14 用户拍板
  // 移除——深折扣一律视为捡漏机会。
  const liquid = { quantity: 100, numAuctions: 0 };

  function signals(items: Parameters<typeof buildMarketSignal>[0][]) {
    return items.map((item) => buildMarketSignal(item, now)).filter((s): s is MarketSignal => s !== null);
  }

  it("flags vendor arbitrage without any history depth", () => {
    const deals = buildDealRadar(
      signals([history([{ daysAgo: 0, marketPrice: 900, minPrice: 400, ...liquid }], { vendorPrice: 1000 })]),
      undefined, now
    );
    expect(deals).toHaveLength(1);
    expect(deals[0].vendor).toBe(true);
    expect(deals[0].profit).toBe(600); // vendorPrice 1000 - minPrice 400
  });

  it("flags vendor arbitrage below the 5s floor — the NPC buy is risk-free", () => {
    // minPrice 999 vs vendorPrice 1000: a 1c spread, far under RADAR_MIN_PROFIT.
    // Reselling to the NPC is guaranteed, so it still belongs on the radar.
    const deals = buildDealRadar(
      signals([history([{ daysAgo: 0, marketPrice: 999, minPrice: 999, ...liquid }], { vendorPrice: 1000 })]),
      undefined, now
    );
    expect(deals).toHaveLength(1);
    expect(deals[0].vendor).toBe(true);
    expect(deals[0].profit).toBe(1);
  });

  it("requires the 2-day depth and 50c floor together", () => {
    const base = [
      { daysAgo: 2, marketPrice: 9800, ...liquid },
      { daysAgo: 1, marketPrice: 10000, ...liquid }
    ];
    const qualifying = history([...base, { daysAgo: 0, marketPrice: 10200, minPrice: 7000, ...liquid }]);
    // 利润率门槛 2026-10-14 移除：只要绝对净利 ≥50c、历史够深、med7 可信，
    // 低价即视为捡漏（利润率不再是门槛）。
    const thinProfit = history([...base, { daysAgo: 0, marketPrice: 10200, minPrice: 9000, ...liquid }], { itemId: 2 });
    const shallowHistory = history([{ daysAgo: 0, marketPrice: 10200, minPrice: 7000, ...liquid }], { itemId: 3 });
    const subFloor = history(
      [
        { daysAgo: 2, marketPrice: 98, ...liquid },
        { daysAgo: 1, marketPrice: 100, ...liquid },
        { daysAgo: 0, marketPrice: 102, minPrice: 75, ...liquid }
      ],
      { itemId: 5 }
    );
    const deals = buildDealRadar(signals([qualifying, thinProfit, shallowHistory, subFloor]), undefined, now);
    expect(deals.map((deal) => deal.itemId)).toEqual([2770, 2]);
    expect(deals[0].vendor).toBe(false);
    expect(deals[0].profit).toBe(2500);
    expect(deals[1].profit).toBe(500);
  });

  it("no auction-count gate: a thin listing can still qualify if the reference holds", () => {
    // quantity=2（在售量极少）：旧口径的挂单数门会拦下，新口径没有挂单数
    // 概念——只要 med7 可信、价格够低，就入选（用户选择先观察，不加
    // 替代门槛）。
    const thin = history(
      [
        { daysAgo: 2, marketPrice: 9800, ...liquid },
        { daysAgo: 1, marketPrice: 10000, ...liquid },
        { daysAgo: 0, marketPrice: 10200, minPrice: 7000, quantity: 2 }
      ],
      { itemId: 4 }
    );
    const deals = buildDealRadar(signals([thin]), undefined, now);
    expect(deals.map((deal) => deal.itemId)).toEqual([4]);
  });

  it("orders vendor deals first, then by absolute profit", () => {
    const smallVendor = history([{ daysAgo: 0, marketPrice: 900, minPrice: 400, ...liquid }], { vendorPrice: 1000, itemId: 1 });
    const bigMedian = history(
      [
        { daysAgo: 2, marketPrice: 49000, ...liquid },
        { daysAgo: 1, marketPrice: 50000, ...liquid },
        { daysAgo: 0, marketPrice: 51000, minPrice: 25000, ...liquid }
      ],
      { itemId: 2 }
    );
    const deals = buildDealRadar(signals([bigMedian, smallVendor]), undefined, now);
    expect(deals.map((deal) => deal.itemId)).toEqual([1, 2]);
  });

  it("rejects a flat 7d series — one camper's ask is not a reference price", () => {
    // Every scan saw the same m: a single seller holding the bottom of a
    // thin book. med7 is that player's asking price, and nothing ever
    // traded against it, so the "discount" measures nothing.
    const camper = history([
      { daysAgo: 2, marketPrice: 49240, ...liquid },
      { daysAgo: 1, marketPrice: 49240, ...liquid },
      { daysAgo: 0, marketPrice: 49240, minPrice: 40000, ...liquid }
    ]);
    expect(buildDealRadar(signals([camper]), undefined, now)).toHaveLength(0);
  });

  it("keeps deep discounts — the discount floor was removed (2026-10-14)", () => {
    // 用户拍板移除 maxDiscount（折扣下限）：87% off 不再视为"参考崩坏"，
    // 而是捡漏机会（极低价绝不剔）。其余门槛仍须满足（3 天历史/利润/可信度）。
    const absurd = history([
      { daysAgo: 2, marketPrice: 49000, ...liquid },
      { daysAgo: 1, marketPrice: 49240, ...liquid },
      { daysAgo: 0, marketPrice: 49500, minPrice: 6240, ...liquid }
    ]);
    const deals = buildDealRadar(signals([absurd]), undefined, now);
    expect(deals).toHaveLength(1);
    expect(deals[0].discountPercent).toBeCloseTo((1 - 6240 / 49240) * 100, 3);
  });

  it("exempts vendor arbitrage from the med7 guards — the NPC price is a fact", () => {
    // Single scan, flat series, 90% below the NPC price: none of the
    // reference-credibility guards apply, because the NPC always buys.
    const deals = buildDealRadar(
      signals([history([{ daysAgo: 0, marketPrice: 1000, minPrice: 100, ...liquid }], { vendorPrice: 1000 })]),
      undefined, now
    );
    expect(deals).toHaveLength(1);
    expect(deals[0].vendor).toBe(true);
  });
});

describe("buildWeekdaySeasonality", () => {
  it("uses median closes so one spike day cannot skew a weekday", () => {
    // Mondays: [100, 100, 999999] -> median 100; Tuesdays: [200]
    const summaries = [
      { date: new Date("2026-07-06T00:00:00Z"), closePrice: 100, volume: 10 },
      { date: new Date("2026-07-13T00:00:00Z"), closePrice: 100, volume: 10 },
      { date: new Date("2026-07-20T00:00:00Z"), closePrice: 999999, volume: 10 },
      { date: new Date("2026-07-07T00:00:00Z"), closePrice: 200, volume: 30 }
    ];
    const seasonality = buildWeekdaySeasonality(summaries);
    const monday = seasonality.find((day) => day.weekday === 1)!;
    const tuesday = seasonality.find((day) => day.weekday === 2)!;
    // overall median = median of [100,100,999999,200] = 100
    expect(monday.priceDeviation).toBeCloseTo(0, 5);
    expect(tuesday.priceDeviation).toBeCloseTo(100, 5);
    expect(monday.listedShare).toBeCloseTo(50, 5);
    expect(seasonality.find((day) => day.weekday === 6)).toBeUndefined();
  });
});
