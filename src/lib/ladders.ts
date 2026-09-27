import { prisma } from "@/lib/prisma";

export type PricePoint = { price: number; count: number };

// Returns the price ladder (first 2-3 price tiers) for the latest addon
// snapshot of each item, so the client radar can show "how big is the gap
// between tier 1 and tier 2" as a deal signal.
export async function getLatestLadders(): Promise<Map<number, PricePoint[]>> {
  const rows = await prisma.auctionSnapshot.findMany({
    where: { source: "addon", rawPayload: { not: undefined } },
    orderBy: { timestamp: "desc" },
    select: { itemId: true, rawPayload: true }
  });
  const map = new Map<number, PricePoint[]>();
  for (const row of rows) {
    if (map.has(row.itemId)) continue;
    const rp = row.rawPayload as { ladder?: PricePoint[] };
    if (rp && Array.isArray(rp.ladder) && rp.ladder.length >= 2) {
      map.set(row.itemId, rp.ladder.slice(0, 3));
    }
  }
  return map;
}
