"use client";

// 可做差价榜：起伏大 × 需求广（流通分）× 有人在卖（在售量）的标的池，
// 均值回归玩法最赚钱的候选。区间徽章显示当前价相对 7 日带的位置。
import Link from "next/link";
import type { SpreadCandidateRow } from "@/lib/analytics";
import { Coins } from "@/components/coins";
import { WatchStar } from "@/components/watch-star";
import { ItemIcon } from "@/components/item-icon";
import { ProductBadge } from "@/components/product-badge";
import { qualityColorClass } from "@/lib/quality";
import { turnoverBadgeClass } from "@/lib/turnover";
import { formatTrendPercent, trendTextClass } from "@/lib/trend";
import { zoneBadge } from "@/lib/utils";

export function SpreadCandidatesTable({ rows, prices, watchedItemIds, productItemIds, server }: {
  rows: SpreadCandidateRow[];
  prices: Map<number, number>;
  watchedItemIds: number[];
  productItemIds: Set<number>;
  server?: string;
}) {
  const watched = new Set(watchedItemIds);
  if (rows.length === 0) {
    return (
      <div className="p-6 font-mono text-xs text-terminal-muted">
        暂无标的：数据满 7 天后，起伏 ≥ 15%、被 2+ 配方使用、有人在售的物品会出现在这里（开服初期正常为空）。
      </div>
    );
  }
  return (
    <div>
      <div className="max-h-[344px] overflow-y-auto [scrollbar-gutter:stable]">
        <table className="w-full min-w-[1000px] table-fixed border-collapse font-mono text-xs">
          <colgroup>
            <col className="w-11" />
            <col />
            <col className="w-[104px]" />
            <col className="w-[110px]" />
            <col className="w-[88px]" />
            <col className="w-[88px]" />
            <col className="w-[88px]" />
            <col className="w-[96px]" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-terminal-panel2 text-[10px] uppercase text-terminal-muted">
            <tr>
              <th className="border-b border-terminal-border px-2 py-2 text-center">★</th>
              <th className="border-b border-terminal-border px-3 py-2 text-left">物品</th>
              <th className="border-b border-terminal-border px-3 py-2 text-right">最低买入</th>
              <th className="border-b border-terminal-border px-3 py-2 text-right">7日参考</th>
              <th className="border-b border-terminal-border px-3 py-2 text-right">区间</th>
              <th className="border-b border-terminal-border px-3 py-2 text-right">起伏%</th>
              <th className="border-b border-terminal-border px-3 py-2 text-right">在售量</th>
              <th className="border-b border-terminal-border px-3 py-2 text-right">环比%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const zone = zoneBadge(row.zone);
              return (
                <tr key={row.itemId} className="border-b border-terminal-border/70 hover:bg-slate-800/35">
                  <td className="px-2 py-2 text-center"><WatchStar itemId={row.itemId} watched={watched.has(row.itemId)} /></td>
                  <td className="px-3 py-2 text-left">
                    <Link href={`/items/${row.itemId}${server === "cn" ? "?server=cn" : ""}`} target="_blank" className={`inline-flex items-center gap-2 ${qualityColorClass(row.quality)}`}>
                      <ItemIcon itemId={row.itemId} icon={row.icon} />
                      <span className="truncate">{row.name}</span>
                    </Link>
                    {productItemIds.has(row.itemId) && <ProductBadge itemId={row.itemId} />}
                    {turnoverBadgeClass(row.turnoverScore) !== null && (
                      <span className={`ml-1.5 rounded px-1 py-0.5 align-middle text-[9px] ${turnoverBadgeClass(row.turnoverScore)}`} title="被 N 个配方使用">{row.turnoverScore}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right"><Coins copper={prices.get(row.itemId) ?? row.price} /></td>
                  <td className="px-3 py-2 text-right text-terminal-muted"><Coins copper={row.med7} /></td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right ${zone.className}`}>{zone.label}</td>
                  <td className="px-3 py-2 text-right text-slate-200">{row.volatilityRatio.toFixed(0)}%</td>
                  <td className="px-3 py-2 text-right text-slate-300">{row.quantity.toLocaleString("en-US")}</td>
                  <td className={"px-3 py-2 text-right " + trendTextClass(row.changePercent)}>{formatTrendPercent(row.changePercent)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
