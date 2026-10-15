// Serves homepage market signals from a per-snapshot-generation cache:
// the universe query and 2600x buildMarketSignal only rerun when a new
// scan lands OR item metadata changes OR the mode (current/history) flips,
// so filter/sort/page interactions pay one cheap timestamp probe instead of
// recomputing the whole market on every request.
import { buildMarketSignal, type MarketSignal } from "@/lib/analytics";
import type { MarketHistory } from "@/lib/market-data";
import { getLatestSnapshotTime, getItemMetaVersion, getMarketUniverse } from "@/lib/repositories";
import type { MarketMode } from "@/lib/repositories";

type SignalFetchers = {
  getLatestSnapshotTime: (market?: string, mode?: MarketMode) => Promise<Date | null>;
  getItemMetaVersion: () => Promise<number>;
  getMarketUniverse: (mode?: MarketMode) => Promise<MarketHistory[]>;
};

export function createMarketSignalSource(fetchers: SignalFetchers) {
  let cachedKey: string | null = null;
  let cachedSignals: MarketSignal[] = [];
  let cachedLatestAt: Date | null = null;

  return {
    async getMarketSignals(mode: MarketMode = "current"): Promise<{ signals: MarketSignal[]; latestSnapshotAt: Date | null }> {
      const latestSnapshotAt = await fetchers.getLatestSnapshotTime("faction", mode);
      if (latestSnapshotAt === null) {
        return { signals: [], latestSnapshotAt: null };
      }
      const metaVersion = await fetchers.getItemMetaVersion();
      const key = `${mode}:${latestSnapshotAt.getTime()}:${metaVersion}`;
      if (cachedKey !== key) {
        const universe = await fetchers.getMarketUniverse(mode);
        // `now` is frozen per generation; med7's 7-day window drifting by
        // one scan interval is immaterial next to scan cadence.
        const now = new Date();
        cachedSignals = universe
          .filter((item) => item.snapshots.length > 0)
          .map((item) => buildMarketSignal(item, now, mode))
          .filter((signal): signal is MarketSignal => signal !== null)
          // price=0 = 本次扫描无在售（auctionator-import 对残留价已归 0）；
          // 不作为行情展示，也不进雷达/配方（避免"墨水 1 金"式旧价残留）。
          .filter((signal) => signal.price > 0);
        cachedLatestAt = latestSnapshotAt;
        cachedKey = key;
      }
      return { signals: cachedSignals, latestSnapshotAt: cachedLatestAt };
    }
  };
}

const defaultSource = createMarketSignalSource({ getLatestSnapshotTime, getItemMetaVersion, getMarketUniverse });

export const getMarketSignals = defaultSource.getMarketSignals;
