import { ArrowLeftRight, Package, Coins, TrendingUp, Clock, Wallet, CheckCircle2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { ClearLedgerButton } from "@/components/clear-ledger-button";
import { CloseTabButton } from "@/components/close-tab-button";

export const dynamic = "force-dynamic";

const AH_CUT = 0.05;

type RecordRow = {
  uid: string;
  kind: "buy" | "sell" | "expired";
  itemId: number;
  qty: number;
  unitPrice: bigint;
  total: bigint;
  ts: Date;
  note: string | null;
};

type QueueLot = { qty: number; unit: number };

function fmtCopper(v: number | bigint): string {
  const n = typeof v === "bigint" ? Number(v) : v;
  if (!Number.isFinite(n)) return "0";
  const g = Math.floor(n / 10000);
  const s = Math.floor((n % 10000) / 100);
  const c = n % 100;
  if (g > 0) return `${g}g ${s}s ${c}c`;
  if (s > 0) return `${s}s ${c}c`;
  return `${c}c`;
}

type Position = {
  itemId: number;
  held: number;
  avgCost: number;
  soldQty: number;
  costOfSold: number;
  revenueNet: number;
  realized: number;
  totalBought: number;
};

function computePositions(records: RecordRow[]): Map<number, { queue: QueueLot[]; pos: Position }> {
  const byItem = new Map<number, { queue: QueueLot[]; pos: Position }>();
  const sorted = [...records].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  for (const r of sorted) {
    if (r.itemId <= 0) continue;
    let entry = byItem.get(r.itemId);
    if (!entry) {
      entry = {
        queue: [],
        pos: {
          itemId: r.itemId, held: 0, avgCost: 0, soldQty: 0,
          costOfSold: 0, revenueNet: 0, realized: 0, totalBought: 0
        }
      };
      byItem.set(r.itemId, entry);
    }
    const pos = entry.pos;
    if (r.kind === "buy") {
      const qty = r.qty;
      const unit = Number(r.unitPrice);
      if (qty > 0 && unit > 0) entry.queue.push({ qty, unit });
      pos.totalBought += Number(r.total);
    } else if (r.kind === "sell") {
      const revenue = Number(r.total);
      let remaining = r.qty;
      let cost = 0;
      while (remaining > 0 && entry.queue.length > 0) {
        const lot = entry.queue[0];
        const take = Math.min(remaining, lot.qty);
        cost += take * lot.unit;
        lot.qty -= take;
        remaining -= take;
        pos.soldQty += take;
        if (lot.qty <= 0) entry.queue.shift();
      }
      pos.revenueNet += revenue * (1 - AH_CUT);
      pos.costOfSold += cost;
      pos.realized = pos.revenueNet - pos.costOfSold;
    }
  }
  for (const entry of byItem.values()) {
    let held = 0, cost = 0;
    for (const lot of entry.queue) { held += lot.qty; cost += lot.qty * lot.unit; }
    entry.pos.held = held;
    entry.pos.avgCost = held > 0 ? Math.floor(cost / held) : 0;
  }
  return byItem;
}

export default async function LedgerPage() {
  const records = await prisma.tradeRecord.findMany({ orderBy: { ts: "desc" }, take: 2000 });
  const itemIds = [...new Set(records.map((r) => r.itemId).filter((id) => id > 0))];
  const items = itemIds.length ? await prisma.item.findMany({ where: { itemId: { in: itemIds } } }) : [];
  const nameOf = new Map(items.map((i) => [i.itemId, i.name]));

  const positions = computePositions(records as unknown as RecordRow[]);
  const all = [...positions.values()].map((e) => e.pos);

  // Split into open positions (still held) and closed (fully sold).
  const openPos = all
    .filter((p) => p.held > 0)
    .sort((a, b) => b.held * b.avgCost - a.held * a.avgCost);
  const closedPos = all
    .filter((p) => p.held === 0 && p.soldQty > 0)
    .sort((a, b) => b.realized - a.realized);

  const totalRealized = all.reduce((s, p) => s + p.realized, 0);
  const totalHeldCost = openPos.reduce((s, p) => s + p.held * p.avgCost, 0);
  const sells = records.filter((r) => r.kind === "sell").length;
  const buys = records.filter((r) => r.kind === "buy").length;

  const detailRows = records.slice(0, 100);

  return (
    <main className="terminal-grid min-h-screen bg-terminal-bg p-3 text-slate-200">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border border-terminal-border bg-terminal-panel px-4 py-3">
        <div>
          <h1 className="font-mono text-lg font-semibold uppercase text-terminal-amber">成交账本</h1>
          <p className="font-mono text-xs text-terminal-muted">买入实时记录 · 卖出来自邮箱扫描 · FIFO 成本与已实现盈亏</p>
        </div>
        <div className="flex items-center gap-3">
          <ClearLedgerButton />
          <CloseTabButton />
        </div>
      </div>

      <div className="mb-3 grid gap-3 font-mono text-xs md:grid-cols-4">
        <Panel><PanelHeader title="已实现盈亏" />
          <div className={`p-3 text-lg font-semibold ${totalRealized >= 0 ? "text-terminal-green" : "text-terminal-red"}`}>{fmtCopper(Math.round(totalRealized))}</div>
        </Panel>
        <Panel><PanelHeader title="持仓成本" />
          <div className="p-3 text-lg font-semibold text-terminal-amber">{fmtCopper(Math.round(totalHeldCost))}</div>
        </Panel>
        <Panel><PanelHeader title="买入笔数" />
          <div className="flex items-center gap-2 p-3 text-lg"><ArrowLeftRight size={16} className="text-terminal-green" />{buys}</div>
        </Panel>
        <Panel><PanelHeader title="卖出笔数" />
          <div className="flex items-center gap-2 p-3 text-lg"><TrendingUp size={16} className="text-terminal-amber" />{sells}</div>
        </Panel>
      </div>

      {/* Open positions: items still held */}
      <div className="mb-3">
        <Panel>
          <PanelHeader title={<span className="flex items-center gap-1"><Wallet size={14} /> 持仓中（买入后未卖出）</span>} />
          <table className="w-full font-mono text-xs">
            <thead className="border-b border-terminal-border text-terminal-muted">
              <tr>
                <th className="p-2 text-left">物品</th>
                <th className="p-2 text-right">持仓</th>
                <th className="p-2 text-right">均价</th>
                <th className="p-2 text-right">成本</th>
              </tr>
            </thead>
            <tbody>
              {openPos.length === 0 && (
                <tr><td colSpan={4} className="p-3 text-terminal-muted">暂无持仓。通过 WAH 按钮买入后会出现在这里。</td></tr>
              )}
              {openPos.map((p) => (
                <tr key={p.itemId} className="border-b border-terminal-border/50">
                  <td className="p-2">{nameOf.get(p.itemId) ?? `item:${p.itemId}`}</td>
                  <td className="p-2 text-right">{p.held}</td>
                  <td className="p-2 text-right">{fmtCopper(p.avgCost)}</td>
                  <td className="p-2 text-right text-terminal-amber">{fmtCopper(p.held * p.avgCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      {/* Closed items: one row each, showing realized P&L */}
      <div className="mb-3">
        <Panel>
          <PanelHeader title={<span className="flex items-center gap-1"><CheckCircle2 size={14} /> 已清仓（按已实现盈亏排序）</span>} />
          <table className="w-full font-mono text-xs">
            <thead className="border-b border-terminal-border text-terminal-muted">
              <tr>
                <th className="p-2 text-left">物品</th>
                <th className="p-2 text-right">已售</th>
                <th className="p-2 text-right">净收入</th>
                <th className="p-2 text-right">成本</th>
                <th className="p-2 text-right">已实现盈亏</th>
              </tr>
            </thead>
            <tbody>
              {closedPos.length === 0 && (
                <tr><td colSpan={5} className="p-3 text-terminal-muted">还没有完全卖出的物品。</td></tr>
              )}
              {closedPos.map((p) => (
                <tr key={p.itemId} className="border-b border-terminal-border/50">
                  <td className="p-2">{nameOf.get(p.itemId) ?? `item:${p.itemId}`}</td>
                  <td className="p-2 text-right">{p.soldQty}</td>
                  <td className="p-2 text-right">{fmtCopper(Math.round(p.revenueNet))}</td>
                  <td className="p-2 text-right">{fmtCopper(p.costOfSold)}</td>
                  <td className={`p-2 text-right ${p.realized >= 0 ? "text-terminal-green" : "text-terminal-red"}`}>
                    {fmtCopper(Math.round(p.realized))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      {/* Recent transaction detail: last 100 */}
      <Panel>
        <PanelHeader title={<span className="flex items-center gap-1"><Clock size={14} /> 最近交易（最新 100 条）</span>} />
        <table className="w-full font-mono text-xs">
          <thead className="border-b border-terminal-border text-terminal-muted">
            <tr>
              <th className="p-2 text-left">时间</th>
              <th className="p-2 text-left">类型</th>
              <th className="p-2 text-left">物品</th>
              <th className="p-2 text-right">数量</th>
              <th className="p-2 text-right">单价</th>
              <th className="p-2 text-right">总额</th>
            </tr>
          </thead>
          <tbody>
            {detailRows.length === 0 && (
              <tr><td colSpan={6} className="p-3 text-terminal-muted">暂无流水。</td></tr>
            )}
            {detailRows.map((r) => (
              <tr key={r.uid} className="border-b border-terminal-border/50">
                <td className="p-2 text-terminal-muted">{r.ts.toLocaleString("zh-CN")}</td>
                <td className="p-2">
                  <span className={
                    r.kind === "buy" ? "text-terminal-green"
                    : r.kind === "sell" ? "text-terminal-amber" : "text-terminal-muted"
                  }>
                    {r.kind === "buy" ? "买入" : r.kind === "sell" ? "卖出" : "流拍"}
                  </span>
                </td>
                <td className="p-2">{nameOf.get(r.itemId) ?? r.note ?? `item:${r.itemId}`}</td>
                <td className="p-2 text-right">{r.qty}</td>
                <td className="p-2 text-right">{fmtCopper(r.unitPrice)}</td>
                <td className="p-2 text-right">{fmtCopper(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <div className="mt-3 flex items-center gap-2 font-mono text-xs text-terminal-muted">
        <Package size={14} />
        卖出金额按扣 5% 拍卖行手续费后计入已实现盈亏；用掉/消耗的物品不记录，保留在持仓中。
      </div>
    </main>
  );
}
