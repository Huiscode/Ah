// 跨市场倒卖指标（M2）：价差%、方向、预计净利、新鲜度 —— 纯函数单测。
// 防污染红线：配对只取两市场都出现的物品；faction 口径从不混入 neutral 价。
import { describe, expect, it } from "vitest";
import { buildCrossMarketRows, attachItemMeta, STALE_DAYS, type CrossMarketSide } from "@/lib/cross-market";

const NOW = new Date("2026-10-11T12:00:00Z");
const DAY = 86_400_000;

function side(partial: Partial<CrossMarketSide> & { itemId: number }): CrossMarketSide {
  return {
    marketPrice: 0,
    minPrice: 0,
    ladderFloor: null,
    quantity: 0,
    numAuctions: 0,
    timestamp: NOW,
    ...partial
  };
}

describe("buildCrossMarketRows", () => {
  it("pairs only items present in both markets and computes diff/direction/profit", () => {
    const faction = [
      side({ itemId: 2580, marketPrice: 500, minPrice: 480, ladderFloor: 480, quantity: 20, numAuctions: 3 }),
      side({ itemId: 1529, marketPrice: 1200, minPrice: 1200, quantity: 2, numAuctions: 1 }),
      // 联盟有、中立无 —— 不配对
      side({ itemId: 1111, marketPrice: 300, quantity: 5 })
    ];
    const neutral = [
      // 中立贵：联盟买 → 中立卖
      side({ itemId: 2580, marketPrice: 1000, minPrice: 900, quantity: 8, numAuctions: 2 }),
      // 中立便宜：中立买 → 联盟卖
      side({ itemId: 1529, marketPrice: 800, minPrice: 780, quantity: 6, numAuctions: 1 }),
      // 中立有、联盟无 —— 不配对
      side({ itemId: 2222, marketPrice: 999, quantity: 1 })
    ];
    const rows = buildCrossMarketRows(faction, neutral, { faction: 0.05, neutral: 0.15 }, NOW);

    expect(rows).toHaveLength(2);
    const row2580 = rows.find((row) => row.itemId === 2580)!;
    // |500−1000| / min(500,1000) = 100%
    expect(row2580.diffPct).toBe(100);
    expect(row2580.direction).toBe("faction→neutral");
    // 买侧（联盟）ladder 第 1 档 480；卖侧（中立）P10 1000 × (1−15%) = 850
    expect(row2580.buySideFloor).toBe(480);
    expect(row2580.estProfit).toBe(370);
    expect(row2580.stale).toBe(false);

    const row1529 = rows.find((row) => row.itemId === 1529)!;
    expect(row1529.direction).toBe("neutral→faction");
    // 买侧（中立）无 ladder → 回退 P10 800；卖侧（联盟）1200 × (1−5%) = 1140
    expect(row1529.buySideFloor).toBe(800);
    expect(row1529.estProfit).toBe(340);
  });

  it("marks a row stale when either side's latest round is older than the threshold", () => {
    const oldFaction = side({ itemId: 2580, marketPrice: 500, timestamp: new Date(NOW.getTime() - (STALE_DAYS + 1) * DAY) });
    const freshNeutral = side({ itemId: 2580, marketPrice: 1000 });
    expect(buildCrossMarketRows([oldFaction], [freshNeutral], undefined, NOW)[0].stale).toBe(true);

    const freshFaction = side({ itemId: 2580, marketPrice: 500 });
    const oldNeutral = side({ itemId: 2580, marketPrice: 1000, timestamp: new Date(NOW.getTime() - (STALE_DAYS + 1) * DAY) });
    expect(buildCrossMarketRows([freshFaction], [oldNeutral], undefined, NOW)[0].stale).toBe(true);
  });

  it("never mixes prices across markets: the profit math uses the side that is actually sold", () => {
    // 中立贵：即使中立挂单数少，方向仍是联盟→中立，费率用中立侧 15%。
    const faction = [side({ itemId: 2580, marketPrice: 100, minPrice: 90, ladderFloor: 90, quantity: 100 })];
    const neutral = [side({ itemId: 2580, marketPrice: 1000, minPrice: 950, quantity: 1 })];
    const [row] = buildCrossMarketRows(faction, neutral, { faction: 0.05, neutral: 0.15 }, NOW);
    expect(row.direction).toBe("faction→neutral");
    expect(row.buySideFloor).toBe(90);
    // 1000 × 0.85 − 90
    expect(row.estProfit).toBe(760);
  });
});

describe("attachItemMeta", () => {
  it("backfills item metadata from the item table map", () => {
    const rows = buildCrossMarketRows(
      [side({ itemId: 2580, marketPrice: 500 })],
      [side({ itemId: 2580, marketPrice: 1000 })],
      undefined,
      NOW
    );
    const meta = new Map([[2580, { name: "亚麻布卷", quality: "common", category: "商品", subCategory: "布料", icon: "inv_fabric" }]]);
    attachItemMeta(rows, meta);
    expect(rows[0]).toMatchObject({ name: "亚麻布卷", quality: "common", category: "商品", subCategory: "布料", icon: "inv_fabric" });
  });
});
