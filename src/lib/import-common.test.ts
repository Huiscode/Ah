// P0-B seed-migration planner: when an in-game /wahrecipes dump carries the
// client-locale (Chinese) name of a craft that the classic seed library stored
// under its English name, the English row must be deleted so the panel never
// lists the same craft twice. Identity = same profession + same sorted
// (itemId, quantity) signature of outputs and reagents.
import { describe, expect, it } from "vitest";
import { planRecipeMigrations, recipeIdentitySignature } from "@/lib/import-common";
import type { AddonRecipe } from "@/lib/addon-scan";

const copperBar: AddonRecipe = {
  name: "铜锭",
  profession: "Mining",
  skillLevel: 1,
  reagents: [{ itemId: 2770, name: "铜矿石", quantity: 1 }],
  outputs: [{ itemId: 2840, name: "铜锭", quantity: 1 }]
};

const copperBarEn: AddonRecipe = {
  ...copperBar,
  name: "Copper Bar"
};

const differentCraft: AddonRecipe = {
  name: "钢锭",
  profession: "Mining",
  skillLevel: 125,
  reagents: [{ itemId: 2771, name: "铁矿石", quantity: 1 }],
  outputs: [{ itemId: 2841, name: "钢锭", quantity: 1 }]
};

const sigOf = (recipe: AddonRecipe): string => recipeIdentitySignature(recipe);

describe("recipeIdentitySignature", () => {
  it("is order-insensitive across reagents and outputs", () => {
    const a: AddonRecipe = {
      ...copperBar,
      reagents: [{ itemId: 1, name: "甲", quantity: 2 }, { itemId: 2, name: "乙", quantity: 1 }],
      outputs: [{ itemId: 3, name: "丙", quantity: 4 }]
    };
    const b: AddonRecipe = {
      ...copperBar,
      reagents: [{ itemId: 2, name: "乙", quantity: 1 }, { itemId: 1, name: "甲", quantity: 2 }],
      outputs: [{ itemId: 3, name: "丙", quantity: 4 }]
    };
    expect(sigOf(a)).toBe(sigOf(b));
  });

  it("differs when a quantity or itemId changes", () => {
    const moreReagents: AddonRecipe = {
      ...copperBar,
      reagents: [{ itemId: 2770, name: "铜矿石", quantity: 2 }]
    };
    expect(sigOf(copperBar)).not.toBe(sigOf(moreReagents));
  });
});

describe("planRecipeMigrations", () => {
  const existing = (recipe: AddonRecipe, id: string) => ({
    id,
    name: recipe.name,
    profession: recipe.profession,
    reagents: recipe.reagents,
    outputs: recipe.outputs
  });

  it("deletes the English seed row when the same craft arrives in Chinese", () => {
    const deletes = planRecipeMigrations(
      [existing(copperBarEn, "seed-en")],
      [copperBar]
    );
    expect(deletes).toEqual(["seed-en"]);
  });

  it("keeps the row when the incoming name already matches (plain upsert path)", () => {
    const deletes = planRecipeMigrations(
      [existing(copperBar, "cn-row")],
      [copperBar]
    );
    expect(deletes).toEqual([]);
  });

  it("keeps rows whose craft signature differs from every incoming dump", () => {
    const deletes = planRecipeMigrations(
      [existing(copperBarEn, "seed-en"), existing(differentCraft, "steel-cn")],
      [copperBar]
    );
    expect(deletes).toEqual(["seed-en"]);
  });

  it("only migrates within the same profession", () => {
    const tailoringCopper: AddonRecipe = {
      ...copperBar,
      profession: "Tailoring"
    };
    const deletes = planRecipeMigrations(
      [existing(copperBarEn, "seed-mining")],
      [tailoringCopper]
    );
    expect(deletes).toEqual([]);
  });
});
