import { notFound } from "next/navigation";
import Link from "next/link";
import { buildMarketSignal, buildWeekdaySeasonality } from "@/lib/analytics";
import {
  getItemDetail,
  getItemSellerPricesByIds,
  getItemVendorPricesByIds,
  getLatestPricesByItemIds,
  getRecipesProducing,
  getWatchedItemIds,
  type MarketMode
} from "@/lib/repositories";
import { buildRecipeFloors, computeRecipeProfits, professionLabel } from "@/lib/recipe-profits";
import { FOOD_EFFECTS } from "@/data/food-effects";
import { formatPercent } from "@/lib/utils";
import { formatTrendPercent, trendTextClass } from "@/lib/trend";
import { Coins } from "@/components/coins";
import { qualityColorClass } from "@/lib/quality";
import { ItemIcon } from "@/components/item-icon";
import { AUCTIONATOR_STALE_MAX_AGE_MS, describeFreshness } from "@/lib/freshness";
import { CandlestickChart, TimeSeriesChart } from "@/components/charts";
import { WatchStar } from "@/components/watch-star";
import { CloseTabButton } from "@/components/close-tab-button";
import { markBaitDays } from "@/lib/bait-filter";
import { Panel, PanelHeader } from "@/components/ui/panel";

export default async function ItemDetail({ params, searchParams }: { params: Promise<{ itemId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { itemId } = await params;
  const raw = await searchParams;
  const mode: MarketMode = raw.history === "1" ? "history" : "current";
  const numericItemId = Number(itemId);
  const item = await getItemDetail(numericItemId, mode);
  if (!item) notFound();

  // 制作配方面板按需取数：只查产出此物品的配方，以及这些配方涉及的
  // 物品的最新市场价 / NPC 保底价——不做全量市场信号扫描（单品页加载
  // 快的关键：med7 在 getItemDetail 里也只算当前物品）。
  const [watchedIds, producingRecipes] = await Promise.all([
    getWatchedItemIds(),
    getRecipesProducing(numericItemId)
  ]);
  const involvedItemIds = new Set<number>([numericItemId]);
  for (const recipe of producingRecipes) {
    for (const material of recipe.reagents) involvedItemIds.add(material.itemId);
    for (const output of recipe.outputs) involvedItemIds.add(output.itemId);
  }
  const [priceByItemId, vendorPrices, sellerPrices] = await Promise.all([
    getLatestPricesByItemIds(Array.from(involvedItemIds), mode),
    getItemVendorPricesByIds(Array.from(involvedItemIds)),
    getItemSellerPricesByIds(Array.from(involvedItemIds))
  ]);
  const floors = buildRecipeFloors(producingRecipes, vendorPrices, sellerPrices);
  const recipeRows = computeRecipeProfits(producingRecipes, priceByItemId, floors.costFloor, floors.revenueFloor);
  // 食物产出物：字典命中即食物（由 foreverchanges.pro 详情页 tooltip 生成）。
  const foodEffect = FOOD_EFFECTS[numericItemId];
  const now = new Date();
  const hasSnapshots = item.snapshots.length > 0;
  const signal = hasSnapshots ? buildMarketSignal(item, now, mode) : null;
  const latestSnapshot = item.snapshots[item.snapshots.length - 1];
  const freshness = describeFreshness(latestSnapshot?.timestamp ?? null, now, AUCTIONATOR_STALE_MAX_AGE_MS);
  // Daily candles and seasonality follow the active mode's channel — legacy
  // addon rows never blend with auctionator rows inside one view.
  const modeSource = mode === "history" ? "addon" : "auctionator";
  const sameSourceSummaries = item.dailySummaries.filter((summary) => (summary.source ?? "auctionator") === modeSource);
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
  // 近 7 日走势线：Auctionator 每日一轮收盘（high≈low=当日代表价），当前模式
  // 用单线表达收盘，并剔除相对自身历史的钓单日（极少挂单/极低价格，bait-filter）；
  // 历史模式（旧插件多次扫描）保留当日最高/最低双线振幅。
  const baitTs = mode === "history" ? null : markBaitDays(sameSourceSummaries.map((s) => ({ ts: s.date.getTime(), close: s.closePrice, volume: s.volume })));
  const rangeByTs = new Map<number, { low: number; high: number; close?: number; volume?: number }>();
  for (const summary of sameSourceSummaries) {
    const ts = summary.date.getTime();
    if (baitTs && baitTs.has(ts)) continue; // 钓单日不入走势
    const entry = rangeByTs.get(ts) ?? { low: summary.lowPrice, high: summary.highPrice, close: summary.closePrice, volume: summary.volume };
    entry.low = Math.min(entry.low, summary.lowPrice);
    entry.high = Math.max(entry.high, summary.highPrice);
    entry.close = summary.closePrice;
    rangeByTs.set(ts, entry);
  }
  const rangeData = Array.from(rangeByTs.entries())
    .sort(([left], [right]) => left - right)
    .map(([ts, entry]) => ({ ts, ...entry }));
  const rangeSeries = mode === "history"
    ? [
        { key: "high" as const, color: "#ff5c7a", name: "当日最高" },
        { key: "low" as const, color: "#39d98a", name: "当日最低" }
      ]
    : [{ key: "close" as const, color: "#39d98a", name: "每日收盘" }];

  return (
    <main className="terminal-grid min-h-screen bg-terminal-bg p-3 text-slate-200">
      <div className="mb-3 flex items-center justify-between border border-terminal-border bg-terminal-panel px-4 py-3">
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
          <CloseTabButton />
        </div>
      </div>
      {mode === "history" ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border border-terminal-amber/50 bg-amber-500/10 px-4 py-2 font-mono text-xs">
          <span className="text-terminal-amber">历史模式 · Beta 删档数据 · P10 口径（2026-10-13 前自研插件）——仅供参考</span>
          <Link href={`/items/${numericItemId}`} className="text-terminal-amber underline">← 返回当前数据（Auctionator 最低价）</Link>
        </div>
      ) : (
        <div className="mb-3 flex items-center justify-between gap-3 border border-terminal-border bg-terminal-panel2 px-4 py-2 font-mono text-xs text-terminal-muted">
          <span>数据口径自 2026-10-13 起为 Auctionator 最低买入价</span>
          <Link href={`/items/${numericItemId}?history=1`} className="text-terminal-amber underline">查看 Beta 历史 P10 →</Link>
        </div>
      )}
      <div className="grid gap-3 xl:grid-cols-[1fr_420px]">
        <div className="space-y-3">
          <Panel>
            <PanelHeader title={mode === "history" ? "近7日最低/最高走势 (日线)" : "近7日收盘走势 (日线)"} />
            <div className="p-3">
              {rangeData.length >= 2
                ? <TimeSeriesChart data={rangeData} series={rangeSeries} />
                : <div className="p-4 font-mono text-xs text-terminal-muted">
                    {mode === "history"
                      ? "历史 addon 数据中没有可用的日线"
                      : baitTs && baitTs.size > 0
                        ? `不足 2 天有效数据（已剔除 ${baitTs.size} 天疑似钓单：极少挂单的极高价格）`
                        : "收盘走势需要至少 2 天的 Auctionator 扫描数据——每次进入拍卖行后保持全量扫描积累"}
                  </div>}
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
            <PanelHeader title="星期几季节性 (收盘 · 相对全部天数中位数的偏差)" />
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
                    <div className="text-xs uppercase text-terminal-muted">{mode === "history" ? "市场价 · P10" : "最低买入价"}</div>
                    <div className="text-2xl"><Coins copper={signal.price} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div><div className="text-terminal-muted">最低价</div><div><Coins copper={signal.minPrice} /></div></div>
                    <div><div className="text-terminal-muted">7日参考（{mode === "history" ? "P10" : "最低价均值"}）</div><div><Coins copper={signal.med7} /></div></div>
                    <div><div className="text-terminal-muted">折扣</div><div className={signal.discountPercent >= 15 ? "text-terminal-green" : ""}>{signal.discountPercent.toFixed(0)}%</div></div>
                    <div><div className="text-terminal-muted">{mode === "history" ? "环比上次" : "环比昨日"}</div><div className={trendTextClass(signal.changePercent)}>{formatTrendPercent(signal.changePercent)}</div></div>
                    <div><div className="text-terminal-muted">在售量</div><div>{signal.quantity.toLocaleString("en-US")}</div></div>
                  </div>
                </>
              )}
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="制作配方" />
            <div className="space-y-2 p-3 font-mono text-xs">
              {foodEffect && recipeRows.length > 0 && (
                <div className="rounded border border-terminal-border bg-terminal-panel2 p-2 text-[12px] leading-relaxed text-slate-300">
                  <span className="font-semibold text-terminal-amber">使用：</span>
                  {foodEffect.replace(/^使用：\s*/, "")}
                </div>
              )}
              {recipeRows.length === 0 && (
                <div className="text-terminal-muted">配方库中没有配方产出这个物品</div>
              )}
              {recipeRows.map((row) => (
                <div key={`${row.recipe.category ?? "craft"}|${row.recipe.profession}|${row.recipe.name}`} className="rounded border border-terminal-border bg-terminal-panel2 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-slate-200">{professionLabel(row.recipe.profession)} · {row.recipe.name}</span>
                    {row.status === "ok" ? (
                      <span className={"shrink-0 " + (row.profit >= 0 ? "text-terminal-green" : "text-terminal-red")}>
                        {row.profit >= 0 ? "+" : ""}{formatPercent(row.marginPercent)}
                        <span className="text-terminal-muted">{row.profit >= 0 ? " 盈利 " : " 亏损 "}</span>
                        <Coins copper={Math.abs(row.profit)} />
                      </span>
                    ) : (
                      <span className="shrink-0 text-terminal-red">缺货</span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-1.5 gap-y-0.5 leading-relaxed text-terminal-muted">
                    {row.status === "ok" ? (
                      row.materials.map((material) => (
                        <span key={material.name}>材料 {material.name}×{material.quantity}（<span className="text-slate-200"><Coins copper={material.price} /></span>）</span>
                      ))
                    ) : (
                      row.missing.map((name) => <span key={name}>缺货：{name}</span>)
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </main>
  );
}
