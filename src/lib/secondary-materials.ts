// 中间材料利润：次级材料 = 由配方合成/分解而来（craft 配方产物），且被至少
// 一个其它配方用作材料的物品（亚麻卷、铜锭、魔法精华等）——它们是供应链里
// 的中间产物，价值由「最低成本做出来 → 按市价卖掉」决定。
//
// 口径：
//   - 生产者：仅 craft 配方（category ≠ "merchant"）。集市商人兑换是"兑换"不是
//     "合成"，不参与制作方；但兑换配方消耗的材料同样计入「被使用」次数。
//   - 单位成本：取所有可计价制作配方中单位成本最低的一个（总成本 ÷ 该配方中
//     该材料的产出数量）。
//   - 单位收入：材料自身单价（实时 AH 价 自扫P10→网站P50，或 NPC 保底价）
//     × (1 − 拍卖税)。
//   - 单位利润 = 单位收入 − 单位成本；利润率 = 单位利润 ÷ 单位成本。
import { AH_CUT } from "@/lib/market-rules";
import type { DbRecipe, RecipeMaterial } from "@/lib/recipe-profits";

export type SecondaryMaterialRow = {
  item: RecipeMaterial; // 材料本体（含品质/名称）
  usageCount: number; // 被多少个配方用作材料
  producingRecipes: number; // 可制作它的 craft 配方数
  unitPrice: number; // 材料单价（铜）
  priceSource: "ah" | "vendor"; // 材料单价的来源
  unitCost: number; // 最便宜制作方式的单位成本（铜）
  craftRecipe: DbRecipe; // 该最便宜制作配方（悬停展示链路）
  unitProfit: number; // 单位利润（铜，取整）
  marginPercent: number; // 利润率（%）
};

export function buildSecondaryMaterialRows(
  recipes: DbRecipe[],
  priceByItemId: Map<number, number>,
  floorPriceById: Map<number, number>
): SecondaryMaterialRow[] {
  const craftRecipes = recipes.filter((recipe) => recipe.category !== "merchant");

  // 被使用次数：任何配方（含商人兑换）消耗该物品即计入。
  const usageCount = new Map<number, number>();
  for (const recipe of recipes) {
    for (const material of recipe.reagents) {
      usageCount.set(material.itemId, (usageCount.get(material.itemId) ?? 0) + 1);
    }
  }

  // 生产者：craft 配方按产出物登记（同一配方去重）。
  const producers = new Map<number, DbRecipe[]>();
  for (const recipe of craftRecipes) {
    const seen = new Set<number>();
    for (const output of recipe.outputs) {
      if (seen.has(output.itemId)) continue;
      seen.add(output.itemId);
      const list = producers.get(output.itemId);
      if (list) list.push(recipe);
      else producers.set(output.itemId, [recipe]);
    }
  }

  const rows: SecondaryMaterialRow[] = [];
  for (const [itemId, producing] of producers) {
    const usedBy = usageCount.get(itemId) ?? 0;
    if (usedBy === 0) continue; // 只保留会被其它配方消耗的中间产物

    let item: RecipeMaterial | undefined;
    for (const recipe of producing) {
      const output = recipe.outputs.find((candidate) => candidate.itemId === itemId);
      if (output) {
        item = output;
        break;
      }
    }
    if (!item) continue;

    // 最便宜制作方式：所有材料可计价（AH 价或保底价）的配方里，单位成本最低者。
    let best: { recipe: DbRecipe; cost: number; qty: number } | null = null;
    for (const recipe of producing) {
      let cost = 0;
      let complete = true;
      for (const material of recipe.reagents) {
        const unit = priceByItemId.get(material.itemId) ?? floorPriceById.get(material.itemId);
        if (unit === undefined) {
          complete = false;
          break;
        }
        cost += material.quantity * unit;
      }
      if (!complete) continue;
      const qty = recipe.outputs.find((output) => output.itemId === itemId)?.quantity ?? 0;
      if (qty <= 0) continue;
      if (!best || cost / qty < best.cost / best.qty) best = { recipe, cost, qty };
    }
    if (!best) continue; // 没有任何可计价制作方式

    const unitPrice = priceByItemId.get(itemId) ?? floorPriceById.get(itemId);
    if (unitPrice === undefined) continue; // 材料本身无价 → 无法算收入

    const unitRevenue = Math.round(unitPrice * (1 - AH_CUT));
    const unitCost = best.cost / best.qty;
    const unitProfit = Math.round(unitRevenue - unitCost);
    rows.push({
      item,
      usageCount: usedBy,
      producingRecipes: producing.length,
      unitPrice,
      priceSource: priceByItemId.has(itemId) ? "ah" : "vendor",
      unitCost,
      craftRecipe: best.recipe,
      unitProfit,
      marginPercent: unitCost === 0 ? 0 : (unitProfit / unitCost) * 100
    });
  }

  // 默认按利润率从高到低（赚钱的在前），同利润率按单位利润降序。
  return rows.sort(
    (left, right) => right.marginPercent - left.marginPercent || right.unitProfit - left.unitProfit
  );
}
