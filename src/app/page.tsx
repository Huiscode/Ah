import { Bell, CalendarClock, Hammer, RadioTower, Star } from "lucide-react";
import { buildDealRadar } from "@/lib/analytics";
import { evaluateAlertRules } from "@/lib/alerts";
import { buildFloorPriceIndex, computeRecipeProfits } from "@/lib/recipe-profits";
import { mergeRadarRules } from "@/lib/market-rules";
import {
  getAlertRules,
  getItemVendorPrices,
  getLatestAddonRoundItemIds,
  getRadarRules,
  getRecipes,
  getUpcomingEvents,
  getWatchedItemIds
} from "@/lib/repositories";
import { getMarketSignals } from "@/lib/market-signals";
import { getAppState } from "@/lib/app-state";
import { describeFreshness } from "@/lib/freshness";
import { filterSortSignals, MARKET_PAGE_SIZE, paginate, parseMarketView } from "@/lib/market-filter";
import { groupedCategoryOptions } from "@/lib/category-zh";
import { formatPercent } from "@/lib/utils";
import { formatTrendPercent, trendTextClass } from "@/lib/trend";
import { Coins } from "@/components/coins";
import { qualityColorClass } from "@/lib/quality";
import { ItemIcon } from "@/components/item-icon";
import { MarketTable } from "@/components/market-table";
import { WatchStar } from "@/components/watch-star";
import { AhledgerToggle } from "@/components/ahledger-toggle";
import { DealRadarTable } from "@/components/deal-radar-table";
import { getLatestLadders } from "@/lib/ladders";
import { RadarParamsPanel } from "@/components/radar-params-panel";
import { PriceLadderPanel } from "@/components/price-ladder-panel";
import { RecipeProfitPanel } from "@/components/recipe-profit-panel";
import { Panel, PanelHeader } from "@/components/ui/panel";
import Link from "next/link";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Chinese labels for the alert metrics surfaced on the dashboard; kept in
  // sync with components/trader-panels.tsx.
  const alertMetricLabels: Record<string, string> = {
    price: "市场价",
    minPrice: "最低价",
    med7: "7日参考",
    discountPercent: "折扣%",
    quantity: "在售量"
  };
  const view = parseMarketView(await searchParams);
  const [{ signals, latestSnapshotAt }, upcomingEvents, watchedIds, alertRules, storedRules, latestAddonRound, ahledgerEnabled, recipes, vendorPrices, ladders] = await Promise.all([
    getMarketSignals(),
    getUpcomingEvents(),
    getWatchedItemIds(),
    getAlertRules(),
    getRadarRules(),
    getLatestAddonRoundItemIds(),
    getAppState("ahledgerEnabled"),
    // 首页制造利润面板只展示专业配方（craft）；商人青睐兑换（merchant）
    // 在 /recipes 配方库页独立呈现。
    getRecipes("craft"),
    getItemVendorPrices(),
    getLatestLadders()
  ]);
  const freshness = describeFreshness(latestSnapshotAt, new Date());
  const watchedSignals = signals.filter((signal) => watchedIds.has(signal.itemId));
  const triggeredAlerts = evaluateAlertRules(alertRules, signals);
  // Route 2: the in-game options panel owns the radar thresholds; each scan
  // import replays them here, so this page renders deals with exactly the
  // rules the addon used. Without a stored override the compiled defaults
  // apply.
  const radarRules = mergeRadarRules(storedRules);
  const allDeals = buildDealRadar(signals, radarRules);
  // The in-game scan round owns the radar's universe: the addon only ever
  // iterates the items it just scanned, so the terminal must not offer deals
  // for items the game is not currently listing — an ahledger-only or stale
  // row cannot be bought in game. With no addon scan at all the website
  // channel is the only data and its whole universe applies.
  const deals = latestAddonRound === null ? allDeals : allDeals.filter((deal) => latestAddonRound.has(deal.itemId));
  const radarCategories = groupedCategoryOptions(Array.from(new Set(deals.map((deal) => deal.category))));
  const priceByItemId = new Map(signals.map((signal) => [signal.itemId, signal.price]));
  // P0-B: full-recipe profit library. Revenue side = live AH price (自扫P10
  // → 网站P50 per signal) or the vendor floor when the market has no listing;
  // the floor index merges the curated dictionary, DB Item.vendorPrice and
  // the vendorP the addon dumped with each recipe (freshest, and the only
  // source for Forever-only items).
  const floorPriceIndex = buildFloorPriceIndex(recipes, vendorPrices);
  const recipeRows = computeRecipeProfits(recipes, priceByItemId, floorPriceIndex);
  // 首页制造利润面板只看"基础加工"利润：矿石→锭（熔炼锭）、布料→卷（裁缝材料）、
  // 皮→熟化皮（制皮材料）、石头→砂轮（锻造材料）、草药/鱼→染料油剂（炼金材料）、
  // 元素/锭转化（炼金次级/强效转化）。端装装备、药水、烹饪等不在此列。
  const CONVERSION_CATEGORIES = new Set(["熔炼锭", "材料", "次级转化", "强效转化"]);
  const conversionRows = recipeRows.filter((row) => CONVERSION_CATEGORIES.has(row.recipe.categoryName ?? ""));
  // The client table only ever receives the visible page; filtering and
  // sorting run here against the URL-provided view.
  const filtered = filterSortSignals(signals, view);
  const marketPage = paginate(filtered, view.page, MARKET_PAGE_SIZE);
  const categories = groupedCategoryOptions(Array.from(new Set(signals.map((signal) => signal.category))));
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
          <AhledgerToggle initialEnabled={ahledgerEnabled !== "0"} />
          <Link href="/recipes" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-terminal-amber hover:underline"><Hammer size={14} /> 配方库</Link>
          <span className="flex items-center gap-1"><Bell size={14} /> 预警就绪</span>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          <Panel>
            <PanelHeader title="捡漏雷达" action={<span className="font-mono text-xs text-terminal-green">共 {deals.length} 条 · NPC必赚 + 最低价 vs 7日参考价（自扫P10/网站P50，按最新来源自动选口径）</span>} />
            <div className="p-3 font-mono text-xs">
              {deals.length === 0 ? (
                <div className="text-terminal-muted">
                  {signals.length === 0 ? "暂无市场数据。进游戏 /wahscan 扫描。" : "当前没有满足流动性与利润门槛的捡漏挂单。"}
                </div>
              ) : (
                <DealRadarTable deals={deals} prices={priceByItemId} categories={radarCategories} watchedItemIds={Array.from(watchedIds)} ladders={ladders} />
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
          <PriceLadderPanel />
          <RadarParamsPanel initialRules={radarRules} />
          <RecipeProfitPanel rows={conversionRows} prices={priceByItemId} floorPrices={floorPriceIndex} limitPerProfession={8} />
          <Panel>
            <PanelHeader title="触发的预警" action={<Bell size={13} className={triggeredAlerts.length > 0 ? "text-terminal-red" : "text-terminal-muted"} />} />
            <div className="space-y-2 p-3 font-mono text-xs">
              {triggeredAlerts.length === 0 && <div className="text-terminal-muted">无触发预警</div>}
              {triggeredAlerts.map((hit) => (
                <div key={hit.rule.id} className="flex items-center justify-between gap-2">
                  <Link href={`/items/${hit.signal.itemId}`} target="_blank" className="text-slate-100 hover:text-terminal-amber">{hit.signal.name}</Link>
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
                    <Link href={`/items/${signal.itemId}`} target="_blank" className={`inline-flex items-center gap-1 ${qualityColorClass(signal.quality)}`}><ItemIcon itemId={signal.itemId} size={16} />{signal.name}</Link>
                  </span>
                  <span className="flex items-center gap-3">
                    <Coins copper={signal.price} />
                    <span className={trendTextClass(signal.changePercent)}>{formatTrendPercent(signal.changePercent)}</span>
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
                  <span className="text-terminal-muted">{event.startTime.toLocaleString("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" })}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
      <footer className="mt-3 border border-terminal-border bg-terminal-panel px-4 py-2 font-mono text-[10px] leading-relaxed text-terminal-muted">
        数据来源：游戏内插件扫描（自扫 · 7日P10 口径）与 <a href="https://ahledger.com" target="_blank" rel="noopener noreferrer" className="text-terminal-amber underline">AHledger</a> 公开 API（网站 · 7日P50 口径，免费使用按授权条款标注来源）。两通道独立运行互不影响，参考价按数据来源分别计算、绝不混算。
      </footer>
    </main>
  );
}
