import { describe, expect, it } from "vitest";
import { buildDisenchantBoard, computeDisenchantLedger, computeCalcSummary, type MarketSignal } from "@/lib/analytics";
import { findDisenchantBand, equipKind } from "@/lib/disenchant-table";

const now = new Date("2026-07-24T12:00:00Z");
// 测试用低门槛：不过滤净赚，便于单独验证期望/兜底计算。
const LOOSE = { minQuantity: 1, minNetProfit: -1e12, staleWindowMs: 7 * 24 * 60 * 60 * 1000 };

function sig(over: Partial<MarketSignal> & Pick<MarketSignal, "itemId" | "quality" | "category" | "price">): MarketSignal {
  const { itemLevel, ...rest } = over;
  return {
    name: "测试装备",
    subCategory: "布甲",
    icon: null,
    source: "auctionator",
    minPrice: over.price,
    quantity: 5,
    numAuctions: 0,
    vendorPrice: 0,
    itemLevel: itemLevel ?? 10,
    med7: over.price,
    med7Samples: 1,
    med7Distinct: 1,
    discountPercent: 0,
    changePercent: 0,
    latestAt: now,
    turnoverScore: 0,
    isVendorItem: false,
    bandLow: 0,
    bandHigh: 0,
    volatilityRatio: 0,
    zone: "none",
    ...rest
  } as MarketSignal;
}

// 材料价：10940 奇异之尘 60c，10938 次级魔法精华 132c，10978 小块微光碎片 100c
const materialPrices = new Map<number, number>([
  [10940, 60],
  [10938, 132],
  [10978, 100]
]);
const matNames = new Map<number, string>();

describe("findDisenchantBand / equipKind", () => {
  it("护甲绿 5-15 段命中，武器/护甲归类正确", () => {
    expect(equipKind("护甲")).toBe("armor");
    expect(equipKind("武器")).toBe("weapon");
    expect(equipKind("矿石")).toBeNull();
    const band = findDisenchantBand("uncommon", "armor", 10);
    expect(band?.ilvlLow).toBe(5);
    expect(band?.ilvlHigh).toBe(15);
    expect(findDisenchantBand("uncommon", "armor", 200)).toBeNull();
  });

  it("部位细分 category 与 subCategory 也能正确归到 armor/weapon，配方/弹药被拒", () => {
    // 部位细分 category
    expect(equipKind("胸部", "布甲")).toBe("armor");
    expect(equipKind("腿部", "皮甲")).toBe("armor");
    expect(equipKind("头部", "板甲")).toBe("armor");
    expect(equipKind("单手", "剑")).toBe("weapon");
    expect(equipKind("双手", "法杖")).toBe("weapon");
    expect(equipKind("远程", "魔杖")).toBe("weapon");
    // subCategory 兜底（category 缺失/unknown）
    expect(equipKind("unknown", "匕首")).toBe("weapon");
    expect(equipKind("unknown", "盾牌")).toBe("armor");
    // 不可分解
    expect(equipKind("配方", "制皮")).toBeNull();
    expect(equipKind("弹药", "箭")).toBeNull();
    expect(equipKind("商品", "草药")).toBeNull();
  });
});

describe("buildDisenchantBoard", () => {
  it("绿护甲 ilvl10：期望分解值按概率加权，净赚扣 5% 手续费", () => {
    // 5-15 护甲绿：40%×1尘 40%×2尘 10%×1精华 10%×2精华
    // 期望 = .4*1*60 + .4*2*60 + .1*1*132 + .1*2*132 = 24+48+13.2+26.4 = 111.6
    const row = buildDisenchantBoard(
      [sig({ itemId: 1, quality: "uncommon", category: "护甲", itemLevel: 10, price: 100, vendorPrice: 20 })],
      materialPrices,
      matNames,
      undefined,
      now
    )[0]!;
    expect(row.expectedValue).toBeCloseTo(111.6, 5);
    expect(row.disenchantNet).toBeCloseTo(111.6 * 0.95 - 100, 5);
    expect(row.hasMissingMatPrice).toBe(false);
    expect(row.bandLabel).toBe("绿·护甲·5-15");
  });

  it("蓝装 100% 单材料：期望=材料价，净赚=材料价×0.95−买入", () => {
    // 11-25 蓝护甲：100%×1 小块微光碎片 100c
    const row = buildDisenchantBoard(
      [sig({ itemId: 2, quality: "rare", category: "护甲", itemLevel: 20, price: 80 })],
      materialPrices,
      matNames,
      undefined,
      now
    )[0]!;
    expect(row.expectedValue).toBeCloseTo(100, 5);
    expect(row.disenchantNet).toBeCloseTo(95 - 80, 5);
  });

  it("材料无价、主档无法保本 → 直接过滤，不靠期望或卖店保留", () => {
    // 武器绿 6-15 材料全部无价 → 主档到手=0 < 买入价，应被主档保本门槛滤掉
    const rows = buildDisenchantBoard(
      [sig({ itemId: 3, quality: "uncommon", category: "武器", itemLevel: 10, price: 50 })],
      new Map(),
      matNames,
      LOOSE,
      now
    );
    expect(rows).toHaveLength(0);
  });

  it("过滤：ilvl=0、非绿蓝、非护甲武器、过期、无在售量均不落榜", () => {
    const signals = [
      sig({ itemId: 10, quality: "uncommon", category: "护甲", itemLevel: 0, price: 100 }), // 未补抓
      sig({ itemId: 11, quality: "common", category: "护甲", itemLevel: 10, price: 100 }), // 白装
      sig({ itemId: 12, quality: "uncommon", category: "矿石", subCategory: "矿石", itemLevel: 10, price: 100 }), // 非装备
      sig({ itemId: 13, quality: "uncommon", category: "护甲", itemLevel: 10, price: 100, latestAt: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000) }), // 过期
      sig({ itemId: 14, quality: "uncommon", category: "护甲", itemLevel: 10, price: 100, quantity: 0 }) // 无在售
    ];
    const rows = buildDisenchantBoard(signals, materialPrices, matNames, undefined, now);
    expect(rows).toHaveLength(0);
  });

  it("主档保本门槛：期望为正但主档(约75%)亏本的抽奖型被过滤；主档保本才入选", () => {
    // 26-30绿护甲：主档灵魂之尘11083(75%)便宜，精华11082/碎片11084贵。
    const priceMap = new Map<number, number>([[11083, 100], [11082, 2000], [11084, 1500]]);
    // 买入300：主档尘×2到手=2×100×0.95=190 <300，虽期望靠小概率精华为正，仍过滤
    const dropped = buildDisenchantBoard(
      [sig({ itemId: 40, quality: "uncommon", category: "护甲", itemLevel: 29, price: 300, quantity: 1 })],
      priceMap, matNames, LOOSE, now
    );
    expect(dropped).toHaveLength(0);
    // 买入150：主档尘×2到手190≥150 保本 → 入选，主档净=40
    const kept = buildDisenchantBoard(
      [sig({ itemId: 41, quality: "uncommon", category: "护甲", itemLevel: 29, price: 150, quantity: 1 })],
      priceMap, matNames, LOOSE, now
    )[0]!;
    expect(kept.mainBestLabel).toBe("灵魂之尘×2");
    expect(kept.mainBestTake).toBeCloseTo(190, 5);
    expect(kept.mainBestNet).toBeCloseTo(40, 5);
  });

  it("卖店回收高于分解时，vendorNet 单独给出，bestNet 取高（主档需先保本）", () => {
    // 蓝武器 ilvl20（11-25段 100%×1 小块微光碎片10978）：材料100c、买入80，主档到手95≥80 通过；
    // 卖店回收150 → vendorNet=70 高于分解净15，bestNet 取卖店。
    const row = buildDisenchantBoard(
      [sig({ itemId: 20, quality: "rare", category: "武器", itemLevel: 20, price: 80, vendorPrice: 150, quantity: 1 })],
      new Map([[10978, 100]]),
      matNames,
      LOOSE,
      now
    )[0]!;
    expect(row.disenchantNet).toBeCloseTo(95 - 80, 5);
    expect(row.vendorNet).toBeCloseTo(70, 5);
    expect(row.bestNet).toBeCloseTo(70, 5);
  });

  it("保本个数：单靠该材料回本需出个数 = ceil(买入价/(材料价×0.95))，无价为 null", () => {
    // 买入 100；10940 尘 60c → 100/(60×0.95)=1.75→2；10938 精华 132c → 0.80→1
    const row = buildDisenchantBoard(
      [sig({ itemId: 30, quality: "uncommon", category: "护甲", itemLevel: 10, price: 100, quantity: 1 })],
      materialPrices,
      matNames,
      LOOSE,
      now
    )[0]!;
    const be = (id: number) => row.mats.find((m) => m.matItemId === id)?.breakEvenQty;
    expect(be(10940)).toBe(2);
    expect(be(10938)).toBe(1);
    // 同一件里未报价的材料 breakEvenQty=null（主档10940有价、主档保本仍入选）
    const mixed = buildDisenchantBoard(
      [sig({ itemId: 31, quality: "uncommon", category: "护甲", itemLevel: 10, price: 100, quantity: 1 })],
      new Map([[10940, 60]]),
      matNames,
      LOOSE,
      now
    )[0]!;
    expect(mixed.mats.find((m) => m.matItemId === 10938)?.breakEvenQty).toBeNull();
  });
});

describe("computeDisenchantLedger 实际分解记账", () => {
  const mats = [
    { matItemId: 10940, matPrice: 60, priced: true },
    { matItemId: 10938, matPrice: 132, priced: true },
    { matItemId: 99999, matPrice: 0, priced: false }
  ];
  it("毛额=Σ数量×现价，到手=毛额×0.95，净赚=到手−买入价；无价不计", () => {
    const r = computeDisenchantLedger(mats, { 10940: 2, 10938: 1 }, 7500);
    // 毛额 = 2×60 + 1×132 = 252；到手 = 252×0.95 = 239.4；净赚 = 239.4 − 7500
    expect(r.gross).toBeCloseTo(252, 5);
    expect(r.afterCut).toBeCloseTo(252 * 0.95, 5);
    expect(r.net).toBeCloseTo(252 * 0.95 - 7500, 5);
  });
  it("未填数量不计入，全空时净赚=−买入价", () => {
    const r = computeDisenchantLedger(mats, {}, 7500);
    expect(r.gross).toBe(0);
    expect(r.afterCut).toBe(0);
    expect(r.net).toBe(-7500);
  });
});

describe("computeCalcSummary 独立分解计算器", () => {
  it("毛额=Σ数量×单价，到手=毛额×0.95，总买入=Σ件数×单件，净赚=到手−总买入", () => {
    // 材料：灵魂之尘×3@550，强效星界精华×1@800 → 毛额=1650+800=2450
    // 买入：50件山地披风@18，30件劣质裤腿@20 → 总买入=900+600=1500
    const r = computeCalcSummary(
      [{ qty: 3, unit: 550 }, { qty: 1, unit: 800 }],
      [{ count: 50, unit: 18 }, { count: 30, unit: 20 }]
    );
    expect(r.gross).toBeCloseTo(2450, 5);
    expect(r.afterCut).toBeCloseTo(2450 * 0.95, 5);
    expect(r.totalBuy).toBe(1500);
    expect(r.net).toBeCloseTo(2450 * 0.95 - 1500, 5);
  });
  it("零数量/零单价/零件数不计入，空买入净赚=到手", () => {
    const r = computeCalcSummary([{ qty: 0, unit: 550 }, { qty: 2, unit: 0 }], [{ count: 0, unit: 100 }]);
    expect(r.gross).toBe(0);
    expect(r.afterCut).toBe(0);
    expect(r.totalBuy).toBe(0);
    expect(r.net).toBe(0);
  });
});
