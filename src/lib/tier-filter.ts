// 档位（价格阶梯）过滤：把单次扫描的完整档位列表压缩成"有效最低价"。
//
// 背景（M4，用户 2026-10-13 拍板）：Auctionator 存档只有聚合价（m/l/h/a），
// 拿不到"第一档 1 单、第二档 100 单"这类档位信息；转录插件（WoWderhoiAH-
// Transcript）已开始把完整档位落盘。本模块从档位里剔除"稀薄 + 断层"的
// 钓单档，把 NPC 必赚式极低钓单和极端高价钓单摘出 7 日参考（med7），同时
// 保留真实捡漏机会（量大低价不剔）。
//
// 判定（从最低价档向上走，按"价格组"处理）：
//   - 同组：与下一档价差 < gapRatio（价格连续，视为同一价位带）
//   - 断层：下一档单价 ≥ 组末档单价 × gapRatio（跳价）
//   - 组跳过：遇到断层时，若"组内累计量 < 下一档数量 × cumRatio"（组相对
//     下一档稀薄，对应"1+2 档总和比第三档少多少就不计入"），整组剔除，
//     从下一档开始新组；否则组稳定，有效最低价 = 组内最低档。
//   - 最后一档永远稳定（没人挂更贵）；总量 < minTotal 时不过滤（真实低流通）。

export type PriceTier = {
  /** 单价（铜） */
  price: number;
  /** 该价位的在售数量 */
  qty: number;
};

export type TierFilterResult = {
  /** 有效最低价（铜）；无有效档时为 null */
  effectivePrice: number | null;
  /** 有效价位的在售量（该档自身 qty） */
  effectiveQty: number;
  /** 被剔除的档（钓单） */
  skipped: PriceTier[];
  /** 参与判定的总在售量 */
  total: number;
};

export const TIER_FILTER_RULES = {
  /** 总在售量小于该值时不过滤（真实低流通物品，保底用最低档） */
  minTotal: 3,
  /** 组累计量 < 下一档数量 × 该值 → 组相对下一档稀薄 */
  cumRatio: 0.5,
  /** 下一档单价 ≥ 本档单价 × 该值 → 价格断层（跳价） */
  gapRatio: 1.3
} as const;

/** 输入档位（升序、同价已合并、qty>0），返回有效最低价与剔除明细。 */
export function effectiveLowestPrice(tiers: PriceTier[]): TierFilterResult {
  const clean = tiers
    .filter((t) => t.price > 0 && t.qty > 0)
    .sort((a, b) => a.price - b.price);
  const total = clean.reduce((s, t) => s + t.qty, 0);
  if (clean.length === 0) return { effectivePrice: null, effectiveQty: 0, skipped: [], total: 0 };
  if (total < TIER_FILTER_RULES.minTotal || clean.length === 1) {
    return { effectivePrice: clean[0].price, effectiveQty: clean[0].qty, skipped: [], total };
  }

  const skipped: PriceTier[] = [];
  let groupStart = 0; // 当前组的首档下标
  let groupCum = 0;   // 当前组累计量
  for (let i = 0; i < clean.length; i++) {
    groupCum += clean[i].qty;
    const next = clean[i + 1];
    if (!next) {
      // 最后一档：当前组稳定（没人挂更贵），有效价 = 组内最低档。
      return { effectivePrice: clean[groupStart].price, effectiveQty: clean[groupStart].qty, skipped, total };
    }
    const gap = next.price >= clean[i].price * TIER_FILTER_RULES.gapRatio;
    if (!gap) continue; // 同组（价格连续）
    // 遇到断层：当前组 vs 下一档
    if (groupCum < next.qty * TIER_FILTER_RULES.cumRatio) {
      // 组相对下一档稀薄 → 整组是钓单，剔除，从下一档开始新组。
      for (let j = groupStart; j <= i; j++) skipped.push(clean[j]);
      groupStart = i + 1;
      groupCum = 0;
      continue;
    }
    // 组稳定 → 有效最低价 = 组内最低档。
    return { effectivePrice: clean[groupStart].price, effectiveQty: clean[groupStart].qty, skipped, total };
  }
  // 防御：不可达（最后一档必然返回）。
  return { effectivePrice: clean[0].price, effectiveQty: clean[0].qty, skipped, total };
}
