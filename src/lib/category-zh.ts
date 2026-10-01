// Classic WoW item-class names as rendered by the zhCN client. Filtering
// keeps the English value (DB + API stay English); only the visible text
// is translated.
export const CATEGORY_ZH: Record<string, string> = {
  Armor: "护甲",
  Weapon: "武器",
  Consumable: "消耗品",
  "Trade Goods": "交易物品",
  Recipe: "配方",
  Miscellaneous: "杂物",
  Container: "容器",
  Key: "钥匙",
  Quest: "任务",
  Quiver: "箭袋",
  Projectile: "弹药",
  Reagent: "材料",
  Enchanting: "附魔",
  Gathering: "布皮草矿",
  unknown: "未知"
};

// 装备：护甲 + 武器 + 箭袋 + 弹药合并为一个筛选项。
export const EQUIPMENT_GROUP = "装备";
export const EQUIPMENT_CATEGORIES = new Set(["Armor", "Weapon", "Quiver", "Projectile"]);

// 材料：矿石/锭、草药、布匹、皮革、宝石、石头、试剂等制造原料。
// 布皮草矿（Gathering，客户端返回的少量材料 itemType）并入材料分组，
// 不再作为独立类目出现在下拉框。
export const MATERIALS_GROUP = "材料";
export const MATERIALS_CATEGORIES = new Set(["Trade Goods", "Reagent", "Gathering"]);

// These categories are not shown in the dropdown (items are grouped elsewhere
// or too rare).
const HIDDEN_CATEGORIES = new Set(["Key", "unknown"]);

// zhCN client returns Chinese category names in scan payloads; normalize them
// to the English canonical keys used by CATEGORY_ZH / grouping rules so the
// dropdown and matching work regardless of which locale wrote the row.
const ZH_TO_EN: Record<string, string> = {
  "护甲": "Armor",
  "武器": "Weapon",
  "消耗品": "Consumable",
  "商品": "Trade Goods",
  "交易物品": "Trade Goods",
  "配方": "Recipe",
  "材料": "Reagent",
  "杂物": "Miscellaneous",
  "其它": "Miscellaneous",
  "容器": "Container",
  "钥匙": "Key",
  "任务": "Quest",
  "箭袋": "Quiver",
  "弹药": "Projectile",
  "附魔": "Enchanting",
  "布皮草矿": "Gathering"
};

export function normalizeCategory(raw: string): string {
  return ZH_TO_EN[raw] ?? raw;
}

export function categoryLabel(category: string): string {
  return CATEGORY_ZH[normalizeCategory(category)] ?? category;
}

// 给定数据库里实际出现的原始分类列表，返回下拉框应显示的选项：
// 装备、材料各只出现一次（如果有任一子分类存在），其余分类原样保留。
export function groupedCategoryOptions(rawCategories: string[]): string[] {
  // 固定顺序：消耗品 → 配方 → 附魔 → 容器 → 材料 → 装备 → 任务 → 杂物
  // （布皮草矿已并入材料，不再单独出现）。
  const ORDER: string[] = ["Consumable", "Recipe", "Enchanting", "Container", MATERIALS_GROUP, EQUIPMENT_GROUP, "Quest", "Miscellaneous"];
  const normalized = rawCategories.map(normalizeCategory);
  const set = new Set(normalized);
  const out: string[] = [];
  for (const cat of ORDER) {
    if (cat === EQUIPMENT_GROUP) {
      if (normalized.some((c) => EQUIPMENT_CATEGORIES.has(c))) out.push(cat);
    } else if (cat === MATERIALS_GROUP) {
      if (normalized.some((c) => MATERIALS_CATEGORIES.has(c))) out.push(cat);
    } else if (set.has(cat)) {
      out.push(cat);
    }
  }
  return out;
}

// 判断某个原始分类是否匹配用户在下拉框里选的值（支持分组）。
export function categoryMatches(rawCategory: string, filterValue: string): boolean {
  if (!filterValue) return true;
  const cat = normalizeCategory(rawCategory);
  if (filterValue === EQUIPMENT_GROUP) return EQUIPMENT_CATEGORIES.has(cat);
  if (filterValue === MATERIALS_GROUP) return MATERIALS_CATEGORIES.has(cat);
  return cat === filterValue;
}
