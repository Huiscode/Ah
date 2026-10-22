import Link from "next/link";
import { RadioTower } from "lucide-react";
import { getMarketSignals } from "@/lib/market-signals";
import { AUCTIONATOR_STALE_MAX_AGE_MS, describeFreshness } from "@/lib/freshness";
import { parseServer, SERVER_LABELS } from "@/lib/servers";
import { DisenchantCalculator } from "@/components/disenchant-calculator";
import { CloseTabButton } from "@/components/close-tab-button";

export const dynamic = "force-dynamic";

// 独立分解计算器页：自由选材料填数量、累加买入价，对比到手与实际净赚。
// 材料现价取本服最新扫描的 AH 最低买入价；无价材料可在页面手填参考单价。
export default async function DisenchantCalcPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const server = parseServer(raw.server);
  const serverLabel = SERVER_LABELS[server] ?? server;
  const serverHrefOther = server === "cn" ? "/tools/disenchant-calc" : "/tools/disenchant-calc?server=cn";

  const { signals, latestSnapshotAt } = await getMarketSignals("faction", "current", server);
  const freshness = describeFreshness(latestSnapshotAt, new Date(), AUCTIONATOR_STALE_MAX_AGE_MS);
  const priceByItemId = new Map(signals.map((s) => [s.itemId, s.price]));

  return (
    <main className="terminal-grid min-h-screen bg-terminal-bg p-3 text-slate-200">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border border-terminal-border bg-terminal-panel px-4 py-3">
        <div>
          <h1 className="font-mono text-lg font-semibold uppercase text-terminal-amber">分解计算器</h1>
          <p className="font-mono text-xs text-terminal-muted">选材料填数量 · 累加买入价 · 对比到手与实际净赚</p>
        </div>
        <div className="flex items-center gap-3 font-mono text-xs text-terminal-muted">
          <span className={freshness.stale ? "flex items-center gap-1 text-terminal-red" : "flex items-center gap-1 text-terminal-green"}>
            <RadioTower size={14} /> {serverLabel}·市场数据更新于 {freshness.label}
          </span>
          <Link href={serverHrefOther} className="text-terminal-amber underline">{server === "cn" ? "← 欧服" : "中国服 →"}</Link>
          <CloseTabButton />
        </div>
      </div>

      {signals.length === 0 && (
        <div className="mb-3 border border-terminal-amber/50 bg-amber-500/10 px-4 py-2 font-mono text-xs text-terminal-amber">
          本服务器暂无市场数据：材料现价为空，可手填参考单价计算。请在游戏内用 Auctionator 扫描后重跑导入。
        </div>
      )}

      <DisenchantCalculator prices={priceByItemId} />
    </main>
  );
}
