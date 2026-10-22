import { FlaskConical, Hammer, RadioTower, ShoppingCart, Star } from "lucide-react";
import type { Route } from "next";
import { buildDealRadar, buildMoverBoard, buildSpreadCandidates, buildDisenchantBoard } from "@/lib/analytics";
import { buildRecipeFloors, computeRecipeProfits } from "@/lib/recipe-profits";
import { buildSecondaryMaterialRows } from "@/lib/secondary-materials";
import { mergeRadarRules } from "@/lib/market-rules";
import {
  getItemSellerPrices,
  getItemVendorPrices,
  getLatestRoundItemIds,
  getLatestSnapshotTime,
  getPriceTierGaps,
  getRadarRules,
  getRecipes,
  getScrollItemIds,
  getShoppingLists,
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
import { OpportunityTabs } from "@/components/opportunity-tabs";
import { SecondaryMaterialsPanel } from "@/components/secondary-materials-panel";
import { CopyListButton } from "@/components/copy-list-button";

import { FavoriteRecipesPanel } from "@/components/favorite-recipes-panel";
import { InstructionsPanel } from "@/components/instructions-panel";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { parseServer, SERVER_LABELS } from "@/lib/servers";
import Link from "next/link";

// 数据口径断点：2026-10-13 起为 Auctionator 最低价；此前为自研插件 Beta P10。
const DATA_SWITCH_DAY = "2026-10-13";

/** 由显式参数生成 query 串（空值剔除；server 双服切换时保留 market/history 视图）。 */
function qs(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  return entries.length ? `?${entries.map(([k, v]) => `${k}=${v}`).join("&")}` : "";
}

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const mode: MarketMode = raw.history === "1" ? "history" : "current";
  const market = raw.market === "neutral" ? "neutral" : "faction";
  const server = parseServer(raw.server);
  const marketLabel = market === "neutral" ? "中立" : "联盟";
  const serverLabel = SERVER_LABELS[server] ?? server;
  // 切回默认视图时 qs 会全空（空 href 点击等于刷新当前页，跳不回去）→ 空串回退根路径 "/"。
  const marketHrefOther: Route = (qs({ market: market === "neutral" ? undefined : "neutral", history: mode === "history" ? "1" : undefined, server: server === "cn" ? "cn" : undefined }) || "/") as Route;
  const historyHref: Route = (qs({ history: mode === "history" ? undefined : "1", market: market === "neutral" ? "neutral" : undefined, server: server === "cn" ? "cn" : undefined }) || "/") as Route;
  const serverHrefOther: Route = (qs({ server: server === "cn" ? undefined : "cn", market: market === "neutral" ? "neutral" : undefined, history: mode === "history" ? "1" : undefined }) || "/") as Route;
  const itemServerQ = server === "cn" ? "?server=cn" : "";
  const view = parseMarketView(raw);
  const [{ signals, latestSnapshotAt }, watchedIds, latestRound, recipes, vendorPrices, sellerPrices, shoppingLists] = await Promise.all([
    getMarketSignals(market, mode, server),
    getWatchedItemIds(),
    // 雷达 universe：该模式最新一轮扫描的在售物品集合（按当前服务器）。
    getLatestRoundItemIds(mode, market, server),
    // 关注配方面板展示配方库中被收藏的配方（craft + merchant 全量，
    // 面板按收藏过滤；收藏在 /recipes 配方库页设置）。
    getRecipes(),
    getItemVendorPrices(),
    getItemSellerPrices(),
    getShoppingLists()
  ]);
  const listOptions = shoppingLists.map((list) => ({ id: list.id, name: list.name }));
  const freshness = describeFreshness(latestSnapshotAt, new Date(), AUCTIONATOR_STALE_MAX_AGE_MS);
  const watchedSignals = signals.filter((signal) => watchedIds.has(signal.itemId));
  // 雷达阈值：默认常量（market-rules.ts）+ 网页"雷达设置"面板的覆盖
  // （RadarRule 单行，经 /api/radar-rules 读写；mergeRadarRules 合并）。
  const radarRules = mergeRadarRules(await getRadarRules());
  const allDeals = buildDealRadar(signals, radarRules);
  // 该模式最新扫描轮 owns the radar's universe：只推荐该模式数据源在售的物品。
  const deals = latestRound === null ? allDeals : allDeals.filter((deal) => latestRound.has(deal.itemId));
  // 可做差价榜 / 异动榜：同样只在最新扫描轮在售的物品中推荐（买得到才上榜）。
  const allSpreads = buildSpreadCandidates(signals);
  const spreads = latestRound === null ? allSpreads : allSpreads.filter((row) => latestRound.has(row.itemId));
  const allMovers = buildMoverBoard(signals);
  const movers = latestRound === null ? allMovers : allMovers.filter((row) => latestRound.has(row.itemId));
  // 价格档位差距（市场价 vs 最低价 %）：最新快照轮，供雷达"价格档位差距 ≥"筛选用。
  const tierGapByItemId = await getPriceTierGaps(mode, market, server);
  const radarCategories = groupedCategoryOptions(Array.from(new Set(deals.map((deal) => deal.category))));
  const priceByItemId = new Map(signals.map((signal) => [signal.itemId, signal.price]));
  const turnoverByItemId = new Map(signals.map((signal) => [signal.itemId, signal.turnoverScore]));
  // 分解榜：买绿/蓝装 → 分解 → 材料挂 AH 的期望套利；材料价取在售信号，缺价按 0 标注。
  const matNameByItemId = new Map(signals.map((signal) => [signal.itemId, signal.name]));
  const allDisenchant = buildDisenchantBoard(signals, priceByItemId, matNameByItemId);
  const disenchant = latestRound === null ? allDisenchant : allDisenchant.filter((row) => latestRound.has(row.itemId));
  // P0-B: full-recipe profit library. Revenue side = live AH price (自扫P10
  // → 网站P50 per signal) or the vendor floor when the market has no listing;
  // cost floor prefers the NPC sell price (Item.sellPrice, in-game merchant
  // transcription) over the buy price (Item.vendorPrice / dictionary), then
  // the vendorP the addon dumped with each recipe (freshest).
  const floors = buildRecipeFloors(recipes, vendorPrices, sellerPrices);
  const scrollItemIds = await getScrollItemIds();
  const recipeRows = computeRecipeProfits(recipes, priceByItemId, floors.costFloor, floors.revenueFloor, scrollItemIds);
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
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-[21px] font-semibold uppercase text-terminal-amber">AH</h1>
          {mode !== "history" && (
            <Link href={historyHref} className="font-mono text-[15px] text-terminal-amber underline">查看 Beta 历史数据（P10）→</Link>
          )}
        </div>
        <div className="flex items-center gap-3 font-mono text-[15px] text-terminal-muted">
          <span className={freshness.stale ? "flex items-center gap-1 text-terminal-red" : "flex items-center gap-1 text-terminal-green"}>
            <RadioTower size={14} /> {serverLabel}·{marketLabel}·数据更新于 {freshness.label}
          </span>
          <Link href={serverHrefOther} className="flex items-center gap-1 text-terminal-amber hover:underline">{server === "cn" ? "← 欧服" : "中国服 →"}</Link>
          <Link href={marketHrefOther} className="flex items-center gap-1 text-terminal-amber hover:underline">{market === "neutral" ? "← 联盟市场" : "中立市场 →"}</Link>
          <Link href="/recipes" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-terminal-amber hover:underline"><Hammer size={14} /> 配方库</Link>
          <Link href="/lists" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-terminal-amber hover:underline"><ShoppingCart size={14} /> 购物清单</Link>
          <Link href="/tools/disenchant-calc" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-terminal-amber hover:underline"><FlaskConical size={14} /> 分解计算器</Link>
        </div>
      </div>

      {mode === "history" && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border border-terminal-amber/50 bg-amber-500/10 px-4 py-2 font-mono text-xs">
          <span className="flex items-center gap-2 text-terminal-amber">
            <RadioTower size={14} /> 历史模式 · Beta 删档数据 · P10 口径（{DATA_SWITCH_DAY} 前自研插件）——仅供参考，与当前 Auctionator 最低价不同
          </span>
          <Link href={historyHref} className="text-terminal-amber underline">← 返回当前数据（Auctionator 最低价）</Link>
        </div>
      )}
      <div className="grid gap-3 xl:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          <Panel>
            <PanelHeader title={
              <span className="flex flex-wrap items-center gap-x-3">
                <span>机会总览</span>
                <span className="normal-case tracking-normal text-[10px] text-terminal-muted">建议：每天较晚时段扫描（档位更全）；raid 重置前后消耗品/材料易现卖出窗口；中立市场时有时无，抓到即对比。</span>
              </span>
            } action={<span className="font-mono text-xs text-terminal-green">最低买入价 vs 7日参考价</span>} />
            {signals.length === 0 ? (
              <div className="p-3 font-mono text-xs text-terminal-muted">
                {mode === "history"
                  ? "历史模式无 addon 数据。"
                  : "暂无市场数据。请在游戏内用 Auctionator 全量扫描拍卖行（每次进入拍卖行时），然后重跑导入。"}
              </div>
            ) : (
              <OpportunityTabs
                deals={deals}
                spreads={spreads}
                movers={movers}
                disenchant={disenchant}
                prices={priceByItemId}
                radarCategories={radarCategories}
                watchedItemIds={Array.from(watchedIds)}
                productItemIds={productItemIds}
                tierGapByItemId={tierGapByItemId}
                server={server}
              />
            )}
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
              server={server}
            />
          </Panel>
        </div>
        <div className="space-y-3">
          {signals.length === 0 ? (
            <Panel>
              <PanelHeader title="利润计算" />
              <div className="p-3 font-mono text-xs text-terminal-muted">
                本服务器暂无市场数据，利润计算不可用。请在游戏内用 Auctionator 全量扫描拍卖行（每次进入拍卖行时），然后重跑导入。
              </div>
            </Panel>
          ) : (
            <>
              <SecondaryMaterialsPanel rows={secondaryRows} prices={priceByItemId} floorPrices={floors.costFloor} turnoverByItemId={turnoverByItemId} server={server} />
              <FavoriteRecipesPanel rows={recipeRows} prices={priceByItemId} floorPrices={floors.costFloor} lists={listOptions} server={server} />
            </>
          )}
          <Panel>
            <PanelHeader title="关注物品" />
            <div className="flex items-center gap-2 border-b border-terminal-border px-3 py-1.5">
              <CopyListButton names={watchedSignals.map((s) => s.name)} listNamePrefix="关注" />
              {watchedSignals.length > 0 && <span className="text-[10px] text-terminal-muted">共 {watchedSignals.length} 项</span>}
            </div>
            <div className="space-y-2 p-3 font-mono text-xs">
              {watchedSignals.length === 0 && <div className="text-terminal-muted">市场表中点 ☆ 添加关注</div>}
              {watchedSignals.map((signal) => (
                <div key={signal.itemId} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <WatchStar itemId={signal.itemId} watched />
                    <Link href={`/items/${signal.itemId}${itemServerQ}`} target="_blank" data-no-ladder className={`inline-flex items-center gap-1 ${qualityColorClass(signal.quality)}`}><ItemIcon itemId={signal.itemId} size={16} />{signal.name}</Link>
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
