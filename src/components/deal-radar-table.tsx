"use client";

import { useState } from "react";
import Link from "next/link";
import { ItemIcon } from "@/components/item-icon";
import { Coins } from "@/components/coins";
import { qualityColorClass } from "@/lib/quality";
import type { DealRadarRow } from "@/lib/analytics";

type SortKey = "name" | "discountPercent" | "minPrice" | "reference";

// Deal radar as a real table: name, discount, min price and 7d-P10 median in
// their own columns, and every column header is clickable to sort that column
// high-to-low (first click) or low-to-high (second click). The rows arrive
// already ranked by the radar's own ordering (NPC-deals first, then absolute
// profit) and keep that order until a header is clicked.
export function DealRadarTable({ deals }: { deals: DealRadarRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortAsc, setSortAsc] = useState(false);

  const rows = [...deals];
  if (sortKey) {
    rows.sort((left, right) => {
      const a = sortKey === "name" ? left.name : left[sortKey];
      const b = sortKey === "name" ? right.name : right[sortKey];
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

  const mark = (key: SortKey) =>
    sortKey === key ? (sortAsc ? " ▲" : " ▼") : "";

  const headerClass = "hover:text-terminal-amber";
  const cellClass = "truncate text-right";
  const colClass = "grid grid-cols-[minmax(0,1fr)_58px_84px_104px] items-center gap-2";

  return (
    <div>
      <div className={`${colClass} border-b border-terminal-border pb-1 font-mono text-[10px] uppercase tracking-wide text-terminal-muted`}>
        <button onClick={() => toggle("name")} className={`${headerClass} truncate text-left`}>物品{mark("name")}</button>
        <button onClick={() => toggle("discountPercent")} className={`${headerClass} text-right`}>折扣{mark("discountPercent")}</button>
        <button onClick={() => toggle("minPrice")} className={`${headerClass} text-right`}>最低价{mark("minPrice")}</button>
        <button onClick={() => toggle("reference")} className={`${headerClass} text-right`}>7日P10{mark("reference")}</button>
      </div>
      <div className="max-h-[316px] overflow-y-auto">
        {rows.map((deal) => (
          <div key={deal.itemId} className={`${colClass} border-b border-terminal-border py-1.5`}>
            <Link href={`/items/${deal.itemId}`} className={`inline-flex min-w-0 items-center gap-2 ${qualityColorClass(deal.quality)}`}>
              <ItemIcon itemId={deal.itemId} size={16} />
              <span className="truncate">{deal.name}</span>
            </Link>
            {deal.vendor
              ? <span className="shrink-0 truncate text-right text-terminal-amber">NPC必赚 +<Coins copper={deal.profit} /></span>
              : <span className={`${cellClass} text-terminal-green`}>-{deal.discountPercent.toFixed(0)}%</span>}
            <span className={cellClass}><Coins copper={deal.minPrice} /></span>
            <span className={`${cellClass} text-terminal-muted`}><Coins copper={deal.reference} /></span>
          </div>
        ))}
      </div>
    </div>
  );
}
