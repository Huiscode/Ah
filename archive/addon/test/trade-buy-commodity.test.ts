// Commodities (herbs/ore/cloth/potions/mats) are bought as a price/quantity
// order, unlike items which are bought one whole listing at a time. The
// native commodity buy dialog lets the player choose how many to buy; the
// server fills the order cheapest-first across rungs and quotes the total
// before anything is bought. The WAH addon must offer that same quantity
// choice instead of blindly buying the cheapest rung's whole stack.
//
// Flow: click buy -> QueryForItem -> COMMODITY_SEARCH_RESULTS_UPDATED opens
// the quantity dialog -> choose a quantity -> StartCommoditiesPurchase ->
// COMMODITY_PRICE_UPDATED quotes the total -> it matches the client estimate
// -> ConfirmCommoditiesPurchase -> COMMODITY_PURCHASE_SUCCEEDED.

import { describe, expect, it } from "vitest";
import { loadAddon, type WowLua } from "./wow-lua";

const MAGEWEAVE = 4338;
const MED7 = 110000; // median of the closes below
const CLOSES = [100000, 110000, 120000];

// Cheapest-first rungs the live server would report.
const RUNGS = [
  { unitPrice: 70000, quantity: 10 },
  { unitPrice: 75000, quantity: 20 },
  { unitPrice: 78000, quantity: 30 }
];

function page(): WowLua {
  const lua = loadAddon();
  lua.setScan([
    { itemId: MAGEWEAVE, name: "Mageweave Cloth", minPrice: 70000, numAuctions: 3 }
  ]);
  lua.setPoints([{ itemId: MAGEWEAVE, closes: CLOSES }]);
  lua.openTab();
  return lua;
}

// Search (switching the panel from deal radar to result rows), then click
// buy on the first row and land the commodity results, which opens the
// quantity dialog.
function openBuyDialog(lua: WowLua) {
  lua.search("Mageweave");
  lua.setCommodityResults(MAGEWEAVE, RUNGS);
  lua.buyRow(1);
  lua.flushQueries();
}

describe("commodity quantity dialog", () => {
  it("opens with the cheapest rung's full quantity preselected", () => {
    const lua = page();
    openBuyDialog(lua);
    expect(lua.dialogVisible()).toBe(true);
    // Default quantity = 10 (the cheapest rung), total = 10 * 70000.
    expect(lua.dialogTotal()).toBe("70g 0s 0c");
  });

  it("fills across rungs cheapest-first and recomputes the total", () => {
    const lua = page();
    openBuyDialog(lua);
    // 15 units = 10 @ 70000 + 5 @ 75000 = 700000 + 375000 = 1075000.
    lua.setBuyQuantity(15);
    expect(lua.dialogTotal()).toBe("107g 50s 0c");
  });

  it("spans all three rungs for a large quantity", () => {
    const lua = page();
    openBuyDialog(lua);
    // 40 units = 10 @ 70000 + 20 @ 75000 + 10 @ 78000
    //          = 700000 + 1500000 + 780000 = 2980000.
    lua.setBuyQuantity(40);
    expect(lua.dialogTotal()).toBe("298g 0s 0c");
  });

  it("refuses a quantity the rungs cannot fully cover", () => {
    const lua = page();
    openBuyDialog(lua);
    // 60 units are available; 61 is not. The total shows a dash and the
    // confirm button is disabled.
    lua.setBuyQuantity(61);
    expect(lua.dialogTotal()).toBe("-");
  });

  it("buys the chosen quantity and reprices the scan to the next rung", () => {
    const lua = page();
    openBuyDialog(lua);
    lua.setBuyQuantity(15);
    lua.confirmBuyDialog();
    lua.flushQueries(); // server quote lands and is auto-confirmed
    lua.flushQueries(); // purchase success resolves
    // The dialog closes on success...
    expect(lua.dialogVisible()).toBe(false);
    // ...and the cheapest surviving rung (75000) becomes the new minimum.
    expect(lua.scanMin(MAGEWEAVE)).toBe(75000);
  });

  it("drops the item from the scan once every rung is consumed", () => {
    const lua = page();
    openBuyDialog(lua);
    lua.setBuyQuantity(60); // buy the whole book
    lua.confirmBuyDialog();
    lua.flushQueries(); // quote
    lua.flushQueries(); // success
    expect(lua.scanned(MAGEWEAVE)).toBe(false);
  });
});
