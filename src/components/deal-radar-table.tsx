"use client";

import { useState, useEffect } from "react";
import { formatTrendPercent, trendTextClass } from "@/lib/trend";
import Link from "next/link";
import { ItemIcon } from "@/components/item-icon";
import { Coins } from "@/components/coins";
import { WatchStar } from "@/components/watch-star";
import { qualityColorClass } from "@/lib/quality";
import { formatPercent } from "@/lib/utils";
import { categoryLabel, categoryMatches } from "@/lib/category-zh";
import type { DealRadarRow } from "@/lib/analytics";
import { usePersistedState } from "@/lib/use-persisted-state";
import type { PricePoint } from "@/lib/ladders";

type SortKey = "name" | "price" | "minPrice" | "reference" | "discountPercent" | "changePercent" | "quantity" | "numAuctions";

// Deal radar as a table that mirrors the market monitor's column skeleton
// (leading spacer, item, P10, min price, 7d-P10 median, discount) so the
// discount column lines up with the market table's discount column below.
// Headers sort: first click high-to-low, second click low-to-high; without
// any click the rows keep the radar's own ranking (NPC deals first, then
// absolute profit).
export function DealRadarTable({ deals, prices, categories, watchedItemIds, ladders }: {
  deals: DealRadarRow[];
  prices: Map<number, number>;
  categories: string[];
  watchedItemIds: number[];
  ladders: Map<number, PricePoint[]>;
}) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortAsc, setSortAsc] = useState(false);
  const [, force] = useState(0);
  const [category, setCategory] = usePersistedState<string>("wah:deal-radar:category", "");
  const [onlyLiquid, setOnlyLiquid] = usePersistedState<boolean>("wah:deal-radar:onlyLiquid", false);
  const [fMinPrice, setFMinPrice] = usePersistedState<number>("wah:filter:minPrice", 0);
  const [fMaxPrice, setFMaxPrice] = usePersistedState<number>("wah:filter:maxPrice", 0);
  const [fGap1, setFGap1] = usePersistedState<number>("wah:filter:gap1", 0);
  const [fGap2, setFGap2] = usePersistedState<number>("wah:filter:gap2", 0);
  useEffect(() => {
    const h = () => {
      try {
        const p = localStorage.getItem("wah:filter:minPrice"); if (p) setFMinPrice(JSON.parse(p));
        const x = localStorage.getItem("wah:filter:maxPrice"); if (x) setFMaxPrice(JSON.parse(x));
        const g1 = localStorage.getItem("wah:filter:gap1"); if (g1) setFGap1(JSON.parse(g1));
        const g2 = localStorage.getItem("wah:filter:gap2"); if (g2) setFGap2(JSON.parse(g2));
      } catch {}
      force((n) => n + 1);
    };
    window.addEventListener("wah:filter", h);
    return () => window.removeEventListener("wah:filter", h);
  }, []);
  const watched = new Set(watchedItemIds);

  useEffect(() => {
    if (category && !categories.includes(category)) setCategory("");
  }, [categories, category, setCategory]);

  let rows = category
    ? deals.filter((deal) => categoryMatches(deal.category, category))
    : [...deals];

  // Client-side secondary filters (from radar params panel).
  if (fMinPrice > 0) rows = rows.filter((d) => d.minPrice >= fMinPrice);
  if (fMaxPrice > 0) rows = rows.filter((d) => d.minPrice <= fMaxPrice);
  if (fGap1 > 0 || fGap2 > 0) {
    rows = rows.filter((deal) => {
      const ladder = ladders.get(deal.itemId);
      if (!ladder || ladder.length < 2) return true;
      const [t1, t2, t3] = ladder;
      if (fGap1 > 0) {
        if (t1.price >= t2.price) return false;
        const g1 = (t2.price - t1.price) / t2.price * 100;
        if (g1 < fGap1) return false;
      }
      if (fGap2 > 0 && t3) {
        if (t2.price >= t3.price) return false;
        const g2 = (t3.price - t2.price) / t3.price * 100;
        if (g2 < fGap2) return false;
      }
      return true;
    });
  }


  // 仅限高流通：只保留有流通分的商品（turnoverScore > 0）。
  if (onlyLiquid) rows = rows.filter((deal) => deal.turnoverScore > 0);

  if (sortKey) {
    rows.sort((left, right) => {
      const a = sortKey === "name" ? left.name : sortKey === "price" ? (prices.get(left.itemId) ?? 0) : left[sortKey];
      const b = sortKey === "name" ? right.name : sortKey === "price" ? (prices.get(right.itemId) ?? 0) : right[sortKey];
      if (a === b) return right.profit - left.profit;
      return sortAsc ? (a > b ? 1 : -1) : (a < b ? 1 : -1);
    });
  } else if (onlyLiquid) {
    // 仅限高流通的默认排序：流通分从高到低，同分按绝对盈利降序。
    rows.sort((left, right) => {
      if (left.turnoverScore !== right.turnoverScore) return right.turnoverScore - left.turnoverScore;
      return right.profit - left.profit;
    });
  }

  const toggle = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc((asc) => !asc);
      return;
    }
    setSortKey(key);
    setSortAsc(false); // first click: high to low
  };

  const mark = (key: SortKey) => (sortKey === key ? (sortAsc ? " ▲" : " ▼") : "");
  const thClass = "cursor-pointer select-none border-b border-terminal-border px-3 py-2 hover:text-slate-200";
  const inputClass = "border border-terminal-border bg-terminal-panel2 px-2 py-1 text-slate-100 focus:outline-none";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-terminal-border px-3 py-2 font-mono text-xs">
        <select value={category} onChange={(event) => setCategory(event.target.value)} className={inputClass}>
          <option value="">全部品类</option>
          {categories.map((value) => (
            <option key={value} value={value}>{categoryLabel(value)}</option>
          ))}
        </select>
        <label className="flex cursor-pointer select-none items-center gap-1.5 text-slate-100" title="只显示有流通分的商品，默认按流通分从高到低排列">
          <input
            type="checkbox"
            checked={onlyLiquid}
            onChange={(event) => setOnlyLiquid(event.target.checked)}
            className="h-3.5 w-3.5 accent-terminal-amber"
          />
          仅限高流通商品
        </label>
        <span className="text-terminal-muted">{rows.length} / {deals.length} 条</span>
      </div>
      <div className="max-h-[344px] overflow-y-auto [scrollbar-gutter:stable]">
      <table className="w-full min-w-[1000px] table-fixed border-collapse font-mono text-xs">
        <colgroup>
          <col className="w-11" />
          <col />
          <col className="w-[100px]" />
          <col className="w-[104px]" />
          <col className="w-[120px]" />
          <col className="w-[96px]" />
          <col className="w-[96px]" />
          <col className="w-[96px]" />
          <col className="w-[96px]" />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-terminal-panel2 text-[10px] uppercase text-terminal-muted">
          <tr>
            <th className="border-b border-terminal-border px-2 py-2 text-center">★</th>
            <th onClick={() => toggle("name")} className={`${thClass} text-left`}>物品{mark("name")}</th>
            <th onClick={() => toggle("minPrice")} className={`${thClass} text-right`}>最低价{mark("minPrice")}</th>
            <th onClick={() => toggle("price")} className={`${thClass} text-right`}>市场价{mark("price")}</th>
            <th onClick={() => toggle("reference")} className={`${thClass} text-right`}>7日参考{mark("reference")}</th>
            <th onClick={() => toggle("discountPercent")} className={`${thClass} text-right`}>折扣%{mark("discountPercent")}</th>
            <th onClick={() => toggle("changePercent")} className={`${thClass} text-right`}>环比%{mark("changePercent")}</th>
            <th onClick={() => toggle("quantity")} className={`${thClass} text-right`}>在售量{mark("quantity")}</th>
            <th onClick={() => toggle("numAuctions")} className={`${thClass} text-right`}>挂单数{mark("numAuctions")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((deal) => (
            <tr key={deal.itemId} className="border-b border-terminal-border/70 hover:bg-slate-800/35">
              <td className="px-2 py-2 text-center"><WatchStar itemId={deal.itemId} watched={watched.has(deal.itemId)} /></td>
              <td className="px-3 py-2 text-left">
                <Link href={`/items/${deal.itemId}`} target="_blank" className={`inline-flex items-center gap-2 ${qualityColorClass(deal.quality)}`}>
                  <ItemIcon itemId={deal.itemId} icon={deal.icon} />
                  <span className="truncate">{deal.name}</span>
                </Link>
                {deal.turnoverScore >= 50
                  ? <span className="ml-1.5 rounded bg-green-500/15 px-1 py-0.5 align-middle text-[9px] text-green-400" title="被 N 个配方使用，流通快">{deal.turnoverScore}§</span>
                  : deal.turnoverScore >= 15
                    ? <span className="ml-1.5 rounded bg-amber-500/15 px-1 py-0.5 align-middle text-[9px] text-amber-400" title="被 N 个配方使用">{deal.turnoverScore}§</span>
                    : deal.turnoverScore > 0
                      ? <span className="ml-1.5 rounded bg-slate-500/15 px-1 py-0.5 align-middle text-[9px] text-slate-400" title="被 N 个配方使用">{deal.turnoverScore}§</span>
                      : null}
              </td>
              <td className="px-3 py-2 text-right"><Coins copper={deal.minPrice} /></td>
              <td className="px-3 py-2 text-right"><Coins copper={prices.get(deal.itemId) ?? 0} /></td>
              <td className="px-3 py-2 text-right text-terminal-muted"><Coins copper={deal.reference} /></td>
              {deal.vendor
                ? <td className="px-3 py-2 text-right text-terminal-amber">NPC必赚 +<Coins copper={deal.profit} /></td>
                : <td className="px-3 py-2 text-right text-terminal-green">-{deal.discountPercent.toFixed(0)}%</td>}
              <td className={"px-3 py-2 text-right " + trendTextClass(deal.changePercent)}>{formatTrendPercent(deal.changePercent)}</td>
              <td className="px-3 py-2 text-right text-slate-300">{deal.quantity.toLocaleString("en-US")}</td>
              <td className="px-3 py-2 text-right text-slate-300">{deal.numAuctions.toLocaleString("en-US")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
