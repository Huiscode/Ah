// Serves homepage market signals from a per-snapshot-generation cache:
// the universe query and 2600x buildMarketSignal only rerun when a new
// scan lands OR item metadata changes, so filter/sort/page interactions pay
// one cheap timestamp probe instead of recomputing the whole market on
// every request.
import { buildMarketSignal, type MarketSignal } from "@/lib/analytics";
import type { MarketHistory } from "@/lib/market-data";
import { getLatestSnapshotTime, getItemMetaVersion, getMarketUniverse } from "@/lib/repositories";

type SignalFetchers = {
  getLatestSnapshotTime: () => Promise<Date | null>;
  getItemMetaVersion: () => Promise<number>;
  getMarketUniverse: () => Promise<MarketHistory[]>;
};

export function createMarketSignalSource(fetchers: SignalFetchers) {
  let cachedKey: string | null = null;
  let cachedSignals: MarketSignal[] = [];

  return {
    async getMarketSignals(): Promise<{ signals: MarketSignal[]; latestSnapshotAt: Date | null }> {
      const latestSnapshotAt = await fetchers.getLatestSnapshotTime();
      if (latestSnapshotAt === null) {
        return { signals: [], latestSnapshotAt: null };
      }
      const metaVersion = await fetchers.getItemMetaVersion();
      const key = `${latestSnapshotAt.getTime()}:${metaVersion}`;
      if (cachedKey !== key) {
        const universe = await fetchers.getMarketUniverse();
        // `now` is frozen per generation; med7's 7-day window drifting by
        // one scan interval (<=15 min) is immaterial next to scan cadence.
        const now = new Date();
        cachedSignals = universe
          .filter((item) => item.snapshots.length > 0)
          .map((item) => buildMarketSignal(item, now));
        cachedKey = key;
      }
      return { signals: cachedSignals, latestSnapshotAt };
    }
  };
}

const defaultSource = createMarketSignalSource({ getLatestSnapshotTime, getItemMetaVersion, getMarketUniverse });

export const getMarketSignals = defaultSource.getMarketSignals;
