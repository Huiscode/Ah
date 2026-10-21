// 经典旧世分解表（绿/蓝 × 护甲/武器 × 物品等级段）。
//
// 来源：插件内置 Source_Classic/Enchant/DisenchantingProbabilities.lua（原版固定
// 概率表）。分解结果不按单件物品定义，而按 品质 × 护甲/武器 × ilvl 段 确定，
// 同段所有装备结果一致。只收录用户需要的绿(uncommon)/蓝(rare)；紫装暂不做。
//
// 局限（2026-10-21）：Forever 新增/改动物品的 ilvl 若落在经典段内，按本表估算；
// 站点不公布逐件分解产出，高等级/新装备结果可能偏离，UI 需标注"经典表估算"。
//
// 每条 outcome：chance=概率(%)，qty=期望/固定数量，matItemId=材料物品ID。

export type DisenchantQuality = "uncommon" | "rare";
export type DisenchantEquip = "armor" | "weapon";

export type DisenchantOutcome = {
  chance: number;   // 概率 %（如 40 = 40%）
  qty: number;      // 该概率下分解出的材料数量（可为小数期望）
  matItemId: number;
};

export type DisenchantBand = {
  ilvlLow: number;
  ilvlHigh: number;
  outcomes: DisenchantOutcome[];
};

// 材料物品ID → 中文兜底名（页面优先用 DB 物品名覆盖；这里只是缺名兜底）。
export const DISENCHANT_MAT_NAMES: Record<number, string> = {
  10940: "奇异之尘",
  10938: "次级魔法精华",
  10939: "强效魔法精华",
  10978: "小块微光碎片",
  11083: "灵魂之尘",
  11082: "强效星界精华",
  11084: "大块微光碎片",
  10998: "次级星界精华",
  11134: "次级秘法精华",
  11138: "小块闪光碎片",
  11137: "幻象之尘",
  11135: "强效秘法精华",
  11139: "大块闪光碎片",
  11174: "次级虚空精华",
  11177: "小块强光碎片",
  11176: "梦境之尘",
  11175: "强效虚空精华",
  11178: "大块强光碎片",
  16202: "次级不灭精华",
  14343: "小块魔光碎片",
  16204: "幻影之尘",
  16203: "强效不灭精华",
  14344: "大块魔光碎片",
  20725: "连结水晶"
};

// 绿装·护甲
const GREEN_ARMOR: DisenchantBand[] = [
  { ilvlLow: 5, ilvlHigh: 15, outcomes: [
    { chance: 40, qty: 1, matItemId: 10940 },
    { chance: 40, qty: 2, matItemId: 10940 },
    { chance: 10, qty: 1, matItemId: 10938 },
    { chance: 10, qty: 2, matItemId: 10938 }
  ]},
  { ilvlLow: 16, ilvlHigh: 20, outcomes: [
    { chance: 37.5, qty: 2, matItemId: 10940 },
    { chance: 37.5, qty: 3, matItemId: 10940 },
    { chance: 10, qty: 1, matItemId: 10939 },
    { chance: 10, qty: 2, matItemId: 10939 },
    { chance: 5, qty: 1, matItemId: 10978 }
  ]},
  { ilvlLow: 21, ilvlHigh: 25, outcomes: [
    { chance: 25, qty: 4, matItemId: 10940 },
    { chance: 25, qty: 5, matItemId: 10940 },
    { chance: 25, qty: 6, matItemId: 10940 },
    { chance: 7.5, qty: 1, matItemId: 10998 },
    { chance: 7.5, qty: 2, matItemId: 10998 },
    { chance: 10, qty: 1, matItemId: 10978 }
  ]},
  { ilvlLow: 26, ilvlHigh: 30, outcomes: [
    { chance: 37.5, qty: 1, matItemId: 11083 },
    { chance: 37.5, qty: 2, matItemId: 11083 },
    { chance: 10, qty: 1, matItemId: 11082 },
    { chance: 10, qty: 2, matItemId: 11082 },
    { chance: 5, qty: 1, matItemId: 11084 }
  ]},
  { ilvlLow: 31, ilvlHigh: 35, outcomes: [
    { chance: 18.75, qty: 2, matItemId: 11083 },
    { chance: 18.75, qty: 3, matItemId: 11083 },
    { chance: 18.75, qty: 4, matItemId: 11083 },
    { chance: 18.75, qty: 5, matItemId: 11083 },
    { chance: 10, qty: 1, matItemId: 11134 },
    { chance: 10, qty: 2, matItemId: 11134 },
    { chance: 5, qty: 1, matItemId: 11138 }
  ]},
  { ilvlLow: 36, ilvlHigh: 40, outcomes: [
    { chance: 37.5, qty: 1, matItemId: 11137 },
    { chance: 37.5, qty: 2, matItemId: 11137 },
    { chance: 10, qty: 1, matItemId: 11135 },
    { chance: 10, qty: 2, matItemId: 11135 },
    { chance: 5, qty: 1, matItemId: 11139 }
  ]},
  { ilvlLow: 41, ilvlHigh: 45, outcomes: [
    { chance: 18.75, qty: 2, matItemId: 11137 },
    { chance: 18.75, qty: 3, matItemId: 11137 },
    { chance: 18.75, qty: 4, matItemId: 11137 },
    { chance: 18.75, qty: 5, matItemId: 11137 },
    { chance: 10, qty: 1, matItemId: 11174 },
    { chance: 10, qty: 2, matItemId: 11174 },
    { chance: 5, qty: 1, matItemId: 11177 }
  ]},
  { ilvlLow: 46, ilvlHigh: 50, outcomes: [
    { chance: 37.5, qty: 1, matItemId: 11176 },
    { chance: 37.5, qty: 2, matItemId: 11176 },
    { chance: 10, qty: 1, matItemId: 11175 },
    { chance: 10, qty: 2, matItemId: 11175 },
    { chance: 5, qty: 1, matItemId: 11178 }
  ]},
  { ilvlLow: 51, ilvlHigh: 55, outcomes: [
    { chance: 18.75, qty: 2, matItemId: 11176 },
    { chance: 18.75, qty: 3, matItemId: 11176 },
    { chance: 18.75, qty: 4, matItemId: 11176 },
    { chance: 18.75, qty: 5, matItemId: 11176 },
    { chance: 10, qty: 1, matItemId: 16202 },
    { chance: 10, qty: 2, matItemId: 16202 },
    { chance: 5, qty: 1, matItemId: 14343 }
  ]},
  { ilvlLow: 56, ilvlHigh: 65, outcomes: [
    { chance: 37.5, qty: 1, matItemId: 16204 },
    { chance: 37.5, qty: 2, matItemId: 16204 },
    { chance: 10, qty: 1, matItemId: 16203 },
    { chance: 10, qty: 2, matItemId: 16203 },
    { chance: 5, qty: 1, matItemId: 14344 }
  ]}
];

// 绿装·武器
const GREEN_WEAPON: DisenchantBand[] = [
  { ilvlLow: 6, ilvlHigh: 15, outcomes: [
    { chance: 10, qty: 1, matItemId: 10940 },
    { chance: 10, qty: 2, matItemId: 10940 },
    { chance: 40, qty: 1, matItemId: 10938 },
    { chance: 40, qty: 2, matItemId: 10938 }
  ]},
  { ilvlLow: 16, ilvlHigh: 20, outcomes: [
    { chance: 10, qty: 2, matItemId: 10940 },
    { chance: 10, qty: 3, matItemId: 10940 },
    { chance: 37.5, qty: 1, matItemId: 10939 },
    { chance: 37.5, qty: 2, matItemId: 10939 },
    { chance: 5, qty: 1, matItemId: 10978 }
  ]},
  { ilvlLow: 21, ilvlHigh: 25, outcomes: [
    { chance: 5, qty: 4, matItemId: 10940 },
    { chance: 5, qty: 5, matItemId: 10940 },
    { chance: 5, qty: 6, matItemId: 10940 },
    { chance: 37.5, qty: 1, matItemId: 10939 },
    { chance: 37.5, qty: 2, matItemId: 10939 },
    { chance: 10, qty: 1, matItemId: 10978 }
  ]},
  { ilvlLow: 26, ilvlHigh: 30, outcomes: [
    { chance: 10, qty: 1, matItemId: 11083 },
    { chance: 10, qty: 2, matItemId: 11083 },
    { chance: 37.5, qty: 1, matItemId: 10939 },
    { chance: 37.5, qty: 2, matItemId: 10939 },
    { chance: 5, qty: 1, matItemId: 11084 }
  ]},
  { ilvlLow: 31, ilvlHigh: 35, outcomes: [
    { chance: 5, qty: 2, matItemId: 11083 },
    { chance: 5, qty: 3, matItemId: 11083 },
    { chance: 5, qty: 4, matItemId: 11083 },
    { chance: 5, qty: 5, matItemId: 11083 },
    { chance: 37.5, qty: 1, matItemId: 11134 },
    { chance: 37.5, qty: 2, matItemId: 11134 },
    { chance: 5, qty: 1, matItemId: 11138 }
  ]},
  { ilvlLow: 36, ilvlHigh: 40, outcomes: [
    { chance: 10, qty: 1, matItemId: 11137 },
    { chance: 10, qty: 2, matItemId: 11137 },
    { chance: 37.5, qty: 1, matItemId: 11135 },
    { chance: 37.5, qty: 2, matItemId: 11135 },
    { chance: 5, qty: 1, matItemId: 11139 }
  ]},
  { ilvlLow: 41, ilvlHigh: 45, outcomes: [
    { chance: 5, qty: 2, matItemId: 11137 },
    { chance: 5, qty: 3, matItemId: 11137 },
    { chance: 5, qty: 4, matItemId: 11137 },
    { chance: 5, qty: 5, matItemId: 11137 },
    { chance: 37.5, qty: 1, matItemId: 11174 },
    { chance: 37.5, qty: 2, matItemId: 11174 },
    { chance: 5, qty: 1, matItemId: 11177 }
  ]},
  { ilvlLow: 46, ilvlHigh: 50, outcomes: [
    { chance: 10, qty: 1, matItemId: 11176 },
    { chance: 10, qty: 2, matItemId: 11176 },
    { chance: 37.5, qty: 1, matItemId: 11175 },
    { chance: 37.5, qty: 2, matItemId: 11175 },
    { chance: 5, qty: 1, matItemId: 11178 }
  ]},
  { ilvlLow: 51, ilvlHigh: 55, outcomes: [
    { chance: 5.5, qty: 2, matItemId: 11176 },
    { chance: 5.5, qty: 3, matItemId: 11176 },
    { chance: 5.5, qty: 4, matItemId: 11176 },
    { chance: 5.5, qty: 5, matItemId: 11176 },
    { chance: 37.5, qty: 1, matItemId: 16202 },
    { chance: 37.5, qty: 2, matItemId: 16202 },
    { chance: 5, qty: 1, matItemId: 14343 }
  ]},
  { ilvlLow: 56, ilvlHigh: 65, outcomes: [
    { chance: 11, qty: 1, matItemId: 16204 },
    { chance: 11, qty: 2, matItemId: 16204 },
    { chance: 37.5, qty: 1, matItemId: 16203 },
    { chance: 37.5, qty: 2, matItemId: 16203 },
    { chance: 5, qty: 1, matItemId: 14344 }
  ]}
];

// 蓝装·护甲（与蓝装·武器相同）
const RARE: DisenchantBand[] = [
  { ilvlLow: 11, ilvlHigh: 25, outcomes: [{ chance: 100, qty: 1, matItemId: 10978 }]},
  { ilvlLow: 26, ilvlHigh: 30, outcomes: [{ chance: 100, qty: 1, matItemId: 11084 }]},
  { ilvlLow: 31, ilvlHigh: 35, outcomes: [{ chance: 100, qty: 1, matItemId: 11138 }]},
  { ilvlLow: 36, ilvlHigh: 40, outcomes: [{ chance: 100, qty: 1, matItemId: 11139 }]},
  { ilvlLow: 41, ilvlHigh: 45, outcomes: [{ chance: 100, qty: 1, matItemId: 11177 }]},
  { ilvlLow: 46, ilvlHigh: 50, outcomes: [{ chance: 100, qty: 1, matItemId: 11178 }]},
  { ilvlLow: 51, ilvlHigh: 55, outcomes: [{ chance: 100, qty: 1, matItemId: 14343 }]},
  { ilvlLow: 56, ilvlHigh: 65, outcomes: [
    { chance: 99.5, qty: 1, matItemId: 14344 },
    { chance: 0.5, qty: 1, matItemId: 20725 }
  ]}
];

export const DISENCHANT_TABLE: Record<DisenchantQuality, Record<DisenchantEquip, DisenchantBand[]>> = {
  uncommon: { armor: GREEN_ARMOR, weapon: GREEN_WEAPON },
  rare: { armor: RARE, weapon: RARE }
};

// category 中文 → 护甲/武器归类。DB 存在两套写法：聚合类（category=护甲/武器，
// subCategory=甲种/武器种类）与部位细分（category=头部/胸部/单手/双手…，subCategory=甲种/武器种类），
// 两者都要归到 armor/weapon；配方/材料/消耗品/背包/弹药/圣物/副手等不可分解一律 null。
const ARMOR_CATEGORY = new Set([
  "护甲", "头部", "手腕", "手部", "肩部", "背部", "胸部", "脚", "腰部", "腿部", "颈部", "饰品", "Armor"
]);
const WEAPON_CATEGORY = new Set([
  "武器", "单手", "双手", "主手", "远程", "投掷"
]);
// subCategory 兜底：category 缺失/unknown 或细分写法时按种类再判一次。
const WEAPON_SUB = new Set([
  "匕首", "剑", "单手剑", "双手剑", "斧", "单手斧", "双手斧", "锤", "单手锤", "双手锤",
  "拳套", "法杖", "长柄武器", "弓", "弩", "枪械", "魔杖", "投掷武器"
]);
const ARMOR_SUB = new Set(["盾牌", "布甲", "皮甲", "锁甲", "板甲"]);

export function equipKind(category: string, subCategory?: string): DisenchantEquip | null {
  if (ARMOR_CATEGORY.has(category)) return "armor";
  if (WEAPON_CATEGORY.has(category)) return "weapon";
  if (subCategory) {
    if (WEAPON_SUB.has(subCategory)) return "weapon";
    if (ARMOR_SUB.has(subCategory)) return "armor";
  }
  return null;
}

export function findDisenchantBand(quality: DisenchantQuality, equip: DisenchantEquip, ilvl: number): DisenchantBand | null {
  const bands = DISENCHANT_TABLE[quality]?.[equip] ?? [];
  return bands.find((band) => ilvl >= band.ilvlLow && ilvl <= band.ilvlHigh) ?? null;
}
