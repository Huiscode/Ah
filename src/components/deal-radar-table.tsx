"use client";

import { useState, useEffect } from "react";
import { formatTrendPercent, trendTextClass } from "@/lib/trend";
import Link from "next/link";
import { ItemIcon } from "@/components/item-icon";
import { Coins } from "@/components/coins";
import { MoneyInput } from "@/components/money-input";
import { WatchStar } from "@/components/watch-star";
import { ProductBadge } from "@/components/product-badge";
import { qualityColorClass } from "@/lib/quality";
import { turnoverBadgeClass } from "@/lib/turnover";
import { formatPercent } from "@/lib/utils";
import { categoryLabel, categoryMatches } from "@/lib/category-zh";
import type { DealRadarRow } from "@/lib/analytics";
import { usePersistedState } from "@/lib/use-persisted-state";

type SortKey = "name" | "price" | "minPrice" | "reference" | "discountPercent" | "changePercent" | "quantity" | "numAuctions";

// Deal radar as a table that mirrors the market monitor's column skeleton
// (leading spacer, item, P10, min price, 7d-P10 median, discount) so the
// discount column lines up with the market table's discount column below.
// Headers sort: first click high-to-low, second click low-to-high; without
// any click the rows keep the radar's own ranking (NPC deals first, then
// absolute profit).
export function DealRadarTable({ deals, prices, categories, watchedItemIds, productItemIds }: {
  deals: DealRadarRow[];
  prices: Map<number, number>;
  categories: string[];
  watchedItemIds: number[];
  productItemIds: Set<number>;
}) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortAsc, setSortAsc] = useState(false);
  const [category, setCategory] = usePersistedState<string>("wah:deal-radar:category", "");
  const [onlyLiquid, setOnlyLiquid] = usePersistedState<boolean>("wah:deal-radar:onlyLiquid", false);
  const [fMinPrice, setFMinPrice] = usePersistedState<number>("wah:filter:minPrice", 0);
  const [fLadder12, setFLadder12] = usePersistedState<number>("wah:deal-radar:ladder12", 0);
  const [fLadder23, setFLadder23] = usePersistedState<number>("wah:deal-radar:ladder23", 0);
  const watched = new Set(watchedItemIds);

  useEffect(() => {
    if (category && !categories.includes(category)) setCategory("");
  }, [categories, category, setCategory]);

  let rows = category
    ? deals.filter((deal) => categoryMatches(deal.category, category))
    : [...deals];

  // 客户端二级筛选：价格下限按最低价。
  if (fMinPrice > 0) rows = rows.filter((d) => d.minPrice >= fMinPrice);

  // 价位阶梯筛选：价位1/2/3 = 最新扫描挂单档位价格（rawPayload.ladder，
  // 从低到高）。"价位1比价位2低 X%" = 最低档至少比次低档低 X%；
  // "价位2比价位3低 Y%" = 次低档至少比第三档低 Y%。启用时缺档的行视为不满足。
  if (fLadder12 > 0) {
    rows = rows.filter((d) => {
      const tier = d.ladder;
      if (!tier || tier.length < 2 || tier[1] <= 0) return false;
      return tier[0] <= tier[1] * (1 - fLadder12 / 100);
    });
  }
  if (fLadder23 > 0) {
    rows = rows.filter((d) => {
      const tier = d.ladder;
      if (!tier || tier.length < 3 || tier[2] <= 0) return false;
      return tier[1] <= tier[2] * (1 - fLadder23 / 100);
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
  } else {
    // 默认排序：必赚行按必赚金额从多到少排最前；其余行按流通分从高到低、
    // 同分按绝对盈利降序（与 buildDealRadar 输出一致）。
    rows.sort((left, right) => {
      if (left.vendor && right.vendor) return right.profit - left.profit;
      if (left.vendor) return -1;
      if (right.vendor) return 1;
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
  const moneyField = "bg-transparent text-right text-slate-100 focus:outline-none";

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
        <span className="flex items-center gap-1.5 border border-terminal-border/60 bg-terminal-panel2 px-2 py-1" title="0=关：不筛选。只保留最低价 ≥ 该值的行">
          <span className="text-terminal-muted">价格下限</span>
          <MoneyInput value={fMinPrice} onChange={setFMinPrice} fieldClass={moneyField} />
        </span>
        <span className="flex items-center gap-1.5 border border-terminal-border/60 bg-terminal-panel2 px-2 py-1" title="0=关：不筛选。价位1/2/3 = 最新扫描挂单档位价（从低到高）；要求最低档(价位1)至少比次低档(价位2)低该百分比，缺档的行被过滤">
          <span className="text-terminal-muted">价位1比价位2低</span>
          <input type="number" min={0} max={100} value={fLadder12 || ""} onChange={(event) => setFLadder12(Number(event.target.value) || 0)} className={`${moneyField} w-12`} />
          <span className="text-terminal-muted">%</span>
        </span>
        <span className="flex items-center gap-1.5 border border-terminal-border/60 bg-terminal-panel2 px-2 py-1" title="0=关：不筛选。要求次低档(价位2)至少比第三档(价位3)低该百分比，缺档的行被过滤">
          <span className="text-terminal-muted">价位2比价位3低</span>
          <input type="number" min={0} max={100} value={fLadder23 || ""} onChange={(event) => setFLadder23(Number(event.target.value) || 0)} className={`${moneyField} w-12`} />
          <span className="text-terminal-muted">%</span>
        </span>
        <span className="ml-auto text-terminal-muted">{rows.length} / {deals.length} 条</span>
      </div>
      <div className="max-h-[344px] overflow-y-auto [scrollbar-gutter:stable]">
      <table className="w-full min-w-[1000px] table-fixed border-collapse font-mono text-xs">
        <colgroup>
          <col className="w-11" />
          <col />
          <col className="w-[100px]" />
          <col className="w-[104px]" />
          <col className="w-[120px]" />
          <col className="w-[140px]" />
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
                {productItemIds.has(deal.itemId) && <ProductBadge itemId={deal.itemId} />}
                {turnoverBadgeClass(deal.turnoverScore) !== null && (
                  <span className={`ml-1.5 rounded px-1 py-0.5 align-middle text-[9px] ${turnoverBadgeClass(deal.turnoverScore)}`} title="被 N 个配方使用">{deal.turnoverScore}</span>
                )}
              </td>
              <td className="px-3 py-2 text-right"><Coins copper={deal.minPrice} /></td>
              <td className="px-3 py-2 text-right"><Coins copper={prices.get(deal.itemId) ?? 0} /></td>
              <td className="px-3 py-2 text-right text-terminal-muted"><Coins copper={deal.reference} /></td>
              {deal.vendor
                ? <td className="whitespace-nowrap px-3 py-2 text-right text-terminal-amber">必赚 +<Coins copper={deal.profit} /></td>
                : <td className={`whitespace-nowrap px-3 py-2 text-right ${deal.discountPercent > 0 ? "text-terminal-green" : deal.discountPercent < 0 ? "text-terminal-red" : "text-slate-100"}`}>{deal.discountPercent.toFixed(0)}%</td>}
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
