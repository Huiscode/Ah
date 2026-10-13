// Single source of truth for the deal-radar rules. The in-game addon is
// retired (2026-10-13): rules no longer compile into Lua and there is no
// game-side authority panel — the web constants below are the only source.

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
  minProfitRatio: number;
  discount: number;
  minHistory: number;
  minMed7Distinct: number;
  maxDiscount: number;
  supplyCap: number;
};

export const dealRadarRules: DealRadarRules = {
  minProfit: 30, // 30c absolute dust floor: below this the spread is noise, not a deal
  minProfitRatio: 0.25, // profit must also be >= 25% of med7: scales with the (early-server) economy
  discount: 0.85, // 最低买入价 at 85% of med7 or lower
  minHistory: 3, // med7 needs 3+ days of daily closes before it means anything
  // Credibility guards on med7 itself. minHistory counts days but says
  // nothing about whether they mean anything: on a thin realm the bottom of
  // the book is often one camper, so every scan records that player's ask
  // and med7 becomes a price no listing ever traded against.
  minMed7Distinct: 2, // a flat 7d series is one seller, not a market
  maxDiscount: 0.75, // past 75% off, the reference is broken, not the listing cheap
  // Supply cap: 0 = off; >0 excludes items whose latest listed quantity
  // exceeds this (oversupplied goods are a hoarding risk).
  supplyCap: 0
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
