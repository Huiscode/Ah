"use client";

import { useState } from "react";
import Link from "next/link";
import { ItemIcon } from "@/components/item-icon";
import { Coins } from "@/components/coins";
import { qualityColorClass } from "@/lib/quality";
import type { DealRadarRow } from "@/lib/analytics";

type SortKey = "name" | "price" | "minPrice" | "reference" | "discountPercent";

// Deal radar as a table that mirrors the market monitor's column skeleton
// (leading spacer, item, P10, min price, 7d-P10 median, discount) so the
// discount column lines up with the market table's discount column below.
// Headers sort: first click high-to-low, second click low-to-high; without
// any click the rows keep the radar's own ranking (NPC deals first, then
// absolute profit).
export function DealRadarTable({ deals, prices }: {
  deals: DealRadarRow[];
  prices: Map<number, number>;
}) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortAsc, setSortAsc] = useState(false);

  const rows = [...deals];
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

  return (
    <div className="max-h-[384px] overflow-y-auto">
      <table className="w-full min-w-[880px] border-collapse font-mono text-xs">
        <thead className="sticky top-0 z-10 bg-terminal-panel2 text-[10px] uppercase text-terminal-muted">
          <tr>
            <th className="border-b border-terminal-border px-2 py-2" />
            <th onClick={() => toggle("name")} className={`${thClass} text-left`}>物品{mark("name")}</th>
            <th onClick={() => toggle("price")} className={`${thClass} text-right`}>P10{mark("price")}</th>
            <th onClick={() => toggle("minPrice")} className={`${thClass} text-right`}>最低价{mark("minPrice")}</th>
            <th onClick={() => toggle("reference")} className={`${thClass} text-right`}>7日P10中位{mark("reference")}</th>
            <th onClick={() => toggle("discountPercent")} className={`${thClass} text-right`}>折扣%{mark("discountPercent")}</th>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
