// Single source of truth for the deal-radar rules. The in-game addon is
// retired (2026-10-13): rules no longer compile into Lua and there is no
// game-side authority panel. The web constants below are the defaults; a
// 网页"雷达设置"面板（src/app/api/radar-rules）可覆盖并存进 RadarRule 单行，
// page.tsx 用 mergeRadarRules 合并后传给 buildDealRadar。

// Pricing pipeline version, stamped into every scan. Consumers (tooltip,
// deal radar, desktop importer) reject any other value: a bump means the
// meaning of the stored prices changed, not just their values.
// 旧自研插件管线版本 = 4（插件已下线，不再产生新扫描；Auctionator 导入
// 不校验此版本）。保留原值以便历史 addon 数据与其测试继续成立。
export const SCAN_PIPELINE_VERSION = 4;

// Auction house cut on a successful sale (5%). Vendor deals are exempt:
// selling to an NPC charges no cut. Used to turn gross spreads into net profit.
export const AH_CUT = 0.05;

// DealRadarRules are web-side thresholds (no plugin authority anymore).
export type DealRadarRules = {
  minProfit: number;
  minHistory: number;
  minMed7Distinct: number;
  staleWindowMs: number;
};

// 2026-10-14 用户拍板：移除 maxDiscount（折扣下限）、supplyCap（供应上限）、
// discount（折扣线）、minProfitRatio（最低利润率）——门槛只留绝对利润、
// 历史天数与可信度，深折扣一律视为捡漏机会。
export const dealRadarRules: DealRadarRules = {
  minProfit: 50, // 50c absolute dust floor: below this the spread is noise, not a deal
  minHistory: 2, // med7 needs 2+ days of daily closes before it means anything
  // Credibility guard on med7 itself: a flat series is one seller, not a market.
  minMed7Distinct: 2, // a flat 7d series is one seller, not a market
  // 新鲜度窗口：手动全量扫描（Auctionator/transcript）低频，默认 7 天。
  staleWindowMs: 7 * 24 * 60 * 60 * 1000
};

// LocalFilterRules are web-only secondary filters over the current database.
// They are never compiled to Lua and never sent to the plugin; they live in
// localStorage and are applied client-side in the deal-radar table.
export type LocalFilterRules = {
  minPrice: number; // only rows with min price >= this (0 = off)
  maxPrice: number; // only rows with min price <= this (0 = off)
};

export const localFilterDefaults: LocalFilterRules = {
  minPrice: 0,
  maxPrice: 0
};

// Legacy route-2 overrides may still sit in RadarRule; merge them over the
// defaults, accepting only the known fields with sane types. (The plugin
// panel that wrote them is retired, so this is only a safety net.)
export function mergeRadarRules(overrides: unknown): DealRadarRules {
  if (typeof overrides !== "object" || overrides === null) return dealRadarRules;
  const source = overrides as Record<string, unknown>;
  const merged = { ...dealRadarRules } as Record<string, unknown>;
  for (const key of Object.keys(dealRadarRules)) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) merged[key] = value;
    else if (typeof value === "boolean") merged[key] = value;
  }
  return merged as DealRadarRules;
}
