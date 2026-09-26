// Splits a validated scan into item-table writes. Existing rows only get
// an update when name/quality/category/subCategory/vendorPrice actually
// changed (translations, data fixes or a category that only landed after
// the client loaded the item), so the routine import path issues zero
// per-item statements.
import type { AddonScanItem } from "@/lib/addon-scan";

export type ExistingItemRow = {
  itemId: number;
  name: string;
  quality: string;
  category: string;
  subCategory: string;
  vendorPrice: number;
};

export type ItemUpdateData = {
  name: string;
  quality: string;
  category: string;
  subCategory: string;
  vendorPrice: number;
};

export function diffScanItems(items: AddonScanItem[], existing: ExistingItemRow[]) {
  const existingByItemId = new Map(existing.map((row) => [row.itemId, row]));
  const creates: Array<{ itemId: number; name: string; quality: string; category: string; subCategory: string; vendorPrice: number }> = [];
  const updates: Array<{ itemId: number; data: ItemUpdateData }> = [];
  for (const item of items) {
    const current = existingByItemId.get(item.itemId);
    if (!current) {
      creates.push({
        itemId: item.itemId,
        name: item.name,
        quality: item.quality,
        category: item.category,
        subCategory: item.subCategory,
        vendorPrice: item.vendorPrice
      });
    } else {
      // The client only reports a category once the item's data is loaded;
      // most replicate-scanned rows come back "unknown". A real category
      // already in the DB (backfilled from the website catalog or an earlier
      // scan) must never be overwritten by that unknown, so the incoming
      // unknown is demoted to the stored value before comparing.
      const category = item.category === "unknown" && current.category !== "unknown" ? current.category : item.category;
      const subCategory = item.subCategory === "unknown" && current.subCategory !== "unknown" ? current.subCategory : item.subCategory;
      if (
        current.name !== item.name ||
        current.quality !== item.quality ||
        current.category !== category ||
        current.subCategory !== subCategory ||
        current.vendorPrice !== item.vendorPrice
      ) {
        updates.push({
          itemId: item.itemId,
          data: {
            name: item.name,
            quality: item.quality,
            category,
            subCategory,
            vendorPrice: item.vendorPrice
          }
        });
      }
    }
  }
  return { creates, updates };
}
