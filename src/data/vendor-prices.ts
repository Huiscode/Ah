// Vendor floor-price dictionary and transformation recipes for WoW: Forever
// (infinite realm, 60-level). "Floor price" = ItemSparse SellPrice: what any
// vendor pays for one unit — the guaranteed minimum revenue of a craft or
// transformation, and the "risk-free" side of the P0-A arbitrage signal:
//
//   保底利润 = Σ(产物 SellPrice × qty) − Σ(材料当前 AH 价 × qty)
//
// Sources (checked 2026-09-26):
// - elitegear.io/games/wow-forever-gold-farmen/ (published 2026-09-23) read
//   the Forever Beta client build 1.60.1.69977 (`wow_classic_beta`)
//   ItemSparse SellPrice via wago.tools and compared it against Classic Era
//   build 1.15.9.69722. All classic values here are "wie Era" (identical to
//   Classic Era); all Forever-only values are marked source "forever-beta".
// - Classic item IDs are canonical (cross-checked against the project DB);
//   Forever-only items have no public item ID yet — their itemId is 0 until
//   the addon dumps the client (P0-B), and they are excluded from any
//   computation until completed. They ship as pending entries so the data is
//   ready the moment the scan fills the IDs.
//
// These are data-set values, not live behavior: the server may still change
// vendor prices before launch (2026-11-05) and during operation.

export type VendorPriceEntry = {
  itemId: number; // 0 = pending client dump (P0-B fills it)
  name: string;
  sellPriceCopper: number;
  source: "classic-era" | "forever-beta";
  note?: string;
};

export type TransformationMaterial = {
  itemId: number; // 0 = pending client dump
  name: string;
  quantity: number;
};

export type TransformationRecipe = {
  name: string; // e.g. 瑟银锭 (display label of the transformation)
  profession: string;
  materials: TransformationMaterial[];
  product: { itemId: number; name: string; quantity: number };
  source: "classic-era" | "forever-beta";
  note?: string; // realization caveats, e.g. required camp object
};

// ---------------------------------------------------------------------------
// Vendor floor prices
// ---------------------------------------------------------------------------

export const vendorPrices: VendorPriceEntry[] = [
  // Ores & bars (classic, "wie Era").
  { itemId: 2770, name: "铜矿石", sellPriceCopper: 5, source: "classic-era" },
  { itemId: 2840, name: "铜锭", sellPriceCopper: 10, source: "classic-era" },
  { itemId: 2771, name: "锡矿石", sellPriceCopper: 25, source: "classic-era" },
  { itemId: 3576, name: "锡锭", sellPriceCopper: 35, source: "classic-era" },
  { itemId: 2841, name: "青铜锭", sellPriceCopper: 50, source: "classic-era" },
  { itemId: 2775, name: "银矿石", sellPriceCopper: 75, source: "classic-era" },
  { itemId: 2842, name: "银锭", sellPriceCopper: 100, source: "classic-era" },
  { itemId: 2772, name: "铁矿石", sellPriceCopper: 150, source: "classic-era" },
  { itemId: 3575, name: "铁锭", sellPriceCopper: 200, source: "classic-era" },
  { itemId: 2776, name: "金矿石", sellPriceCopper: 500, source: "classic-era" },
  { itemId: 3577, name: "金锭", sellPriceCopper: 600, source: "classic-era" },
  { itemId: 3858, name: "秘银矿石", sellPriceCopper: 250, source: "classic-era" },
  { itemId: 3860, name: "秘银锭", sellPriceCopper: 400, source: "classic-era" },
  { itemId: 7911, name: "真银矿石", sellPriceCopper: 500, source: "classic-era" },
  { itemId: 6037, name: "真银锭", sellPriceCopper: 1250, source: "classic-era" },
  { itemId: 10620, name: "瑟银矿石", sellPriceCopper: 250, source: "classic-era" },
  { itemId: 12359, name: "瑟银锭", sellPriceCopper: 600, source: "classic-era" },
  { itemId: 11370, name: "黑铁矿石", sellPriceCopper: 500, source: "classic-era" },
  { itemId: 11371, name: "黑铁锭", sellPriceCopper: 600, source: "classic-era" },
  { itemId: 3857, name: "煤块", sellPriceCopper: 125, source: "classic-era" },
  { itemId: 3859, name: "钢锭", sellPriceCopper: 60, source: "classic-era" },

  // Cloth & bolts (classic, "wie Era").
  { itemId: 2589, name: "亚麻布", sellPriceCopper: 13, source: "classic-era" },
  { itemId: 2996, name: "亚麻布卷", sellPriceCopper: 40, source: "classic-era" },
  { itemId: 2592, name: "毛料", sellPriceCopper: 33, source: "classic-era" },
  { itemId: 2997, name: "毛料卷", sellPriceCopper: 100, source: "classic-era" },
  { itemId: 4306, name: "丝绸", sellPriceCopper: 150, source: "classic-era" },
  { itemId: 4305, name: "丝绸卷", sellPriceCopper: 600, source: "classic-era" },
  { itemId: 4338, name: "魔纹布", sellPriceCopper: 250, source: "classic-era" },
  { itemId: 4339, name: "魔纹布卷", sellPriceCopper: 1250, source: "classic-era" },
  { itemId: 14047, name: "符文布", sellPriceCopper: 400, source: "classic-era" },
  { itemId: 14048, name: "符文布卷", sellPriceCopper: 2000, source: "classic-era" },

  // Leather (classic, "wie Era").
  { itemId: 2318, name: "轻皮", sellPriceCopper: 15, source: "classic-era" },
  { itemId: 2319, name: "中皮", sellPriceCopper: 50, source: "classic-era" },
  { itemId: 4234, name: "重皮", sellPriceCopper: 150, source: "classic-era" },
  { itemId: 4304, name: "厚皮", sellPriceCopper: 300, source: "classic-era" },
  { itemId: 8170, name: "硬甲皮", sellPriceCopper: 500, source: "classic-era" },

  // Forever-only items with an already-known ID (from the project DB).
  { itemId: 249410, name: "硫酸", sellPriceCopper: 125, source: "forever-beta" },
  // Forever-only NPC 常驻出售材料：ID 原为 0（待客户端 dump），2026-10-02 由
  // 游戏扫描/配方数据确认后补齐；名字以 Item 表/客户端译名为准
  // （旧字典名为"染色剂"）。
  { itemId: 249409, name: "天蓝染料", sellPriceCopper: 125, source: "forever-beta" },
  { itemId: 249430, name: "品红染料", sellPriceCopper: 250, source: "forever-beta" },
  { itemId: 249431, name: "翠绿染料", sellPriceCopper: 375, source: "forever-beta" },
  { itemId: 249432, name: "砂纸", sellPriceCopper: 250, source: "forever-beta" },
  { itemId: 249429, name: "无瑕鳞片", sellPriceCopper: 375, source: "forever-beta", note: "稀有剥皮材料（物品等级 60）" },
  { itemId: 249391, name: "黄铁矿", sellPriceCopper: 100, source: "forever-beta", note: "稀有采矿材料（物品等级 25）" },
];

// Forever-only items whose itemId is not publicly published; the addon scan
// (P0-B) will dump them from the client and complete these entries.
export const pendingVendorItems: VendorPriceEntry[] = [
  { itemId: 0, name: "重瑟银矿", sellPriceCopper: 375, source: "forever-beta", note: "稀有材料，需营地熔炉熔炼" },
  { itemId: 0, name: "重瑟银锭", sellPriceCopper: 2500, source: "forever-beta", note: "营地熔炉（Geschmolzene Gießerei）产出" },
  { itemId: 0, name: "Pechblende（沥青铀矿）", sellPriceCopper: 375, source: "forever-beta", note: "稀有采集物（物品等级 60）" },
  { itemId: 0, name: "Azerothium 锭", sellPriceCopper: 5000, source: "forever-beta", note: "2 Pechblende + 1 煤块熔炼" },
  { itemId: 0, name: "Legionit 锭", sellPriceCopper: 5000, source: "forever-beta", note: "炼金转化（重瑟银锭 + 恶魔水晶）" },
  { itemId: 0, name: "Tobernit", sellPriceCopper: 15000, source: "forever-beta", note: "附魔 300+ 材料" },
  { itemId: 0, name: "恶魔水晶", sellPriceCopper: 3000, source: "forever-beta" },
  { itemId: 0, name: "厚柴薪", sellPriceCopper: 50000, source: "forever-beta", note: "商人卖价 20g / 回购 5g（非套利品，仅参考）" },
  { itemId: 0, name: "力量鱼（大）", sellPriceCopper: 10000, source: "forever-beta", note: "带重量大鱼 1s/磅；103磅 1g3s" },
  { itemId: 0, name: "死亡之莲", sellPriceCopper: 1500, source: "forever-beta" },
  { itemId: 0, name: "Bauxit（铝土矿）", sellPriceCopper: 250, source: "forever-beta", note: "稀有采矿材料（物品等级 45）" },
];

// ---------------------------------------------------------------------------
// Transformation recipes (material → product). The guaranteed math only
// needs the product's floor price; the material side is priced by the live
// AH snapshot in the calc layer.
// ---------------------------------------------------------------------------

export const transformations: TransformationRecipe[] = [
  // Mining smelts — the leveling-economy staple. All classic, "wie Era".
  { name: "铜锭", profession: "采矿", source: "classic-era", materials: [{ itemId: 2770, name: "铜矿石", quantity: 1 }], product: { itemId: 2840, name: "铜锭", quantity: 1 } },
  { name: "青铜锭", profession: "采矿", source: "classic-era", materials: [{ itemId: 2840, name: "铜锭", quantity: 1 }, { itemId: 3576, name: "锡锭", quantity: 1 }], product: { itemId: 2841, name: "青铜锭", quantity: 2 } },
  { name: "银锭", profession: "采矿", source: "classic-era", materials: [{ itemId: 2775, name: "银矿石", quantity: 1 }], product: { itemId: 2842, name: "银锭", quantity: 1 } },
  { name: "铁锭", profession: "采矿", source: "classic-era", materials: [{ itemId: 2772, name: "铁矿石", quantity: 1 }], product: { itemId: 3575, name: "铁锭", quantity: 1 } },
  { name: "金锭", profession: "采矿", source: "classic-era", materials: [{ itemId: 2776, name: "金矿石", quantity: 1 }], product: { itemId: 3577, name: "金锭", quantity: 1 } },
  { name: "秘银锭", profession: "采矿", source: "classic-era", materials: [{ itemId: 3858, name: "秘银矿石", quantity: 1 }], product: { itemId: 3860, name: "秘银锭", quantity: 1 } },
  { name: "真银锭", profession: "采矿", source: "classic-era", materials: [{ itemId: 7911, name: "真银矿石", quantity: 1 }], product: { itemId: 6037, name: "真银锭", quantity: 1 } },
  { name: "瑟银锭", profession: "采矿", source: "classic-era", materials: [{ itemId: 10620, name: "瑟银矿石", quantity: 1 }], product: { itemId: 12359, name: "瑟银锭", quantity: 1 } },
  // Negative smelts — included so the panel shows honest "不赚" states with
  // real data (steel eats a coal; dark iron eats 8 ores for a bar).
  { name: "钢锭", profession: "采矿", source: "classic-era", materials: [{ itemId: 3575, name: "铁锭", quantity: 1 }, { itemId: 3857, name: "煤块", quantity: 1 }], product: { itemId: 3859, name: "钢锭", quantity: 1 }, note: "保底价低于材料价，熔炼亏" },
  { name: "黑铁锭", profession: "采矿", source: "classic-era", materials: [{ itemId: 11370, name: "黑铁矿石", quantity: 8 }], product: { itemId: 11371, name: "黑铁锭", quantity: 1 }, note: "8 矿炼 1 锭，保底价巨亏" },
  // Tailoring bolts — roughly zero spread at vendor prices; AH demand, not
  // the vendor, decides whether they pay.
  { name: "亚麻布卷", profession: "裁缝", source: "classic-era", materials: [{ itemId: 2589, name: "亚麻布", quantity: 2 }], product: { itemId: 2996, name: "亚麻布卷", quantity: 1 } },
  { name: "毛料卷", profession: "裁缝", source: "classic-era", materials: [{ itemId: 2592, name: "毛料", quantity: 3 }], product: { itemId: 2997, name: "毛料卷", quantity: 1 } },
  { name: "丝绸卷", profession: "裁缝", source: "classic-era", materials: [{ itemId: 4306, name: "丝绸", quantity: 4 }], product: { itemId: 4305, name: "丝绸卷", quantity: 1 } },
  { name: "魔纹布卷", profession: "裁缝", source: "classic-era", materials: [{ itemId: 4338, name: "魔纹布", quantity: 5 }], product: { itemId: 4339, name: "魔纹布卷", quantity: 1 } },
  { name: "符文布卷", profession: "裁缝", source: "classic-era", materials: [{ itemId: 14047, name: "符文布", quantity: 5 }], product: { itemId: 14048, name: "符文布卷", quantity: 1 } },
  // Leatherworking upgrade — always a vendor loss; for crafters only.
  { name: "硬甲皮（升级）", profession: "制皮", source: "classic-era", materials: [{ itemId: 4304, name: "厚皮", quantity: 6 }], product: { itemId: 8170, name: "硬甲皮", quantity: 1 }, note: "6 厚皮升 1 硬甲皮，保底价亏" },

  // Forever-only chains — real prices, itemId pending the client dump.
  { name: "重瑟银锭", profession: "采矿", source: "forever-beta", materials: [{ itemId: 0, name: "重瑟银矿", quantity: 1 }], product: { itemId: 0, name: "重瑟银锭", quantity: 1 }, note: "需营地熔炉（采矿 300 + 蓝图），保底价 +21s25/个" },
  { name: "Azerothium 锭", profession: "采矿", source: "forever-beta", materials: [{ itemId: 0, name: "Pechblende", quantity: 2 }, { itemId: 3857, name: "煤块", quantity: 1 }], product: { itemId: 0, name: "Azerothium 锭", quantity: 1 }, note: "保底价 +41s25/个（按材料保底价计）" },
  { name: "Legionit 转化", profession: "炼金", source: "forever-beta", materials: [{ itemId: 0, name: "重瑟银锭", quantity: 1 }, { itemId: 0, name: "恶魔水晶", quantity: 1 }], product: { itemId: 0, name: "Legionit 锭", quantity: 1 }, note: "保底价 −5s，转化亏（除非 AH 价更低）" },
];

export const vendorPriceById: ReadonlyMap<number, VendorPriceEntry> = new Map(
  vendorPrices.map((entry) => [entry.itemId, entry])
);
