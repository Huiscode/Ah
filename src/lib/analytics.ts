// Snapshot-based market signals. Every statistic here follows the same
// philosophy as the in-game scanner: medians and percentiles over raw
// snapshots, never means over daily aggregates — means inherit every
// bait listing, and daily closes erase the hourly structure of the AH.
import type { MarketHistory, SnapshotSource } from "@/lib/market-data";
import { dealRadarRules, AH_CUT, type DealRadarRules } from "@/lib/market-rules";
import { isStale } from "@/lib/freshness";

export type MarketSignal = {
  itemId: number;
  name: string;
  category: string;
  quality: string;
  icon?: string | null; // in-game icon texture name, when known
  source?: SnapshotSource; // channel of the latest snapshot: "addon" (P10) | "ahledger" (median); absent = addon
  price: number; // latest snapshot's unit price (addon P10 / ahledger median), copper
  minPrice: number; // latest scan's minimum listed unit price
  quantity: number; // latest scan's listed quantity (supply, NOT sales)
  numAuctions: number;
  vendorPrice: number; // NPC sell price, copper; 0 = unsellable
  med7: number; // median snapshot close over the last 7 days, SAME source only
  med7Samples: number; // same-source snapshots inside the 7d window backing med7
  med7Distinct: number; // distinct closes in that window; 1 = flat series
  discountPercent: number; // how far the current min sits below med7
  changePercent: number; // latest close vs the previous same-source close
  latestAt: Date; // timestamp of the latest observation backing this signal
  turnoverScore: number; // #recipes that use this item as a reagent (higher = faster turnover)
  isVendorItem: boolean; // true = NPC sells this container/consumable (bottles, dyes, thread)
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MED_WINDOW_DAYS = 7;

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length / 2) - 1];
}

function snapshotSource(snapshot: { source?: string }): SnapshotSource {
  return snapshot.source === "ahledger" ? "ahledger" : "addon";
}

export function buildMarketSignal(item: MarketHistory, now: Date): MarketSignal {
  const snapshots = [...item.snapshots].sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
  if (snapshots.length === 0) {
    throw new Error(`buildMarketSignal: item ${item.itemId} has no snapshots — filter empty items before signalling`);
  }
  const latest = snapshots[snapshots.length - 1];
  const source = snapshotSource(latest);
  // All statistics are scoped to the latest snapshot's channel: the two
  // channels carry different price metrics (addon P10 vs ahledger median),
  // so mixing them inside one med7 window would fabricate a reference no
  // single observation ever produced. The reference follows whichever
  // channel supplied the latest round.
  const sameSource = snapshots.filter((snapshot) => snapshotSource(snapshot) === source);
  const previous = sameSource[sameSource.length - 2];
  const windowStart = now.getTime() - MED_WINDOW_DAYS * DAY_MS;
  const windowPrices = sameSource
    .filter((snapshot) => snapshot.timestamp.getTime() >= windowStart)
    .map((snapshot) => snapshot.marketPrice);
  const med7 = windowPrices.length > 0 ? median(windowPrices) : latest.marketPrice;
  return {
    itemId: item.itemId,
    name: item.name,
    category: item.category,
    quality: item.quality,
    icon: item.icon,
    source,
    price: latest.marketPrice,
    minPrice: latest.minPrice,
    quantity: latest.quantity,
    numAuctions: latest.numAuctions,
    vendorPrice: item.vendorPrice,
    med7,
    med7Samples: windowPrices.length,
    med7Distinct: new Set(windowPrices).size,
    discountPercent: med7 > 0 ? (1 - latest.minPrice / med7) * 100 : 0,
    changePercent: previous && previous.marketPrice > 0 ? ((latest.marketPrice - previous.marketPrice) / previous.marketPrice) * 100 : 0,
    latestAt: latest.timestamp,
    turnoverScore: item.turnoverScore ?? 0,
    isVendorItem: item.isVendorItem ?? false
  };
}

export type DealRadarRow = {
  itemId: number;
  name: string;
  quality: string;
  category: string;
  icon?: string | null; // in-game icon texture name, when known
  source?: SnapshotSource; // channel backing this deal's reference (P10 or median); absent = addon
  minPrice: number;
  reference: number; // vendorPrice for vendor deals, med7 otherwise
  profit: number; // copper spread between reference and current min
  vendor: boolean;
  discountPercent: number;
  changePercent: number;
  quantity: number;
  numAuctions: number;
  turnoverScore: number; // #recipes that use this item as reagent; higher = faster sell-through
};

// Deal radar, mirroring addon/WoWderhoiAH/Trade.lua refreshDeals: the two
// implementations must classify the same scan identically or the terminal
// promises deals the in-game buy list can't deliver. Both read the same
// thresholds; defaults come from the single source of truth
// (src/lib/market-rules.ts) and route-2 overrides arrive with each scan
// import (the in-game panel is the authority).
export function buildDealRadar(signals: MarketSignal[], rules: DealRadarRules = dealRadarRules, now: Date = new Date()): DealRadarRow[] {
  const {
    minProfit: RADAR_MIN_PROFIT,
    minProfitRatio: RADAR_MIN_PROFIT_RATIO,
    discount: RADAR_DISCOUNT,
    minAuctions: RADAR_MIN_AUCTIONS,
    minHistory: RADAR_MIN_HISTORY,
    minMed7Distinct: RADAR_MIN_MED7_DISTINCT,
    maxDiscount: RADAR_MAX_DISCOUNT,
    supplyCap: RADAR_SUPPLY_CAP
  } = rules;
  const minAuctionsGate = RADAR_MIN_AUCTIONS;
  const deals: DealRadarRow[] = [];
  for (const signal of signals) {
    // Skip NPC-sold containers/consumables (empty vials, lead vials, dyes,
    // thread). Their AH price is capped at the vendor floor, so flipping them
    // never makes money; the radar should never surface them.
    if (signal.isVendorItem) continue;
    // Freshness gate: skip deals whose latest observation is older than the
    // 2h stale window, so the radar never points at a price that already moved.
    if (isStale(signal.latestAt, now)) continue;
    // Class 1: vendor arbitrage. Listed below the NPC sell price is a
    // guaranteed profit with zero market risk — no history needed, and no
    // profit floor either: the NPC always buys, so even a 1c spread is
    // free money the moment you're already at the AH. Only addon scans
    // carry vendor prices, so vendor deals are inherently addon-sourced.
    if (signal.vendorPrice > 0 && signal.minPrice > 0 && signal.minPrice < signal.vendorPrice) {
      deals.push({
        itemId: signal.itemId,
        name: signal.name,
        quality: signal.quality,
        category: signal.category,
        icon: signal.icon,
        source: "addon",
        minPrice: signal.minPrice,
        reference: signal.vendorPrice,
        profit: signal.vendorPrice - signal.minPrice,
        vendor: true,
        discountPercent: (1 - signal.minPrice / signal.vendorPrice) * 100,
        changePercent: signal.changePercent,
        quantity: signal.quantity,
        numAuctions: signal.numAuctions,
        turnoverScore: signal.turnoverScore
      });
    // Class 2: median discount. Requires history depth (3+ scans) AND a
    // live market (3+ auctions) AND a worthwhile absolute spread —
    // otherwise the list fills with illiquid junk nobody ever buys. The
    // last two conditions distrust med7 itself: a flat series is one
    // camper's ask, and a discount past the cap means the reference broke,
    // not that the listing is cheap. Neither applies to vendor deals above.
    // The auction-count gate is addon-only: the AHledger pricetable carries
    // no auctions field, so ahledger rows report 0 and the liquidity guard
    // would otherwise block every website-sourced deal. Optional liquidity
    // gates A (supply shrinking) and C (supply cap) tighten the pool when
    // enabled; both only ever filter, never reorder.
    } else if (signal.med7Samples >= RADAR_MIN_HISTORY && signal.med7 > 0 && signal.minPrice > 0
      && (signal.source === "ahledger" || signal.numAuctions >= minAuctionsGate)
      && signal.med7 * (1 - AH_CUT) - signal.minPrice >= RADAR_MIN_PROFIT
      && signal.med7 * (1 - AH_CUT) - signal.minPrice >= signal.med7 * (1 - AH_CUT) * RADAR_MIN_PROFIT_RATIO
      && signal.minPrice <= signal.med7 * RADAR_DISCOUNT
      && signal.med7Distinct >= RADAR_MIN_MED7_DISTINCT
      && signal.minPrice >= signal.med7 * (1 - RADAR_MAX_DISCOUNT)
      && (RADAR_SUPPLY_CAP <= 0 || signal.quantity <= RADAR_SUPPLY_CAP)) {
      deals.push({
        itemId: signal.itemId,
        name: signal.name,
        quality: signal.quality,
        category: signal.category,
        icon: signal.icon,
        source: signal.source,
        minPrice: signal.minPrice,
        reference: signal.med7,
        profit: Math.floor(signal.med7 * (1 - AH_CUT) - signal.minPrice),
        vendor: false,
        discountPercent: signal.discountPercent,
        changePercent: signal.changePercent,
        quantity: signal.quantity,
        numAuctions: signal.numAuctions,
        turnoverScore: signal.turnoverScore
      });
    }
  }
  // Vendor deals first (risk-free), then by turnover score (faster sellers),
  // then by absolute profit. High-turnover items liquidate quickly; stacking
  // profit on a slow mover ties up gold that could be rotating on a fast one.
  return deals.sort((left, right) => {
    if (left.vendor !== right.vendor) return left.vendor ? -1 : 1;
    if (left.turnoverScore !== right.turnoverScore) return right.turnoverScore - left.turnoverScore;
    return right.profit - left.profit;
  });
}

export type WeekdaySeasonality = {
  weekday: number; // 0 = Sunday .. 6 = Saturday (UTC)
  priceDeviation: number; // weekday median close vs overall median, percent
  listedShare: number; // weekday share of total listed quantity, percent
  sampleCount: number;
};

// WoW trading has a weekly pulse (reset day, raid nights); weekday
// medians make the cycle visible without one spike day skewing it.
export function buildWeekdaySeasonality(
  summaries: Array<{ date: Date; closePrice: number; volume: number }>
): WeekdaySeasonality[] {
  if (summaries.length === 0) return [];
  const overallMedian = median(summaries.map((summary) => summary.closePrice));
  const totalListed = summaries.reduce((sum, summary) => sum + summary.volume, 0);
  const byWeekday = new Map<number, { closes: number[]; listed: number }>();
  for (const summary of summaries) {
    const weekday = summary.date.getUTCDay();
    const bucket = byWeekday.get(weekday) ?? { closes: [], listed: 0 };
    bucket.closes.push(summary.closePrice);
    bucket.listed += summary.volume;
    byWeekday.set(weekday, bucket);
  }
  return Array.from(byWeekday.entries())
    .sort(([left], [right]) => left - right)
    .map(([weekday, bucket]) => ({
      weekday,
      priceDeviation: overallMedian === 0 ? 0 : ((median(bucket.closes) - overallMedian) / overallMedian) * 100,
      listedShare: totalListed === 0 ? 0 : (bucket.listed / totalListed) * 100,
      sampleCount: bucket.closes.length
    }));
}
