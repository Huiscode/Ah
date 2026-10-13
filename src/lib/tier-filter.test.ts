import { describe, expect, it } from "vitest";
import { effectiveLowestPrice, TIER_FILTER_RULES } from "@/lib/tier-filter";

describe("effectiveLowestPrice", () => {
  it("正常多档物品：取最低档", () => {
    const r = effectiveLowestPrice([
      { price: 700, qty: 92 },
      { price: 800, qty: 36 },
      { price: 1100, qty: 101 }
    ]);
    expect(r.effectivePrice).toBe(700);
    expect(r.skipped).toEqual([]);
  });

  it("典型钓单（用户例）：第一档 1 单、第二档 100 单且断层 → 记录第二单", () => {
    const r = effectiveLowestPrice([
      { price: 5000, qty: 1 },
      { price: 10000, qty: 100 }
    ]);
    expect(r.effectivePrice).toBe(10000);
    expect(r.skipped).toEqual([{ price: 5000, qty: 1 }]);
  });

  it("用户方案 B：1+2 档同组稀薄且与第三档断层 → 1、2 档整组剔除", () => {
    const r = effectiveLowestPrice([
      { price: 5000, qty: 1 },
      { price: 5500, qty: 1 },
      { price: 10000, qty: 100 }
    ]);
    expect(r.effectivePrice).toBe(10000);
    expect(r.skipped).toEqual([
      { price: 5000, qty: 1 },
      { price: 5500, qty: 1 }
    ]);
  });

  it("量大的低价不剔除（真实捡漏机会）", () => {
    const r = effectiveLowestPrice([
      { price: 5000, qty: 50 },
      { price: 10000, qty: 10 }
    ]);
    expect(r.effectivePrice).toBe(5000);
    expect(r.skipped).toEqual([]);
  });

  it("总量 < minTotal（真实低流通）→ 不过滤，用最低档", () => {
    const r = effectiveLowestPrice([
      { price: 5000, qty: 1 },
      { price: 6000, qty: 1 }
    ]);
    expect(r.effectivePrice).toBe(5000);
    expect(r.skipped).toEqual([]);
  });

  it("只有一档 → 直接取该档", () => {
    const r = effectiveLowestPrice([{ price: 5000, qty: 3 }]);
    expect(r.effectivePrice).toBe(5000);
  });

  it("高价钓单不影响有效最低价（最低档量大即稳定）", () => {
    const r = effectiveLowestPrice([
      { price: 10000, qty: 100 },
      { price: 999999, qty: 1 }
    ]);
    expect(r.effectivePrice).toBe(10000);
    expect(r.skipped).toEqual([]);
  });

  it("同组小价差（无断层）→ 组稳定取最低档", () => {
    const r = effectiveLowestPrice([
      { price: 5000, qty: 1 },
      { price: 5100, qty: 100 }
    ]);
    expect(r.effectivePrice).toBe(5000);
    expect(r.skipped).toEqual([]);
  });

  it("断层但组量占比够 → 不跳过（组稳定）", () => {
    // 5000(50) vs 10000(10)：cum=50 ≥ 10×0.5 → 组稳定
    const r = effectiveLowestPrice([
      { price: 5000, qty: 50 },
      { price: 10000, qty: 10 }
    ]);
    expect(r.effectivePrice).toBe(5000);
  });

  it("断层且组量相对下一档稀薄（10 vs 100）→ 按用户规则剔除", () => {
    // 10 单@5000 只有下一档 100 单@10000 的 10% → 少量又极低 → 剔除
    const r = effectiveLowestPrice([
      { price: 5000, qty: 10 },
      { price: 10000, qty: 100 }
    ]);
    expect(r.effectivePrice).toBe(10000);
    expect(r.skipped).toEqual([{ price: 5000, qty: 10 }]);
  });

  it("链式断层：跳过钓单组后取稳定档", () => {
    const r = effectiveLowestPrice([
      { price: 100, qty: 1 },
      { price: 300, qty: 3 },   // 1 < 3×0.5 → 100 组跳过
      { price: 500, qty: 5 },   // 3 < 5×0.5=2.5? no → 组稳定
      { price: 10000, qty: 10000 }
    ]);
    expect(r.effectivePrice).toBe(300);
    expect(r.skipped).toEqual([{ price: 100, qty: 1 }]);
  });

  it("空输入 / 无效档位（qty=0 或 price=0）→ 空结果", () => {
    expect(effectiveLowestPrice([]).effectivePrice).toBeNull();
    const r = effectiveLowestPrice([
      { price: 0, qty: 5 },
      { price: 100, qty: 0 }
    ]);
    expect(r.effectivePrice).toBeNull();
    expect(r.total).toBe(0);
  });

  it("常量可调", () => {
    expect(TIER_FILTER_RULES.minTotal).toBe(3);
    expect(TIER_FILTER_RULES.cumRatio).toBe(0.5);
    expect(TIER_FILTER_RULES.gapRatio).toBe(1.3);
  });
});
