import { ArrowLeftRight, RadioTower } from "lucide-react";
import Link from "next/link";
import { getCrossMarketSides } from "@/lib/repositories";
import { buildCrossMarketRows, attachItemMeta, type CrossMarketRow } from "@/lib/cross-market";
import { MARKET_FEES } from "@/data/market-fees";
import { describeFreshness } from "@/lib/freshness";
import { qualityColorClass } from "@/lib/quality";
import { CopperAmount } from "@/components/copper-amount";
import { ItemIcon } from "@/components/item-icon";
import { Panel, PanelHeader } from "@/components/ui/panel";

// 跨市场倒卖面板（M2，核心）：联盟主城市场 × 中立（三角路口营地）市场
// 最新一轮配对，找出两边有价差/数量差的物品用于倒卖。
//
// 防污染红线：只比较两市场都出现过的物品；中立价绝不混入联盟分析；
// 一方无数据时整个面板空态，绝不编造价格。费率按经典值（联盟 5% /
// 中立 15%，src/data/market-fees.ts 可调），页面明确标注"以游戏实收为准"。

function parseArbitrageView(searchParams: Record<string, string | string[] | undefined>) {
  const minDiff = Number(searchParams.minDiff) || 30; // 最小价差%，默认 30
  const minQty = Math.max(0, Number(searchParams.minQty) || 0); // 最小买侧数量
  const operable = searchParams.operable === "1"; // 只看两市场均新鲜
  const sortParam = Array.isArray(searchParams.sort) ? searchParams.sort[0] : searchParams.sort;
  const sort = sortParam === "diff" ? "diff" : "profit";
  return { minDiff, minQty, operable, sort };
}

function applyArbitrageView(rows: CrossMarketRow[], view: ReturnType<typeof parseArbitrageView>) {
  const filtered = rows.filter((row) => {
    if (row.diffPct < view.minDiff) return false;
    const buySide = row.direction === "faction→neutral" ? row.faction : row.neutral;
    if (buySide.quantity < view.minQty) return false;
    if (view.operable && row.stale) return false;
    return true;
  });
  return filtered.sort((a, b) =>
    view.sort === "diff" ? b.diffPct - a.diffPct : b.estProfit - a.estProfit
  );
}

const DIRECTION_LABEL: Record<CrossMarketRow["direction"], string> = {
  "faction→neutral": "联盟→中立",
  "neutral→faction": "中立→联盟"
};

export default async function ArbitragePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const view = parseArbitrageView(raw);
  const { factionAt, neutralAt, faction, neutral, items } = await getCrossMarketSides();
  const meta = new Map(items.map((item) => [item.itemId, item]));
  const rows = attachItemMeta(buildCrossMarketRows(faction, neutral), meta);
  const visible = applyArbitrageView(rows, view);
  const factionFreshness = describeFreshness(factionAt, new Date());
  const neutralFreshness = describeFreshness(neutralAt, new Date());
  // 空态判断用时间戳（查询在任一方无数据时两侧数组都为空，但时间戳保留
  // 有数据那侧），提示文案才能区分"缺哪边"。
  const hasData = factionAt !== null && neutralAt !== null;

  // typedRoutes 下动态 query 链接用对象 href；query 只保留非空标量。
  const link = (params: Record<string, string>) => {
    const merged: Record<string, string> = { ...params };
    for (const [key, value] of Object.entries(raw)) {
      if (key in merged) continue;
      const scalar = Array.isArray(value) ? value[0] : value;
      if (scalar !== undefined && scalar !== null && scalar !== "") merged[key] = scalar;
    }
    return { pathname: "/arbitrage" as const, query: merged };
  };
  const sortLink = (sort: string) => link({ sort });
  const toggleParam = (key: string, on: string) =>
    link({ [key]: (Array.isArray(raw[key]) ? raw[key]?.[0] : raw[key]) === on ? "" : on });

  return (
    <main className="terminal-grid min-h-screen bg-terminal-bg p-3 text-slate-200">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border border-terminal-border bg-terminal-panel px-4 py-3">
        <div>
          <h1 className="font-mono text-lg font-semibold uppercase text-terminal-amber">Cross-Market Arbitrage</h1>
          <p className="font-mono text-xs text-terminal-muted">跨市场倒卖 · 联盟主城 × 中立（三角路口营地）</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-terminal-muted">
          <span className={factionFreshness.stale ? "text-terminal-red" : "text-terminal-green"}>联盟·更新于 {factionFreshness.label}</span>
          <span className={neutralFreshness.stale ? "text-terminal-red" : "text-terminal-green"}>中立·更新于 {neutralFreshness.label}</span>
          <Link href="/neutral" className="flex items-center gap-1 text-terminal-amber hover:underline"><ArrowLeftRight size={14} /> 中立行情</Link>
          <Link href="/" className="flex items-center gap-1 text-terminal-amber hover:underline">← 主终端</Link>
        </div>
      </div>

      {!hasData ? (
        <Panel>
          <PanelHeader title="跨市场比较" />
          <div className="p-6 font-mono text-xs text-terminal-muted">
            {factionAt === null && neutralAt === null
              ? "两个市场都还没有扫描数据。请先在主城拍卖行扫一次（联盟数据），再到三角路口贸易营地的中立拍卖行扫一次（/wah scan），然后 /reload 落盘。"
              : neutralAt === null
                ? "已有联盟数据，但还没有中立数据。请到三角路口贸易营地的中立拍卖行扫一次（/wah scan），然后 /reload 落盘，跨市场比较即有真实结果。"
                : "已有中立数据，但还没有联盟数据。请先在主城拍卖行扫一次。"}
          </div>
        </Panel>
      ) : (
        <div className="space-y-3">
          <Panel>
            <PanelHeader
              title="倒卖机会"
              action={<span className="font-mono text-xs text-terminal-green">{visible.length} 条 · 两市场均有挂单 · 价差≥{view.minDiff}%</span>}
            />
            <div className="flex flex-wrap items-center gap-3 border-b border-terminal-border px-3 py-2 font-mono text-xs text-terminal-muted">
              <span className="text-terminal-amber">价差≥</span>
              {[10, 30, 50, 100].map((pct) => (
                <Link key={pct} href={link({ minDiff: String(pct) })} className={view.minDiff === pct ? "text-terminal-green underline" : "hover:underline"}>
                  {pct}%
                </Link>
              ))}
              <span className="ml-3 text-terminal-amber">买侧量≥</span>
              {[0, 5, 20, 50].map((qty) => (
                <Link key={qty} href={link({ minQty: String(qty) })} className={view.minQty === qty ? "text-terminal-green underline" : "hover:underline"}>
                  {qty === 0 ? "无" : qty}
                </Link>
              ))}
              <Link href={toggleParam("operable", "1")}
                className={view.operable ? "text-terminal-green underline" : "hover:underline"}>
                仅可操作（两市场均新鲜）
              </Link>
              <span className="ml-3 text-terminal-amber">排序</span>
              <Link href={sortLink("profit")} className={view.sort === "profit" ? "text-terminal-green underline" : "hover:underline"}>净利</Link>
              <Link href={sortLink("diff")} className={view.sort === "diff" ? "text-terminal-green underline" : "hover:underline"}>价差%</Link>
            </div>
            {visible.length === 0 ? (
              <div className="p-6 font-mono text-xs text-terminal-muted">
                没有满足当前筛选的倒卖机会（价差≥{view.minDiff}%、买侧量≥{view.minQty}）。试试放宽筛选。
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead>
                    <tr className="border-b border-terminal-border text-terminal-muted">
                      <th className="px-3 py-2 font-normal">物品</th>
                      <th className="px-3 py-2 text-right font-normal">联盟价 P10</th>
                      <th className="px-3 py-2 text-right font-normal">中立价 P10</th>
                      <th className="px-3 py-2 text-right font-normal">价差%</th>
                      <th className="px-3 py-2 text-center font-normal">方向</th>
                      <th className="px-3 py-2 text-right font-normal">预计净利</th>
                      <th className="px-3 py-2 text-right font-normal">买侧量/卖侧量</th>
                      <th className="px-3 py-2 text-center font-normal">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => {
                      const buySide = row.direction === "faction→neutral" ? row.faction : row.neutral;
                      const sellSide = row.direction === "faction→neutral" ? row.neutral : row.faction;
                      return (
                        <tr key={row.itemId} className="border-b border-terminal-border/40 hover:bg-terminal-panel">
                          <td className="px-3 py-1.5">
                            <span className="flex items-center gap-2">
                              <ItemIcon itemId={row.itemId} icon={row.icon} />
                              <span className={qualityColorClass(row.quality)}>{row.name}</span>
                              <span className="text-terminal-muted">{row.category} / {row.subCategory}</span>
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-right"><CopperAmount copper={row.faction.marketPrice} /></td>
                          <td className="px-3 py-1.5 text-right"><CopperAmount copper={row.neutral.marketPrice} /></td>
                          <td className="px-3 py-1.5 text-right font-semibold text-terminal-amber">{row.diffPct.toFixed(1)}%</td>
                          <td className="px-3 py-1.5 text-center">
                            <span className={row.direction === "faction→neutral" ? "text-terminal-green" : "text-sky-400"}>
                              {DIRECTION_LABEL[row.direction]}
                            </span>
                          </td>
                          <td className={`px-3 py-1.5 text-right ${row.estProfit > 0 ? "text-terminal-green" : "text-terminal-red"}`}>
                            <CopperAmount copper={row.estProfit} />
                          </td>
                          <td className="px-3 py-1.5 text-right text-terminal-muted">
                            {buySide.quantity.toLocaleString()} / {sellSide.quantity.toLocaleString()}
                            <span className="ml-1 text-terminal-muted/70">({buySide.numAuctions}笔/{sellSide.numAuctions}笔)</span>
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            {row.stale
                              ? <span className="text-terminal-red">陈旧</span>
                              : <span className="text-terminal-green">正常</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <p className="font-mono text-xs text-terminal-muted">
            费率按经典怀旧服值（联盟 5% / 中立 15%，<code>src/data/market-fees.ts</code> 可调），以游戏实收为准；预计净利 = 卖侧 P10×(1−费率) − 买侧最低档价。中立价可能陈旧（超 7 天标"陈旧"）；低挂单量物品慎倒。方向文案提示跑图成本：中立 AH 在三角路口（艾尔文森林↔赤脊山交界），联盟很近、部落要跑路。
          </p>
        </div>
      )}
    </main>
  );
}
