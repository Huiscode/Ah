"use client";

// 分解榜：买绿/蓝装 → 分解 → 材料挂 AH 的期望套利。
// 期望分解值 = Σ(概率% × 数量 × 材料 AH 现价)；分解净赚 = 期望×(1−5%手续费) − 买入价。
// 材料无价按 0 计并标注；净赚正绿负红。卖店回收作为兜底参照小字显示。
// 行内「记账」：分解后填入实际得到的材料数量，自动算扣 5% 手续费后的到手价与实际净赚，对比买入价。
import { useMemo, useState } from "react";
import Link from "next/link";
import type { DisenchantRow } from "@/lib/analytics";
import { computeDisenchantLedger } from "@/lib/analytics";
import { Coins } from "@/components/coins";
import { WatchStar } from "@/components/watch-star";
import { ItemIcon } from "@/components/item-icon";
import { qualityColorClass } from "@/lib/quality";

type UniqueMat = { matItemId: number; matName: string; matPrice: number; priced: boolean };

function DisenchantRowRow({ row, prices, watched, server }: {
  row: DisenchantRow;
  prices: Map<number, number>;
  watched: boolean;
  server?: string;
}) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<number, string>>({});

  // 同分段同材料多条结果按 matItemId 去重，有价价优先。
  const mats = useMemo<UniqueMat[]>(() => {
    const map = new Map<number, UniqueMat>();
    for (const m of row.mats) {
      const existing = map.get(m.matItemId);
      if (!existing) map.set(m.matItemId, { matItemId: m.matItemId, matName: m.matName, matPrice: m.matPrice, priced: m.priced });
      else if (!existing.priced && m.priced) map.set(m.matItemId, { ...existing, matPrice: m.matPrice, priced: true });
    }
    return [...map.values()];
  }, [row.mats]);

  // 记账合计：毛额 = Σ(实填数量 × 材料现价)；到手 = 毛额×(1−AH_CUT)；实际净赚 = 到手 − 买入价。
  const ledger = useMemo(() => {
    const numeric: Record<number, number> = {};
    for (const m of mats) {
      const n = Number(qty[m.matItemId] ?? 0);
      if (Number.isFinite(n) && n > 0) numeric[m.matItemId] = n;
    }
    return computeDisenchantLedger(
      mats.map((m) => ({ matItemId: m.matItemId, matPrice: m.matPrice, priced: m.priced })),
      numeric,
      row.buyPrice
    );
  }, [mats, qty, row.buyPrice]);

  const netClass = row.disenchantNet >= 0 ? "text-terminal-green" : "text-terminal-red";
  const actualNetClass = ledger.net >= 0 ? "text-terminal-green" : "text-terminal-red";

  return (
    <>
      <tr className="border-b border-terminal-border/70 hover:bg-slate-800/35">
        <td className="px-2 py-2 text-center"><WatchStar itemId={row.itemId} watched={watched} /></td>
        <td className="px-3 py-2 text-left">
          <Link href={`/items/${row.itemId}${server === "cn" ? "?server=cn" : ""}`} target="_blank" className={`inline-flex items-center gap-2 ${qualityColorClass(row.quality)}`}>
            <ItemIcon itemId={row.itemId} icon={row.icon} />
            <span className="truncate">{row.name}</span>
          </Link>
          <div className="mt-0.5 pl-6 text-[10px] text-terminal-muted">
            {row.subCategory ?? row.category} · 等级{row.itemLevel}
          </div>
        </td>
        <td className="px-3 py-2 text-left">
          <span className="whitespace-nowrap rounded bg-terminal-panel2 px-1.5 py-0.5 text-[10px] text-slate-300">{row.bandLabel}</span>
        </td>
        <td className="px-3 py-2 text-right"><Coins copper={prices.get(row.itemId) ?? row.buyPrice} /></td>
        <td className="px-3 py-2 text-right text-slate-300"><Coins copper={row.expectedValue} /></td>
        <td className="px-3 py-2 text-right">
          <span className={netClass}><Coins copper={row.disenchantNet} /></span>
          <div className="text-[10px] text-terminal-green" title="最可能主档（约75%概率）较好结果到手；已要求它≥买入才入选，第一档不强求">
            主档{row.mainBestLabel}到手 <Coins copper={row.mainBestTake} />
          </div>
          {row.vendorNet > row.disenchantNet && (
            <div className="text-[10px] text-terminal-muted" title="直接卖 NPC 的回收（无手续费）">卖店 <Coins copper={row.vendorNet} /></div>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-0.5 block text-[10px] text-terminal-muted underline-offset-2 hover:text-slate-200 hover:underline"
          >
            {open ? "收起记账" : "记账（填实际产出）"}
          </button>
        </td>
        <td className="px-3 py-2 text-left">
          <div className="space-y-0.5">
            {row.mats.map((mat, idx) => (
              <div key={`${mat.matItemId}-${mat.chance}-${mat.qty}-${idx}`} className="flex items-center gap-1.5 text-[10px] leading-tight">
                <span className={mat.priced ? "text-slate-300" : "text-terminal-muted line-through"}>
                  {mat.matName} {mat.chance}%×{mat.qty}
                </span>
                {mat.priced
                  ? (
                    <>
                      <span className="text-terminal-muted">@<Coins copper={mat.matPrice} /></span>
                      <span className="text-terminal-muted">保本{mat.breakEvenQty}个</span>
                    </>
                  )
                  : <span className="text-terminal-muted">无价</span>}
              </div>
            ))}
          </div>
          {row.hasMissingMatPrice && <div className="mt-0.5 text-[9px] text-terminal-muted">含缺价材料，期望偏低</div>}
        </td>
        <td className="px-3 py-2 text-right text-slate-300">{row.quantity.toLocaleString("en-US")}</td>
      </tr>
      {open && (
        <tr className="border-b border-terminal-border/70 bg-slate-900/40">
          <td colSpan={8} className="px-4 py-3">
            <div className="space-y-2">
              <div className="text-[10px] uppercase text-terminal-muted">实际分解记账（按材料现价 × 实填数量，扣 5% 手续费后对比买入价）</div>
              {mats.map((m) => (
                <div key={m.matItemId} className="flex items-center gap-2 text-xs">
                  <span className={`w-32 truncate ${m.priced ? "text-slate-300" : "text-terminal-muted line-through"}`}>{m.matName}</span>
                  <span className="w-20 text-terminal-muted">
                    {m.priced ? <>@<Coins copper={m.matPrice} /></> : "无价"}
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    placeholder="数量"
                    value={qty[m.matItemId] ?? ""}
                    onChange={(e) => setQty((prev) => ({ ...prev, [m.matItemId]: e.target.value }))}
                    className="w-20 rounded border border-terminal-border bg-terminal-panel2 px-2 py-1 text-xs text-slate-200 outline-none focus:border-slate-500"
                  />
                  {m.priced && qty[m.matItemId] && Number(qty[m.matItemId]) > 0 && (
                    <span className="text-terminal-muted">= <Coins copper={Number(qty[m.matItemId]) * m.matPrice} /></span>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-terminal-border pt-2 text-xs">
                <span className="text-terminal-muted">材料毛额 <Coins copper={ledger.gross} /></span>
                <span className="text-terminal-muted">到手(扣5%) <Coins copper={ledger.afterCut} /></span>
                <span className="text-terminal-muted">买入价 <Coins copper={row.buyPrice} /></span>
                <span className={actualNetClass}>实际净赚 <Coins copper={ledger.net} /></span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function DisenchantTable({ rows, prices, watchedItemIds, productItemIds, server }: {
  rows: DisenchantRow[];
  prices: Map<number, number>;
  watchedItemIds: number[];
  productItemIds: Set<number>;
  server?: string;
}) {
  const watched = new Set(watchedItemIds);
  if (rows.length === 0) {
    return (
      <div className="p-6 font-mono text-xs text-terminal-muted">
        暂无分解机会：只收录"最可能主档（约75%概率）较好结果到手也≥买入价"的绿/蓝护甲、武器；靠小概率精华/碎片拉高期望、主档亏本的抽奖型已直接过滤。开服初期或材料缺价时可能为空。
      </div>
    );
  }
  return (
    <div>
      <div className="max-h-[344px] overflow-y-auto [scrollbar-gutter:stable]">
        <table className="w-full min-w-[1180px] table-fixed border-collapse font-mono text-xs">
          <colgroup>
            <col className="w-11" />
            <col className="w-[220px]" />
            <col className="w-[110px]" />
            <col className="w-[96px]" />
            <col className="w-[104px]" />
            <col className="w-[104px]" />
            <col />
            <col className="w-[72px]" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-terminal-panel2 text-[10px] uppercase text-terminal-muted">
            <tr>
              <th className="border-b border-terminal-border px-2 py-2 text-center">★</th>
              <th className="border-b border-terminal-border px-3 py-2 text-left">装备（部位·等级）</th>
              <th className="border-b border-terminal-border px-3 py-2 text-left">分解段</th>
              <th className="border-b border-terminal-border px-3 py-2 text-right">买入价</th>
              <th className="border-b border-terminal-border px-3 py-2 text-right">期望分解值</th>
              <th className="border-b border-terminal-border px-3 py-2 text-right">分解净赚</th>
              <th className="border-b border-terminal-border px-3 py-2 text-left">分解明细（概率×数量 @材料价）</th>
              <th className="border-b border-terminal-border px-3 py-2 text-right">在售量</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <DisenchantRowRow
                key={row.itemId}
                row={row}
                prices={prices}
                watched={watched.has(row.itemId)}
                server={server}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
