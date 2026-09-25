"use client";

import { useState } from "react";
import Link from "next/link";
import { ItemIcon } from "@/components/item-icon";
import { Coins } from "@/components/coins";
import { qualityColorClass } from "@/lib/quality";
import { formatPercent } from "@/lib/utils";
import type { DealRadarRow } from "@/lib/analytics";

type SortKey = "name" | "price" | "minPrice" | "reference" | "discountPercent" | "changePercent" | "quantity" | "numAuctions";

// Deal radar as a table that mirrors the market monitor's column skeleton
// (leading spacer, item, P10, min price, 7d-P10 median, discount) so the
// discount column lines up with the market table's discount column below.
// Headers sort: first click high-to-low, second click low-to-high; without
// any click the rows keep the radar's own ranking (NPC deals first, then
// absolute profit).
export function DealRadarTable({ deals, prices, categories }: {
  deals: DealRadarRow[];
  prices: Map<number, number>;
  categories: string[];
}) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortAsc, setSortAsc] = useState(false);
  const [category, setCategory] = useState("");

  const rows = category
    ? deals.filter((deal) => deal.category === category)
    : [...deals];
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
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <span className="text-terminal-muted">{rows.length} / {deals.length} 条</span>
      </div>
      <div className="max-h-[344px] overflow-y-auto">
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
            <th className="border-b border-terminal-border px-2 py-2" />
            <th onClick={() => toggle("name")} className={`${thClass} text-left`}>物品{mark("name")}</th>
            <th onClick={() => toggle("price")} className={`${thClass} text-right`}>P10{mark("price")}</th>
            <th onClick={() => toggle("minPrice")} className={`${thClass} text-right`}>最低价{mark("minPrice")}</th>
            <th onClick={() => toggle("reference")} className={`${thClass} text-right`}>7日P10中位{mark("reference")}</th>
            <th onClick={() => toggle("discountPercent")} className={`${thClass} text-right`}>折扣%{mark("discountPercent")}</th>
            <th onClick={() => toggle("changePercent")} className={`${thClass} text-right`}>环比%{mark("changePercent")}</th>
            <th onClick={() => toggle("quantity")} className={`${thClass} text-right`}>在售量{mark("quantity")}</th>
            <th onClick={() => toggle("numAuctions")} className={`${thClass} text-right`}>挂单数{mark("numAuctions")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((deal) => (
            <tr key={deal.itemId} className="border-b border-terminal-border/70 hover:bg-slate-800/35">
              <td className="px-2 py-2" />
              <td className="px-3 py-2 text-left">
                <Link href={`/items/${deal.itemId}`} className={`inline-flex items-center gap-2 ${qualityColorClass(deal.quality)}`}>
                  <ItemIcon itemId={deal.itemId} />
                  <span className="truncate">{deal.name}</span>
                </Link>
              </td>
              <td className="px-3 py-2 text-right"><Coins copper={prices.get(deal.itemId) ?? 0} /></td>
              <td className="px-3 py-2 text-right"><Coins copper={deal.minPrice} /></td>
              <td className="px-3 py-2 text-right text-terminal-muted"><Coins copper={deal.reference} /></td>
              {deal.vendor
                ? <td className="px-3 py-2 text-right text-terminal-amber">NPC必赚 +<Coins copper={deal.profit} /></td>
                : <td className="px-3 py-2 text-right text-terminal-green">-{deal.discountPercent.toFixed(0)}%</td>}
              <td className={deal.changePercent >= 0 ? "px-3 py-2 text-right text-terminal-red" : "px-3 py-2 text-right text-terminal-green"}>{formatPercent(deal.changePercent)}</td>
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
