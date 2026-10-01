import { prisma } from "@/lib/prisma";

export type PricePoint = { price: number; count: number };

// Returns the price ladder (first 2-3 price tiers) for the latest addon
// snapshot of each item, so the client radar can show "how big is the gap
// between tier 1 and tier 2" as a deal signal. Raw SQL: the previous form
// pulled every addon snapshot row (31x10^4+) and truncated in JS (~1.7s);
// the window function reads only one row per item.
export async function getLatestLadders(): Promise<Map<number, PricePoint[]>> {
  const rows = await prisma.$queryRaw<{ item_id: number; raw_payload: { ladder?: PricePoint[] } }[]>`
    SELECT "item_id", "raw_payload" FROM (
      SELECT "item_id", "raw_payload",
             ROW_NUMBER() OVER (PARTITION BY "item_id" ORDER BY "timestamp" DESC) AS rn
      FROM "AuctionSnapshot"
      WHERE "source" = 'addon' AND "raw_payload" IS NOT NULL
    ) ranked WHERE rn = 1`;
  const map = new Map<number, PricePoint[]>();
  for (const row of rows) {
    const rp = row.raw_payload;
    if (rp && Array.isArray(rp.ladder) && rp.ladder.length >= 2) {
      map.set(Number(row.item_id), rp.ladder.slice(0, 3));
    }
  }
  return map;
}
