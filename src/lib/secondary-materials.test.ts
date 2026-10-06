import { describe, expect, it } from "vitest";
import { buildSecondaryMaterialRows } from "@/lib/secondary-materials";
import type { DbRecipe } from "@/lib/recipe-profits";

const craft = (name: string, reagents: DbRecipe["reagents"], outputs: DbRecipe["outputs"]): DbRecipe => ({
  name,
  profession: "Tailoring",
  skillLevel: 1,
  reagents,
  outputs,
  category: "craft"
});

const merchant = (name: string, reagents: DbRecipe["reagents"], outputs: DbRecipe["outputs"]): DbRecipe => ({
  name,
  profession: "General",
  skillLevel: 0,
  reagents,
  outputs,
  category: "merchant"
});

const M = (itemId: number, name: string, quantity: number) => ({ itemId, name, quantity });

describe("buildSecondaryMaterialRows", () => {
  const ore = M(1, "铜矿石", 2);
  const bar = M(2, "铜锭", 1);
  const chest = M(3, "铜质胸甲", 1);
  const cloth = M(4, "亚麻布", 2);
  const bolt = M(5, "亚麻卷", 2);
  const bag = M(6, "亚麻包", 1);
  const favorTrinket = M(7, "青睐饰品", 1);

  const recipes: DbRecipe[] = [
    craft("熔炼铜锭", [ore], [bar]),
    craft("锻造铜质胸甲", [bar], [chest]),
    craft("织亚麻卷", [cloth], [bolt]),
    craft("缝亚麻包", [bolt], [bag]),
    merchant("商人兑换", [bolt], [favorTrinket])
  ];

  const prices = new Map<number, number>([
    [1, 10], // 铜矿石
    [2, 40], // 铜锭
    [3, 200], // 胸甲
    [4, 5], // 亚麻布
    [5, 50], // 亚麻卷
    [6, 300], // 包
    [7, 1] // 兑换品
  ]);

  it("只保留「配方产物且被其它配方用作材料」的物品", () => {
    const rows = buildSecondaryMaterialRows(recipes, prices, new Map());
    const ids = rows.map((row) => row.item.itemId).sort((a, b) => a - b);
    // 铜锭：被胸甲配方使用；亚麻卷：被亚麻包和商人兑换使用。
    expect(ids).toEqual([2, 5]);
  });

  it("按最便宜制作方式摊算单位成本，税率计入售价", () => {
    const rows = buildSecondaryMaterialRows(recipes, prices, new Map());
    const bar = rows.find((row) => row.item.itemId === 2)!;
    expect(bar.unitCost).toBe(20); // 2×铜矿石10 ÷ 1 单位
    expect(bar.unitProfit).toBe(38 - 20); // round(40×0.95) − 20
    expect(bar.priceSource).toBe("ah");
    const bolt = rows.find((row) => row.item.itemId === 5)!;
    expect(bolt.unitCost).toBe(5); // 2×亚麻布5 ÷ 2 单位
    expect(bolt.usageCount).toBe(2); // 亚麻包 + 商人兑换
    expect(bolt.producingRecipes).toBe(1);
  });

  it("商人兑换配方的产出不参与制作方", () => {
    const rows = buildSecondaryMaterialRows(recipes, prices, new Map());
    expect(rows.some((row) => row.item.itemId === 7)).toBe(false);
  });

  it("在多个可制作配方中选单位成本最低者", () => {
    const recipes2: DbRecipe[] = [...recipes, craft("粗制铜锭", [M(1, "铜矿石", 4)], [bar])];
    const rows = buildSecondaryMaterialRows(recipes2, prices, new Map());
    const barRow = rows.find((row) => row.item.itemId === 2)!;
    expect(barRow.craftRecipe.name).toBe("熔炼铜锭"); // 2×10 < 4×10
    expect(barRow.producingRecipes).toBe(2);
  });

  it("按利润率降序排列", () => {
    const rows = buildSecondaryMaterialRows(recipes, prices, new Map());
    const margins = rows.map((row) => row.marginPercent);
    expect([...margins].sort((a, b) => b - a)).toEqual(margins);
  });
});
