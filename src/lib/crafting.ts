// Craft profit engine plus the curated classic (WoW: Forever / infinite 60)
// recipe table. Quantities are curated seed data (verify in-game before
// trusting large positions); itemIds are authoritative, names are display
// labels. Recipes cover material processing that actually exists on the
// infinite realm — bars and bolts — not TBC-exclusive crafts whose mats can
// never appear in the market feed.

export type CraftRecipe = {
  name: string;
  productItemId: number;
  productQuantity: number;
  profession: string;
  materials: Array<{ itemId: number; name: string; quantity: number; vendorPriceCopper?: number }>;
};

export type CraftProfitRow = {
  recipe: CraftRecipe;
  status: "ok" | "missing";
  cost: number;
  revenue: number;
  profit: number;
  marginPercent: number;
  missing: string[];
};

const AH_CUT = 0.05; // neutral/faction AH cut on successful sales

export const craftRecipes: CraftRecipe[] = [
  // Bars (mining) — ore -> bar smelting, the leveling economy staple.
  {
    name: "铜锭",
    productItemId: 2840,
    productQuantity: 1,
    profession: "采矿",
    materials: [{ itemId: 2770, name: "铜矿石", quantity: 1 }]
  },
  {
    name: "锡锭",
    productItemId: 3576,
    productQuantity: 1,
    profession: "采矿",
    materials: [{ itemId: 2771, name: "锡矿石", quantity: 1 }]
  },
  {
    name: "青铜锭",
    productItemId: 2841,
    productQuantity: 2,
    profession: "采矿(熔合)",
    materials: [
      { itemId: 2840, name: "铜锭", quantity: 1 },
      { itemId: 3576, name: "锡锭", quantity: 1 }
    ]
  },
  {
    name: "银锭",
    productItemId: 2842,
    productQuantity: 1,
    profession: "采矿",
    materials: [{ itemId: 2775, name: "银矿石", quantity: 1 }]
  },
  {
    name: "铁锭",
    productItemId: 3575,
    productQuantity: 1,
    profession: "采矿",
    materials: [{ itemId: 2772, name: "铁矿石", quantity: 1 }]
  },
  {
    name: "秘银锭",
    productItemId: 3860,
    productQuantity: 1,
    profession: "采矿",
    materials: [{ itemId: 3858, name: "秘银矿石", quantity: 1 }]
  },
  {
    name: "真银锭",
    productItemId: 6037,
    productQuantity: 1,
    profession: "采矿",
    materials: [{ itemId: 7911, name: "真银矿石", quantity: 1 }]
  },
  {
    name: "瑟银锭",
    productItemId: 12359,
    productQuantity: 1,
    profession: "采矿",
    materials: [{ itemId: 10620, name: "瑟银矿石", quantity: 1 }]
  },

  // Bolts (tailoring) — cloth -> bolt.
  {
    name: "亚麻布卷",
    productItemId: 2996,
    productQuantity: 1,
    profession: "裁缝",
    materials: [{ itemId: 2589, name: "亚麻布", quantity: 2 }]
  },
  {
    name: "毛料卷",
    productItemId: 2997,
    productQuantity: 1,
    profession: "裁缝",
    materials: [{ itemId: 2592, name: "毛料", quantity: 3 }]
  },
  {
    name: "丝绸卷",
    productItemId: 4305,
    productQuantity: 1,
    profession: "裁缝",
    materials: [{ itemId: 4306, name: "丝绸", quantity: 4 }]
  },
  {
    name: "魔纹布卷",
    productItemId: 4339,
    productQuantity: 1,
    profession: "裁缝",
    materials: [{ itemId: 4338, name: "魔纹布", quantity: 3 }]
  },
  {
    name: "符文布卷",
    productItemId: 14048,
    productQuantity: 1,
    profession: "裁缝",
    materials: [{ itemId: 14047, name: "符文布", quantity: 5 }]
  }
];

export function computeCraftProfits(recipes: CraftRecipe[], priceByItemId: Map<number, number>): CraftProfitRow[] {
  const rows = recipes.map<CraftProfitRow>((recipe) => {
    const missing: string[] = [];
    let cost = 0;
    for (const material of recipe.materials) {
      const price = priceByItemId.get(material.itemId) ?? material.vendorPriceCopper;
      if (price === undefined) {
        missing.push(material.name);
      } else {
        cost += material.quantity * price;
      }
    }
    const productPrice = priceByItemId.get(recipe.productItemId);
    if (productPrice === undefined) missing.push(recipe.name);
    if (missing.length > 0) {
      return { recipe, status: "missing", cost: 0, revenue: 0, profit: 0, marginPercent: 0, missing };
    }
    const revenue = Math.round(recipe.productQuantity * productPrice! * (1 - AH_CUT));
    const profit = revenue - cost;
    return {
      recipe,
      status: "ok",
      cost,
      revenue,
      profit,
      marginPercent: cost === 0 ? 0 : (profit / cost) * 100,
      missing: []
    };
  });
  return rows.sort((left, right) => {
    if (left.status !== right.status) return left.status === "ok" ? -1 : 1;
    return right.profit - left.profit;
  });
}
