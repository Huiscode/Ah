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
    // 模拟主城市场：关闭开服宽限，阈值降到 1（2 挂单 ≥ 1 → faction，走 scanData）。
    lua.exec("WowTest.ns.MARKET_GRACE_DAYS = 0");
    lua.exec("WowTest.ns.MARKET_SPLIT_AUCTIONS = 1");
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
    lua.exec("WowTest.ns.MARKET_GRACE_DAYS = 0");
    lua.exec("WowTest.ns.MARKET_SPLIT_AUCTIONS = 1");
    lua.clearReplicateCooldown();
    lua.runScan();
    lua.exec('WowTest.fireEvent("REPLICATE_ITEM_LIST_UPDATE")');
    lua.runOnUpdate();
    lua.runOnUpdate();

    expect(scannedLayout(lua, 9999)).toEqual({ vendorP: 0, itemClass: "unknown", itemSubClass: "unknown", p50: 500 });
  });
});

// 市场识别（0.3.5）：主城规模（≥20000 挂单）写 scanData + points；中立
// 规模（<20000 挂单）写独立槽位 neutralScanData，不覆盖主城 scanData、
// 不追加 points —— 中立行情既不能覆盖游戏内联盟数据，也不会进网页导入。
describe("market discrimination (faction vs neutral)", () => {
  it("parks a neutral scan in its own slot without touching the faction scan or points", () => {
    const lua = loadAddon();
    // 先做一次主城扫描：关闭开服宽限，阈值降到 1（2 挂单 ≥ 1 → faction），
    // 写入 scanData 与 points。
    lua.setReplicate([
      { name: "亚麻布卷", texture: 0, count: 2, qualityID: 1, usable: 1, level: 1, minBid: 500, minIncrement: 5, buyoutPrice: 1000, bidAmount: 0, owner: "A", saleStatus: 0, itemID: 2580, hasAllInfo: true }
    ]);
    lua.exec("WowTest.ns.MARKET_GRACE_DAYS = 0");
    lua.exec("WowTest.ns.MARKET_SPLIT_AUCTIONS = 1");
    lua.clearReplicateCooldown();
    lua.runScan();
    lua.exec('WowTest.fireEvent("REPLICATE_ITEM_LIST_UPDATE")');
    lua.runOnUpdate();
    lua.runOnUpdate();
    expect(lua.eval("WoWderhoiAH_ScanData.market")).toBe("faction");
    const pointsBefore = Number(lua.eval("WoWderhoiAHDB.points[2580] and #WoWderhoiAHDB.points[2580] or 0"));
    expect(pointsBefore).toBe(1);

    // 再扫中立市场（阈值升到 1000，2 挂单 < 1000 → neutral），应走独立槽位。
    lua.exec("WowTest.ns.MARKET_SPLIT_AUCTIONS = 1000");
    lua.setReplicate([
      { name: "翡翠", texture: 134134, count: 1, qualityID: 2, usable: 1, level: 1, minBid: 900, minIncrement: 5, buyoutPrice: 1100, bidAmount: 0, owner: "C", saleStatus: 0, itemID: 1529, hasAllInfo: true }
    ]);
    lua.clearReplicateCooldown();
    lua.runScan();
    lua.exec('WowTest.fireEvent("REPLICATE_ITEM_LIST_UPDATE")');
    lua.runOnUpdate();
    lua.runOnUpdate();

    // 主城 scanData 保持原样（仍是亚麻布卷，market=faction），未被中立覆盖。
    expect(lua.scanned(2580)).toBe(true);
    expect(lua.eval("WoWderhoiAH_ScanData.market")).toBe("faction");
    expect(lua.eval("WoWderhoiAH_ScanData.items[1529] == nil")).toBe(true);
    // 中立槽位有数据且标记 neutral。
    expect(lua.eval("WoWderhoiAHDB.neutralScanData ~= nil")).toBe(true);
    expect(lua.eval("WoWderhoiAHDB.neutralScanData.market")).toBe("neutral");
    expect(lua.eval("WoWderhoiAHDB.neutralScanData.items[1529] ~= nil")).toBe(true);
    // 中立扫描不追加 points：主城物品点数不变，中立物品无点数。
    const pointsAfter = Number(lua.eval("WoWderhoiAHDB.points[2580] and #WoWderhoiAHDB.points[2580] or 0"));
    expect(pointsAfter).toBe(pointsBefore);
    expect(lua.eval("WoWderhoiAHDB.points[1529] == nil")).toBe(true);
  });
});

// 开服宽限（0.3.7）：首次扫描起 7 天内，无论扫到多少挂单都按联盟拍卖行收，
// 避免小经济开服（主城不足 2 万条）被误判中立而丢数据；已有数据的账户
// 升级后不重新进入宽限。
describe("launch grace (first 7 days = faction)", () => {
  it("treats the first scan as faction regardless of listing count", () => {
    const lua = loadAddon();
    // 阈值设 1000：若按条数本应判中立，但宽限期内一律按联盟收。
    lua.exec("WowTest.ns.MARKET_SPLIT_AUCTIONS = 1000");
    lua.setReplicate([
      { name: "亚麻布卷", texture: 0, count: 2, qualityID: 1, usable: 1, level: 1, minBid: 500, minIncrement: 5, buyoutPrice: 1000, bidAmount: 0, owner: "A", saleStatus: 0, itemID: 2580, hasAllInfo: true }
    ]);
    lua.clearReplicateCooldown();
    lua.runScan();
    lua.exec('WowTest.fireEvent("REPLICATE_ITEM_LIST_UPDATE")');
    lua.runOnUpdate();
    lua.runOnUpdate();
    // 首扫锚定宽限起点，且数据写入主城槽位。
    expect(lua.eval("WoWderhoiAHDB.firstScanAt ~= nil")).toBe(true);
    expect(lua.eval("WoWderhoiAH_ScanData.market")).toBe("faction");
    expect(lua.scanned(2580)).toBe(true);
    expect(lua.eval("WoWderhoiAHDB.neutralScanData == nil")).toBe(true);
  });

  it("does not re-enter the grace for an account that already has scan data", () => {
    const lua = loadAddon();
    // 模拟升级自 0.3.5 的老账户：已有主城 scanData，不应重新进入 7 天宽限。
    lua.exec("WoWderhoiAH_ScanData = { market = 'faction', items = {} }");
    lua.exec("WowTest.ns.MARKET_SPLIT_AUCTIONS = 1000");
    lua.setReplicate([
      { name: "翡翠", texture: 134134, count: 1, qualityID: 2, usable: 1, level: 1, minBid: 900, minIncrement: 5, buyoutPrice: 1100, bidAmount: 0, owner: "C", saleStatus: 0, itemID: 1529, hasAllInfo: true }
    ]);
    lua.clearReplicateCooldown();
    lua.runScan();
    lua.exec('WowTest.fireEvent("REPLICATE_ITEM_LIST_UPDATE")');
    lua.runOnUpdate();
    lua.runOnUpdate();
    // 没有锚点、按阈值走中立，主城 scanData 不被覆盖。
    expect(lua.eval("WoWderhoiAHDB.firstScanAt == nil")).toBe(true);
    expect(lua.eval("WoWderhoiAHDB.neutralScanData ~= nil")).toBe(true);
    expect(lua.eval("WoWderhoiAHDB.neutralScanData.market")).toBe("neutral");
    expect(lua.eval("WoWderhoiAH_ScanData.market")).toBe("faction");
    expect(lua.eval("WoWderhoiAH_ScanData.items[1529] == nil")).toBe(true);
  });
});
