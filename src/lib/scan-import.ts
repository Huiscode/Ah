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
    } else if (
      current.name !== item.name ||
      current.quality !== item.quality ||
      current.category !== item.category ||
      current.subCategory !== item.subCategory ||
      current.vendorPrice !== item.vendorPrice
    ) {
      updates.push({
        itemId: item.itemId,
        data: {
          name: item.name,
          quality: item.quality,
          category: item.category,
          subCategory: item.subCategory,
          vendorPrice: item.vendorPrice
        }
      });
    }
  }
  return { creates, updates };
}
