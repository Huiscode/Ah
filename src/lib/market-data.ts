import type { AuctionSnapshot, DailySummary, Item } from "@prisma/client";

// Data channel of a price row. "addon" = the in-game plugin's own scan
// (P10 marketPrice); "ahledger" = the AHledger public API (median
// marketPrice). The two are different price metrics and must never be
// mixed inside one med7 window or one daily OHLCV row.
export type SnapshotSource = "addon" | "ahledger";

export type ItemWithHistory = Item & {
  snapshots: AuctionSnapshot[];
  dailySummaries: DailySummary[];
};

export type MarketHistory = Omit<Item, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
  createdAt?: Date;
  updatedAt?: Date;
  // source is a string (Prisma type) rather than the SnapshotSource union so
  // both DB rows (source: string) and hand-built test fixtures (no source)
  // assign cleanly; consumers narrow with snapshotSource() in analytics.
  // Price columns are BigInt in the DB (to hold 100k-gold prices), but the
  // repositories convert them to Number before they reach domain code, so the
  // domain types use number.
  snapshots: Array<Omit<AuctionSnapshot, "id" | "itemId" | "item" | "rawPayload" | "source" | "minPrice" | "marketPrice"> & Partial<Pick<AuctionSnapshot, "id" | "itemId" | "rawPayload">> & { source?: string; minPrice: number; marketPrice: number }>;
  dailySummaries: Array<Omit<DailySummary, "id" | "itemId" | "item" | "source" | "openPrice" | "closePrice" | "highPrice" | "lowPrice"> & Partial<Pick<DailySummary, "id" | "itemId">> & { source?: string; openPrice: number; closePrice: number; highPrice: number; lowPrice: number }>;
};
