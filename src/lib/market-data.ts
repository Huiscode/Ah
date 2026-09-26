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
  snapshots: Array<Omit<AuctionSnapshot, "id" | "itemId" | "item" | "rawPayload" | "source"> & Partial<Pick<AuctionSnapshot, "id" | "itemId" | "rawPayload">> & { source?: string }>;
  dailySummaries: Array<Omit<DailySummary, "id" | "itemId" | "item" | "source"> & Partial<Pick<DailySummary, "id" | "itemId">> & { source?: string }>;
};
