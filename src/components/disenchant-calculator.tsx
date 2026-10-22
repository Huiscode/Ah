"use client";

// 独立分解计算器：自由选附魔材料填数量、按「装备+件数+单件价」批量累加买入，
// 同一处对比材料毛额 / 扣5%到手 / 总买入 / 实际净赚（到手−总买入，绿赚红亏）。
// 价格一律 g/s/c（金/银/铜）输入：1金=100银=10000铜。不绑定榜单。
import { useMemo, useState } from "react";
import { DISENCHANT_MAT_NAMES } from "@/lib/disenchant-table";
import { computeCalcSummary } from "@/lib/analytics";
import { Coins } from "@/components/coins";

type MaterialRow = { matItemId: number | ""; qty: string; g: string; s: string; c: string };
type BuyRow = { note: string; count: string; g: string; s: string; c: string };

const MAT_OPTIONS = Object.entries(DISENCHANT_MAT_NAMES).map(([id, name]) => ({
  id: Number(id),
  name
}));

const emptyMaterial = (): MaterialRow => ({ matItemId: "", qty: "", g: "", s: "", c: "" });
const emptyBuy = (): BuyRow => ({ note: "", count: "", g: "", s: "", c: "" });

const num = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const gscToCopper = (g: string, s: string, c: string) => num(g) * 10000 + num(s) * 100 + num(c);

const inputCls =
  "rounded border border-terminal-border bg-terminal-panel2 px-2 py-1 text-slate-200 outline-none focus:border-slate-500";

// g/s/c 三联输入：金 / 银 / 铜 三个小框。
function GscFields({
  g, s, c, on
}: {
  g: string; s: string; c: string;
  on: (patch: { g?: string; s?: string; c?: string }) => void;
}) {
  const field = (val: string, key: "g" | "s" | "c", unit: string, w: string, ph: string) => (
    <span className="inline-flex items-center gap-0.5">
      <input
        type="number" min={0} step={1} inputMode="numeric" placeholder={ph}
        value={val}
        onChange={(e) => on({ [key]: e.target.value })}
        className={`${inputCls} ${w} text-center`}
      />
      <span className="text-terminal-muted">{unit}</span>
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1">
      {field(g, "g", "g", "w-12", "0")}
      {field(s, "s", "s", "w-12", "0")}
      {field(c, "c", "c", "w-12", "0")}
    </span>
  );
}

export function DisenchantCalculator({ prices }: { prices: Map<number, number> }) {
  const [materials, setMaterials] = useState<MaterialRow[]>([emptyMaterial()]);
  const [buys, setBuys] = useState<BuyRow[]>([emptyBuy()]);

  // 材料行单价：优先 AH 现价，无价则用手填 g/s/c。
  const matUnit = (row: MaterialRow): number => {
    if (row.matItemId === "") return 0;
    const live = prices.get(row.matItemId) ?? 0;
    return live > 0 ? live : gscToCopper(row.g, row.s, row.c);
  };

  const summary = useMemo(() => {
    const lines = materials.map((r) => ({ qty: num(r.qty), unit: matUnit(r) }));
    const buyLines = buys.map((r) => ({ count: num(r.count), unit: gscToCopper(r.g, r.s, r.c) }));
    return computeCalcSummary(lines, buyLines);
  }, [materials, buys, prices]);

  const setMaterial = (idx: number, patch: Partial<MaterialRow>) =>
    setMaterials((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const setBuy = (idx: number, patch: Partial<BuyRow>) =>
    setBuys((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const netClass = summary.net >= 0 ? "text-terminal-green" : "text-terminal-red";

  return (
    <div className="space-y-4 font-mono text-xs">
      {/* 材料区 */}
      <section className="border border-terminal-border bg-terminal-panel/92">
        <div className="flex h-9 items-center justify-between border-b border-terminal-border px-3 text-[11px] uppercase tracking-wide text-terminal-muted">
          <span>分解得到的材料（填实际出了几个）</span>
          <button
            type="button"
            onClick={() => setMaterials((r) => [...r, emptyMaterial()])}
            className="text-terminal-amber hover:underline"
          >
            + 添加材料
          </button>
        </div>
        <div className="space-y-2 p-3">
          {materials.map((row, idx) => {
            const live = row.matItemId === "" ? 0 : (prices.get(row.matItemId) ?? 0);
            const subtotal = num(row.qty) * matUnit(row);
            return (
              <div key={idx} className="flex flex-wrap items-center gap-2">
                <select
                  value={row.matItemId}
                  onChange={(e) => setMaterial(idx, { matItemId: e.target.value === "" ? "" : Number(e.target.value) })}
                  className={`${inputCls} w-48`}
                >
                  <option value="">选择材料…</option>
                  {MAT_OPTIONS.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                <input
                  type="number" min={0} step={1} inputMode="numeric" placeholder="数量"
                  value={row.qty}
                  onChange={(e) => setMaterial(idx, { qty: e.target.value })}
                  className={`${inputCls} w-16 text-center`}
                />
                {live > 0 ? (
                  <span className="w-36 text-terminal-muted">现价 <Coins copper={live} /></span>
                ) : (
                  <GscFields
                    g={row.g} s={row.s} c={row.c}
                    on={(p) => setMaterial(idx, p)}
                  />
                )}
                <span className="w-28 text-terminal-muted">小计 <Coins copper={subtotal} /></span>
                <button
                  type="button"
                  onClick={() => setMaterials((r) => r.filter((_, i) => i !== idx))}
                  className="text-terminal-red/80 hover:underline"
                >
                  删除
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* 买入区：批量，装备名 + 件数 + 单件 g/s/c */}
      <section className="border border-terminal-border bg-terminal-panel/92">
        <div className="flex h-9 items-center justify-between border-b border-terminal-border px-3 text-[11px] uppercase tracking-wide text-terminal-muted">
          <span>买入装备花费（同名可一次填件数，自动乘单件价）</span>
          <button
            type="button"
            onClick={() => setBuys((r) => [...r, emptyBuy()])}
            className="text-terminal-amber hover:underline"
          >
            + 添加一种装备
          </button>
        </div>
        <div className="space-y-2 p-3">
          {buys.map((row, idx) => {
            const unit = gscToCopper(row.g, row.s, row.c);
            const subtotal = num(row.count) * unit;
            return (
              <div key={idx} className="flex flex-wrap items-center gap-2">
                <input
                  type="text" placeholder="装备名（如：山地披风）"
                  value={row.note}
                  onChange={(e) => setBuy(idx, { note: e.target.value })}
                  className={`${inputCls} min-w-40 flex-1`}
                />
                <input
                  type="number" min={0} step={1} inputMode="numeric" placeholder="件数"
                  value={row.count}
                  onChange={(e) => setBuy(idx, { count: e.target.value })}
                  className={`${inputCls} w-16 text-center`}
                />
                <GscFields
                  g={row.g} s={row.s} c={row.c}
                  on={(p) => setBuy(idx, p)}
                />
                <span className="w-28 text-terminal-muted">小计 <Coins copper={subtotal} /></span>
                <button
                  type="button"
                  onClick={() => setBuys((r) => r.filter((_, i) => i !== idx))}
                  className="text-terminal-red/80 hover:underline"
                >
                  删除
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* 对比汇总 */}
      <section className="grid gap-2 sm:grid-cols-4">
        <div className="border border-terminal-border bg-terminal-panel2 p-3">
          <div className="text-[10px] uppercase text-terminal-muted">材料毛额</div>
          <div className="mt-1 text-sm"><Coins copper={summary.gross} /></div>
        </div>
        <div className="border border-terminal-border bg-terminal-panel2 p-3">
          <div className="text-[10px] uppercase text-terminal-muted">到手（扣5%税）</div>
          <div className="mt-1 text-sm"><Coins copper={summary.afterCut} /></div>
        </div>
        <div className="border border-terminal-border bg-terminal-panel2 p-3">
          <div className="text-[10px] uppercase text-terminal-muted">总买入</div>
          <div className="mt-1 text-sm"><Coins copper={summary.totalBuy} /></div>
        </div>
        <div className="border border-terminal-border bg-terminal-panel2 p-3">
          <div className="text-[10px] uppercase text-terminal-muted">实际净赚</div>
          <div className={`mt-1 text-sm font-bold ${netClass}`}><Coins copper={summary.net} /></div>
        </div>
      </section>
    </div>
  );
}
