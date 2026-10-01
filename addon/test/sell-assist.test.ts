// The sell-assist panel ("出售助手") sits beside the radar while an item is
// in the sell slot. It must clear its text and close the moment the slot is
// empty -- including the moment a deal is won ("小刀拿下"). Three things used
// to keep it on screen:
//   1) the SetItem/ClearPost handlers were defined before the sellAssist
//      local was declared, so they bound to a nil global and every close
//      path died silently inside its pcall;
//   2) the poll's `itemId` was an undeclared global, so it kept the first
//      item's ID forever and re-armed the panel after the hooks closed it;
//   3) ItemDisplay:GetItemID() returns a stale ID after removal, and the
//      poll trusted that ID instead of re-verifying the ItemLocation.
//
// These tests drive the panel through the classic sell-slot API, through a
// mock retail ItemSellFrame with a stale ItemDisplay, and through both buy
// success paths.

import { describe, expect, it } from "vitest";
import { loadAddon, type WowLua } from "./wow-lua";

const MAGEWEAVE = 4338;
const LINEN = 2589;
const CLOSES = [100000, 110000, 120000];
const SLOT_ITEM = 3413;

function page(): WowLua {
  const lua = loadAddon();
  lua.setScan([
    { itemId: MAGEWEAVE, name: "Mageweave Cloth", minPrice: 70000, numAuctions: 6 }
  ]);
  lua.setPoints([
    { itemId: MAGEWEAVE, closes: CLOSES },
    { itemId: LINEN, closes: CLOSES }
  ]);
  lua.openTab();
  return lua;
}

describe("sell assist via the classic sell-slot API", () => {
  it("shows while an item sits in the sell slot", () => {
    const lua = page();
    lua.setSellItem(SLOT_ITEM, "物品", 1);
    lua.pollSellAssist();
    expect(lua.sellAssistVisible()).toBe(true);
    expect(lua.sellAssistTitle()).toBe("出售助手: 物品");
  });

  it("clears its text and closes once the sell slot is empty", () => {
    const lua = page();
    lua.setSellItem(SLOT_ITEM, "物品", 1);
    lua.pollSellAssist();
    lua.clearSellItem();
    lua.pollSellAssist();
    expect(lua.sellAssistVisible()).toBe(false);
    expect(lua.sellAssistTitle()).toBe("");
  });
});

describe("a stale ItemDisplay cannot resurrect the panel", () => {
  it("backfills the item already in the slot, then closes when it is taken back", () => {
    const lua = page();
    lua.installItemSellFrame(SLOT_ITEM, "物品");
    // First poll: installs the hooks and backfills the state from the
    // ItemDisplay (which already reports the item).
    lua.pollSellAssist();
    expect(lua.sellAssistVisible()).toBe(true);
    // The item is taken back: ClearPost routes through SetItem(nil).
    lua.sellFrameClearPost();
    expect(lua.sellAssistVisible()).toBe(false);
    // GetItemID still returns the removed ID, but later polls must keep
    // the panel closed instead of re-reading it.
    lua.pollSellAssist();
    expect(lua.sellAssistVisible()).toBe(false);
    expect(lua.sellAssistTitle()).toBe("");
  });

  it("closes when the captured ItemLocation stops existing", () => {
    const lua = page();
    lua.installItemSellFrame(SLOT_ITEM, "物品");
    lua.pollSellAssist(); // backfill (no captured location yet)
    // A real item is placed.
    lua.sellFrameSetItem("ok");
    expect(lua.sellAssistVisible()).toBe(true);
    // The slot now reports a location that no longer exists.
    lua.sellFrameSetItem("gone");
    expect(lua.sellAssistVisible()).toBe(false);
    // The next poll must not bring it back either.
    lua.pollSellAssist();
    expect(lua.sellAssistVisible()).toBe(false);
  });
});

describe("winning a deal clears and closes the sell assist", () => {
  it("item buyout path: closes on AUCTION_HOUSE_PURCHASE_COMPLETED", () => {
    const lua = page();
    lua.setSellItem(SLOT_ITEM, "物品", 1);
    lua.pollSellAssist();
    expect(lua.sellAssistVisible()).toBe(true);
    // Buy a different item (Mageweave) through the item flow.
    lua.search("Mageweave");
    lua.setSearchResults(MAGEWEAVE, [
      { auctionID: 1, itemID: MAGEWEAVE, quantity: 10, buyoutAmount: 700000, containsOwnerItem: false }
    ]);
    lua.buyRow(1);
    lua.flushQueries();    // results land, dialog opens
    lua.confirmBuyDialog(); // PlaceBuyout -> purchase completed
    lua.flushQueries();
    // The panel is closed the moment the deal is won...
    expect(lua.sellAssistVisible()).toBe(false);
    // ...and with the sell slot now empty, later polls keep it closed.
    lua.clearSellItem();
    lua.pollSellAssist();
    expect(lua.sellAssistVisible()).toBe(false);
  });

  it("commodity path: closes on COMMODITY_PURCHASE_SUCCEEDED", () => {
    const lua = page();
    lua.setSellItem(SLOT_ITEM, "物品", 1);
    lua.pollSellAssist();
    expect(lua.sellAssistVisible()).toBe(true);
    // Commodity flow: results open the quantity dialog.
    lua.search("Mageweave");
    lua.setCommodityResults(MAGEWEAVE, [
      { unitPrice: 70000, quantity: 10 },
      { unitPrice: 75000, quantity: 20 }
    ]);
    lua.buyRow(1);
    lua.flushQueries();
    lua.setBuyQuantity(15);
    lua.confirmBuyDialog();
    lua.flushQueries(); // server quote, auto-confirmed
    lua.flushQueries(); // purchase succeeded
    expect(lua.sellAssistVisible()).toBe(false);
    lua.clearSellItem();
    lua.pollSellAssist();
    expect(lua.sellAssistVisible()).toBe(false);
  });
});
