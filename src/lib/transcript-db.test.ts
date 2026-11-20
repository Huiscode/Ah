import { describe, expect, it } from "vitest";
import { flattenTranscriptDb } from "@/lib/transcript-db";

describe("flattenTranscriptDb", () => {
  it("reads v2 per-market tiers so one item can carry both markets", () => {
    const entries = flattenTranscriptDb({
      version: 2,
      markets: {
        faction: { "2589": { t: 100, tiers: [{ p: 10, q: 3 }] } },
        neutral: { "2589": { t: 200, tiers: [{ p: 12.4, q: 1 }] } }
      }
    });
    expect(entries).toEqual([
      { itemId: 2589, market: "faction", t: 100, tiers: [{ price: 10, qty: 3 }] },
      { itemId: 2589, market: "neutral", t: 200, tiers: [{ price: 12, qty: 1 }] }
    ]);
  });

  it("still reads v1 saves, routing by each entry's market field", () => {
    const entries = flattenTranscriptDb({
      scans: { "1": { t: 5, market: "neutral", tiers: [] }, "2": { t: 6, tiers: [] }, bad: { t: 7 } }
    });
    expect(entries.map((e) => [e.itemId, e.market])).toEqual([[1, "neutral"], [2, "faction"]]);
  });

  it("treats fengari's empty-table arrays as no entries", () => {
    expect(flattenTranscriptDb({ version: 2, markets: { faction: [], neutral: [] } })).toEqual([]);
  });
});
