// P0-B /wahrecipes: the in-game trade-skill window is the only source of
// the 600+ new recipes, so the dump logic (walk headers, read reagents and
// results, merge across professions, ride vendor floors along) is pinned
// here under fengari with a scripted skill window.
import { describe, expect, it } from "vitest";
import { loadAddon, type WowLua } from "./wow-lua";

// A reagent/result fixture: name, count and the client-formatted item link.
const LINK = (id: number, name: string) => `|Hitem:${id}:0:0:0|h[${name}]|h`;

function miningWindow(): unknown[] {
  return [
    { name: "采矿", isHeader: true, rank: 300 },
    {
      name: "铜锭", rank: 1,
      reagents: [{ name: "铜矿石", count: 1, link: LINK(2770, "铜矿石") }],
      results: [{ name: "铜锭", count: 1, link: LINK(2840, "铜锭") }]
    },
    {
      name: "钢锭", rank: 125,
      reagents: [
        { name: "铁锭", count: 1, link: LINK(3575, "铁锭") },
        { name: "煤块", count: 1, link: LINK(3857, "煤块") }
      ],
      results: [{ name: "钢锭", count: 1, link: LINK(3859, "钢锭") }]
    }
  ];
}

// Nested headers: the first header names the profession, the second is a
// sub-group; recipes sit under the group and must keep the profession name.
function smithingWindow(): unknown[] {
  return [
    { name: "锻造", isHeader: true, rank: 200 },
    { name: "熔炼", isHeader: true, rank: 200 },
    {
      name: "黑铁锭", rank: 230,
      reagents: [{ name: "黑铁矿石", count: 8, link: LINK(11370, "黑铁矿石") }],
      results: [{ name: "黑铁锭", count: 1, link: LINK(11371, "黑铁锭") }]
    }
  ];
}

function recipeField(lua: WowLua, key: string, field: string): string | number | boolean | null {
  return lua.eval(`WowTest.recipes()[${JSON.stringify(key)}] and WowTest.recipes()[${JSON.stringify(key)}].${field}`);
}

describe("/wahrecipes dump", () => {
  it("collects recipes from the open window with reagents, results and skill requirement", () => {
    const lua = loadAddon();
    lua.setTradeSkills(miningWindow());
    lua.dumpRecipes();

    expect(lua.recipeCount()).toBe(2);
    expect(recipeField(lua, "采矿|铜锭", "profession")).toBe("采矿");
    expect(recipeField(lua, "采矿|铜锭", "skillLevel")).toBe(1);
    expect(lua.text(`WowTest.recipes()["采矿|铜锭"].reagents[1].itemId`)).toBe("2770");
    expect(lua.text(`WowTest.recipes()["采矿|铜锭"].reagents[1].quantity`)).toBe("1");
    expect(lua.text(`WowTest.recipes()["采矿|铜锭"].outputs[1].itemId`)).toBe("2840");
    expect(recipeField(lua, "采矿|钢锭", "skillLevel")).toBe(125);
    expect(lua.text(`WowTest.recipes()["采矿|钢锭"].reagents[2].name`)).toBe("煤块");
  });

  it("rides the vendor floor of every touched item along with the recipe", () => {
    const lua = loadAddon();
    lua.exec(`WowTest.itemInfo[2770] = { vendorP = 5 }`);
    lua.exec(`WowTest.itemInfo[2840] = { vendorP = 10 }`);
    lua.setTradeSkills(miningWindow());
    lua.dumpRecipes();

    expect(lua.number(`WowTest.recipes()["采矿|铜锭"].reagents[1].vendorP`)).toBe(5);
    expect(lua.number(`WowTest.recipes()["采矿|铜锭"].outputs[1].vendorP`)).toBe(10);
    // Items the client has no info for ride without a vendorP, not as 0.
    expect(lua.eval(`WowTest.recipes()["采矿|钢锭"].reagents[1].vendorP`)).toBe(null);
  });

  it("a link with no item id degrades to itemId 0 instead of dropping the recipe", () => {
    const lua = loadAddon();
    lua.setTradeSkills([
      { name: "炼金", isHeader: true, rank: 300 },
      {
        name: "神秘转化", rank: 300,
        reagents: [{ name: "无链接材料", count: 2, link: "item:0:0:0" }],
        results: [{ name: "神秘产物", count: 1, link: undefined }]
      }
    ]);
    lua.dumpRecipes();

    expect(lua.recipeCount()).toBe(1);
    expect(lua.text(`WowTest.recipes()["炼金|神秘转化"].reagents[1].itemId`)).toBe("0");
    expect(lua.text(`WowTest.recipes()["炼金|神秘转化"].outputs[1].itemId`)).toBe("0");
  });

  it("nested sub-group headers keep the outer profession name", () => {
    const lua = loadAddon();
    lua.setTradeSkills(smithingWindow());
    lua.dumpRecipes();

    expect(lua.recipeCount()).toBe(1);
    expect(recipeField(lua, "锻造|黑铁锭", "profession")).toBe("锻造");
    expect(lua.text(`WowTest.recipes()["锻造|黑铁锭"].outputs[1].itemId`)).toBe("11371");
  });

  it("re-running for the second profession merges instead of replacing", () => {
    const lua = loadAddon();
    lua.setTradeSkills(miningWindow());
    lua.dumpRecipes();
    lua.setTradeSkills(smithingWindow());
    lua.dumpRecipes();

    expect(lua.recipeCount()).toBe(3);
    expect(recipeField(lua, "采矿|铜锭", "profession")).toBe("采矿");
    expect(recipeField(lua, "锻造|黑铁锭", "profession")).toBe("锻造");
  });

  it("re-running the same window overwrites the same-name recipe (idempotent)", () => {
    const lua = loadAddon();
    lua.setTradeSkills(miningWindow());
    lua.dumpRecipes();
    lua.setTradeSkills(miningWindow());
    lua.dumpRecipes();

    expect(lua.recipeCount()).toBe(2);
  });

  it("reports a clear message when the trade-skill window API is absent", () => {
    const lua = loadAddon({ locale: "enUS" });
    lua.exec("GetNumTradeSkills = nil");
    lua.dumpRecipes();
    expect(lua.lastChat()).toContain("GetNumTradeSkills");
  });

  it("reports a clear message when the window shows nothing", () => {
    const lua = loadAddon({ locale: "enUS" });
    lua.setTradeSkills([]);
    lua.dumpRecipes();
    expect(lua.lastChat()).toContain("No recipes read");
  });
});
