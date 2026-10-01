import { notFound } from "next/navigation";
import Link from "next/link";
import { buildMarketSignal, buildWeekdaySeasonality } from "@/lib/analytics";
import { getItemDetail, getWatchedItemIds } from "@/lib/repositories";
import { prisma } from "@/lib/prisma";
import { formatPercent } from "@/lib/utils";
import { formatTrendPercent, trendTextClass } from "@/lib/trend";
import { Coins } from "@/components/coins";
import { qualityColorClass } from "@/lib/quality";
import { ItemIcon } from "@/components/item-icon";
import { describeFreshness } from "@/lib/freshness";
import { CandlestickChart, TimeSeriesChart } from "@/components/charts";
import { WatchStar } from "@/components/watch-star";
import { CloseTabButton } from "@/components/close-tab-button";
import { Panel, PanelHeader } from "@/components/ui/panel";

export default async function ItemDetail({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const numericItemId = Number(itemId);
  const item = await getItemDetail(numericItemId);
  if (!item) notFound();

  const [watchedIds] = await Promise.all([
    getWatchedItemIds()
  ]);
  const now = new Date();
  const hasSnapshots = item.snapshots.length > 0;
  const signal = hasSnapshots ? buildMarketSignal(item, now) : null;
  const latestSnapshot = item.snapshots[item.snapshots.length - 1];
  const freshness = describeFreshness(latestSnapshot?.timestamp ?? null, now);
  // Daily candles and seasonality follow the addon channel — the only
  // channel that exists now; legacy ahledger rows (pre-purge) are excluded
  // so the K-line never blends two price metrics.
  const sameSourceSummaries = item.dailySummaries.filter((summary) => (summary.source ?? "addon") === "addon");
  const seasonality = buildWeekdaySeasonality(sameSourceSummaries);
  const weekdayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const candleData = sameSourceSummaries.map((summary) => ({
    label: summary.date.toLocaleString("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" }).slice(5, 10),
    open: summary.openPrice,
    close: summary.closePrice,
    high: summary.highPrice,
    low: summary.lowPrice,
    volume: summary.volume
  }));
  // Intraday view: raw scan snapshots. AH prices swing hour to hour; with
  // auto-rescan every ~15 min this is the actual trading chart. Each scan
  // carries both closes from the SAME scan: P10 (market price) and P50
  // (display-only market center), so the two curves are directly
  // comparable. Points predating the P50 curve have no alt value and the
  // P50 line simply starts there.
  const intradayByTs = new Map<number, { price?: number; alt?: number; volume?: number }>();
  for (const snapshot of item.snapshots) {
    if ((snapshot.source ?? "addon") !== "addon") continue;
    const ts = snapshot.timestamp.getTime();
    const entry = intradayByTs.get(ts) ?? {};
    if (entry.price === undefined) {
      entry.price = snapshot.marketPrice;
      entry.volume = snapshot.quantity;
    }
    if (entry.alt === undefined && snapshot.altPrice !== undefined) {
      entry.alt = snapshot.altPrice;
    }
    intradayByTs.set(ts, entry);
  }
  const intradayData = Array.from(intradayByTs.entries())
    .sort(([left], [right]) => left - right)
    .map(([ts, entry]) => ({ ts, ...entry }));
  const intradaySeries = [
    { key: "price" as const, color: "#56c7ff", name: "P10" },
    { key: "alt" as const, color: "#ffc46b", name: "P50" }
  ];

  return (
    <main className="terminal-grid min-h-screen bg-terminal-bg p-3 text-slate-200">
      <div className="relative mb-3 flex items-center justify-between border border-terminal-border bg-terminal-panel px-4 py-3">
        <div>
          <div className="font-mono text-xs uppercase text-terminal-muted">商品终端</div>
          <h1 className={`flex items-center gap-2 font-mono text-2xl font-semibold ${qualityColorClass(item.quality)}`}>
            <ItemIcon itemId={item.itemId} icon={item.icon} size={28} />{item.name}
            {item.turnoverScore >= 50
              ? <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-xs font-normal text-green-400">{item.turnoverScore}</span>
              : item.turnoverScore >= 15
                ? <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-normal text-amber-400">{item.turnoverScore}</span>
                : item.turnoverScore > 0
                  ? <span className="rounded bg-slate-500/15 px-1.5 py-0.5 text-xs font-normal text-slate-400">{item.turnoverScore}</span>
                  : null}
          </h1>
          <div className={freshness.stale ? "font-mono text-xs text-terminal-red" : "font-mono text-xs text-terminal-green"}>
            数据更新于 {freshness.label}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xl"><WatchStar itemId={item.itemId} watched={watchedIds.has(item.itemId)} /></span>
        </div>
        <div className="absolute left-1/2 -translate-x-1/2"><CloseTabButton /></div>
      </div>
      <div className="grid gap-3 xl:grid-cols-[1fr_420px]">
        <div className="space-y-3">
          <Panel>
            <PanelHeader title="盘中走势 (逐次扫描)" />
            <div className="p-3">
              {intradayData.length >= 2
                ? <TimeSeriesChart data={intradayData} series={intradaySeries} />
                : <div className="p-4 font-mono text-xs text-terminal-muted">盘中曲线需要多次扫描——开 /wahauto 挂机自动积累（每约 15 分钟一个点），P50 曲线从下次扫描起积累</div>}
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="K线 (日线 OHLC)" />
            <div className="p-3">
              {candleData.length >= 2
                ? <CandlestickChart data={candleData} />
                : <div className="p-4 font-mono text-xs text-terminal-muted">K 线需要至少 2 天的扫描数据</div>}
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="星期几季节性 (P10收盘 · 相对全部天数中位数的偏差)" />
            <div className="grid grid-cols-7 gap-px bg-terminal-border font-mono text-xs">
              {seasonality.map((day) => (
                <div key={day.weekday} className="bg-terminal-panel px-2 py-3 text-center">
                  <div className="uppercase text-terminal-muted">{weekdayNames[day.weekday]}</div>
                  <div className={"mt-1 " + trendTextClass(day.priceDeviation)}>
                    {formatTrendPercent(day.priceDeviation, 1)}
                  </div>
                  <div className="mt-1 text-[10px] text-terminal-muted">在售 {day.listedShare.toFixed(0)}% · n={day.sampleCount}</div>
                </div>
              ))}
              {seasonality.length === 0 && (
                <div className="col-span-7 bg-terminal-panel px-3 py-3 text-terminal-muted">数据不足，需要跨越至少一周的扫描积累</div>
              )}
            </div>
          </Panel>
        </div>
        <div className="space-y-3">
          <Panel>
            <PanelHeader title="行情概要" />
            <div className="space-y-3 p-4 font-mono text-sm">
              {!signal && <div className="text-xs text-terminal-muted">尚无扫描数据</div>}
              {signal && (
                <>
                  <div>
                    <div className="text-xs uppercase text-terminal-muted">市场价 · P10</div>
                    <div className="text-2xl"><Coins copper={signal.price} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div><div className="text-terminal-muted">最低价</div><div><Coins copper={signal.minPrice} /></div></div>
                    <div><div className="text-terminal-muted">7日参考（P10）</div><div><Coins copper={signal.med7} /></div></div>
                    <div><div className="text-terminal-muted">折扣</div><div className={signal.discountPercent >= 15 ? "text-terminal-green" : ""}>{signal.discountPercent.toFixed(0)}%</div></div>
                    <div><div className="text-terminal-muted">环比上次</div><div className={trendTextClass(signal.changePercent)}>{formatTrendPercent(signal.changePercent)}</div></div>
                    <div><div className="text-terminal-muted">在售量</div><div>{signal.quantity.toLocaleString("en-US")}</div></div>
                    <div><div className="text-terminal-muted">挂单数</div><div>{signal.numAuctions.toLocaleString("en-US")}</div></div>
                  </div>
                </>
              )}
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="价格档位" />
            <div className="p-4 font-mono text-xs">
              {(() => {
                const rp = latestSnapshot?.rawPayload as { ladder?: Array<{ price: number; count: number }> } | null;
                const ladder = rp?.ladder;
                if (!ladder || ladder.length === 0) return <div className="text-terminal-muted">最近一次扫描未记录价格档位（下次 /wahscan 后自动出现）</div>;
                return (
                  <table className="w-full">
                    <thead className="text-terminal-muted">
                      <tr><td className="py-1">价格</td><td className="text-right">数量</td><td className="text-right">累计</td></tr>
                    </thead>
                    <tbody>
                      {ladder.slice(0, 5).map((row, i) => {
                        const cum = ladder.slice(0, i + 1).reduce((s, r) => s + r.count, 0);
                        return (
                          <tr key={i} className={i === 0 ? "text-terminal-amber" : ""}>
                            <td className="py-1"><Coins copper={row.price} /></td>
                            <td className="text-right">{row.count}</td>
                            <td className="text-right text-terminal-muted">{cum}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </Panel>
        </div>
      </div>
    </main>
  );
}
