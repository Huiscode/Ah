import { Bell, CalendarClock, Hammer, RadioTower, Star } from "lucide-react";
import { buildDealRadar } from "@/lib/analytics";
import { evaluateAlertRules } from "@/lib/alerts";
import { computeCraftProfits, craftRecipes } from "@/lib/crafting";
import { mergeRadarRules } from "@/lib/market-rules";
import {
  getAlertRules,
  getRadarRules,
  getUpcomingEvents,
  getWatchedItemIds
} from "@/lib/repositories";
import { getMarketSignals } from "@/lib/market-signals";
import { describeFreshness } from "@/lib/freshness";
import { filterSortSignals, MARKET_PAGE_SIZE, paginate, parseMarketView } from "@/lib/market-filter";
import { formatPercent } from "@/lib/utils";
import { Coins } from "@/components/coins";
import { qualityColorClass } from "@/lib/quality";
import { ItemIcon } from "@/components/item-icon";
import { MarketTable } from "@/components/market-table";
import { WatchStar } from "@/components/watch-star";
import { DealRadarTable } from "@/components/deal-radar-table";
import { RadarParamsPanel } from "@/components/radar-params-panel";
import { Panel, PanelHeader } from "@/components/ui/panel";
import Link from "next/link";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Chinese labels for the alert metrics surfaced on the dashboard; kept in
  // sync with components/trader-panels.tsx.
  const alertMetricLabels: Record<string, string> = {
    price: "P10 市价",
    minPrice: "最低价",
    med7: "7日P10中位",
    discountPercent: "折扣%",
    quantity: "在售量"
  };
  const view = parseMarketView(await searchParams);
  const [{ signals, latestSnapshotAt }, upcomingEvents, watchedIds, alertRules, storedRules] = await Promise.all([
    getMarketSignals(),
    getUpcomingEvents(),
    getWatchedItemIds(),
    getAlertRules(),
    getRadarRules()
  ]);
  const freshness = describeFreshness(latestSnapshotAt, new Date());
  const watchedSignals = signals.filter((signal) => watchedIds.has(signal.itemId));
  const triggeredAlerts = evaluateAlertRules(alertRules, signals);
  // Route 2: the in-game options panel owns the radar thresholds; each scan
  // import replays them here, so this page renders deals with exactly the
  // rules the addon used. Without a stored override the compiled defaults
  // apply.
  const radarRules = mergeRadarRules(storedRules);
  const deals = buildDealRadar(signals, radarRules);
  const priceByItemId = new Map(signals.map((signal) => [signal.itemId, signal.price]));
  const craftRows = computeCraftProfits(craftRecipes, priceByItemId);
  const craftOk = craftRows.filter((row) => row.status === "ok");
  const craftMissingCount = craftRows.length - craftOk.length;
  // The client table only ever receives the visible page; filtering and
  // sorting run here against the URL-provided view.
  const filtered = filterSortSignals(signals, view);
  const marketPage = paginate(filtered, view.page, MARKET_PAGE_SIZE);
  const categories = Array.from(new Set(signals.map((signal) => signal.category))).sort();
  const pageWatchedIds = marketPage.rows.filter((signal) => watchedIds.has(signal.itemId)).map((signal) => signal.itemId);

  return (
    <main className="terminal-grid min-h-screen bg-terminal-bg p-3 text-slate-200">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border border-terminal-border bg-terminal-panel px-4 py-3">
        <div>
          <h1 className="font-mono text-lg font-semibold uppercase text-terminal-amber">WoWderhoi AHelper</h1>
          <p className="font-mono text-xs text-terminal-muted">无限拍卖行行情与短线交易终端</p>
        </div>
        <div className="flex items-center gap-3 font-mono text-xs text-terminal-muted">
          <span className={freshness.stale ? "flex items-center gap-1 text-terminal-red" : "flex items-center gap-1 text-terminal-green"}>
            <RadioTower size={14} /> 数据更新于 {freshness.label}
          </span>
          <span className="flex items-center gap-1"><Bell size={14} /> 预警就绪</span>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          <Panel>
            <PanelHeader title="捡漏雷达" action={<span className="font-mono text-xs text-terminal-green">共 {deals.length} 条 · NPC必赚 + 最低价 vs 7日P10中位</span>} />
            <div className="p-3 font-mono text-xs">
              {deals.length === 0 ? (
                <div className="text-terminal-muted">
                  {signals.length === 0 ? "暂无市场数据。进游戏 /wahscan 扫描。" : "当前没有满足流动性与利润门槛的捡漏挂单。"}
                </div>
              ) : (
                <DealRadarTable deals={deals} prices={priceByItemId} />
              )}
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="市场监控" />
            <MarketTable
              rows={marketPage.rows}
              watchedItemIds={pageWatchedIds}
              view={view}
              categories={categories}
              totalCount={signals.length}
              filteredCount={filtered.length}
              page={marketPage.page}
              pageCount={marketPage.pageCount}
            />
          </Panel>
        </div>
        <div className="space-y-3">
          <Panel>
            <PanelHeader title="制造利润" action={<Hammer size={13} className="text-terminal-muted" />} />
            <div className="space-y-2 p-3 font-mono text-xs">
              {craftOk.length === 0 && (
                <div className="text-terminal-muted">扫描覆盖配方材料与成品后此处显示利润排行</div>
              )}
              {craftOk.slice(0, 8).map((row) => (
                <div key={row.recipe.name} className="flex items-center justify-between gap-2">
                  <span className="text-slate-100">{row.recipe.name}<span className="ml-1 text-[10px] text-terminal-muted">{row.recipe.profession}</span></span>
                  <span className="flex items-center gap-3">
                    <span className={row.profit >= 0 ? "text-terminal-green" : "text-terminal-red"}><Coins copper={row.profit} /></span>
                    <span className={row.marginPercent >= 0 ? "text-terminal-green" : "text-terminal-red"}>{formatPercent(row.marginPercent)}</span>
                  </span>
                </div>
              ))}
              {craftMissingCount > 0 && (
                <div className="border-t border-terminal-border pt-2 text-[10px] text-terminal-muted">
                  另有 {craftMissingCount} 个配方因缺少价格数据未计算
                </div>
              )}
            </div>
          </Panel>
          <RadarParamsPanel note="游戏内权威 · 扫描后同步">
            <div className="space-y-2 font-mono text-xs">
              <p className="text-[10px] leading-relaxed text-terminal-muted">
                这些阈值在游戏内修改（拍卖行面板「设置」按钮或 /wahopt），改动立即生效并随下次扫描同步回这里。此处为只读跟随。捡漏雷达同时受 NPC 必赚（无门槛）与以下第二档门槛约束。
              </p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-100">绝对利润下限</span>
                <Coins copper={radarRules.minProfit} />
              </div>
              <p className="-mt-1 text-[10px] leading-relaxed text-terminal-muted">利润低于此铜币数的价差视为噪音而非机会。</p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-100">相对利润下限</span>
                <span>{formatPercent(radarRules.minProfitRatio * 100).replace(/^\+/, "")}</span>
              </div>
              <p className="-mt-1 text-[10px] leading-relaxed text-terminal-muted">利润还须达到 7 日 P10 中位的该比例，让下限随物价缩放。0.25 = 利润不低于中位的 25%。</p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-100">最大折扣</span>
                <span>{formatPercent(radarRules.maxDiscount * 100).replace(/^\+/, "")}</span>
              </div>
              <p className="-mt-1 text-[10px] leading-relaxed text-terminal-muted">雷达信任的最大折扣深度；超过此深度说明参考价已失效，而不是挂单便宜。0.75 = 最多信任低于中位 75%。</p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-100">最低挂单数</span>
                <span>{radarRules.minAuctions}</span>
              </div>
              <p className="-mt-1 text-[10px] leading-relaxed text-terminal-muted">构成真实市场所需的最低挂单数；挂单太少就没有可买入的市场。</p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-100">历史样本数</span>
                <span>{radarRules.minHistory}</span>
              </div>
              <p className="-mt-1 text-[10px] leading-relaxed text-terminal-muted">7 日窗口内中位有效所需的最少扫描次数；历史太浅时中位没有意义。</p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-100">中位去重样本</span>
                <span>{radarRules.minMed7Distinct}</span>
              </div>
              <p className="-mt-1 text-[10px] leading-relaxed text-terminal-muted">要求的 7 日 P10 去重样本数。完全平坦的序列是一个蹲守卖家的报价，不是市场，雷达拒绝按它折扣。</p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-100">供给收缩</span>
                <span className={radarRules.supplyShrink ? "text-terminal-green" : "text-terminal-muted"}>{radarRules.supplyShrink ? `开（≤${formatPercent(Math.abs(radarRules.supplyShrinkMax) * 100)}）` : "关"}</span>
              </div>
              <p className="-mt-1 text-[10px] leading-relaxed text-terminal-muted">开启后要求最近 4 次扫描的在售量净收缩至少 {formatPercent(Math.abs(radarRules.supplyShrinkMax) * 100)}——供给在被买走，周转快、囤积风险低。关闭则不要求。</p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-100">流动性下限</span>
                <span className={radarRules.minAuctionsBoost ? "text-terminal-green" : "text-terminal-muted"}>{radarRules.minAuctionsBoost ? `开（≥${radarRules.minAuctionsFloor}）` : "关"}</span>
              </div>
              <p className="-mt-1 text-[10px] leading-relaxed text-terminal-muted">开启后最低挂单数从默认门槛提高到 {radarRules.minAuctionsFloor}，更严格的流动性门槛。</p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-100">供给量上限</span>
                <span className={radarRules.supplyCap > 0 ? "text-terminal-green" : "text-terminal-muted"}>{radarRules.supplyCap > 0 ? radarRules.supplyCap.toLocaleString("zh-CN") : "关（0）"}</span>
              </div>
              <p className="-mt-1 text-[10px] leading-relaxed text-terminal-muted">排除最新在售量超过该上限的物品——供给过剩的商品有囤积风险。0 表示不设上限。</p>
            </div>
          </RadarParamsPanel>
          <Panel>
            <PanelHeader title="触发的预警" action={<Bell size={13} className={triggeredAlerts.length > 0 ? "text-terminal-red" : "text-terminal-muted"} />} />
            <div className="space-y-2 p-3 font-mono text-xs">
              {triggeredAlerts.length === 0 && <div className="text-terminal-muted">无触发预警</div>}
              {triggeredAlerts.map((hit) => (
                <div key={hit.rule.id} className="flex items-center justify-between gap-2">
                  <Link href={`/items/${hit.rule.itemId}`} className="text-slate-100 hover:text-terminal-amber">{hit.signal.name}</Link>
                  <span className="text-terminal-red">
                    {alertMetricLabels[hit.rule.metric] ?? hit.rule.metric} {hit.rule.operator === "gt" ? ">" : "<"} {hit.rule.threshold}（现 {hit.actual.toFixed(2)}）
                  </span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="关注列表" action={<Star size={13} className="text-terminal-amber" />} />
            <div className="space-y-2 p-3 font-mono text-xs">
              {watchedSignals.length === 0 && <div className="text-terminal-muted">市场表中点 ☆ 添加关注</div>}
              {watchedSignals.map((signal) => (
                <div key={signal.itemId} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <WatchStar itemId={signal.itemId} watched />
                    <Link href={`/items/${signal.itemId}`} className={`inline-flex items-center gap-1 ${qualityColorClass(signal.quality)}`}><ItemIcon itemId={signal.itemId} size={16} />{signal.name}</Link>
                  </span>
                  <span className="flex items-center gap-3">
                    <Coins copper={signal.price} />
                    <span className={signal.changePercent >= 0 ? "text-terminal-red" : "text-terminal-green"}>{formatPercent(signal.changePercent)}</span>
                  </span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="版本日历" action={<CalendarClock size={13} className="text-terminal-muted" />} />
            <div className="space-y-2 p-3 font-mono text-xs">
              {upcomingEvents.length === 0 && <div className="text-terminal-muted">暂无已录入的版本事件</div>}
              {upcomingEvents.map((event) => (
                <div key={event.id} className="flex items-center justify-between gap-2">
                  <span className="text-slate-200">{event.eventName}</span>
                  <span className="text-terminal-muted">{event.startTime.toISOString().slice(0, 10)}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </main>
  );
}
