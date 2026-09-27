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
  const [category, setCategory] = usePersistedState<string>("wah:deal-radar:category", "");
  const [gapFilterOn, setGapFilterOn] = usePersistedState<boolean>("wah:deal-radar:gap-on", false);
  const [gap1Pct, setGap1Pct] = usePersistedState<number>("wah:deal-radar:gap1", 15);
  const [gap2Pct, setGap2Pct] = usePersistedState<number>("wah:deal-radar:gap2", 15);
  const watched = new Set(watchedItemIds);

  useEffect(() => {
    if (category && !categories.includes(category)) setCategory("");
  }, [categories, category, setCategory]);

  let rows = category
    ? deals.filter((deal) => categoryMatches(deal.category, category))
    : [...deals];

  // 价格断层筛选：第1档比第2档便宜 ≥ gap1Pct%，第2档比第3档便宜 ≥ gap2Pct%。
  if (gapFilterOn) {
    rows = rows.filter((deal) => {
      const ladder = ladders.get(deal.itemId);
      if (!ladder || ladder.length < 2) return false;
      const [t1, t2, t3] = ladder;
      const gap1 = (t2.price - t1.price) / t2.price * 100;
      if (gap1 < gap1Pct) return false;
      if (t3) {
        const gap2 = (t3.price - t2.price) / t3.price * 100;
        if (gap2 < gap2Pct) return false;
      }
      return true;
    });
  }
  if (sortKey) {
    rows.sort((left, right) => {
      const a = sortKey === "name" ? left.name : sortKey === "price" ? (prices.get(left.itemId) ?? 0) : left[sortKey];
      const b = sortKey === "name" ? right.name : sortKey === "price" ? (prices.get(right.itemId) ?? 0) : right[sortKey];
      if (a === b) return right.profit - left.profit;
      return sortAsc ? (a > b ? 1 : -1) : (a < b ? 1 : -1);
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
        <span className="text-terminal-muted">{rows.length} / {deals.length} 条</span>
        <label className="ml-2 inline-flex items-center gap-1 text-terminal-muted">
          <input type="checkbox" checked={gapFilterOn} onChange={(e) => setGapFilterOn(e.target.checked)} />
          价格断层
        </label>
        {gapFilterOn && (
          <span className="inline-flex items-center gap-1 text-terminal-muted">
            1比2低
            <input type="number" value={gap1Pct} onChange={(e) => setGap1Pct(Number(e.target.value))} className="w-12 border border-terminal-border bg-terminal-panel2 px-1 py-0.5 text-slate-100" />%
            2比3低
            <input type="number" value={gap2Pct} onChange={(e) => setGap2Pct(Number(e.target.value))} className="w-12 border border-terminal-border bg-terminal-panel2 px-1 py-0.5 text-slate-100" />%
          </span>
        )}
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
            <th onClick={() => toggle("price")} className={`${thClass} text-right`}>最新价{mark("price")}</th>
            <th onClick={() => toggle("minPrice")} className={`${thClass} text-right`}>最低价{mark("minPrice")}</th>
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
                <Link href={`/items/${deal.itemId}`} className={`inline-flex items-center gap-2 ${qualityColorClass(deal.quality)}`}>
                  <ItemIcon itemId={deal.itemId} icon={deal.icon} />
                  <span className="truncate">{deal.name}</span>
                </Link>
                {deal.source === "ahledger" && <span className="ml-1.5 rounded bg-amber-500/15 px-1 py-0.5 align-middle text-[9px] text-amber-400">网站</span>}
              </td>
              <td className="px-3 py-2 text-right"><Coins copper={prices.get(deal.itemId) ?? 0} /></td>
              <td className="px-3 py-2 text-right"><Coins copper={deal.minPrice} /></td>
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
