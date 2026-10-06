"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import type { SecondaryMaterialRow } from "@/lib/secondary-materials";
import { formatPercent } from "@/lib/utils";
import { qualityColorClassById } from "@/lib/quality";
import { turnoverBadgeClass } from "@/lib/turnover";
import { professionLabel } from "@/lib/recipe-profits";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Coins } from "@/components/coins";
import { CopperAmount } from "@/components/copper-amount";
import { usePersistedState } from "@/lib/use-persisted-state";

// 中间材料利润：次级材料 = 配方产物且被其它配方用作材料（亚麻卷、铜锭、
// 魔法精华等）。每行 = 该材料 1 单位的利润（按最便宜制作方式摊算成本）；
// 悬停显示制作链路、材料单价与利润明细。
function TurnoverBadge({ itemId, turnoverByItemId }: { itemId: number; turnoverByItemId: Map<number, number> }) {
  const score = turnoverByItemId.get(itemId) ?? 0;
  const cls = turnoverBadgeClass(score);
  if (cls === null) return null;
  return (
    <span className={`shrink-0 rounded px-1 py-0.5 align-middle text-[9px] ${cls}`} title="被 N 个配方使用">{score}</span>
  );
}

export function SecondaryMaterialsPanel({ rows, prices, floorPrices, turnoverByItemId }: {
  rows: SecondaryMaterialRow[];
  prices: Map<number, number>;
  floorPrices: Map<number, number>;
  turnoverByItemId: Map<number, number>;
}) {
  const [open, setOpen] = usePersistedState<boolean>("wah:secondary-materials:open", true);
  const [profession, setProfession] = usePersistedState<string>("wah:secondary-materials:profession", "");

  // 按制作配方的专业分组：行已在 lib 里按利润率全局降序，组内保持该顺序；
  // 组间按组内最高利润率从高到低排列。
  const groups = new Map<string, SecondaryMaterialRow[]>();
  for (const row of rows) {
    const profession = row.craftRecipe.profession || "General";
    const list = groups.get(profession);
    if (list) list.push(row);
    else groups.set(profession, [row]);
  }
  const groupEntries = [...groups.entries()].sort(
    (left, right) => right[1][0].marginPercent - left[1][0].marginPercent
  );
  // 选中的专业在最新数据里已不存在（扫描变化）时，回到"全部专业"。
  useEffect(() => {
    if (profession && !groups.has(profession)) setProfession("");
  }, [profession, groups, setProfession]);

  const visibleGroups = profession ? groupEntries.filter(([entry]) => entry === profession) : groupEntries;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex h-9 w-full items-center justify-between border border-terminal-border bg-terminal-panel px-3 font-mono text-[11px] uppercase tracking-wide text-terminal-muted hover:text-terminal-amber"
      >
        <span>中间材料利润</span>
        <Eye size={13} />
      </button>
    );
  }

  return (
    <Panel>
      <PanelHeader
        title="中间材料利润"
        action={
          <span className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-terminal-muted">{rows.length} 种</span>
            <button onClick={() => setOpen(false)} aria-label="收起" className="text-terminal-muted hover:text-terminal-amber"><EyeOff size={13} /></button>
          </span>
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-terminal-border px-3 py-2 font-mono text-xs">
        <select
          value={profession}
          onChange={(event) => setProfession(event.target.value)}
          className="border border-terminal-border bg-terminal-panel2 px-2 py-1 text-slate-100 focus:outline-none"
        >
          <option value="">全部专业</option>
          {groupEntries.map(([entry]) => (
            <option key={entry} value={entry}>{professionLabel(entry)}</option>
          ))}
        </select>
      </div>
      <div className="max-h-[300px] space-y-3 overflow-y-auto p-3 font-mono text-xs">
        {rows.length === 0 && (
          <div className="text-terminal-muted">
            暂无数据。先 /wahscan 扫描并导入，或到 <Link href="/recipes" target="_blank" rel="noopener noreferrer" className="text-terminal-amber hover:underline">配方库</Link> 确认材料价格。
          </div>
        )}
        {visibleGroups.map(([profession, groupRows]) => (
          <div key={profession}>
            <div className="flex items-center justify-between border-b border-terminal-border/60 pb-1 text-[10px] uppercase tracking-wide text-terminal-muted">
              <span>{professionLabel(profession)}</span>
              <span>{groupRows.length} 种</span>
            </div>
            <div className="space-y-2 pt-1">
              {groupRows.map((row) => (
          <div key={row.item.itemId} className="group relative flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <Link
                href={`/items/${row.item.itemId}`}
                target="_blank"
                data-no-ladder
                className={`truncate ${qualityColorClassById(row.item.quality)}`}
              >
                {row.item.name}
              </Link>
              <TurnoverBadge itemId={row.item.itemId} turnoverByItemId={turnoverByItemId} />
            </span>
            <span className="flex shrink-0 items-center gap-3">
              <span className={row.unitProfit >= 0 ? "text-terminal-green" : "text-terminal-red"}><Coins copper={row.unitProfit} /></span>
              <span className={row.unitProfit >= 0 ? "text-terminal-green" : "text-terminal-red"}>{formatPercent(row.marginPercent)}</span>
            </span>
            {/* Hover: cheapest craft chain — per-material cost (AH or floor),
                unit cost / unit revenue after the AH cut / unit profit */}
            <div className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden w-80 whitespace-normal border border-terminal-border bg-terminal-panel p-2 font-mono text-[10px] leading-relaxed text-slate-200 shadow-lg group-hover:block">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-100">制作：{row.craftRecipe.name}</span>
                <span className="shrink-0 text-terminal-muted">{professionLabel(row.craftRecipe.profession)}</span>
              </div>
              {row.producingRecipes > 1 && (
                <div className="text-[9px] text-terminal-muted">另有 {row.producingRecipes - 1} 个配方可做（按单位成本最低展示）</div>
              )}
              {row.craftRecipe.reagents.map((material) => {
                const unit = prices.get(material.itemId) ?? floorPrices.get(material.itemId);
                const subtotal = unit === undefined ? undefined : unit * material.quantity;
                return (
                  <div key={material.itemId} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Link href={`/items/${material.itemId}`} target="_blank" data-no-ladder className={`pointer-events-auto inline-flex items-center gap-1 truncate ${qualityColorClassById(material.quality)}`}>{material.name}</Link>
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
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-100">单位成本</span>
                <span><CopperAmount copper={Math.round(row.unitCost)} /></span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-100">单位售价（税后）</span>
                <span><CopperAmount copper={Math.round(row.unitPrice * (1 - 0.05))} />{row.priceSource === "vendor" ? " 保底" : ""}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-100">单位利润</span>
                <span className={row.unitProfit >= 0 ? "text-terminal-green" : "text-terminal-red"}><CopperAmount copper={row.unitProfit} /> {formatPercent(row.marginPercent)}</span>
              </div>
              <div className="mt-1 text-[9px] text-terminal-muted">成本按最便宜制作配方摊到 1 单位；售价已含 5% 拍卖税；标"保底"的价格为 NPC 收购价兜底（无实时 AH 价）。</div>
            </div>
          </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
