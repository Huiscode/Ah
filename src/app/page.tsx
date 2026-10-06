import { ArrowLeftRight, Bell, Hammer, RadioTower, Star } from "lucide-react";
import { buildDealRadar } from "@/lib/analytics";
import { evaluateAlertRules } from "@/lib/alerts";
import { buildFloorPriceIndex, computeRecipeProfits } from "@/lib/recipe-profits";
import { buildSecondaryMaterialRows } from "@/lib/secondary-materials";
import { mergeRadarRules } from "@/lib/market-rules";
import {
  getAlertRules,
  getItemVendorPrices,
  getLatestAddonRoundItemIds,
  getRadarRules,
  getRecipes,
  getWatchedItemIds
} from "@/lib/repositories";
import { getMarketSignals } from "@/lib/market-signals";
import { describeFreshness } from "@/lib/freshness";
import { filterSortSignals, MARKET_PAGE_SIZE, paginate, parseMarketView } from "@/lib/market-filter";
import { groupedCategoryOptions } from "@/lib/category-zh";
import { formatTrendPercent, trendTextClass } from "@/lib/trend";
import { Coins } from "@/components/coins";
import { qualityColorClass } from "@/lib/quality";
import { ItemIcon } from "@/components/item-icon";
import { ProductBadge } from "@/components/product-badge";
import { MarketTable } from "@/components/market-table";
import { WatchStar } from "@/components/watch-star";
import { DealRadarTable } from "@/components/deal-radar-table";
import { SecondaryMaterialsPanel } from "@/components/secondary-materials-panel";

import { PriceLadderPanel } from "@/components/price-ladder-panel";
import { FavoriteRecipesPanel } from "@/components/favorite-recipes-panel";
import { InstructionsPanel } from "@/components/instructions-panel";
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
  const [{ signals, latestSnapshotAt }, watchedIds, alertRules, storedRules, latestAddonRound, recipes, vendorPrices] = await Promise.all([
    getMarketSignals(),
    getWatchedItemIds(),
    getAlertRules(),
    getRadarRules(),
    getLatestAddonRoundItemIds(),
    // 关注配方面板展示配方库中被收藏的配方（craft + merchant 全量，
    // 面板按收藏过滤；收藏在 /recipes 配方库页设置）。
    getRecipes(),
    getItemVendorPrices()
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
  // for items the game is not currently listing — a stale row cannot be
  // bought in game. With no addon scan at all the radar has no universe.
  const deals = latestAddonRound === null ? allDeals : allDeals.filter((deal) => latestAddonRound.has(deal.itemId));
  const radarCategories = groupedCategoryOptions(Array.from(new Set(deals.map((deal) => deal.category))));
  const priceByItemId = new Map(signals.map((signal) => [signal.itemId, signal.price]));
  const turnoverByItemId = new Map(signals.map((signal) => [signal.itemId, signal.turnoverScore]));
  // P0-B: full-recipe profit library. Revenue side = live AH price (自扫P10
  // → 网站P50 per signal) or the vendor floor when the market has no listing;
  // the floor index merges the curated dictionary, DB Item.vendorPrice and
  // the vendorP the addon dumped with each recipe (freshest, and the only
  // source for Forever-only items).
  const floorPriceIndex = buildFloorPriceIndex(recipes, vendorPrices);
  const recipeRows = computeRecipeProfits(recipes, priceByItemId, floorPriceIndex);
  // 中间材料（次级材料）：配方产物且被其它配方用作材料，按单位利润排序。
  const secondaryRows = buildSecondaryMaterialRows(recipes, priceByItemId, floorPriceIndex);
  // 配方产出物集合：扫描物品若被某配方产出（成品），在列表中标记"产品"徽章。
  const productItemIds = new Set<number>();
  for (const recipe of recipes) for (const output of recipe.outputs) productItemIds.add(output.itemId);
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
          <Link href="/recipes" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-terminal-amber hover:underline"><Hammer size={14} /> 配方库</Link>
          <Link href="/ledger" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-terminal-amber hover:underline"><ArrowLeftRight size={14} /> 成交账本</Link>
          <span className="flex items-center gap-1"><Bell size={14} /> 预警就绪</span>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          <Panel>
            <PanelHeader title="捡漏雷达" action={<span className="font-mono text-xs text-terminal-green">共 {deals.length} 条 · 必赚 + 最低价 vs 7日参考价（自扫P10）</span>} />
            <div className="p-3 font-mono text-xs">
              {deals.length === 0 ? (
                <div className="text-terminal-muted">
                  {signals.length === 0 ? "暂无市场数据。进游戏 /wahscan 扫描。" : "当前没有满足流动性与利润门槛的捡漏挂单。"}
                </div>
              ) : (
                <DealRadarTable deals={deals} prices={priceByItemId} categories={radarCategories} watchedItemIds={Array.from(watchedIds)} productItemIds={productItemIds} />
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
              productItemIds={productItemIds}
            />
          </Panel>
        </div>
        <div className="space-y-3">
          <SecondaryMaterialsPanel rows={secondaryRows} prices={priceByItemId} floorPrices={floorPriceIndex} turnoverByItemId={turnoverByItemId} />
          <PriceLadderPanel />
          <FavoriteRecipesPanel rows={recipeRows} prices={priceByItemId} floorPrices={floorPriceIndex} />
          <Panel>
            <PanelHeader title="关注物品" action={<Star size={13} className="text-terminal-amber" />} />
            <div className="space-y-2 p-3 font-mono text-xs">
              {watchedSignals.length === 0 && <div className="text-terminal-muted">市场表中点 ☆ 添加关注</div>}
              {watchedSignals.map((signal) => (
                <div key={signal.itemId} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <WatchStar itemId={signal.itemId} watched />
                    <Link href={`/items/${signal.itemId}`} target="_blank" data-no-ladder className={`inline-flex items-center gap-1 ${qualityColorClass(signal.quality)}`}><ItemIcon itemId={signal.itemId} size={16} />{signal.name}</Link>
                    {productItemIds.has(signal.itemId) && <ProductBadge itemId={signal.itemId} />}
                  </span>
                  <span className="flex items-center gap-3">
                    <Coins copper={signal.price} />
                    <span className={trendTextClass(signal.changePercent)}>{formatTrendPercent(signal.changePercent)}</span>
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
      <InstructionsPanel />
      <footer className="mt-3 border border-terminal-border bg-terminal-panel px-4 py-2 font-mono text-[10px] leading-relaxed text-terminal-muted">
        数据来源：游戏内插件扫描（自扫 · 7日P10 口径；P50 为同源展示曲线，不参与参考价计算）。扫描数据即时回传，参考价统一按 P10 口径计算。
      </footer>
    </main>
  );
}
