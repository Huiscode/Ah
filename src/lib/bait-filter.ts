// 钓单 / 流动性过滤（相对物品自身历史）。分两个用途：
//
// 1. markBaitDays（走势图用）：只剔"极少挂单 + 极高价格"日——极少挂单的低价
//    是捡漏机会，保留；单个高价挂单污染走势，剔除。
// 2. markThinDays（7日参考 med7 用）：剔除**所有**极少挂单日（不论价格高低）——
//    极少挂单的价格无论高或低都不可靠：低价是可遇不可求的个例，计入会把
//    参考价拉低、制造假捡漏；高价是钓单。med7 只反映正常流动性下的价格中枢。
//
// 两条规则都必须对比物品自身历史：某物品若长久就是极少量挂单，那不叫
// "极少挂单"；只有远低于自身常态才判定。Auctionator 只保留约 7 天 daily，
// 样本不足时宁可不过滤（minSamples 保护），避免误杀常态商品。

export type BaitDay = {
  /** 日期（UTC 午夜）时间戳，用作过滤结果 key */
  ts: number;
  /** 当日收盘价（铜） */
  close: number;
  /** 当日最高在售量（Auctionator a 字段；缺失为 0） */
  volume: number;
};

export const BAIT_FILTER_RULES = {
  /** 该物品 Auctionator 日线少于该天数时不启用过滤（样本太少，分位不可靠） */
  minSamples: 5,
  /** volume < 自身中位数 × 此比例 → 极少挂单（在售量不足自身常态 1/5） */
  volumeRatio: 0.2,
  /** close > 自身中位数 × 此比例 → 极高价格（仅在同时极少挂单时判定为钓单） */
  highPriceRatio: 2
} as const;

/** 极少挂单日的 ts 集合（volume < 自身中位数 × volumeRatio，不论价格）。 */
export function markThinDays(days: BaitDay[]): Set<number> {
  const out = new Set<number>();
  if (days.length < BAIT_FILTER_RULES.minSamples) return out;
  const volumes = days.map((d) => d.volume).sort((a, b) => a - b);
  const medianVolume = volumes[Math.floor(volumes.length / 2)];
  // 中位数为 0（无在售量数据）时不参与判定，避免全量误杀。
  const volumeFloor = medianVolume > 0 ? medianVolume * BAIT_FILTER_RULES.volumeRatio : 0;
  for (const d of days) {
    if (volumeFloor > 0 && d.volume < volumeFloor) out.add(d.ts);
  }
  return out;
}

/** 钓单日（极少挂单 + 极高价格）的 ts 集合。 */
export function markBaitDays(days: BaitDay[]): Set<number> {
  const thin = markThinDays(days);
  if (thin.size === 0) return thin;
  const closes = days.map((d) => d.close).sort((a, b) => a - b);
  const medianClose = closes[Math.floor(closes.length / 2)];
  const highCeiling = medianClose * BAIT_FILTER_RULES.highPriceRatio;
  const out = new Set<number>();
  for (const d of days) {
    if (thin.has(d.ts) && d.close > highCeiling) out.add(d.ts);
  }
  return out;
}

/** 便捷封装：输入 daily 行，按给定标记集合剔除（默认 markBaitDays）。 */
export function filterDays<T extends { date: Date; closePrice: number; volume: number }>(
  rows: T[],
  flagged: Set<number>
): T[] {
  return rows.filter((r) => !flagged.has(r.date.getTime()));
}

/** 剔除钓单日（极少挂单+极高价格）后的行——走势图用。 */
export function filterBaitDays<T extends { date: Date; closePrice: number; volume: number }>(
  rows: T[],
  baitTs?: Set<number>
): T[] {
  const flagged = baitTs ?? markBaitDays(rows.map((r) => ({ ts: r.date.getTime(), close: r.closePrice, volume: r.volume })));
  return filterDays(rows, flagged);
}

/** 剔除所有极少挂单日后的行——7日参考（med7）用。 */
export function filterThinDays<T extends { date: Date; closePrice: number; volume: number }>(
  rows: T[],
  thinTs?: Set<number>
): T[] {
  const flagged = thinTs ?? markThinDays(rows.map((r) => ({ ts: r.date.getTime(), close: r.closePrice, volume: r.volume })));
  return filterDays(rows, flagged);
}
