"use client";

// 异动榜：两次扫描/两日之间价格大幅变动（|环比%| ≥ 20%）。大跌 = 甩货/错杀
// （买点候选，绿）；大涨 = 需求脉冲/抬价（卖点候选，红）。需要前一日数据，
// 开服初期榜单为空是预期。
import Link from "next/link";
import type { MoverRow } from "@/lib/analytics";
import { Coins } from "@/components/coins";
import { WatchStar } from "@/components/watch-star";
import { ItemIcon } from "@/components/item-icon";
import { ProductBadge } from "@/components/product-badge";
import { qualityColorClass } from "@/lib/quality";
import { turnoverBadgeClass } from "@/lib/turnover";
import { formatTrendPercent } from "@/lib/trend";

function directionBadge(changePercent: number): { label: string; className: string } {
  return changePercent < 0
    ? { label: "大跌·买点", className: "text-terminal-green" }
    : { label: "大涨·卖点", className: "text-terminal-red" };
}

export function MoverBoardTable({ rows, prices, watchedItemIds, productItemIds, server }: {
  rows: MoverRow[];
  prices: Map<number, number>;
  watchedItemIds: number[];
  productItemIds: Set<number>;
  server?: string;
}) {
  const watched = new Set(watchedItemIds);
  if (rows.length === 0) {
    return (
      <div className="p-6 font-mono text-xs text-terminal-muted">
        暂无异动：两次扫描之间价格变动 ≥ 20% 且有人在售的物品会出现在这里（开服初期数据不足，正常为空）。
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
            <col className="w-[100px]" />
            <col className="w-[120px]" />
            <col className="w-[88px]" />
            <col className="w-[64px]" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-terminal-panel2 text-[10px] uppercase text-terminal-muted">
            <tr>
              <th className="border-b border-terminal-border px-2 py-2 text-center">★</th>
              <th className="border-b border-terminal-border px-3 py-2 text-left">物品</th>
              <th className="border-b border-terminal-border px-3 py-2 text-right">最低买入</th>
              <th className="border-b border-terminal-border px-3 py-2 text-right">7日参考</th>
              <th className="border-b border-terminal-border px-3 py-2 text-right">变动%</th>
              <th className="border-b border-terminal-border px-3 py-2 text-right">方向</th>
              <th className="border-b border-terminal-border px-3 py-2 text-right">在售量</th>
              <th className="border-b border-terminal-border px-3 py-2 text-right">流通</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const direction = directionBadge(row.changePercent);
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
                  <td className={`whitespace-nowrap px-3 py-2 text-right ${row.changePercent < 0 ? "text-terminal-green" : "text-terminal-red"}`}>{formatTrendPercent(row.changePercent)}</td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right ${direction.className}`}>{direction.label}</td>
                  <td className="px-3 py-2 text-right text-slate-300">{row.quantity.toLocaleString("en-US")}</td>
                  <td className="px-3 py-2 text-right text-slate-300">{row.turnoverScore}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
