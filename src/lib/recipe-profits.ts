// P0-B: full-recipe profit engine over the recipe library dumped by the
// in-game /wahrecipes command. Unlike the curated static table (crafting.ts,
// kept for its tests), recipes here carry zero- or multi-product outputs and
// ride the vendor floor (vendorP) the addon dumped for every touched item.
//
// Price priority for a craft, per the P0-B plan:
//   1. live AH price — the market signal already resolves 自扫 P10 → 网站
//      P50 by the newest source, so the caller passes that map as-is;
//   2. vendor floor — buildFloorPriceIndex merges three sources with the
//      addon dump on top (it is the freshest client read, and the only
//      source that carries Forever-only items before their public IDs land):
//      curated dictionary (vendor-prices.ts) < DB Item.vendorPrice < dump.
import { vendorPriceById } from "@/data/vendor-prices";
import { AH_CUT } from "@/lib/market-rules";

export type RecipeMaterial = {
  itemId: number;
  name: string;
  quantity: number;
  vendorPrice?: number; // NPC SellPrice in copper, dumped by /wahrecipes
  // wx-wow 种子附加的物品属性（扫描配方无）：品质 0-7 / 物品等级 / 需要等级。
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
  // "craft" = professional craft (seeded from the wx-wow 无限服 library or
  // /wahrecipes dumps); "merchant" = merchant-favor exchange (集市商人).
  category?: "craft" | "merchant";
  // 商人兑换的青睐货币成本（currency 3402，无铜币汇率）；craft 为 0。
  favorCost?: number;
  // wx-wow 种子附加信息：技能四档难度 [学,黄,绿,灰]（0=未记录）、
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

// wx-wow 种子里个别分类名漏了中译，在这里补显示层映射。
const CATEGORY_EN_TO_ZH: Record<string, string> = {
  "Thrown": "投掷武器",
  "Armor Food": "护甲食物"
};

export const categoryLabel = (category: string): string =>
  CATEGORY_EN_TO_ZH[category] ?? category;

// Floor-price index for a recipe library: curated dictionary first, then any
// Item.vendorPrice the DB carries, then the addon-dumped vendorP (freshest,
// and the only coverage for Forever-only item IDs). Later sources overwrite
// earlier ones.
export function buildFloorPriceIndex(
  recipes: DbRecipe[],
  itemVendorPrices: ReadonlyMap<number, number> = new Map()
): Map<number, number> {
  const floor = new Map<number, number>();
  for (const [itemId, entry] of vendorPriceById) {
    floor.set(itemId, entry.sellPriceCopper);
  }
  for (const [itemId, price] of itemVendorPrices) {
    if (price > 0) floor.set(itemId, price);
  }
  for (const recipe of recipes) {
    for (const material of [...recipe.reagents, ...recipe.outputs]) {
      if (material.vendorPrice !== undefined && material.vendorPrice > 0) {
        floor.set(material.itemId, material.vendorPrice);
      }
    }
  }
  return floor;
}

export function computeRecipeProfits(
  recipes: DbRecipe[],
  priceByItemId: Map<number, number>,
  floorPriceById: Map<number, number>
): RecipeProfitRow[] {
  const rows = recipes.map<RecipeProfitRow>((recipe) => {
    const missing: string[] = [];
    const materials: MaterialPrice[] = [];
    let cost = 0;
    for (const material of recipe.reagents) {
      const ah = priceByItemId.get(material.itemId);
      const floor = floorPriceById.get(material.itemId);
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
      const price = priceByItemId.get(output.itemId) ?? floorPriceById.get(output.itemId);
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
