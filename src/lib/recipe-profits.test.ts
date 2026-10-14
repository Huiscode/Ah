// P0-B profit engine: live AH price first, cost floor second (NPC sell price
// over buy price), revenue floor (buy price) for the revenue side. Pins the
// price priority, multi-product revenue, AH cut and the margin-first ordering.
import { describe, expect, it } from "vitest";
import { buildRecipeFloors, computeRecipeProfits, type DbRecipe } from "@/lib/recipe-profits";
import { vendorPriceById } from "@/data/vendor-prices";

const LINEN_BOLT = 2840; // 铜锭, classic floor 10c
const LINEN_CLOTH = 2770; // 铜矿石, classic floor 5c
const IRON_ORE = 2772; // 铁矿石, classic floor 150c
const COAL = 3857; // 煤块, classic floor 125c

function priceMap(entries: Array<[number, number]>): Map<number, number> {
  return new Map(entries);
}

describe("computeRecipeProfits", () => {
  const copper: DbRecipe = {
    name: "铜锭",
    profession: "采矿",
    skillLevel: 1,
    reagents: [{ itemId: LINEN_CLOTH, name: "铜矿石", quantity: 1 }],
    outputs: [{ itemId: LINEN_BOLT, name: "铜锭", quantity: 1 }]
  };

  it("charges the AH cut on the revenue side and reports margin on cost", () => {
    const rows = computeRecipeProfits([copper], priceMap([[LINEN_CLOTH, 5], [LINEN_BOLT, 20]]), new Map(), new Map());
    expect(rows[0].status).toBe("ok");
    expect(rows[0].cost).toBe(5);
    expect(rows[0].revenue).toBe(19); // 20 * (1 - 0.05)
    expect(rows[0].profit).toBe(14);
    expect(rows[0].marginPercent).toBeCloseTo(280, 5);
  });

  it("falls back to the vendor floor when a side has no live AH price", () => {
    const floors = buildRecipeFloors([], new Map());
    const rows = computeRecipeProfits([copper], priceMap([]), floors.costFloor, floors.revenueFloor);
    // 铜矿石 floor 5c, 铜锭 floor 10c -> revenue 9.5 -> 10, profit 5.
    expect(rows[0].status).toBe("ok");
    expect(rows[0].cost).toBe(5);
    expect(rows[0].revenue).toBe(10);
    expect(rows[0].profit).toBe(5);
  });

  it("marks a craft missing when a material has neither market price nor floor", () => {
    const rows = computeRecipeProfits([copper], priceMap([[LINEN_BOLT, 20]]), new Map(), new Map());
    expect(rows[0].status).toBe("missing");
    expect(rows[0].missing).toEqual(["铜矿石"]);
  });

  it("sums every output of a multi-product recipe", () => {
    const multi: DbRecipe = {
      name: "双产物",
      profession: "炼金",
      skillLevel: 100,
      reagents: [{ itemId: COAL, name: "煤块", quantity: 1 }],
      outputs: [
        { itemId: 1, name: "产物甲", quantity: 2 },
        { itemId: 2, name: "产物乙", quantity: 3 }
      ]
    };
    const rows = computeRecipeProfits(
      [multi],
      priceMap([[COAL, 100], [1, 10], [2, 20]]),
      new Map(),
      new Map()
    );
    expect(rows[0].status).toBe("ok");
    expect(rows[0].revenue).toBe(Math.round((2 * 10 + 3 * 20) * 0.95)); // (20+60)*0.95 = 76
    expect(rows[0].cost).toBe(100);
    expect(rows[0].profit).toBe(76 - 100);
  });

  it("sorts computable rows by margin descending and pushes missing rows last", () => {
    const highMargin: DbRecipe = { ...copper, name: "高利" };
    const lowMargin: DbRecipe = {
      ...copper,
      name: "低利",
      reagents: [{ itemId: IRON_ORE, name: "铁矿石", quantity: 1 }],
      outputs: [{ itemId: 99, name: "铁制品", quantity: 1 }]
    };
    const noData: DbRecipe = {
      ...copper,
      name: "缺价",
      reagents: [{ itemId: 424242, name: "幽灵材料", quantity: 1 }],
      outputs: [{ itemId: LINEN_BOLT, name: "铜锭", quantity: 1 }]
    };
    const prices = priceMap([[LINEN_CLOTH, 5], [LINEN_BOLT, 20], [IRON_ORE, 200], [99, 210]]);
    const rows = computeRecipeProfits([noData, lowMargin, highMargin], prices, new Map(), new Map());
    expect(rows.map((row) => row.recipe.name)).toEqual(["高利", "低利", "缺价"]);
  });
});

describe("buildRecipeFloors", () => {
  it("merges the curated dictionary, DB vendor prices and the addon dump, dump on top", () => {
    const dumpRecipe: DbRecipe = {
      name: "重瑟银锭",
      profession: "采矿",
      skillLevel: 300,
      reagents: [{ itemId: 900001, name: "重瑟银矿", quantity: 1, vendorPrice: 375 }],
      outputs: [{ itemId: 900002, name: "重瑟银锭", quantity: 1, vendorPrice: 2500 }]
    };
    const dbPrices = new Map<number, number>([[900001, 300]]);
    const floors = buildRecipeFloors([dumpRecipe], dbPrices);
    // Classic dictionary values survive in both floors.
    expect(floors.costFloor.get(LINEN_CLOTH)).toBe(vendorPriceById.get(LINEN_CLOTH)?.sellPriceCopper);
    expect(floors.revenueFloor.get(LINEN_CLOTH)).toBe(vendorPriceById.get(LINEN_CLOTH)?.sellPriceCopper);
    // The addon dump overwrites the DB value for the same item (freshest
    // client read) and adds the product floor to both floors.
    expect(floors.costFloor.get(900001)).toBe(375);
    expect(floors.revenueFloor.get(900001)).toBe(375);
    expect(floors.costFloor.get(900002)).toBe(2500);
    expect(floors.revenueFloor.get(900002)).toBe(2500);
  });

  it("lets the NPC sell price override the buy price on the cost floor only", () => {
    const floors = buildRecipeFloors([], new Map([[1, 100]]), new Map([[1, 300]]));
    expect(floors.costFloor.get(1)).toBe(300); // 材料成本按 NPC 卖价
    expect(floors.revenueFloor.get(1)).toBe(100); // 收入兜底仍按收购价
  });

  it("ignores zero vendor prices from any source", () => {
    const floors = buildRecipeFloors([], new Map([[LINEN_CLOTH, 0]]), new Map([[LINEN_CLOTH, 0]]));
    expect(floors.costFloor.get(LINEN_CLOTH)).toBe(5); // dictionary value, not 0
    expect(floors.revenueFloor.get(LINEN_CLOTH)).toBe(5);
  });
});
