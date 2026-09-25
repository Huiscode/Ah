// Trade rows had no hover handler at all, so the one page in the addon
// dedicated to deciding what to buy was the one place its own price data
// could not be read. These tests pin what a row points the client's tooltip
// at -- the item the row shows, never a position -- and that GUI.lua's price
// block rides along through the hooks it already installs.
//
// The retail port has no per-listing auction index to point at: a search row
// is an item aggregated from the scan, exactly like a deal row, so both aim
// the tooltip at the item itself.

import { describe, expect, it } from "vitest";
import { loadAddon, type WowLua } from "./wow-lua";

const MAGEWEAVE = 4338;

const LISTINGS = [
  { itemId: MAGEWEAVE, name: "Mageweave Cloth", count: 20, buyout: 200000 },
  { itemId: MAGEWEAVE, name: "Mageweave Cloth", count: 20, buyout: 160000 }
];

function tradePage(): WowLua {
  const lua = loadAddon();
  lua.setScan([{ itemId: MAGEWEAVE, name: "Mageweave Cloth", minPrice: 8000, numAuctions: 6 }]);
  lua.setPoints([{ itemId: MAGEWEAVE, closes: [10000, 11000, 12000] }]);
  lua.openTab();
  return lua;
}

describe("row tooltips", () => {
  it("aims a search row at the item, not at the row's position", () => {
    const lua = tradePage();
    lua.search("Mageweave", LISTINGS);
    lua.hoverRow(1);
    expect(lua.tooltipSource()).toBe(`hyperlink:item:${MAGEWEAVE}`);
  });

  it("carries the price block the four-column table has no room for", () => {
    const lua = tradePage();
    lua.search("Mageweave", LISTINGS);
    lua.hoverRow(1);
    // Routing through the client's own item tooltip is the point: GUI.lua
    // already hooks every tooltip setter, so the scan and history section
    // appends itself with no second code path to keep in step.
    expect(lua.tooltipText()).toContain("最低价");
    expect(lua.tooltipText()).toContain("7日P10中位");
  });

  it("aims a deal row at the same item", () => {
    // A radar row is built from scan data, so there is no auction index to
    // point at -- only the item, the same item a search row points at.
    const lua = tradePage();
    lua.hoverRow(1);
    expect(lua.tooltipSource()).toBe(`hyperlink:item:${MAGEWEAVE}`);
    expect(lua.tooltipText()).toContain("最低价");
  });

  it("hides the tooltip when the cursor leaves the row", () => {
    const lua = tradePage();
    lua.hoverRow(1);
    expect(lua.tooltipShown()).toBe(true);
    lua.leaveRow(1);
    expect(lua.tooltipShown()).toBe(false);
  });
});
