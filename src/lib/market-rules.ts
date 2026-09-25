// Single source of truth for the deal-radar rules and the scan pipeline
// version. The in-game addon (Lua) cannot import this at runtime — the
// game has no build step — so scripts/gen-lua-rules.ts compiles these
// values into addon/WoWderhoiAH/GeneratedRules.lua, and a drift test
// (scripts/gen-lua-rules.test.ts) asserts the committed Lua matches. Every
// TS consumer imports the constants here directly; nothing re-declares them.

// Pricing pipeline version, stamped into every scan. Consumers (tooltip,
// deal radar, desktop importer) reject any other value: a bump means the
// meaning of the stored prices changed, not just their values.
export const SCAN_PIPELINE_VERSION = 3;

export type DealRadarRules = {
  minProfit: number;
  minProfitRatio: number;
  discount: number;
  minAuctions: number;
  minHistory: number;
  minMed7Distinct: number;
  maxDiscount: number;
  supplyShrink: boolean;
  supplyShrinkMax: number;
  minAuctionsBoost: boolean;
  minAuctionsFloor: number;
  supplyCap: number;
};

export const dealRadarRules: DealRadarRules = {
  minProfit: 30, // 30c absolute dust floor: below this the spread is noise, not a deal
  minProfitRatio: 0.25, // profit must also be >= 25% of med7: scales with the (early-server) economy
  discount: 0.85, // min price at 85% of med7 or lower
  minAuctions: 3, // liquidity guard: fewer sellers = no real market
  minHistory: 3, // the P10 median needs depth before it means anything
  // Credibility guards on med7 itself. minHistory counts samples but says
  // nothing about whether they mean anything: on a thin realm the bottom of
  // the book is often one camper, so every scan records that player's ask
  // and med7 becomes a price no listing ever traded against.
  minMed7Distinct: 2, // a flat 7d P10 series is one seller, not a market
  maxDiscount: 0.75, // past 75% off, the reference is broken, not the listing cheap
  // Optional liquidity filters (route-2 tunables; all off by default).
  // A — supply-shrink gate: the last four scans' listed quantity must have
  // shrunk by at least |supplyShrinkMax|, i.e. the supply is being bought
  // up (fast turnover) rather than sitting on the board.
  supplyShrink: false,
  supplyShrinkMax: -0.15,
  // B — raise the liquidity floor from minAuctions to minAuctionsFloor.
  minAuctionsBoost: false,
  minAuctionsFloor: 5,
  // C — supply cap: 0 = off; >0 excludes items whose latest listed
  // quantity exceeds this (oversupplied goods are a hoarding risk).
  supplyCap: 0
};

// Route-2 overrides arrive with each scan import (the in-game options panel
// is the authority). Merge them over the compiled defaults, accepting only
// the known fields and only with sane types — anything malformed keeps the
// default so a bad payload can never cripple the radar.
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
