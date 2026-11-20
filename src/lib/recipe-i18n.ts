// 配方数据的显示层本地化：DB 里的配方名/材料名/产出名是中文（foreverchanges
// 中文源抓取），但材料和产出都带 itemId，而 Item 表已回填 nameEn——渲染前按
// itemId / 中文名映射成显示语言即可，不需要重新爬配方页。
//
// 关键取舍：**必须在做完 computeRecipeProfits 等计算之后**调用（那些算法用
// 中文名做图纸前缀/关联配方匹配）；recipe.name 保留中文做稳定标识（收藏
// localStorage、unique 键都靠它），英文显示名放 recipe.displayName，
// 组件渲染 `displayName ?? name`。
import type { DbRecipe, RecipeMaterial, RecipeProfitRow } from "@/lib/recipe-profits";
import type { SecondaryMaterialRow } from "@/lib/secondary-materials";
import { displayName, type Lang } from "@/lib/i18n";

export type ItemNameRow = { itemId: number; name: string; nameEn: string | null };

export type ItemNameIndex = {
  /** itemId → 英文名（无则 null） */
  byItemId: Map<number, string | null>;
  /** 中文名 → 英文名（recipe 名 / missing 材料名兜底用） */
  byZhName: Map<string, string>;
};

export function buildItemNameIndex(rows: ItemNameRow[]): ItemNameIndex {
  const byItemId = new Map<number, string | null>();
  const byZhName = new Map<string, string>();
  for (const r of rows) {
    byItemId.set(r.itemId, r.nameEn);
    if (r.nameEn) byZhName.set(r.name, r.nameEn);
  }
  return { byItemId, byZhName };
}

/** 配方显示名：优先同名物品的英文名（成品/图纸物品），兜底单产出的英文名。 */
function recipeDisplayName(recipe: DbRecipe, index: ItemNameIndex): string | undefined {
  const sameName = index.byZhName.get(recipe.name);
  if (sameName) return sameName;
  if (recipe.outputs.length === 1) {
    const en = index.byItemId.get(recipe.outputs[0].itemId);
    if (en) return en;
  }
  return undefined;
}

function localizeMaterial(m: RecipeMaterial, index: ItemNameIndex): RecipeMaterial {
  const en = index.byItemId.get(m.itemId);
  return en ? { ...m, name: en } : m;
}

// 配方子分类名（foreverchanges 中文源，51 个固定值）→ 英文显示名。
export const RECIPE_CATEGORY_EN: Record<string, string> = {
  "胸部": "Chest",
  "手": "Hands",
  "脚": "Feet",
  "腿部": "Legs",
  "腰部": "Waist",
  "肩部": "Shoulders",
  "手腕": "Wrists",
  "头部": "Head",
  "药水": "Potions",
  "药剂": "Elixirs",
  "双手武器": "Two-Handed Weapons",
  "单手武器": "One-Handed Weapons",
  "背部": "Back",
  "饰品和装置": "Trinkets & Devices",
  "背包": "Bags",
  "零件": "Parts",
  "智力、法术强度与法力": "Intellect, Spell Power & Mana",
  "营地物品": "Camping",
  "展示用的衬衫和长袍": "Shirts & Robes",
  "武器": "Weapons",
  "炸弹和炸药": "Bombs & Explosives",
  "力量与攻击强度": "Strength & Attack Power",
  "护目镜和头盔": "Goggles & Helmets",
  "耐力": "Stamina",
  "磨刀石、平衡石和砂轮": "Whetstones & Grindstones",
  "枪械和瞄准镜": "Guns & Scopes",
  "护甲片": "Armor Kits",
  "其他增益": "Other Buffs",
  "熔炼": "Smelting",
  "敏捷": "Agility",
  "其他": "Other",
  "盾牌": "Shields",
  "侏儒工程学": "Gnomish Engineering",
  "转化": "Transmutation",
  "绷带": "Bandages",
  "地精工程学": "Goblin Engineering",
  "其他装备": "Other Gear",
  "钥匙、棒子和工具": "Keys, Rods & Tools",
  "熟皮": "Cured Hides",
  "油和其他": "Oils & Misc",
  "抗毒药剂和药水": "Anti-Venom",
  "合剂": "Flasks",
  "精神": "Spirit",
  "盾刺、锁链和马刺": "Spikes, Chains & Spurs",
  "布卷": "Bolts of Cloth",
  "颈部": "Neck",
  "只回复生命与法力": "Health & Mana Recovery",
  "宠物和坐骑": "Pets & Mounts",
  "烟花和玩具": "Fireworks & Toys",
  "护盾": "Wards",
  "副手": "Off-hand"
};

function localizeRecipe(recipe: DbRecipe, index: ItemNameIndex): DbRecipe {
  return {
    ...recipe,
    displayName: recipeDisplayName(recipe, index),
    categoryName: recipe.categoryName ? (RECIPE_CATEGORY_EN[recipe.categoryName] ?? recipe.categoryName) : recipe.categoryName,
    reagents: recipe.reagents.map((m) => localizeMaterial(m, index)),
    outputs: recipe.outputs.map((m) => localizeMaterial(m, index))
  };
}

/** ZH 模式不需要变换（DB 即中文）；EN 模式做显示名替换。纯显示层，不动计算结果数值。 */
export function localizeRecipeProfitRow(row: RecipeProfitRow, index: ItemNameIndex, lang: Lang): RecipeProfitRow {
  if (lang === "zh") return row;
  return {
    ...row,
    recipe: localizeRecipe(row.recipe, index),
    materials: row.materials.map((m) => {
      const en = index.byZhName.get(m.name);
      return en ? { ...m, name: en } : m;
    }),
    missing: row.missing.map((n) => index.byZhName.get(n) ?? n),
    linkedCraft: row.linkedCraft
      ? { ...row.linkedCraft, outputName: displayName(row.linkedCraft.outputName, index.byZhName.get(row.linkedCraft.outputName), lang) }
      : null
  };
}

export function localizeSecondaryRow(row: SecondaryMaterialRow, index: ItemNameIndex, lang: Lang): SecondaryMaterialRow {
  if (lang === "zh") return row;
  return {
    ...row,
    item: localizeMaterial(row.item, index),
    craftRecipe: localizeRecipe(row.craftRecipe, index)
  };
}
