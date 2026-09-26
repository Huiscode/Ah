import { notFound } from "next/navigation";
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
import { AlertRulePanel } from "@/components/trader-panels";
import { WatchStar } from "@/components/watch-star";
import { Panel, PanelHeader } from "@/components/ui/panel";

export default async function ItemDetail({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const numericItemId = Number(itemId);
  const item = await getItemDetail(numericItemId);
  if (!item) notFound();
  const [watchedIds, alertRules] = await Promise.all([
    getWatchedItemIds(),
    prisma.alertRule.findMany({ where: { itemId: numericItemId } })
  ]);
  const now = new Date();
  const hasSnapshots = item.snapshots.length > 0;
  const signal = hasSnapshots ? buildMarketSignal(item, now) : null;
  const latestSnapshot = item.snapshots[item.snapshots.length - 1];
  const latestSource = (latestSnapshot?.source ?? "addon") as "addon" | "ahledger";
  const freshness = describeFreshness(latestSnapshot?.timestamp ?? null, now);
  // Daily candles and seasonality are scoped to the latest data channel:
  // the two channels carry different price metrics (addon P10 vs ahledger
  // median) and their OHLCV rows must not be blended.
  const sameSourceSummaries = item.dailySummaries.filter((summary) => (summary.source ?? "addon") === latestSource);
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
  // auto-rescan every ~15 min this is the actual trading chart. Both data
  // channels render as separate lines — primary = latest source, alt = the
  // other channel — so the two metrics are directly comparable.
  const intradayByTs = new Map<number, { price?: number; alt?: number; volume?: number }>();
  for (const snapshot of item.snapshots) {
    const source = (snapshot.source ?? "addon") as "addon" | "ahledger";
    const ts = snapshot.timestamp.getTime();
    const entry = intradayByTs.get(ts) ?? {};
    if (source === latestSource) {
      if (entry.price === undefined) {
        entry.price = snapshot.marketPrice;
        entry.volume = snapshot.quantity;
      }
    } else if (entry.alt === undefined) {
      entry.alt = snapshot.marketPrice;
    }
    intradayByTs.set(ts, entry);
  }
  const intradayData = Array.from(intradayByTs.entries())
    .sort(([left], [right]) => left - right)
    .map(([ts, entry]) => ({ ts, ...entry }));
  const intradaySeries = latestSource === "ahledger"
    ? [
        { key: "price" as const, color: "#ffc46b", name: "P50" },
        { key: "alt" as const, color: "#56c7ff", name: "P10" }
      ]
    : [
        { key: "price" as const, color: "#56c7ff", name: "P10" },
        { key: "alt" as const, color: "#ffc46b", name: "P50" }
      ];

  return (
    <main className="terminal-grid min-h-screen bg-terminal-bg p-3 text-slate-200">
      <div className="mb-3 flex items-center justify-between border border-terminal-border bg-terminal-panel px-4 py-3">
        <div>
          <div className="font-mono text-xs uppercase text-terminal-muted">商品终端</div>
          <h1 className={`flex items-center gap-2 font-mono text-2xl font-semibold ${qualityColorClass(item.quality)}`}><ItemIcon itemId={item.itemId} icon={item.icon} size={28} />{item.name}</h1>
          <div className={freshness.stale ? "font-mono text-xs text-terminal-red" : "font-mono text-xs text-terminal-green"}>
            数据更新于 {freshness.label}
          </div>
        </div>
        <span className="text-xl"><WatchStar itemId={item.itemId} watched={watchedIds.has(item.itemId)} /></span>
      </div>
      <div className="grid gap-3 xl:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          <Panel>
            <PanelHeader title="盘中走势 (逐次扫描)" />
            <div className="p-3">
              {intradayData.length >= 2
                ? <TimeSeriesChart data={intradayData} series={intradaySeries} />
                : <div className="p-4 font-mono text-xs text-terminal-muted">盘中曲线需要多次扫描——开 /wahauto 挂机自动积累（每约 15 分钟一个点），或等 AHledger 网站通道轮询积累</div>}
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="K线 (日线 OHLC)" />
            <div className="p-3">
              {candleData.length >= 2
                ? <CandlestickChart data={candleData} />
                : <div className="p-4 font-mono text-xs text-terminal-muted">
                    {latestSource === "ahledger"
                      ? "K 线需至少 2 天的网站数据（网站通道逐日积累）"
                      : "K 线需要至少 2 天的扫描数据"}
                  </div>}
            </div>
          </Panel>
          <Panel>
            <PanelHeader title={`星期几季节性 (${latestSource === "ahledger" ? "中位收盘" : "P10收盘"} · 相对全部天数中位数的偏差)`} />
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
                    <div className="text-xs uppercase text-terminal-muted">最新价{latestSource === "ahledger" ? " · P50" : " · P10"}</div>
                    <div className="text-2xl"><Coins copper={signal.price} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div><div className="text-terminal-muted">最低价</div><div><Coins copper={signal.minPrice} /></div></div>
                    <div><div className="text-terminal-muted">7日参考{latestSource === "ahledger" ? "（P50）" : "（P10）"}</div><div><Coins copper={signal.med7} /></div></div>
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
            <PanelHeader title="价格预警" />
            <AlertRulePanel itemId={item.itemId} rules={alertRules} />
          </Panel>
        </div>
      </div>
    </main>
  );
}
