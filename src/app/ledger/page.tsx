import Link from "next/link";
import { ArrowLeftRight, Package, Coins, TrendingUp, Clock } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { Panel, PanelHeader } from "@/components/ui/panel";

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
  // records arrive newest-first; process oldest-first.
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
    // expired: no P&L effect; items return to stock at unknown cost.
  }
  // Finalize avg cost of held lots.
  for (const entry of byItem.values()) {
    let held = 0, cost = 0;
    for (const lot of entry.queue) { held += lot.qty; cost += lot.qty * lot.unit; }
    entry.pos.held = held;
    entry.pos.avgCost = held > 0 ? Math.floor(cost / held) : 0;
  }
  return byItem;
}

export default async function LedgerPage() {
  const records = await prisma.tradeRecord.findMany({ orderBy: { ts: "desc" }, take: 1000 });
  const itemIds = [...new Set(records.map((r) => r.itemId).filter((id) => id > 0))];
  const items = itemIds.length ? await prisma.item.findMany({ where: { itemId: { in: itemIds } } }) : [];
  const nameOf = new Map(items.map((i) => [i.itemId, i.name]));

  const positions = computePositions(records as unknown as RecordRow[]);
  const posList = [...positions.values()]
    .map((e) => e.pos)
    .filter((p) => p.held > 0 || p.soldQty > 0)
    .sort((a, b) => b.realized - a.realized);

  const totalRealized = posList.reduce((s, p) => s + p.realized, 0);
  const totalHeldCost = posList.reduce((s, p) => s + p.held * p.avgCost, 0);
  const sells = records.filter((r) => r.kind === "sell").length;
  const buys = records.filter((r) => r.kind === "buy").length;

  return (
    <main className="terminal-grid min-h-screen bg-terminal-bg p-3 text-slate-200">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border border-terminal-border bg-terminal-panel px-4 py-3">
        <div>
          <h1 className="font-mono text-lg font-semibold uppercase text-terminal-amber">成交账本</h1>
          <p className="font-mono text-xs text-terminal-muted">买入实时记录 · 卖出/流拍来自邮箱扫描 · FIFO 成本与已实现盈亏</p>
        </div>
        <Link href="/" className="font-mono text-xs text-terminal-amber hover:underline">← 返回终端</Link>
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

      <div className="mb-3">
        <Panel>
          <PanelHeader title="持仓与盈亏（按已实现盈亏排序）" />
          <table className="w-full font-mono text-xs">
            <thead className="border-b border-terminal-border text-terminal-muted">
              <tr>
                <th className="p-2 text-left">物品</th>
                <th className="p-2 text-right">持仓</th>
                <th className="p-2 text-right">均价</th>
                <th className="p-2 text-right">已售</th>
                <th className="p-2 text-right">已实现盈亏</th>
              </tr>
            </thead>
            <tbody>
              {posList.length === 0 && (
                <tr><td colSpan={5} className="p-3 text-terminal-muted">暂无记录。在游戏内通过 WAH 按钮买入后，流水会自动出现在这里。</td></tr>
              )}
              {posList.map((p) => (
                <tr key={p.itemId} className="border-b border-terminal-border/50">
                  <td className="p-2">{nameOf.get(p.itemId) ?? `item:${p.itemId}`}</td>
                  <td className="p-2 text-right">{p.held}</td>
                  <td className="p-2 text-right">{fmtCopper(p.avgCost)}</td>
                  <td className="p-2 text-right">{p.soldQty}</td>
                  <td className={`p-2 text-right ${p.realized >= 0 ? "text-terminal-green" : "text-terminal-red"}`}>
                    {fmtCopper(Math.round(p.realized))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="流水明细（最新在前）" />
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
            {records.slice(0, 200).map((r) => (
              <tr key={r.uid} className="border-b border-terminal-border/50">
                <td className="p-2 text-terminal-muted">
                  <span className="flex items-center gap-1"><Clock size={10} />{r.ts.toLocaleString("zh-CN")}</span>
                </td>
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
        卖出金额按扣 5% 拍卖行手续费后的净额计入已实现盈亏；流拍不计盈亏。
      </div>
    </main>
  );
}
