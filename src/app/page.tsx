import { FlaskConical, Hammer, RadioTower, ShoppingCart, Star } from "lucide-react";
import type { Route } from "next";
import { buildDealRadar, buildMoverBoard, buildSpreadCandidates, buildDisenchantBoard } from "@/lib/analytics";
import { buildRecipeFloors, computeRecipeProfits } from "@/lib/recipe-profits";
import { buildSecondaryMaterialRows } from "@/lib/secondary-materials";
import { mergeRadarRules } from "@/lib/market-rules";
import { buildItemNameIndex, localizeRecipeProfitRow, localizeSecondaryRow } from "@/lib/recipe-i18n";
import {
  getItemSellerPrices,
  getItemVendorPrices,
  getItemNames,
  getItemPriceTiersByItemIds,
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
import { L, displayName } from "@/lib/i18n";
import { getLang } from "@/lib/i18n-server";
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
import { parseServer, serverLabel } from "@/lib/servers";
import { LangToggle } from "@/components/lang-toggle";
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
  // beta 历史数据已随公测清库、老插件通道已退役——历史模式 UI 于 2026-11-08
  // 移除（?history=1 不再生效，始终当前口径）。
  const mode: MarketMode = "current";
  const market = raw.market === "neutral" ? "neutral" : "faction";
  const server = parseServer(raw.server);
  const lang = await getLang();
  const marketLabel = market === "neutral" ? L(lang, "Neutral", "中立") : L(lang, "Alliance", "联盟");
  const serverLabelText = serverLabel(server, lang);
  // 切回默认视图时 qs 会全空（空 href 点击等于刷新当前页，跳不回去）→ 空串回退根路径 "/"。
  const marketHrefOther: Route = (qs({ market: market === "neutral" ? undefined : "neutral" }) || "/") as Route;
  const view = parseMarketView(raw);
  const [{ signals, latestSnapshotAt }, watchedIds, latestRound, recipes, vendorPrices, sellerPrices, shoppingLists, itemNames] = await Promise.all([
    getMarketSignals(market, mode, server),
    getWatchedItemIds(),
    // 雷达 universe：该模式最新一轮扫描的在售物品集合（按当前服务器）。
    getLatestRoundItemIds(mode, market, server),
    // 关注配方面板展示配方库中被收藏的配方（craft + merchant 全量，
    // 面板按收藏过滤；收藏在 /recipes 配方库页设置）。
    getRecipes(),
    getItemVendorPrices(),
    getItemSellerPrices(),
    getShoppingLists(),
    // 配方显示层本地化索引（EN 模式按 itemId/中文名映射英文名）。
    getItemNames()
  ]);
  const nameIndex = buildItemNameIndex(itemNames);
  const listOptions = shoppingLists.map((list) => ({ id: list.id, name: list.name }));
  const freshness = describeFreshness(latestSnapshotAt, new Date(), AUCTIONATOR_STALE_MAX_AGE_MS, lang);
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
  const matNameByItemId = new Map(signals.map((signal) => [signal.itemId, displayName(signal.name, signal.nameEn, lang)]));
  const allDisenchant = buildDisenchantBoard(signals, priceByItemId, matNameByItemId);
  const disenchant = latestRound === null ? allDisenchant : allDisenchant.filter((row) => latestRound.has(row.itemId));
  // P0-B: full-recipe profit library. Revenue side = live AH price (自扫P10
  // → 网站P50 per signal) or the vendor floor when the market has no listing;
  // cost floor prefers the NPC sell price (Item.sellPrice, in-game merchant
  // transcription) over the buy price (Item.vendorPrice / dictionary), then
  // the vendorP the addon dumped with each recipe (freshest).
  const floors = buildRecipeFloors(recipes, vendorPrices, sellerPrices);
  const scrollItemIds = await getScrollItemIds();
  const recipeRows = computeRecipeProfits(recipes, priceByItemId, floors.costFloor, floors.revenueFloor, scrollItemIds)
    .map((row) => localizeRecipeProfitRow(row, nameIndex, lang));
  // 中间材料（次级材料）：配方产物且被其它配方用作材料，按单位利润排序。
  const secondaryRows = buildSecondaryMaterialRows(recipes, priceByItemId, floors.costFloor, floors.revenueFloor)
    .map((row) => localizeSecondaryRow(row, nameIndex, lang));
  // 中间材料悬停要展示该材料的前五档价格档位（转录补档数据，一轮批量取）。
  const secondaryTiersByItemId = await getItemPriceTiersByItemIds(secondaryRows.map((row) => row.item.itemId), market, server);
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
        </div>
        <div className="flex items-center gap-3 font-mono text-[15px] text-terminal-muted">
          <span className={freshness.stale ? "flex items-center gap-1 text-terminal-red" : "flex items-center gap-1 text-terminal-green"}>
            <RadioTower size={14} /> {serverLabelText}·{marketLabel}·{L(lang, "updated", "数据更新于")} {freshness.label}
          </span>
          <Link href={marketHrefOther} className="flex items-center gap-1 text-terminal-amber hover:underline">{market === "neutral" ? L(lang, "← Alliance market", "← 联盟市场") : L(lang, "Neutral market →", "中立市场 →")}</Link>
          <Link href="/recipes" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-terminal-amber hover:underline"><Hammer size={14} /> {L(lang, "Recipes", "配方库")}</Link>
          <Link href="/lists" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-terminal-amber hover:underline"><ShoppingCart size={14} /> {L(lang, "Shopping Lists", "购物清单")}</Link>
          <Link href="/tools/disenchant-calc" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-terminal-amber hover:underline"><FlaskConical size={14} /> {L(lang, "Disenchant Calc", "分解计算器")}</Link>
          <LangToggle lang={lang} />
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          <Panel>
            <PanelHeader title={
              <span className="flex flex-wrap items-center gap-x-3">
                <span>{L(lang, "Opportunities", "机会总览")}</span>
                <span className="normal-case tracking-normal text-[10px] text-terminal-muted">{L(lang, "Tip: scan late in the day (more tiers listed); consumables/mats move around raid reset; the neutral AH comes and goes — compare when you catch it.", "建议：每天较晚时段扫描（档位更全）；raid 重置前后消耗品/材料易现卖出窗口；中立市场时有时无，抓到即对比。")}</span>
              </span>
            } action={<span className="font-mono text-xs text-terminal-green">{L(lang, "Min buyout vs 7d ref", "最低买入价 vs 7日参考价")}</span>} />
            {signals.length === 0 ? (
              <div className="p-3 font-mono text-xs text-terminal-muted">
                {market === "neutral"
                  ? L(lang, `No neutral-market data yet (check the top badge: current view ${serverLabelText}·Neutral). The neutral AH is at the camp between Elwynn Forest and Redridge — go there, click "Scan Neutral AH", then /reload to flush the data and auto-import.`, `暂无中立市场数据（注意顶部标签：当前是 ${serverLabelText}·中立）。中立拍卖行在艾尔文森林/赤脊山交界营地——到那里点「扫描中立拍卖行」，完成后 /reload 落盘即自动导入。`)
                  : L(lang, `No market data yet (check the top badge: current view ${serverLabelText}·${marketLabel}). Run a full Auctionator scan in game, then /reload to flush the data and auto-import.`, `暂无市场数据（注意顶部标签：当前是 ${serverLabelText}·${marketLabel}）。请在游戏内用 Auctionator 全量扫描拍卖行，完成后 /reload 落盘即自动导入。`)}
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
                lang={lang}
              />
            )}
          </Panel>
          <Panel>
            <PanelHeader title={L(lang, "Market Monitor", "市场监控")} />
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
              <PanelHeader title={L(lang, "Profit Calc", "利润计算")} />
              <div className="p-3 font-mono text-xs text-terminal-muted">
                {L(lang, "No market data on this server yet — profit calc unavailable. Run a full Auctionator scan in game (each time you visit the AH), then re-run the import.", "本服务器暂无市场数据，利润计算不可用。请在游戏内用 Auctionator 全量扫描拍卖行（每次进入拍卖行时），然后重跑导入。")}
              </div>
            </Panel>
          ) : (
            <>
              <SecondaryMaterialsPanel rows={secondaryRows} prices={priceByItemId} floorPrices={floors.costFloor} turnoverByItemId={turnoverByItemId} tiersByItemId={secondaryTiersByItemId} server={server} />
              <FavoriteRecipesPanel rows={recipeRows} prices={priceByItemId} floorPrices={floors.costFloor} lists={listOptions} server={server} />
            </>
          )}
          <Panel>
            <PanelHeader title={L(lang, "Watchlist", "关注物品")} />
            <div className="flex items-center gap-2 border-b border-terminal-border px-3 py-1.5">
              <CopyListButton names={watchedSignals.map((s) => displayName(s.name, s.nameEn, lang))} listNamePrefix={L(lang, "Watch", "关注")} />
              {watchedSignals.length > 0 && <span className="text-[10px] text-terminal-muted">{L(lang, `${watchedSignals.length} items`, `共 ${watchedSignals.length} 项`)}</span>}
            </div>
            <div className="space-y-2 p-3 font-mono text-xs">
              {watchedSignals.length === 0 && <div className="text-terminal-muted">{L(lang, "Click ☆ in the market table to watch", "市场表中点 ☆ 添加关注")}</div>}
              {watchedSignals.map((signal) => (
                <div key={signal.itemId} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <WatchStar itemId={signal.itemId} watched />
                    <Link href={`/items/${signal.itemId}`} target="_blank" data-no-ladder className={`inline-flex items-center gap-1 ${qualityColorClass(signal.quality)}`}><ItemIcon itemId={signal.itemId} size={16} />{displayName(signal.name, signal.nameEn, lang)}</Link>
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
        {L(lang, "Data source: Auctionator addon (Forever-client adapted) SavedVariables import — price = lowest buyout (m); 7d ref = median of the last 7 daily closes.", "数据来源：Auctionator 插件（Forever 客户端适配版）SavedVariables 导入——价格口径 = 最低买入价（m）；7日参考 = 近 7 日每日收盘的中位数。")}
      </footer>
    </main>
  );
}
