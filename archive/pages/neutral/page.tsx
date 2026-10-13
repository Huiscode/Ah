import { RadioTower } from "lucide-react";
import Link from "next/link";
import { getNeutralMarketLatest, getLatestSnapshotTime } from "@/lib/repositories";
import { describeFreshness } from "@/lib/freshness";
import { qualityColorClass } from "@/lib/quality";
import { CopperAmount } from "@/components/copper-amount";
import { ItemIcon } from "@/components/item-icon";
import { Panel, PanelHeader } from "@/components/ui/panel";

// 中立拍卖行（M1）：只读展示三角路口贸易营地（艾尔文森林 ↔ 赤脊山交界，
// 板条箱提交点）的最新一轮行情。独立于联盟主城市场：数据来自插件的
// neutralScanData 槽位，按 market='neutral' 落库，不参与雷达/趋势/配方
// 利润等任何联盟分析。跨市场差价比较（M2）在本页的基础上扩展。
export default async function NeutralMarketPage() {
  const [{ scannedAt, rows }, latestSnapshotAt] = await Promise.all([
    getNeutralMarketLatest(),
    getLatestSnapshotTime("neutral")
  ]);
  const freshness = describeFreshness(scannedAt, new Date());
  const sorted = [...rows].sort((a, b) => b.marketPrice - a.marketPrice);

  return (
    <main className="terminal-grid min-h-screen bg-terminal-bg p-3 text-slate-200">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border border-terminal-border bg-terminal-panel px-4 py-3">
        <div>
          <h1 className="font-mono text-lg font-semibold uppercase text-terminal-amber">Neutral Market</h1>
          <p className="font-mono text-xs text-terminal-muted">中立拍卖行 · 三角路口贸易营地（艾尔文森林 ↔ 赤脊山交界）</p>
        </div>
        <div className="flex items-center gap-3 font-mono text-xs text-terminal-muted">
          <span className={freshness.stale ? "flex items-center gap-1 text-terminal-red" : "flex items-center gap-1 text-terminal-green"}>
            <RadioTower size={14} /> 数据更新于 {freshness.label}
          </span>
          <Link href="/" className="flex items-center gap-1 text-terminal-amber hover:underline">← 返回主终端</Link>
        </div>
      </div>

      <Panel>
        <PanelHeader
          title="中立行情 · 最新一轮"
          action={<span className="font-mono text-xs text-terminal-green">共 {rows.length} 件在售 · 仅供查看，不参与联盟分析</span>}
        />
        {rows.length === 0 ? (
          <div className="p-6 font-mono text-xs text-terminal-muted">
            {latestSnapshotAt === null
              ? "尚无中立市场数据。请在三角路口贸易营地的拍卖行完成一次扫描（/wah scan），插件会把中立行情单独记录并导入。"
              : "中立市场扫描已导入但本轮没有在售物品。"}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="border-b border-terminal-border text-terminal-muted">
                  <th className="px-3 py-2 font-normal">物品</th>
                  <th className="px-3 py-2 text-right font-normal">市场价 P10</th>
                  <th className="px-3 py-2 text-right font-normal">最低挂单</th>
                  <th className="px-3 py-2 text-right font-normal">在售量</th>
                  <th className="px-3 py-2 text-right font-normal">挂单数</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <tr key={row.itemId} className="border-b border-terminal-border/40 hover:bg-terminal-panel">
                    <td className="px-3 py-1.5">
                      <span className="flex items-center gap-2">
                        <ItemIcon itemId={row.itemId} icon={row.icon} />
                        <span className={qualityColorClass(row.quality)}>{row.name}</span>
                        <span className="text-terminal-muted">{row.category} / {row.subCategory}</span>
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right text-terminal-amber"><CopperAmount copper={row.marketPrice} /></td>
                    <td className="px-3 py-1.5 text-right"><CopperAmount copper={row.minPrice} /></td>
                    <td className="px-3 py-1.5 text-right">{row.quantity.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right">{row.numAuctions.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </main>
  );
}
