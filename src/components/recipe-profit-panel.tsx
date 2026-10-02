"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Hammer, Eye, EyeOff } from "lucide-react";
import type { RecipeProfitRow } from "@/lib/recipe-profits";
import { professionLabel } from "@/lib/recipe-profits";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Coins } from "@/components/coins";
import { CopperAmount } from "@/components/copper-amount";
import { formatPercent } from "@/lib/utils";
import { qualityColorClassById } from "@/lib/quality";
import { usePersistedState } from "@/lib/use-persisted-state";

// Unambiguous compact copper: 193 -> "1g93c", -113 -> "-1s13c". Mirrors the
// server-side helper; kept here so tooltip math never re-renders oddly.
function fmtCopper(copper: number): string {
  const sign = copper < 0 ? "-" : "";
  const abs = Math.abs(copper);
  const g = Math.floor(abs / 10000);
  const s = Math.floor((abs % 10000) / 100);
  const c = abs % 100;
  const parts: string[] = [];
  if (g > 0) parts.push(`${g}g`);
  if (s > 0) parts.push(`${s}s`);
  if (c > 0 || parts.length === 0) parts.push(`${c}c`);
  return sign + parts.join("");
}

// 流通分徽章：被多少个配方当材料使用（越高周转越快），与市场表口径一致。
function TurnoverBadge({ score }: { score: number }) {
  if (score <= 0) return null;
  const cls =
    score >= 50
      ? "bg-green-500/15 text-green-400"
      : score >= 15
        ? "bg-amber-500/15 text-amber-400"
        : "bg-slate-500/15 text-slate-400";
  return (
    <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] ${cls}`} title="被 N 个配方使用，流通快">{score}</span>
  );
}

// P0-B 制造利润面板：全配方库（游戏内 /wahrecipes 扫描 + 内置经典种子），
// 默认按服务端利润率排序，可按专业过滤；悬停显示完整配方链路与价格来源
// （AH 价或保底价兜底）。首页以 limitPerProfession 精简为每专业 Top N 并
// 提供 viewAllHref 跳转独立配方库页；配方库页自身不传 limit 显示全量。
export function RecipeProfitPanel({ rows, prices, floorPrices, limitPerProfession, viewAllHref, turnoverScores }: {
  rows: RecipeProfitRow[];
  prices: Map<number, number>;
  floorPrices: Map<number, number>;
  limitPerProfession?: number;
  viewAllHref?: Route;
  turnoverScores?: Map<number, number>;
}) {
  const professions = useMemo(() => {
    const seen = new Set<string>();
    for (const row of rows) if (row.recipe.profession) seen.add(row.recipe.profession);
    return Array.from(seen).sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [rows]);
  const [profession, setProfession] = usePersistedState<string>("wah:profit-panel:profession", "全部");
  const [open, setOpen] = useState(true);

  const filtered = useMemo(
    () => (profession === "全部" ? rows : rows.filter((row) => row.recipe.profession === profession)),
    [rows, profession]
  );
  const computable = filtered.filter((row) => row.status === "ok");
  const shown = limitPerProfession ? computable.slice(0, limitPerProfession) : computable;
  const hiddenCount = computable.length - shown.length;
  const missingCount = filtered.length - computable.length;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex h-9 w-full items-center justify-between border border-terminal-border bg-terminal-panel px-3 font-mono text-[11px] uppercase tracking-wide text-terminal-muted hover:text-terminal-amber"
      >
        <span>制造利润</span>
        <Eye size={13} />
      </button>
    );
  }

  return (
    <Panel>
      <PanelHeader
        title="制造利润"
        action={
          <span className="flex items-center gap-2">
            <Hammer size={13} className="text-terminal-muted" />
            {rows.length > 0 && (
              <select
                value={profession}
                onChange={(event) => setProfession(event.target.value)}
                className="max-w-[120px] border border-terminal-border bg-terminal-panel px-1 py-0.5 text-[10px] text-slate-200 outline-none"
              >
                <option value="全部">全部专业</option>
                {professions.map((name) => (
                  <option key={name} value={name}>{professionLabel(name)}</option>
                ))}
              </select>
            )}
            <button onClick={() => setOpen(false)} aria-label="收起" className="text-terminal-muted hover:text-terminal-amber"><EyeOff size={13} /></button>
          </span>
        }
      />
      <div className="space-y-2 p-3 font-mono text-xs">
        {rows.length === 0 && (
          <div className="text-terminal-muted">
            暂无配方库。游戏内打开专业技能窗口（按 K），运行 <span className="text-terminal-amber">/wahrecipes</span> 扫描已学配方；配方随下次 /wahscan 自动上传。
          </div>
        )}
        {shown.map((row) => {
          // 配方均为单输出且输出名=配方名，可安全绑定产出物品的单品页；
          // 非 craft / 异常数据兜底为纯文本。
          const primaryOutput = row.recipe.outputs[0];
          const primaryTurnover = primaryOutput ? (turnoverScores?.get(primaryOutput.itemId) ?? 0) : 0;
          return (
          <div key={`${row.recipe.profession}|${row.recipe.name}`} className="group relative flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              {primaryOutput ? (
                <Link href={`/items/${primaryOutput.itemId}`} target="_blank" data-no-ladder className={`inline-flex items-center gap-1 truncate ${qualityColorClassById(primaryOutput.quality)}`}>
                  {row.recipe.name}
                </Link>
              ) : (
                <span className="truncate text-slate-100">{row.recipe.name}</span>
              )}
              <TurnoverBadge score={primaryTurnover} />
              <span className="shrink-0 text-[9px] text-terminal-muted">{row.recipe.skillLevel}</span>
            </span>
            <span className="flex shrink-0 items-center gap-3">
              <span className={row.profit >= 0 ? "text-terminal-green" : "text-terminal-red"}><Coins copper={row.profit} /></span>
              <span className={row.marginPercent >= 0 ? "text-terminal-green" : "text-terminal-red"}>{formatPercent(row.marginPercent)}</span>
            </span>
            {/* Hover: full craft chain — per-material cost (AH or floor),
                product revenue after the AH cut, profit and margin */}
            <div className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden w-80 whitespace-normal border border-terminal-border bg-terminal-panel p-2 font-mono text-[10px] leading-relaxed text-slate-200 shadow-lg group-hover:block">
              {row.recipe.reagents.map((material) => {
                const unit = prices.get(material.itemId) ?? floorPrices.get(material.itemId);
                const subtotal = unit === undefined ? undefined : unit * material.quantity;
                return (
                  <div key={material.itemId} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Link href={`/items/${material.itemId}`} target="_blank" data-no-ladder className={`pointer-events-auto inline-flex items-center gap-1 truncate ${qualityColorClassById(material.quality)}`}>{material.name}</Link>
                      <TurnoverBadge score={turnoverScores?.get(material.itemId) ?? 0} />
                      <span className="shrink-0 text-terminal-muted">×{material.quantity}</span>
                    </span>
                    <span>
                      {unit === undefined ? "无价" : <><span className="text-terminal-muted">@</span><CopperAmount copper={unit} /></>}
                      {subtotal !== undefined && <span className="ml-1 text-terminal-muted">=<CopperAmount copper={subtotal} />{prices.get(material.itemId) === undefined ? " 保底" : ""}</span>}
                    </span>
                  </div>
                );
              })}
              <div className="my-1 border-t border-terminal-border" />
              {row.recipe.outputs.map((output) => {
                const unit = prices.get(output.itemId) ?? floorPrices.get(output.itemId);
                const subtotal = unit === undefined ? undefined : unit * output.quantity;
                return (
                  <div key={output.itemId} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Link href={`/items/${output.itemId}`} target="_blank" data-no-ladder className={`pointer-events-auto inline-flex items-center gap-1 truncate ${qualityColorClassById(output.quality)}`}>{output.name}</Link>
                      <TurnoverBadge score={turnoverScores?.get(output.itemId) ?? 0} />
                      <span className="shrink-0 text-terminal-muted">×{output.quantity}</span>
                    </span>
                    <span>
                      {unit === undefined ? "无价" : <><span className="text-terminal-muted">@</span><CopperAmount copper={unit} /></>}
                      {subtotal !== undefined && <span className="ml-1 text-terminal-muted">=<CopperAmount copper={subtotal} />{prices.get(output.itemId) === undefined ? " 保底" : ""}</span>}
                    </span>
                  </div>
                );
              })}
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-100">利润</span>
                <span className={row.profit >= 0 ? "text-terminal-green" : "text-terminal-red"}><CopperAmount copper={row.profit} /> {formatPercent(row.marginPercent)}</span>
              </div>
              <div className="mt-1 text-[9px] text-terminal-muted">产出价已含 5% 拍卖税；标"保底"的价格为 NPC 收购价兜底（无实时 AH 价）。</div>
            </div>
          </div>
          );
        })}
        {rows.length > 0 && (hiddenCount > 0 || missingCount > 0) && (
          <div className="border-t border-terminal-border pt-2 text-[10px] text-terminal-muted">
            {hiddenCount > 0 && <>另有 {hiddenCount} 个可算配方未在此列出</>}
            {hiddenCount > 0 && missingCount > 0 && " · "}
            {missingCount > 0 && <>{missingCount} 个配方因缺少价格数据未计算（{profession === "全部" ? "全专业" : profession}）</>}
          </div>
        )}
        {viewAllHref && rows.length > 0 && (
          <Link href={viewAllHref} target="_blank" rel="noopener noreferrer" className="block border-t border-terminal-border pt-2 text-[10px] text-terminal-amber hover:underline">
            查看全部 {rows.length} 条配方 → 配方库
          </Link>
        )}
      </div>
    </Panel>
  );
}
