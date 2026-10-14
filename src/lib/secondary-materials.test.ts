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
  const ore = M(1, "é“œçŸ¿çŸ³", 2);
  const bar = M(2, "é“œé”­", 1);
  const chest = M(3, "é“œè´¨èƒ¸ç”²", 1);
  const cloth = M(4, "äºšéº»å¸ƒ", 2);
  const bolt = M(5, "äºšéº»å·", 2);
  const bag = M(6, "äºšéº»åŒ…", 1);
  const favorTrinket = M(7, "é’çé¥°å“", 1);

  const recipes: DbRecipe[] = [
    craft("ç†”ç‚¼é“œé”­", [ore], [bar]),
    craft("é”»é€ é“œè´¨èƒ¸ç”²", [bar], [chest]),
    craft("ç»‡äºšéº»å·", [cloth], [bolt]),
    craft("ç¼äºšéº»åŒ…", [bolt], [bag]),
    merchant("å•†äººå…‘æ¢", [bolt], [favorTrinket])
  ];

  const prices = new Map<number, number>([
    [1, 10], // é“œçŸ¿çŸ³
    [2, 40], // é“œé”­
    [3, 200], // èƒ¸ç”²
    [4, 5], // äºšéº»å¸ƒ
    [5, 50], // äºšéº»å·
    [6, 300], // åŒ…
    [7, 1] // å…‘æ¢å“
  ]);

  it("åªä¿ç•™ã€Œé…æ–¹äº§ç‰©ä¸”è¢«å…¶å®ƒé…æ–¹ç”¨ä½œææ–™ã€çš„ç‰©å“", () => {
    const rows = buildSecondaryMaterialRows(recipes, prices, new Map(), new Map());
    const ids = rows.map((row) => row.item.itemId).sort((a, b) => a - b);
    // é“œé”­ï¼šè¢«èƒ¸ç”²é…æ–¹ä½¿ç”¨ï¼›äºšéº»å·ï¼šè¢«äºšéº»åŒ…å’Œå•†äººå…‘æ¢ä½¿ç”¨ã€‚
    expect(ids).toEqual([2, 5]);
  });

  it("æŒ‰æœ€ä¾¿å®œåˆ¶ä½œæ–¹å¼æ‘Šç®—å•ä½æˆæœ¬ï¼Œç¨ŽçŽ‡è®¡å…¥å”®ä»·", () => {
    const rows = buildSecondaryMaterialRows(recipes, prices, new Map(), new Map());
    const bar = rows.find((row) => row.item.itemId === 2)!;
    expect(bar.unitCost).toBe(20); // 2Ã—é“œçŸ¿çŸ³10 Ã· 1 å•ä½
    expect(bar.unitProfit).toBe(38 - 20); // round(40Ã—0.95) âˆ’ 20
    expect(bar.priceSource).toBe("ah");
    const bolt = rows.find((row) => row.item.itemId === 5)!;
    expect(bolt.unitCost).toBe(5); // 2Ã—äºšéº»å¸ƒ5 Ã· 2 å•ä½
    expect(bolt.usageCount).toBe(2); // äºšéº»åŒ… + å•†äººå…‘æ¢
    expect(bolt.producingRecipes).toBe(1);
  });

  it("å•†äººå…‘æ¢é…æ–¹çš„äº§å‡ºä¸å‚ä¸Žåˆ¶ä½œæ–¹", () => {
    const rows = buildSecondaryMaterialRows(recipes, prices, new Map(), new Map());
    expect(rows.some((row) => row.item.itemId === 7)).toBe(false);
  });

  it("åœ¨å¤šä¸ªå¯åˆ¶ä½œé…æ–¹ä¸­é€‰å•ä½æˆæœ¬æœ€ä½Žè€…", () => {
    const recipes2: DbRecipe[] = [...recipes, craft("ç²—åˆ¶é“œé”­", [M(1, "é“œçŸ¿çŸ³", 4)], [bar])];
    const rows = buildSecondaryMaterialRows(recipes2, prices, new Map(), new Map());
    const barRow = rows.find((row) => row.item.itemId === 2)!;
    expect(barRow.craftRecipe.name).toBe("ç†”ç‚¼é“œé”­"); // 2Ã—10 < 4Ã—10
    expect(barRow.producingRecipes).toBe(2);
  });

  it("æŒ‰åˆ©æ¶¦çŽ‡é™åºæŽ’åˆ—", () => {
    const rows = buildSecondaryMaterialRows(recipes, prices, new Map(), new Map());
    const margins = rows.map((row) => row.marginPercent);
    expect([...margins].sort((a, b) => b - a)).toEqual(margins);
  });
});

