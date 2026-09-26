import { describe, expect, it } from "vitest";
import type { AddonScanItem } from "@/lib/addon-scan";
import { diffScanItems } from "./scan-import";

function scanItem(partial: Partial<AddonScanItem> & Pick<AddonScanItem, "itemId" | "name">): AddonScanItem {
  return {
    quality: "common",
    category: "Trade Goods",
    subCategory: "Herb",
    minPrice: 90,
    marketPrice: 100,
    quantity: 5,
    numAuctions: 2,
    vendorPrice: 0,
    ...partial
  };
}

function existingRow(itemId: number, name: string, overrides: Partial<{ quality: string; category: string; subCategory: string; vendorPrice: number }> = {}) {
  return {
    itemId,
    name,
    quality: "common",
    category: "Trade Goods",
    subCategory: "Herb",
    vendorPrice: 0,
    icon: null,
    ...overrides
  };
}

describe("diffScanItems", () => {
  it("creates every item when the store is empty", () => {
    const items = [scanItem({ itemId: 1, name: "梦叶草" }), scanItem({ itemId: 2, name: "魔铁矿石" })];
    const diff = diffScanItems(items, []);
    expect(diff.creates.map((row) => row.itemId)).toEqual([1, 2]);
    expect(diff.updates).toEqual([]);
  });

  it("emits neither create nor update for unchanged known items", () => {
    const items = [scanItem({ itemId: 1, name: "梦叶草", quality: "uncommon" })];
    const diff = diffScanItems(items, [existingRow(1, "梦叶草", { quality: "uncommon" })]);
    expect(diff.creates).toEqual([]);
    expect(diff.updates).toEqual([]);
  });

  it("updates only items whose name, quality, category, subcategory, or vendor price changed", () => {
    const items = [
      scanItem({ itemId: 1, name: "梦叶草" }),
      scanItem({ itemId: 2, name: "魔铁矿石·新译名" }),
      scanItem({ itemId: 3, name: "碎骨头", quality: "poor" }),
      scanItem({ itemId: 4, name: "厚皮", vendorPrice: 120 }),
      scanItem({ itemId: 5, name: "瘤背战斗法杖", category: "Weapon", subCategory: "Staves" })
    ];
    const diff = diffScanItems(items, [
      existingRow(1, "梦叶草"),
      existingRow(2, "魔铁矿石"),
      existingRow(3, "碎骨头"),
      existingRow(4, "厚皮"),
      existingRow(5, "瘤背战斗法杖", { category: "unknown", subCategory: "unknown" })
    ]);
    expect(diff.creates).toEqual([]);
    expect(diff.updates.map((update) => update.itemId)).toEqual([2, 3, 4, 5]);
    expect(diff.updates[0].data).toEqual({ name: "魔铁矿石·新译名", quality: "common", category: "Trade Goods", subCategory: "Herb", vendorPrice: 0 });
    expect(diff.updates[1].data).toEqual({ name: "碎骨头", quality: "poor", category: "Trade Goods", subCategory: "Herb", vendorPrice: 0 });
    expect(diff.updates[2].data).toEqual({ name: "厚皮", quality: "common", category: "Trade Goods", subCategory: "Herb", vendorPrice: 120 });
    expect(diff.updates[3].data).toEqual({ name: "瘤背战斗法杖", quality: "common", category: "Weapon", subCategory: "Staves", vendorPrice: 0 });
  });

  it("carries the full column set on creates", () => {
    const diff = diffScanItems([scanItem({ itemId: 7, name: "精金矿石", subCategory: "Metal & Stone", vendorPrice: 50 })], []);
    expect(diff.creates[0]).toEqual({
      itemId: 7,
      name: "精金矿石",
      quality: "common",
      category: "Trade Goods",
      subCategory: "Metal & Stone",
      vendorPrice: 50
    });
  });

  it("never overwrites a stored real category with an incoming unknown", () => {
    // Same name/quality/vendor, category already real in DB, client says unknown -> no update at all.
    const same = diffScanItems([scanItem({ itemId: 9, name: "秘银锭", category: "unknown", subCategory: "unknown" })], [
      existingRow(9, "秘银锭", { category: "Trade Goods", subCategory: "Metal & Stone" })
    ]);
    expect(same.updates).toEqual([]);
    // Name changed but category unknown -> update keeps the stored category.
    const renamed = diffScanItems([scanItem({ itemId: 10, name: "秘银锭·新译名", category: "unknown", subCategory: "unknown" })], [
      existingRow(10, "秘银锭", { category: "Trade Goods", subCategory: "Metal & Stone" })
    ]);
    expect(renamed.updates).toHaveLength(1);
    expect(renamed.updates[0].data).toEqual({
      name: "秘银锭·新译名",
      quality: "common",
      category: "Trade Goods",
      subCategory: "Metal & Stone",
      vendorPrice: 0
    });
  });

  it("promotes a stored unknown to a real incoming category", () => {
    const diff = diffScanItems([scanItem({ itemId: 11, name: "瘤背战斗法杖", category: "Weapon", subCategory: "Staves" })], [
      existingRow(11, "瘤背战斗法杖", { category: "unknown", subCategory: "unknown" })
    ]);
    expect(diff.updates).toHaveLength(1);
    expect(diff.updates[0].data.category).toBe("Weapon");
    expect(diff.updates[0].data.subCategory).toBe("Staves");
  });
});
