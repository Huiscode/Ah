import { describe, expect, it } from "vitest";
import { buildDealRadar, buildMarketSignal, buildMoverBoard, buildSpreadCandidates, buildWeekdaySeasonality, computeBand, type MarketSignal } from "@/lib/analytics";
import { dealRadarRules, mergeRadarRules, RADAR_RULES_VERSION } from "@/lib/market-rules";
import { generateDemoHistory } from "@/lib/demo-history";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-07-24T12:00:00Z");

// Auctionator 口径 fixture：快照 = 每次导入的最新一批（每物品 1 行，m =
// 最低买入价）；每日汇总 = 每扫描日一行收盘（close = 当日 m，low/high
// 按当日快照振幅）。med7/环比都从 daily 计算（与生产一致）。
function history(
  snapshots: Array<{ daysAgo: number; marketPrice: number; minPrice?: number; quantity?: number; numAuctions?: number }>,
  overrides?: { vendorPrice?: number; itemId?: number; name?: string; sellPrice?: number; turnoverScore?: number; isVendorItem?: boolean; itemLevel?: number }
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
    itemLevel: overrides?.itemLevel ?? 0,
    icon: null,
    turnoverScore: overrides?.turnoverScore ?? 0,
    isVendorItem: overrides?.isVendorItem ?? false,
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
        market: "faction",
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
  // 2026-11-20 重构：四种策略按"总利润 = 单件 × 可买量"进池（规则见 market-rules.ts）。
  // 默认门槛：必赚总利润 ≥ 10 银；扫货/跨市场单件 ≥ max(20 银, 买价 15%)、
  // 总利润 ≥ 1 金（仅有真实档位时校验）；7 日参考需 ≥ 3 天、≥ 2 个不同收盘。
  function sig(overrides: Partial<MarketSignal>): MarketSignal {
    return {
      itemId: 1,
      name: "材料",
      category: "材料",
      quality: "common",
      icon: null,
      source: "auctionator",
      price: 100,
      minPrice: 100,
      quantity: 50,
      numAuctions: 0,
      vendorPrice: 0,
      med7: 0,
      med7Samples: 0,
      med7Distinct: 0,
      discountPercent: 0,
      changePercent: 0,
      latestAt: now,
      turnoverScore: 0,
      isVendorItem: false,
      bandLow: 0,
      bandHigh: 0,
      volatilityRatio: 0,
      zone: "none",
      ...overrides
    };
  }
  const credible = { med7Samples: 3, med7Distinct: 3 };

  it("vendor: sweeps every tier below the NPC price, no history needed", () => {
    const tiers = new Map([[1, [{ price: 400, qty: 5 }, { price: 900, qty: 2 }, { price: 1200, qty: 10 }]]]);
    const deals = buildDealRadar([sig({ minPrice: 400, price: 400, vendorPrice: 1000 })], undefined, now, { tiersByItemId: tiers });
    expect(deals).toHaveLength(1);
    expect(deals[0]).toMatchObject({ kind: "vendor", buyQty: 7, sellPrice: 1000, unitProfit: 100, totalProfit: 600 * 5 + 100 * 2, depthKnown: true });
  });

  it("vendor: drops known-depth flips whose total is under 10 silver", () => {
    const tiers = new Map([[1, [{ price: 999, qty: 1 }]]]);
    expect(buildDealRadar([sig({ minPrice: 999, vendorPrice: 1000 })], undefined, now, { tiersByItemId: tiers })).toHaveLength(0);
  });

  it("flip: buys cheap tiers and relists 1c under the next tier, capped by the 7d ref", () => {
    // k=1：回挂 51999 不够赚；k=2：回挂 89999，两档都过单件门槛；k=3：第三档 90000 单件不够 → 取 k=2
    const tiers = new Map([[1, [{ price: 50000, qty: 2 }, { price: 52000, qty: 1 }, { price: 90000, qty: 5 }]]]);
    const deals = buildDealRadar([sig({ minPrice: 50000, price: 50000, med7: 100000, ...credible })], undefined, now, { tiersByItemId: tiers });
    expect(deals).toHaveLength(1);
    expect(deals[0]).toMatchObject({ kind: "flip", buyQty: 3, sellPrice: 89999, unitProfit: 33499 });
    expect(deals[0].totalProfit).toBe(Math.floor(89999 * 0.95 * 3 - (50000 * 2 + 52000)));
  });

  it("flip: without tiers only the unit gates apply and depth is assumed 1", () => {
    const ok = sig({ itemId: 1, minPrice: 7000, med7: 10000, ...credible });
    const thin = sig({ itemId: 2, minPrice: 8000, med7: 10000, ...credible }); // 单件 1500 < 20 银
    const deals = buildDealRadar([ok, thin], undefined, now);
    expect(deals.map((d) => d.itemId)).toEqual([1]);
    expect(deals[0]).toMatchObject({ depthKnown: false, buyQty: 1, unitProfit: 2500 });
  });

  it("flip: needs 3 days of history and a non-flat reference", () => {
    const shallow = sig({ itemId: 1, minPrice: 7000, med7: 10000, med7Samples: 2, med7Distinct: 2 });
    const camper = sig({ itemId: 2, minPrice: 7000, med7: 10000, med7Samples: 3, med7Distinct: 1 });
    expect(buildDealRadar([shallow, camper], undefined, now)).toHaveLength(0);
  });

  it("cross: buys here and undercuts the other market when both sides are fresh", () => {
    const here = sig({ itemId: 1, minPrice: 10000 });
    const fresh = sig({ itemId: 1, minPrice: 20000 });
    const deals = buildDealRadar([here], undefined, now, { otherSignals: [fresh], otherMarket: "neutral" });
    expect(deals).toHaveLength(1);
    expect(deals[0]).toMatchObject({ kind: "cross", sellMarket: "neutral", sellPrice: 19999, unitProfit: Math.floor(19999 * 0.95 - 10000) });

    const stale = sig({ itemId: 1, minPrice: 20000, latestAt: new Date(now.getTime() - 3 * DAY) });
    expect(buildDealRadar([here], undefined, now, { otherSignals: [stale], otherMarket: "neutral" })).toHaveLength(0);
  });

  it("band: a volatile, demanded item below its 7d band reverts to the reference", () => {
    const dip = sig({ minPrice: 900, price: 900, med7: 1000, zone: "buy", volatilityRatio: 30, turnoverScore: 2, quantity: 10 });
    const deals = buildDealRadar([dip], undefined, now);
    expect(deals).toHaveLength(1);
    expect(deals[0]).toMatchObject({ kind: "band", sellPrice: 1000, unitProfit: 50 });
  });

  it("orders every play by total profit", () => {
    const tiers = new Map([[2, [{ price: 400, qty: 50 }]]]);
    const deals = buildDealRadar(
      [sig({ itemId: 1, minPrice: 7000, med7: 10000, ...credible }), sig({ itemId: 2, minPrice: 400, vendorPrice: 1000 })],
      undefined, now, { tiersByItemId: tiers }
    );
    expect(deals.map((d) => [d.itemId, d.totalProfit])).toEqual([[2, 30000], [1, 2500]]);
  });
});

describe("mergeRadarRules", () => {
  it("drops saved rules from an older rule version so new defaults take effect", () => {
    expect(mergeRadarRules({ minProfit: 50, minHistory: 2 })).toEqual(dealRadarRules);
    expect(mergeRadarRules({ version: RADAR_RULES_VERSION, minHistory: 5, flipMinUnitProfit: -1 }))
      .toEqual({ ...dealRadarRules, minHistory: 5 });
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

describe("7日带：band / zone / 起伏比", () => {
  // zone 的 buy/sell 突破逻辑直接测 computeBand（fixture 模型里当日收盘 =
  // 最新扫描价，current 恒在带内，无法经 buildMarketSignal 触发突破）。
  it("computeBand: breaks below the 7d band -> buy zone", () => {
    const band = computeBand([100, 120, 80], 70, 100);
    expect(band.bandLow).toBe(80);
    expect(band.bandHigh).toBe(120);
    expect(band.volatilityRatio).toBeCloseTo(40, 5); // (120-80)/100
    expect(band.zone).toBe("buy");
  });

  it("computeBand: above the band -> sell; inside -> flat; insufficient -> none", () => {
    expect(computeBand([100, 120, 80], 130, 100).zone).toBe("sell");
    expect(computeBand([100, 120, 80], 100, 100).zone).toBe("flat");
    expect(computeBand([100], 100, 100).zone).toBe("none"); // 单样本
    expect(computeBand([], 100, 100).zone).toBe("none");
    expect(computeBand([100, 100], 100, 100).zone).toBe("none"); // 平坦
  });

  it("buildMarketSignal exposes the 7d band from same-source closes", () => {
    const signal = buildMarketSignal(
      history([
        { daysAgo: 2, marketPrice: 100 },
        { daysAgo: 1, marketPrice: 120 },
        { daysAgo: 0, marketPrice: 90, quantity: 50 }
      ]),
      now
    )!;
    // window closes [100, 120, 90] -> bandLow 90, bandHigh 120, med7 100
    expect(signal.bandLow).toBe(90);
    expect(signal.bandHigh).toBe(120);
    expect(signal.volatilityRatio).toBeCloseTo(30, 5);
    expect(signal.zone).toBe("flat");
  });

  it("no band with a single scan (data insufficient)", () => {
    const single = buildMarketSignal(history([{ daysAgo: 0, marketPrice: 100 }]), now)!;
    expect(single.bandLow).toBe(0);
    expect(single.zone).toBe("none");
  });
});

describe("buildSpreadCandidates", () => {
  function makeSignal(overrides: Partial<MarketSignal>): MarketSignal {
    return {
      itemId: 0,
      name: "材料",
      category: "材料",
      quality: "common",
      icon: null,
      source: "auctionator",
      price: 100,
      minPrice: 100,
      quantity: 50,
      numAuctions: 0,
      vendorPrice: 0,
      med7: 100,
      med7Samples: 3,
      med7Distinct: 3,
      discountPercent: 0,
      changePercent: 0,
      latestAt: now,
      turnoverScore: 0,
      isVendorItem: false,
      bandLow: 0,
      bandHigh: 0,
      volatilityRatio: 0,
      zone: "none",
      ...overrides
    };
  }

  it("lists volatile, demanded, in-stock items as spread candidates", () => {
    const candidates = buildSpreadCandidates(
      [
        makeSignal({ itemId: 1, name: "波动材料", volatilityRatio: 40, turnoverScore: 3, quantity: 50, zone: "buy", bandLow: 80, bandHigh: 120 })
      ],
      undefined,
      now
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].itemId).toBe(1);
    expect(candidates[0].zone).toBe("buy");
  });

  it("drops flat, demand-less, or out-of-stock items", () => {
    const candidates = buildSpreadCandidates(
      [
        makeSignal({ itemId: 1, name: "平坦材料", volatilityRatio: 0, turnoverScore: 3, quantity: 50, zone: "none" }),
        makeSignal({ itemId: 2, name: "无需求材料", volatilityRatio: 40, turnoverScore: 0, quantity: 50, zone: "buy" }),
        makeSignal({ itemId: 3, name: "缺货材料", volatilityRatio: 40, turnoverScore: 3, quantity: 0, zone: "buy" }),
        makeSignal({ itemId: 4, name: "无波动带材料", volatilityRatio: 40, turnoverScore: 3, quantity: 50, zone: "none" })
      ],
      undefined,
      now
    );
    expect(candidates).toHaveLength(0);
  });

  it("ranks higher volatility × demand first", () => {
    const candidates = buildSpreadCandidates(
      [
        makeSignal({ itemId: 1, name: "中波动", volatilityRatio: 20, turnoverScore: 1, quantity: 50, zone: "flat", bandLow: 80, bandHigh: 120 }),
        makeSignal({ itemId: 2, name: "高波动高需求", volatilityRatio: 60, turnoverScore: 4, quantity: 50, zone: "flat", bandLow: 50, bandHigh: 150 })
      ],
      undefined,
      now
    );
    expect(candidates.map((c) => c.itemId)).toEqual([2, 1]);
  });
});

describe("buildMoverBoard", () => {
  function makeSignal(overrides: Partial<MarketSignal>): MarketSignal {
    return {
      itemId: 0,
      name: "材料",
      category: "材料",
      quality: "common",
      icon: null,
      source: "auctionator",
      price: 100,
      minPrice: 100,
      quantity: 10,
      numAuctions: 0,
      vendorPrice: 0,
      med7: 100,
      med7Samples: 3,
      med7Distinct: 3,
      discountPercent: 0,
      changePercent: 0,
      latestAt: now,
      turnoverScore: 0,
      isVendorItem: false,
      bandLow: 0,
      bandHigh: 0,
      volatilityRatio: 0,
      zone: "none",
      ...overrides
    };
  }

  it("flags moves >= 20% against the previous daily close", () => {
    const movers = buildMoverBoard(
      [
        makeSignal({ itemId: 1, name: "大涨物品", changePercent: 30 }),
        makeSignal({ itemId: 2, name: "大跌物品", changePercent: -30 }),
        makeSignal({ itemId: 3, name: "正常波动", changePercent: 10 })
      ],
      undefined,
      now
    );
    expect(movers.map((m) => m.itemId).sort()).toEqual([1, 2]);
    expect(movers[0].changePercent).toBe(30); // |变动%| 降序
  });

  it("stays empty when nothing moves enough or nothing is in stock", () => {
    const movers = buildMoverBoard(
      [
        makeSignal({ itemId: 1, changePercent: 5 }),
        makeSignal({ itemId: 2, changePercent: 30, quantity: 0 })
      ],
      undefined,
      now
    );
    expect(movers).toHaveLength(0);
  });
});
