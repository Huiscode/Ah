"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ItemIcon } from "@/components/item-icon";
import { Coins } from "@/components/coins";
import { WatchStar } from "@/components/watch-star";
import { ProductBadge } from "@/components/product-badge";
import { qualityColorClass } from "@/lib/quality";
import { turnoverBadgeClass } from "@/lib/turnover";
import type { DealKind, DealRadarRow } from "@/lib/analytics";
import { usePersistedState } from "@/lib/use-persisted-state";
import { useLang, useLL } from "@/components/lang-provider";
import { displayName } from "@/lib/i18n";
import { filterRadarRows, RADAR_FILTER_DEFAULTS, RADAR_FILTER_KEYS } from "@/lib/radar-filters";

type SortKey = "name" | "kind" | "buyPrice" | "buyQty" | "sellPrice" | "unitProfit" | "totalProfit" | "roiPercent" | "quantity";

export const DEAL_KIND_LABELS: Record<DealKind, [string, string]> = {
  vendor: ["Vendor", "必赚"],
  flip: ["Flip", "扫货"],
  cross: ["Cross", "跨市场"],
  band: ["Band", "波段"]
};

const KIND_CLASS: Record<DealKind, string> = {
  vendor: "text-terminal-amber",
  flip: "text-terminal-green",
  cross: "text-sky-300",
  band: "text-violet-300"
};

// 捡漏雷达：每行 = 一个可执行的赚金动作（买什么、买多少、卖到哪、赚多少）。
// 默认按总利润降序；点表头切换排序（第一次高→低，再点低→高）。
export function DealRadarTable({ deals, categories, watchedItemIds, productItemIds, tierGapByItemId }: {
  deals: DealRadarRow[];
  categories: string[];
  watchedItemIds: number[];
  productItemIds: Set<number>;
  tierGapByItemId?: Map<number, number>; // 前五档价格档位差距%
  server?: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortAsc, setSortAsc] = useState(false);
  const [strategy] = usePersistedState<string>(RADAR_FILTER_KEYS.strategy, "");
  const [category, setCategory] = usePersistedState<string>(RADAR_FILTER_KEYS.category, "");
  const [minTotalProfitSilver] = usePersistedState<number>(RADAR_FILTER_KEYS.minTotalProfitSilver, 0);
  const [onlyLiquid] = usePersistedState<boolean>(RADAR_FILTER_KEYS.onlyLiquid, RADAR_FILTER_DEFAULTS.onlyLiquid);
  const [minQuantity] = usePersistedState<number>(RADAR_FILTER_KEYS.minQuantity, 0);
  const [minTierGap] = usePersistedState<number>(RADAR_FILTER_KEYS.minTierGap, 0);
  const lang = useLang();
  const tr = useLL();
  const watched = new Set(watchedItemIds);

  useEffect(() => {
    if (category && !categories.includes(category)) setCategory("");
  }, [categories, category, setCategory]);

  const rows = filterRadarRows(
    deals,
    { strategy, category, minTotalProfitSilver, onlyLiquid, minQuantity, minTierGap },
    tierGapByItemId
  );

  if (sortKey) {
    rows.sort((left, right) => {
      const a = sortKey === "name" ? left.name : left[sortKey];
      const b = sortKey === "name" ? right.name : right[sortKey];
      if (a === b) return right.totalProfit - left.totalProfit;
      return sortAsc ? (a > b ? 1 : -1) : (a < b ? 1 : -1);
    });
  }

  const toggle = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc((asc) => !asc);
      return;
    }
    setSortKey(key);
    setSortAsc(false);
  };

  const mark = (key: SortKey) => (sortKey === key ? (sortAsc ? " ▲" : " ▼") : "");
  const thClass = "cursor-pointer select-none border-b border-terminal-border px-3 py-2 hover:text-slate-200";
  const kindLabel = (kind: DealKind) => tr(DEAL_KIND_LABELS[kind][0], DEAL_KIND_LABELS[kind][1]);
  const marketLabel = (market?: string) => (market === "neutral" ? tr("Neutral", "中立") : tr("Alliance", "联盟"));

  return (
    <div>
      <div className="max-h-[344px] overflow-y-auto [scrollbar-gutter:stable]">
      <table className="w-full min-w-[1080px] table-fixed border-collapse font-mono text-xs">
        <colgroup>
          <col className="w-11" />
          <col />
          <col className="w-[84px]" />
          <col className="w-[100px]" />
          <col className="w-[64px]" />
          <col className="w-[110px]" />
          <col className="w-[96px]" />
          <col className="w-[104px]" />
          <col className="w-[64px]" />
          <col className="w-[72px]" />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-terminal-panel2 text-[10px] uppercase text-terminal-muted">
          <tr>
            <th className="border-b border-terminal-border px-2 py-2 text-center">★</th>
            <th onClick={() => toggle("name")} className={`${thClass} text-left`}>{tr("Item", "物品")}{mark("name")}</th>
            <th onClick={() => toggle("kind")} className={`${thClass} text-left`}>{tr("Play", "策略")}{mark("kind")}</th>
            <th onClick={() => toggle("buyPrice")} className={`${thClass} text-right`} title={tr("Cheapest listing", "最便宜一档单价")}>{tr("Buy @", "买入价")}{mark("buyPrice")}</th>
            <th onClick={() => toggle("buyQty")} className={`${thClass} text-right`} title={tr("Units to buy (sum of swept tiers); ~ = depth unknown, assume 1", "建议买入数量（扫到的档位合计）；~ = 暂无档位数据，按 1 计")}>{tr("Qty", "买量")}{mark("buyQty")}</th>
            <th onClick={() => toggle("sellPrice")} className={`${thClass} text-right`} title={tr("Where to sell: vendor price / relist price / other market", "卖到哪：NPC 收购价 / 回挂价 / 另一市场挂价")}>{tr("Sell @", "卖出价")}{mark("sellPrice")}</th>
            <th onClick={() => toggle("unitProfit")} className={`${thClass} text-right`} title={tr("Net per unit after 5% AH cut (worst unit bought)", "税后单件净利（按最贵那件算）")}>{tr("Unit", "单件利润")}{mark("unitProfit")}</th>
            <th onClick={() => toggle("totalProfit")} className={`${thClass} text-right`}>{tr("Total", "总利润")}{mark("totalProfit")}</th>
            <th onClick={() => toggle("roiPercent")} className={`${thClass} text-right`}>ROI{mark("roiPercent")}</th>
            <th onClick={() => toggle("quantity")} className={`${thClass} text-right`} title={tr("Total listed in this market", "本市场在售总量")}>{tr("Listed", "在售")}{mark("quantity")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((deal) => (
            <tr key={deal.key} className="border-b border-terminal-border/70 hover:bg-slate-800/35">
              <td className="px-2 py-2 text-center"><WatchStar itemId={deal.itemId} watched={watched.has(deal.itemId)} /></td>
              <td className="px-3 py-2 text-left">
                <Link href={`/items/${deal.itemId}`} target="_blank" className={`inline-flex items-center gap-2 ${qualityColorClass(deal.quality)}`}>
                  <ItemIcon itemId={deal.itemId} icon={deal.icon} />
                  <span className="truncate">{displayName(deal.name, deal.nameEn, lang)}</span>
                </Link>
                {productItemIds.has(deal.itemId) && <ProductBadge itemId={deal.itemId} />}
                {turnoverBadgeClass(deal.turnoverScore) !== null && (
                  <span className={`ml-1.5 rounded px-1 py-0.5 align-middle text-[9px] ${turnoverBadgeClass(deal.turnoverScore)}`} title={tr("Used by N recipes", "被 N 个配方使用")}>{deal.turnoverScore}</span>
                )}
              </td>
              <td className={`whitespace-nowrap px-3 py-2 text-left ${KIND_CLASS[deal.kind]}`}>
                {kindLabel(deal.kind)}{deal.kind === "cross" ? ` →${marketLabel(deal.sellMarket)}` : ""}
              </td>
              <td className="px-3 py-2 text-right"><Coins copper={deal.buyPrice} /></td>
              <td className="px-3 py-2 text-right text-slate-300">{deal.depthKnown ? deal.buyQty.toLocaleString("en-US") : `~${deal.buyQty}`}</td>
              <td className="px-3 py-2 text-right text-terminal-muted"><Coins copper={deal.sellPrice} /></td>
              <td className="px-3 py-2 text-right"><Coins copper={deal.unitProfit} /></td>
              <td className="px-3 py-2 text-right text-terminal-green"><Coins copper={deal.totalProfit} /></td>
              <td className="px-3 py-2 text-right text-slate-300">{deal.roiPercent.toFixed(0)}%</td>
              <td className="px-3 py-2 text-right text-slate-300">{deal.quantity.toLocaleString("en-US")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
