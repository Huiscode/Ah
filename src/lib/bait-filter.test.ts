import { describe, expect, it } from "vitest";
import { markBaitDays, markThinDays, filterBaitDays, filterThinDays, BAIT_FILTER_RULES } from "@/lib/bait-filter";

const day = (n: number) => new Date(Date.UTC(2026, 9, n)).getTime();

describe("markThinDays（med7 用：剔除所有极少挂单日，不论价格）", () => {
  it("样本不足 minSamples 天时不启用过滤", () => {
    const days = [
      { ts: day(1), close: 100, volume: 10 },
      { ts: day(2), close: 300, volume: 1 },
      { ts: day(3), close: 95, volume: 9 }
    ];
    expect(markThinDays(days).size).toBe(0);
  });

  it("极少挂单的低价日也标记（低价个例不应计入 med7）", () => {
    const days = [
      { ts: day(1), close: 100, volume: 50 },
      { ts: day(2), close: 98, volume: 48 },
      { ts: day(3), close: 102, volume: 52 },
      { ts: day(4), close: 99, volume: 51 },
      { ts: day(5), close: 101, volume: 49 },
      { ts: day(6), close: 40, volume: 1 }
    ];
    const flagged = markThinDays(days);
    expect(flagged.has(day(6))).toBe(true);
  });

  it("极少挂单的极高价日也标记", () => {
    const days = [
      { ts: day(1), close: 100, volume: 50 },
      { ts: day(2), close: 98, volume: 48 },
      { ts: day(3), close: 102, volume: 52 },
      { ts: day(4), close: 99, volume: 51 },
      { ts: day(5), close: 101, volume: 49 },
      { ts: day(6), close: 350, volume: 1 }
    ];
    expect(markThinDays(days).has(day(6))).toBe(true);
  });

  it("极少挂单 + 正常价格也标记", () => {
    const days = [
      { ts: day(1), close: 100, volume: 50 },
      { ts: day(2), close: 98, volume: 48 },
      { ts: day(3), close: 102, volume: 52 },
      { ts: day(4), close: 99, volume: 51 },
      { ts: day(5), close: 101, volume: 49 },
      { ts: day(6), close: 100, volume: 1 }
    ];
    expect(markThinDays(days).has(day(6))).toBe(true);
  });

  it("挂单充足的日子（含极低/极高价格）不标记", () => {
    const days = [
      { ts: day(1), close: 100, volume: 50 },
      { ts: day(2), close: 98, volume: 48 },
      { ts: day(3), close: 102, volume: 52 },
      { ts: day(4), close: 99, volume: 51 },
      { ts: day(5), close: 101, volume: 49 },
      { ts: day(6), close: 30, volume: 45 },  // 低价但量正常 → 不标记
      { ts: day(7), close: 350, volume: 45 }  // 高价但量正常 → 不标记
    ];
    expect(markThinDays(days).size).toBe(0);
  });

  it("物品自身长期极少挂单（中位 1）时，1 单不算极少挂单", () => {
    const days = [
      { ts: day(1), close: 100, volume: 1 },
      { ts: day(2), close: 102, volume: 1 },
      { ts: day(3), close: 99, volume: 2 },
      { ts: day(4), close: 101, volume: 1 },
      { ts: day(5), close: 100, volume: 1 },
      { ts: day(6), close: 300, volume: 1 }
    ];
    expect(markThinDays(days).size).toBe(0);
  });

  it("volume 全为 0（无量数据）时不按量维度误杀", () => {
    const days = [
      { ts: day(1), close: 100, volume: 0 },
      { ts: day(2), close: 102, volume: 0 },
      { ts: day(3), close: 99, volume: 0 },
      { ts: day(4), close: 101, volume: 0 },
      { ts: day(5), close: 100, volume: 0 },
      { ts: day(6), close: 350, volume: 0 }
    ];
    expect(markThinDays(days).size).toBe(0);
  });
});

describe("markBaitDays（走势图用：只剔极少挂单+极高价格）", () => {
  it("样本不足 minSamples 天时不启用过滤（避免小样本误杀）", () => {
    const days = [
      { ts: day(1), close: 100, volume: 10 },
      { ts: day(2), close: 300, volume: 1 },
      { ts: day(3), close: 95, volume: 9 }
    ];
    expect(markBaitDays(days).size).toBe(0);
  });

  it("极少挂单 + 极低价格 → 不剔除（这正是捡漏机会）", () => {
    const days = [
      { ts: day(1), close: 100, volume: 50 },
      { ts: day(2), close: 98, volume: 48 },
      { ts: day(3), close: 102, volume: 52 },
      { ts: day(4), close: 99, volume: 51 },
      { ts: day(5), close: 101, volume: 49 },
      { ts: day(6), close: 40, volume: 1 } // 1 单 + 腰斩价 → 捡漏，保留
    ];
    expect(markBaitDays(days).size).toBe(0);
  });

  it("极少挂单 + 极高价格 → 剔除（钓单：单个高价挂单污染参考价）", () => {
    const days = [
      { ts: day(1), close: 100, volume: 50 },
      { ts: day(2), close: 98, volume: 48 },
      { ts: day(3), close: 102, volume: 52 },
      { ts: day(4), close: 99, volume: 51 },
      { ts: day(5), close: 101, volume: 49 },
      { ts: day(6), close: 350, volume: 1 } // 1 单 + 3.5 倍价 → 钓单
    ];
    const flagged = markBaitDays(days);
    expect(flagged.has(day(6))).toBe(true);
    expect(flagged.size).toBe(1);
  });

  it("极少挂单 + 正常价格 → 不剔除（价不异常，不污染走势）", () => {
    const days = [
      { ts: day(1), close: 100, volume: 50 },
      { ts: day(2), close: 98, volume: 48 },
      { ts: day(3), close: 102, volume: 52 },
      { ts: day(4), close: 99, volume: 51 },
      { ts: day(5), close: 101, volume: 49 },
      { ts: day(6), close: 100, volume: 1 } // 1 单但价格正常 → 保留
    ];
    expect(markBaitDays(days).size).toBe(0);
  });

  it("挂单正常 + 极高价格 → 不剔除（可能是真实涨价）", () => {
    const days = [
      { ts: day(1), close: 100, volume: 50 },
      { ts: day(2), close: 98, volume: 48 },
      { ts: day(3), close: 102, volume: 52 },
      { ts: day(4), close: 99, volume: 51 },
      { ts: day(5), close: 101, volume: 49 },
      { ts: day(6), close: 350, volume: 45 } // 高价但挂单充足 → 保留
    ];
    expect(markBaitDays(days).size).toBe(0);
  });

  it("物品自身长期极少挂单（中位 1）时，1 单不算极少挂单", () => {
    const days = [
      { ts: day(1), close: 100, volume: 1 },
      { ts: day(2), close: 102, volume: 1 },
      { ts: day(3), close: 99, volume: 2 },
      { ts: day(4), close: 101, volume: 1 },
      { ts: day(5), close: 100, volume: 1 },
      { ts: day(6), close: 300, volume: 1 } // 高价但自身常态就 1 单 → 不剔
    ];
    expect(markBaitDays(days).size).toBe(0);
  });

  it("高流通物品正常波动不误杀", () => {
    const days = [
      { ts: day(1), close: 100, volume: 500 },
      { ts: day(2), close: 97, volume: 480 },
      { ts: day(3), close: 105, volume: 520 },
      { ts: day(4), close: 92, volume: 510 },
      { ts: day(5), close: 103, volume: 490 },
      { ts: day(6), close: 88, volume: 470 }
    ];
    expect(markBaitDays(days).size).toBe(0);
  });

  it("volume 全为 0（无量数据）时不按量维度误杀", () => {
    const days = [
      { ts: day(1), close: 100, volume: 0 },
      { ts: day(2), close: 102, volume: 0 },
      { ts: day(3), close: 99, volume: 0 },
      { ts: day(4), close: 101, volume: 0 },
      { ts: day(5), close: 100, volume: 0 },
      { ts: day(6), close: 350, volume: 0 }
    ];
    expect(markBaitDays(days).size).toBe(0);
  });
});

describe("filterBaitDays / filterThinDays", () => {
  const rows = () => [
    { date: new Date(day(1)), closePrice: 100, volume: 50, extra: "a" },
    { date: new Date(day(2)), closePrice: 40, volume: 1, extra: "b" }, // 捡漏机会（少量+低价）
    { date: new Date(day(3)), closePrice: 350, volume: 1, extra: "c" }, // 钓单（少量+高价）
    { date: new Date(day(4)), closePrice: 102, volume: 52, extra: "d" },
    { date: new Date(day(5)), closePrice: 99, volume: 51, extra: "e" },
    { date: new Date(day(6)), closePrice: 101, volume: 49, extra: "f" }
  ];

  it("filterBaitDays（走势图）：只剔钓单，保留捡漏日", () => {
    const kept = filterBaitDays(rows());
    expect(kept.map((r) => r.extra)).toEqual(["a", "b", "d", "e", "f"]);
  });

  it("filterThinDays（med7）：剔除所有极少挂单日（含捡漏低价日）", () => {
    const kept = filterThinDays(rows());
    expect(kept.map((r) => r.extra)).toEqual(["a", "d", "e", "f"]);
  });

  it("BAIT_FILTER_RULES 常量可调且被两条规则使用", () => {
    expect(BAIT_FILTER_RULES.minSamples).toBe(5);
    expect(BAIT_FILTER_RULES.volumeRatio).toBe(0.2);
    expect(BAIT_FILTER_RULES.highPriceRatio).toBe(2);
  });
});
