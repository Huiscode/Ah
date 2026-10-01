import type { AuctionSnapshot, DailySummary, Item } from "@prisma/client";

// Data channel of a price row. "addon" = the in-game plugin's own scan
// (P10 marketPrice + display-only P50 altPrice). The website channel
// (AHledger) was removed; the union stays so legacy rows in the store
// remain typeable until purged.
export type SnapshotSource = "addon" | "ahledger";

export type ItemWithHistory = Item & {
  snapshots: AuctionSnapshot[];
  dailySummaries: DailySummary[];
};

export type MarketHistory = Omit<Item, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
  createdAt?: Date;
  updatedAt?: Date;
  // 7d median info computed at the repository layer over ALL same-source
  // snapshots inside the 7-day window (SQL aggregate). The snapshots array
  // below is truncated for chart/list rendering, so computing med7 from it
  // directly would silently differ between pages with different truncation
  // depths (homepage 48 vs item page 96). Consumers use med7Info when
  // present and fall back to snapshot-based math only for hand-built
  // fixtures.
  med7Info?: { med7: number; samples: number; distinct: number };
  // source is a string (Prisma type) rather than the SnapshotSource union so
  // both DB rows (source: string) and hand-built test fixtures (no source)
  // assign cleanly; consumers narrow with snapshotSource() in analytics.
  // Price columns are BigInt in the DB (to hold 100k-gold prices), but the
  // repositories convert them to Number before they reach domain code, so the
  // domain types use number.
  snapshots: Array<Omit<AuctionSnapshot, "id" | "itemId" | "item" | "rawPayload" | "source" | "minPrice" | "marketPrice" | "altPrice"> & Partial<Pick<AuctionSnapshot, "id" | "itemId" | "rawPayload">> & { source?: string; minPrice: number; marketPrice: number; altPrice?: number }>;
  dailySummaries: Array<Omit<DailySummary, "id" | "itemId" | "item" | "source" | "openPrice" | "closePrice" | "highPrice" | "lowPrice"> & Partial<Pick<DailySummary, "id" | "itemId">> & { source?: string; openPrice: number; closePrice: number; highPrice: number; lowPrice: number }>;
};
