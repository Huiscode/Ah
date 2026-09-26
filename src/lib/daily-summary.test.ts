import { describe, expect, it } from "vitest";
import { mergeScanIntoDailySummaries, mergePointsIntoDailySummaries } from "@/lib/daily-summary";

const scannedAt = new Date("2026-07-23T14:30:00Z");

describe("mergeScanIntoDailySummaries", () => {
  it("creates OHLCV rows for items without a summary today", () => {
    const { date, creates, updates } = mergeScanIntoDailySummaries(
      [{ itemId: 2770, marketPrice: 210, quantity: 240 }],
      scannedAt,
      []
    );
    expect(date).toEqual(new Date("2026-07-23T00:00:00Z"));
    expect(updates).toHaveLength(0);
    expect(creates).toEqual([
      { itemId: 2770, date, source: "addon", openPrice: 210, closePrice: 210, highPrice: 210, lowPrice: 210, volume: 240 }
    ]);
  });

  it("stamps the channel source onto created OHLCV rows", () => {
    const { creates } = mergeScanIntoDailySummaries(
      [{ itemId: 2770, marketPrice: 125, quantity: 5000 }],
      scannedAt,
      [],
      "ahledger"
    );
    expect(creates[0].source).toBe("ahledger");
  });

  it("updates close and stretches high/low for repeat scans in a day", () => {
    const { creates, updates } = mergeScanIntoDailySummaries(
      [
        { itemId: 2770, marketPrice: 180, quantity: 300 }, // dipped below existing low
        { itemId: 13468, marketPrice: 999999, quantity: 2 } // new item mid-day
      ],
      scannedAt,
      [{ itemId: 2770, highPrice: 220, lowPrice: 200 }]
    );
    expect(creates.map((row) => row.itemId)).toEqual([13468]);
    expect(updates).toEqual([
      { itemId: 2770, data: { closePrice: 180, highPrice: 220, lowPrice: 180, volume: 300 } }
    ]);
  });
});

describe("mergePointsIntoDailySummaries", () => {
  it("folds a multi-day point series into per-day OHLCV rows, open from the first point", () => {
    const points = [
      // 2026-07-22 evening series (3 rounds)
      { itemId: 2770, timestamp: new Date("2026-07-22T20:00:00Z"), marketPrice: 190, quantity: 240 },
      { itemId: 2770, timestamp: new Date("2026-07-22T20:15:00Z"), marketPrice: 180, quantity: 230 },
      { itemId: 2770, timestamp: new Date("2026-07-22T20:30:00Z"), marketPrice: 200, quantity: 225 },
      // 2026-07-23 morning series (2 rounds)
      { itemId: 2770, timestamp: new Date("2026-07-23T06:00:00Z"), marketPrice: 210, quantity: 220 },
      { itemId: 2770, timestamp: new Date("2026-07-23T06:15:00Z"), marketPrice: 205, quantity: 215 },
      { itemId: 13468, timestamp: new Date("2026-07-23T06:00:00Z"), marketPrice: 950000, quantity: 3 }
    ];
    const { creates, updates } = mergePointsIntoDailySummaries(points, [
      // 07-22 already imported earlier today
      { itemId: 2770, date: new Date("2026-07-22T00:00:00Z"), highPrice: 205, lowPrice: 185 }
    ]);
    expect(creates).toEqual([
      {
        itemId: 2770,
        date: new Date("2026-07-23T00:00:00Z"),
        source: "addon",
        openPrice: 210,
        closePrice: 205,
        highPrice: 210,
        lowPrice: 205,
        volume: 215
      },
      {
        itemId: 13468,
        date: new Date("2026-07-23T00:00:00Z"),
        source: "addon",
        openPrice: 950000,
        closePrice: 950000,
        highPrice: 950000,
        lowPrice: 950000,
        volume: 3
      }
    ]);
    // 07-22 already exists: open untouched, close/high/low/volume merged.
    expect(updates).toEqual([
      { itemId: 2770, date: new Date("2026-07-22T00:00:00Z"), data: { closePrice: 200, highPrice: 205, lowPrice: 180, volume: 225 } }
    ]);
  });
});
