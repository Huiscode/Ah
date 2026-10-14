import { Bell, Hammer, RadioTower, Star } from "lucide-react";
import { buildDealRadar } from "@/lib/analytics";
import { evaluateAlertRules } from "@/lib/alerts";
import { buildRecipeFloors, computeRecipeProfits } from "@/lib/recipe-profits";
import { buildSecondaryMaterialRows } from "@/lib/secondary-materials";
import { mergeRadarRules } from "@/lib/market-rules";
import {
  getAlertRules,
  getItemSellerPrices,
  getItemVendorPrices,
  getLatestRoundItemIds,
  getLatestSnapshotTime,
  getRadarRules,
  getRecipes,
  getWatchedItemIds,
  type MarketMode
} from "@/lib/repositories";
import { getMarketSignals } from "@/lib/market-signals";
import { AUCTIONATOR_STALE_MAX_AGE_MS, describeFreshness } from "@/lib/freshness";
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

import { FavoriteRecipesPanel } from "@/components/favorite-recipes-panel";
import { InstructionsPanel } from "@/components/instructions-panel";
import { Panel, PanelHeader } from "@/components/ui/panel";
import Link from "next/link";

// 数据口径断点：2026-10-13 起为 Auctionator 最低价；此前为自研插件 Beta P10。
const DATA_SWITCH_DAY = "2026-10-13";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Chinese labels for the alert metrics surfaced on the dashboard; kept in
  // sync with components/trader-panels.tsx.
  const alertMetricLabels: Record<string, string> = {
    price: "最低买入价",
    minPrice: "最低价",
    med7: "7日参考",
    discountPercent: "折扣%",
    quantity: "在售量"
  };
  const raw = await searchParams;
  const mode: MarketMode = raw.history === "1" ? "history" : "current";
  const view = parseMarketView(raw);
  const [{ signals, latestSnapshotAt }, watchedIds, alertRules, latestRound, recipes, vendorPrices, sellerPrices] = await Promise.all([
    getMarketSignals(mode),
    getWatchedItemIds(),
    getAlertRules(),
    // 雷达 universe：该模式最新一轮扫描的在售物品集合。
    getLatestRoundItemIds(mode),
    // 关注配方面板展示配方库中被收藏的配方（craft + merchant 全量，
    // 面板按收藏过滤；收藏在 /recipes 配方库页设置）。
    getRecipes(),
    getItemVendorPrices(),
    getItemSellerPrices()
  ]);
  const freshness = describeFreshness(latestSnapshotAt, new Date(), AUCTIONATOR_STALE_MAX_AGE_MS);
  const watchedSignals = signals.filter((signal) => watchedIds.has(signal.itemId));
  const triggeredAlerts = evaluateAlertRules(alertRules, signals);
  // 雷达阈值：默认常量（market-rules.ts）+ 网页"雷达设置"面板的覆盖
  // （RadarRule 单行，经 /api/radar-rules 读写；mergeRadarRules 合并）。
  const radarRules = mergeRadarRules(await getRadarRules());
  const allDeals = buildDealRadar(signals, radarRules);
  // 该模式最新扫描轮 owns the radar's universe：只推荐该模式数据源在售的物品。
  const deals = latestRound === null ? allDeals : allDeals.filter((deal) => latestRound.has(deal.itemId));
  const radarCategories = groupedCategoryOptions(Array.from(new Set(deals.map((deal) => deal.category))));
  const priceByItemId = new Map(signals.map((signal) => [signal.itemId, signal.price]));
  const turnoverByItemId = new Map(signals.map((signal) => [signal.itemId, signal.turnoverScore]));
  // P0-B: full-recipe profit library. Revenue side = live AH price (自扫P10
  // → 网站P50 per signal) or the vendor floor when the market has no listing;
  // cost floor prefers the NPC sell price (Item.sellPrice, in-game merchant
  // transcription) over the buy price (Item.vendorPrice / dictionary), then
  // the vendorP the addon dumped with each recipe (freshest).
  const floors = buildRecipeFloors(recipes, vendorPrices, sellerPrices);
  const recipeRows = computeRecipeProfits(recipes, priceByItemId, floors.costFloor, floors.revenueFloor);
  // 中间材料（次级材料）：配方产物且被其它配方用作材料，按单位利润排序。
  const secondaryRows = buildSecondaryMaterialRows(recipes, priceByItemId, floors.costFloor, floors.revenueFloor);
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
            <RadioTower size={14} /> 联盟·数据更新于 {freshness.label}
          </span>
          <Link href="/recipes" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-terminal-amber hover:underline"><Hammer size={14} /> 配方库</Link>
          <span className="flex items-center gap-1"><Bell size={14} /> 预警就绪</span>
        </div>
      </div>

      {mode === "history" ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border border-terminal-amber/50 bg-amber-500/10 px-4 py-2 font-mono text-xs">
          <span className="flex items-center gap-2 text-terminal-amber">
            <RadioTower size={14} /> 历史模式 · Beta 删档数据 · P10 口径（{DATA_SWITCH_DAY} 前自研插件）——仅供参考，与当前 Auctionator 最低价不同
          </span>
          <Link href="/" className="text-terminal-amber underline">← 返回当前数据（Auctionator 最低价）</Link>
        </div>
      ) : (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border border-terminal-border bg-terminal-panel2 px-4 py-2 font-mono text-xs text-terminal-muted">
          <span>数据口径自 {DATA_SWITCH_DAY} 起为 <span className="text-terminal-amber">Auctionator 最低买入价</span>（旧 Beta P10 数据保留在库中）</span>
          <Link href="/?history=1" className="text-terminal-amber underline">查看 Beta 历史数据（P10）→</Link>
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          <Panel>
            <PanelHeader title="捡漏雷达" action={<span className="font-mono text-xs text-terminal-green">共 {deals.length} 条 · 必赚 + {mode === "history" ? "最低价 vs 7日参考价（P10）" : "最低买入价 vs 7日参考价"}</span>} />
            <div className="p-3 font-mono text-xs">
              {deals.length === 0 ? (
                <div className="text-terminal-muted">
                  {signals.length === 0
                    ? mode === "history"
                      ? "历史模式无 addon 数据。"
                      : "暂无市场数据。请在游戏内用 Auctionator 全量扫描拍卖行（每次进入拍卖行时），然后重跑导入。"
                    : "当前没有满足利润与参考价门槛的捡漏挂单。"}
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
          <SecondaryMaterialsPanel rows={secondaryRows} prices={priceByItemId} floorPrices={floors.costFloor} turnoverByItemId={turnoverByItemId} />
          <FavoriteRecipesPanel rows={recipeRows} prices={priceByItemId} floorPrices={floors.costFloor} />
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
        {mode === "history"
          ? "历史模式：数据来源 = 旧自研插件 Beta 删档扫描（P10 口径，截至 2026-10 停用）；仅供开服前参考，与当前 Auctionator 最低价口径不同。"
          : "数据来源：Auctionator 插件（Forever 客户端适配版）SavedVariables 导入——价格口径 = 最低买入价（m）；7日参考 = 近 7 日每日收盘的中位数。旧 Beta 版自研插件数据（P10）保留在库中，可在页头切换到历史模式参考。"}
      </footer>
    </main>
  );
}
