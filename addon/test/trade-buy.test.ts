// Buying the cheapest listing of an item makes the session's scan data a
// lie about that item, and the deal radar reads the scan as its record of
// what is listed right now. Only a full rescan ever rewrote it, so a bought
// deal kept reappearing in the radar at the price it no longer had.
//
// The retail buy path re-verifies live: startBuy issues a QueryForItem for
// the exact itemKey, the server answers asynchronously (ITEM_SEARCH_RESULTS_
// UPDATED), and finalizeBuy picks the cheapest valid buyout, purchases it,
// and writes the correction into the scan from the listings that are still
// live — never from a guess.

import { describe, expect, it } from "vitest";
import { loadAddon, type WowLua } from "./wow-lua";

const MAGEWEAVE = 4338;
const LINEN = 2589;
const MED7 = 110000; // median of the closes below; the radar's reference price

// 80000 is 27% under the reference, so it is a deal; the discount gate sits
// at 93500, which is what makes the second listing's price decisive.
const CLOSES = [100000, 110000, 120000];

type ResultRow = { auctionID: number; itemID: number; quantity: number; buyoutAmount: number; containsOwnerItem?: boolean };

function result(auctionID: number, unitPrice: number, itemId = MAGEWEAVE, options?: { owner?: boolean }): ResultRow {
  return {
    auctionID, itemID: itemId, quantity: 10,
    buyoutAmount: unitPrice * 10,
    containsOwnerItem: options?.owner ?? false
  };
}

function page(options?: { numAuctions?: number; extraScan?: unknown[] }): WowLua {
  const lua = loadAddon();
  lua.setScan([
    {
      itemId: MAGEWEAVE, name: "Mageweave Cloth",
      minPrice: 80000, numAuctions: options?.numAuctions ?? 6
    },
    ...(options?.extraScan ?? [])
  ]);
  lua.setPoints([
    { itemId: MAGEWEAVE, closes: CLOSES },
    { itemId: LINEN, closes: CLOSES }
  ]);
  lua.openTab();
  return lua;
}

// Search, then buy the cheapest row — which is row 1, because the results
// list defaults to ascending unit price. The stub queues the server answer;
// flushQueries() lands ITEM_SEARCH_RESULTS_UPDATED and finalizes the buy.
function buyCheapest(lua: WowLua, liveResults: ResultRow[]) {
  lua.search("Mageweave");
  lua.setSearchResults(MAGEWEAVE, liveResults);
  lua.buyRow(1);
  lua.flushQueries();
}

describe("a purchase corrects the scan the radar reads", () => {
  it("leaves the cheapest surviving listing as the item's new minimum", () => {
    const lua = page();
    // Two survivors, so "the cheapest one left" and "one of the ones left"
    // are different answers.
    buyCheapest(lua, [result(1, 80000), result(2, 90000), result(3, 85000)]);
    expect(lua.scanMin(MAGEWEAVE)).toBe(85000);
    // Still 22% under the reference, so it stays on the radar -- at the
    // price a player would actually pay now.
    lua.findDeals();
    expect(lua.names()).toEqual(["Mageweave Cloth"]);
    expect(lua.cell(1, 3)).toBe("8金 50银");
  });

  it("drops the item once the surviving price no longer clears the gate", () => {
    const lua = page();
    // 95000 is 14% under a reference of 110000: short of the 15% the radar
    // requires, so what is left is not a deal any more.
    buyCheapest(lua, [result(1, 80000), result(2, 95000)]);
    expect(lua.scanMin(MAGEWEAVE)).toBe(95000);
    lua.findDeals();
    expect(lua.names()).toEqual([]);
  });

  it("forgets the item entirely when its last listing is the one bought", () => {
    const lua = page();
    buyCheapest(lua, [result(1, 80000)]);
    // Every number in the entry described a book that no longer exists, and
    // a zeroed minimum would read as "free" on the tooltip.
    expect(lua.scanned(MAGEWEAVE)).toBe(false);
    lua.findDeals();
    expect(lua.names()).toEqual([]);
  });

  it("counts the bought listing out of the book's depth", () => {
    // Three auctions is exactly the liquidity floor, so buying one has to
    // take the item off the radar even though the price still qualifies.
    const lua = page({ numAuctions: 3 });
    buyCheapest(lua, [result(1, 80000), result(2, 85000)]);
    expect(lua.scanAuctions(MAGEWEAVE)).toBe(2);
    lua.findDeals();
    expect(lua.names()).toEqual([]);
  });

  it("reprices the bought item only, never a lookalike from the same list", () => {
    const lua = page({
      extraScan: [{ itemId: LINEN, name: "Linen Cloth", minPrice: 80000, numAuctions: 6 }]
    });
    // The live answer for Mageweave is corrected; Linen's entry stays
    // whatever the last scan saw — the purchase is knowledge about the book.
    buyCheapest(lua, [result(1, 80000), result(2, 85000)]);
    expect(lua.scanMin(MAGEWEAVE)).toBe(85000);
    expect(lua.scanMin(LINEN)).toBe(80000);
    expect(lua.scanAuctions(LINEN)).toBe(6);
  });

  it("changes nothing when the server has no buyable listing at click time", () => {
    const lua = page();
    lua.search("Mageweave");
    lua.setSearchResults(MAGEWEAVE, [result(1, 80000, MAGEWEAVE, { owner: true })]);
    lua.buyRow(1);
    lua.flushQueries();
    // Only the player's own listing exists: nothing is bought, nothing moves.
    expect(lua.lastChat()).toContain("没有有效的一口价挂单");
    expect(lua.scanMin(MAGEWEAVE)).toBe(80000);
    expect(lua.scanAuctions(MAGEWEAVE)).toBe(6);
  });

  it("changes nothing when the server has no listings at all", () => {
    const lua = page();
    lua.search("Mageweave");
    lua.setSearchResults(MAGEWEAVE, []);
    lua.buyRow(1);
    lua.flushQueries();
    expect(lua.lastChat()).toContain("没有有效的一口价挂单");
    expect(lua.scanMin(MAGEWEAVE)).toBe(80000);
  });
});
