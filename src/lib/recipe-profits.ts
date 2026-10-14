// P0-B: full-recipe profit engine over the recipe library dumped by the
// in-game /wahrecipes command. Unlike the curated static table (crafting.ts,
// kept for its tests), recipes here carry zero- or multi-product outputs and
// ride the vendor floor (vendorP) the addon dumped for every touched item.
//
// Price priority for a craft (M4.2 口径，用户 2026-10-14 拍板)：
//   1. live AH price — the market signal already resolves 自扫 P10 → 网站
//      P50 by the newest source, so the caller passes that map as-is;
//   2. cost floor（材料成本兜底）— NPC 卖价（Item.sellPrice，游戏内商人
//      卖出单价）优先 > 收购价（Item.vendorPrice / 字典，机会成本）：
//      材料无 AH 价时，制造成本应按"NPC 卖给你的价"算，用收购价兜底会
//      低估成本、虚高利润；
//   3. revenue floor（成品收入兜底）— 收购价（卖 NPC 的保底收入）。
//      dump（/wahrecipes vendorP，收购价）覆盖两层兜底的同名物品。
import { vendorPriceById } from "@/data/vendor-prices";
import { AH_CUT } from "@/lib/market-rules";

export type RecipeMaterial = {
  itemId: number;
  name: string;
  quantity: number;
  vendorPrice?: number; // NPC SellPrice in copper, dumped by /wahrecipes
  // 种子附加的物品属性（扫描配方无）：品质 0-7 / 物品等级 / 需要等级。
  quality?: number;
  ilvl?: number;
  req?: number;
};

export type DbRecipe = {
  name: string;
  profession: string;
  skillLevel: number;
  reagents: RecipeMaterial[];
  outputs: RecipeMaterial[];
  // "craft" = professional craft (seeded from the recipe library or
  // /wahrecipes dumps); "merchant" = merchant-favor exchange (集市商人).
  category?: "craft" | "merchant";
  // 商人兑换的青睐货币成本（currency 3402，无铜币汇率）；craft 为 0。
  favorCost?: number;
  // 附加信息：技能四档难度 [学,黄,绿,灰]（0=未记录）、
  // 分类名（如"药水""药剂"）、配方/兑换法术 ID。
  difficulty?: number[];
  categoryName?: string;
  spellId?: number;
};

// 单种材料的价格明细：卡片上标注"当前单价 + 来源"。
// source "ah" = 实时拍卖行价（自扫P10 → 网站P50，最新来源自动选）；
// source "vendor" = 无 AH 价，按 NPC 保底价（经典字典 < DB < 游戏 /wahrecipes 扫描 vendorP）。
export type MaterialPrice = {
  name: string;
  quantity: number;
  price: number; // 单价（铜）
  source: "ah" | "vendor";
};

export type RecipeProfitRow = {
  recipe: DbRecipe;
  status: "ok" | "missing";
  cost: number;
  revenue: number;
  profit: number;
  marginPercent: number;
  missing: string[];
  materials: MaterialPrice[]; // 每种材料当前单价与来源（缺价材料不在此列）
};


// Canonical English profession names (stored value) → client-locale display
// labels. Data keeps the English keys (import layer / /wahrecipes normalize to
// these); the UI renders Chinese via professionLabel().
export const PROFESSION_EN_TO_ZH: Record<string, string> = {
  Alchemy: "炼金术",
  Blacksmithing: "锻造",
  Cooking: "烹饪",
  Enchanting: "附魔",
  Engineering: "工程学",
  "First Aid": "急救",
  Fishing: "钓鱼",
  Herbalism: "草药学",
  Leatherworking: "制皮",
  Mining: "采矿",
  Skinning: "剥皮",
  Tailoring: "裁缝",
  General: "贸易通用"
};

export const professionLabel = (profession: string): string =>
  PROFESSION_EN_TO_ZH[profession] ?? profession;

// 个别分类名漏了中译，在这里补显示层映射。
const CATEGORY_EN_TO_ZH: Record<string, string> = {
  "Thrown": "投掷武器",
  "Armor Food": "护甲食物"
};

export const categoryLabel = (category: string): string =>
  CATEGORY_EN_TO_ZH[category] ?? category;

export type RecipeFloors = {
  /** 材料成本兜底：NPC 卖价（Item.sellPrice，游戏内商人卖出单价）> 收购价 > 字典。 */
  costFloor: Map<number, number>;
  /** 成品收入兜底：收购价（Item.vendorPrice / 字典，卖 NPC 保底）> dump。 */
  revenueFloor: Map<number, number>;
};

// Floor-price index for a recipe library.
//   costFloor：材料成本兜底——NPC 卖价（sellerPrice）优先，其次收购价（机会成本）；
//   revenueFloor：成品收入兜底——收购价（卖 NPC 的保底收入）。
//   来源合并顺序：经典字典（收购价基座）< DB Item.vendorPrice（收购价，audit 核对）
//   < DB Item.sellPrice（NPC 卖价，只进 costFloor）< dump vendorP（freshest，两层都覆盖）。
export function buildRecipeFloors(
  recipes: DbRecipe[],
  itemVendorPrices: ReadonlyMap<number, number> = new Map(),
  itemSellerPrices: ReadonlyMap<number, number> = new Map()
): RecipeFloors {
  const costFloor = new Map<number, number>();
  const revenueFloor = new Map<number, number>();
  for (const [itemId, entry] of vendorPriceById) {
    costFloor.set(itemId, entry.sellPriceCopper);
    revenueFloor.set(itemId, entry.sellPriceCopper);
  }
  for (const [itemId, price] of itemVendorPrices) {
    if (price > 0) {
      costFloor.set(itemId, price);
      revenueFloor.set(itemId, price);
    }
  }
  for (const [itemId, price] of itemSellerPrices) {
    if (price > 0) costFloor.set(itemId, price);
  }
  for (const recipe of recipes) {
    for (const material of [...recipe.reagents, ...recipe.outputs]) {
      if (material.vendorPrice !== undefined && material.vendorPrice > 0) {
        costFloor.set(material.itemId, material.vendorPrice);
        revenueFloor.set(material.itemId, material.vendorPrice);
      }
    }
  }
  return { costFloor, revenueFloor };
}

export function computeRecipeProfits(
  recipes: DbRecipe[],
  priceByItemId: Map<number, number>,
  costFloor: Map<number, number>,
  revenueFloor: Map<number, number> = costFloor
): RecipeProfitRow[] {
  const rows = recipes.map<RecipeProfitRow>((recipe) => {
    const missing: string[] = [];
    const materials: MaterialPrice[] = [];
    let cost = 0;
    for (const material of recipe.reagents) {
      const ah = priceByItemId.get(material.itemId);
      const floor = costFloor.get(material.itemId);
      const price = ah ?? floor;
      if (price === undefined) {
        missing.push(material.name);
      } else {
        cost += material.quantity * price;
        materials.push({ name: material.name, quantity: material.quantity, price, source: ah !== undefined ? "ah" : "vendor" });
      }
    }
    let revenue = 0;
    for (const output of recipe.outputs) {
      const price = priceByItemId.get(output.itemId) ?? revenueFloor.get(output.itemId);
      if (price === undefined) {
        missing.push(output.name);
      } else {
        revenue += output.quantity * price;
      }
    }
    if (missing.length > 0 || recipe.outputs.length === 0) {
      return { recipe, status: "missing", cost: 0, revenue: 0, profit: 0, marginPercent: 0, missing, materials };
    }
    revenue = Math.round(revenue * (1 - AH_CUT));
    const profit = revenue - cost;
    return {
      recipe,
      status: "ok",
      cost,
      revenue,
      profit,
      marginPercent: cost === 0 ? 0 : (profit / cost) * 100,
      missing: [],
      materials
    };
  });
  // 默认按利润率排序（计划口径）：可算的在最前、利润率从高到低；缺价
  // 的排最后（不参与利润排序）。
  return rows.sort((left, right) => {
    if (left.status !== right.status) return left.status === "ok" ? -1 : 1;
    if (left.status === "ok") return right.marginPercent - left.marginPercent;
    return left.recipe.name.localeCompare(right.recipe.name, "zh-CN");
  });
}
