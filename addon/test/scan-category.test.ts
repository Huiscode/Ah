// The vendor-price / category path (itemCategoryAndVendor in
// WoWderhoiAH.lua) was dead on the Forever client: the addon called
// C_Item.GetItemInfoByID, which does not exist there (verified by probe),
// so vendorP stayed 0 and the "NPC必赚" radar class could never fire.
// The fix reads C_Item.GetItemInfo with the client's real layout: position
// 6/7 are localized itemType/itemSubType strings and position 11 is the
// sell price. These tests drive the FULL scan path (replicate stream ->
// recordAuction -> itemCategoryAndVendor) and pin the layout contract, so a
// future client-layout change fails loudly instead of silently zeroing
// vendor prices again.

import { describe, expect, it } from "vitest";
import { loadAddon, type WowLua } from "./wow-lua";

function scannedLayout(lua: WowLua, itemId: number) {
  return {
    vendorP: lua.scanVendorP(itemId),
    itemClass: lua.scanClass(itemId),
    itemSubClass: lua.eval(`WoWderhoiAH_ScanData.items[${itemId}].itemSubClass`) as string,
    p50: lua.eval(`WoWderhoiAH_ScanData.items[${itemId}].p50`) as number
  };
}

// The probe's real measurements: 4370 (大型铜壳炸弹) sells to an NPC for
// 175c with class 消耗品/爆炸物; 1529 (翡翠) for 700c 商品/其它.
describe("itemCategoryAndVendor on the Forever layout", () => {
  it("reads vendor price and category through a full scan", () => {
    const lua = loadAddon();
    lua.setItemInfo(4370, {
      name: "大型铜壳炸弹",
      itemType: "消耗品",
      itemSubType: "爆炸物",
      vendorP: 175,
      classID: 0,
      subClassID: 0,
      iconFileID: 133709
    });
    lua.setItemInfo(1529, {
      name: "翡翠",
      itemType: "商品",
      itemSubType: "其它",
      vendorP: 700,
      classID: 7,
      subClassID: 11,
      iconFileID: 134134
    });
    lua.setReplicate([
      { name: "大型铜壳炸弹", texture: 133709, count: 3, qualityID: 1, usable: 1, level: 1, minBid: 500, minIncrement: 5, buyoutPrice: 1500, bidAmount: 0, owner: "A", saleStatus: 0, itemID: 4370, hasAllInfo: true },
      { name: "翡翠", texture: 134134, count: 1, qualityID: 2, usable: 1, level: 1, minBid: 1000, minIncrement: 5, buyoutPrice: 1200, bidAmount: 0, owner: "B", saleStatus: 0, itemID: 1529, hasAllInfo: true }
    ]);
    lua.clearReplicateCooldown();
    lua.runScan();          // SlashCmdList["WOWDERHOIAH"] -> ReplicateItems
    lua.exec('WowTest.fireEvent("REPLICATE_ITEM_LIST_UPDATE")');
    lua.runOnUpdate();      // first chunk pass
    lua.runOnUpdate();      // revisit pass -> finishScan

    expect(lua.scanned(4370)).toBe(true);
    expect(lua.scanned(1529)).toBe(true);
    // 4370 has one listing of 3 at 500c -> P50 = P10 = 500; 1529 one of 1
    // at 1200c -> P50 = 1200. The scan now emits both closes so the web
    // terminal can chart P10 (market price) and P50 (display-only) curves
    // from the same snapshot.
    expect(scannedLayout(lua, 4370)).toEqual({ vendorP: 175, itemClass: "消耗品", itemSubClass: "爆炸物", p50: 500 });
    expect(scannedLayout(lua, 1529)).toEqual({ vendorP: 700, itemClass: "商品", itemSubClass: "其它", p50: 1200 });
  });

  it("falls back to unknown/0 when the client has no cache entry yet", () => {
    const lua = loadAddon();
    lua.setReplicate([
      { name: "未缓存物品", texture: 0, count: 1, qualityID: 1, usable: 1, level: 1, minBid: 500, minIncrement: 5, buyoutPrice: 500, bidAmount: 0, owner: "A", saleStatus: 0, itemID: 9999, hasAllInfo: true }
    ]);
    lua.clearReplicateCooldown();
    lua.runScan();
    lua.exec('WowTest.fireEvent("REPLICATE_ITEM_LIST_UPDATE")');
    lua.runOnUpdate();
    lua.runOnUpdate();

    expect(scannedLayout(lua, 9999)).toEqual({ vendorP: 0, itemClass: "unknown", itemSubClass: "unknown", p50: 500 });
  });
});
