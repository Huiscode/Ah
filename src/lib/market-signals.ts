// Serves homepage market signals from a per-snapshot-generation cache:
// the universe query and 2600x buildMarketSignal only rerun when a new
// scan lands OR item metadata changes OR the mode (current/history) flips,
// so filter/sort/page interactions pay one cheap timestamp probe instead of
// recomputing the whole market on every request.
import { buildMarketSignal, type MarketSignal } from "@/lib/analytics";
import type { MarketHistory } from "@/lib/market-data";
import { getLatestSnapshotTime, getItemMetaVersion, getMarketUniverse } from "@/lib/repositories";
import type { MarketMode } from "@/lib/repositories";
import { DEFAULT_SERVER } from "@/lib/servers";

type SignalFetchers = {
  getLatestSnapshotTime: (market: string, mode?: MarketMode, server?: string) => Promise<Date | null>;
  getItemMetaVersion: () => Promise<number>;
  getMarketUniverse: (market: string, mode?: MarketMode, server?: string) => Promise<MarketHistory[]>;
};

export function createMarketSignalSource(fetchers: SignalFetchers) {
  let cachedKey: string | null = null;
  let cachedSignals: MarketSignal[] = [];
  let cachedLatestAt: Date | null = null;

  return {
    async getMarketSignals(market: string = "faction", mode: MarketMode = "current", server: string = DEFAULT_SERVER): Promise<{ signals: MarketSignal[]; latestSnapshotAt: Date | null }> {
      const latestSnapshotAt = await fetchers.getLatestSnapshotTime(market, mode, server);
      if (latestSnapshotAt === null) {
        return { signals: [], latestSnapshotAt: null };
      }
      const metaVersion = await fetchers.getItemMetaVersion();
      // 缓存键含 server：欧服/中国服各自独立缓存，切服即重算，互不串味。
      const key = `${server}:${market}:${mode}:${latestSnapshotAt.getTime()}:${metaVersion}`;
      if (cachedKey !== key) {
        const universe = await fetchers.getMarketUniverse(market, mode, server);
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
