"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
import { useLang, useLL } from "@/components/lang-provider";
import { L } from "@/lib/i18n";

// 中间材料利润：次级材料 = 配方产物且被其它配方用作材料（亚麻卷、铜锭、
// 魔法精华等）。每行 = 该材料 1 单位的利润（按最便宜制作方式摊算成本）；
// 悬停显示制作链路、材料单价与利润明细。
function TurnoverBadge({ itemId, turnoverByItemId }: { itemId: number; turnoverByItemId: Map<number, number> }) {
  const tr = useLL();
  const score = turnoverByItemId.get(itemId) ?? 0;
  const cls = turnoverBadgeClass(score);
  if (cls === null) return null;
  return (
    <span className={`shrink-0 rounded px-1 py-0.5 align-middle text-[9px] ${cls}`} title={tr("Used by N recipes", "被 N 个配方使用")}>{score}</span>
  );
}

export function SecondaryMaterialsPanel({ rows, prices, floorPrices, turnoverByItemId, tiersByItemId, server }: {
  rows: SecondaryMaterialRow[];
  prices: Map<number, number>;
  floorPrices: Map<number, number>;
  turnoverByItemId: Map<number, number>;
  /** 该材料最新转录轮的价格档位（前5档悬停展示；无转录数据的物品不在 map 里）。 */
  tiersByItemId?: Map<number, Array<{ price: number; qty: number }>>;
  server?: string; // 当前服务器视图（"eu"/"cn"），物品链接保持同服跳转
}) {
  const lang = useLang();
  const tr = useLL();
  const [open, setOpen] = usePersistedState<boolean>("wah:secondary-materials:open", true);
  const [profession, setProfession] = usePersistedState<string>("wah:secondary-materials:profession", "");
  // 当前等级：与配方库页（RecipeLibrary）共享同一份按专业记忆的等级表
  // （wah:recipes:skillLevels，键=英文专业名）。默认 300=基本不过滤；
  // 低于配方学会等级的行（还做不了）隐藏。
  const [skillLevels, setSkillLevels] = usePersistedState<Record<string, string>>("wah:recipes:skillLevels", {});
  const DEFAULT_LEVEL = 300; // 上限 300（经典专业技能封顶）
  const levelFor = (prof: string) => Math.min(Number.parseInt(skillLevels[prof] ?? "", 10) || DEFAULT_LEVEL, DEFAULT_LEVEL);
  // 悬停提示：整行触发（onMouseEnter/Leave）。提示框用 portal 渲染到 body（fixed 定位），
  // 完全脱离滚动容器——否则提示框溢出容器底部会把内容撑高，7 件也会弹出滚动条。
  const [hoveredRow, setHoveredRow] = useState<SecondaryMaterialRow | null>(null);
  const [hoveredRect, setHoveredRect] = useState<DOMRect | null>(null);

  // 提示框内容（制作链路：材料单价/单位成本/税后售价/利润 + 该材料前5档价格档位）。
  // 固定高度估算用于上下摆放。
  const TOOLTIP_H = 340;
  const renderCraftTooltip = (row: SecondaryMaterialRow) => {
    const tiers = tiersByItemId?.get(row.item.itemId)?.slice(0, 5) ?? [];
    return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-slate-100">{tr("Craft:", "制作：")}{row.craftRecipe.displayName ?? row.craftRecipe.name}</span>
        <span className="shrink-0 text-terminal-muted">{professionLabel(row.craftRecipe.profession, lang)}</span>
      </div>
      {row.producingRecipes > 1 && (
        <div className="text-[9px] text-terminal-muted">{tr(`${row.producingRecipes - 1} more recipes can craft this (cheapest unit cost shown)`, `另有 ${row.producingRecipes - 1} 个配方可做（按单位成本最低展示）`)}</div>
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
              {unit === undefined ? tr("no price", "无价") : <><span className="text-terminal-muted">@</span><CopperAmount copper={unit} /></>}
              {subtotal !== undefined && <span className="ml-1 text-terminal-muted">=<CopperAmount copper={subtotal} />{prices.get(material.itemId) === undefined ? tr(" floor", " 保底") : ""}</span>}
            </span>
          </div>
        );
      })}
      <div className="my-1 border-t border-terminal-border" />
      <div className="flex items-center justify-between gap-2">
        <span className="text-slate-100">{tr("Unit cost", "单位成本")}</span>
        <span><CopperAmount copper={Math.round(row.unitCost)} /></span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-slate-100">{tr("Unit price (after cut)", "单位售价（税后）")}</span>
        <span><CopperAmount copper={Math.round(row.unitPrice * (1 - 0.05))} />{row.priceSource === "vendor" ? tr(" floor", " 保底") : ""}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-slate-100">{tr("Unit profit", "单位利润")}</span>
        <span className={row.unitProfit >= 0 ? "text-terminal-green" : "text-terminal-red"}><CopperAmount copper={row.unitProfit} /> {formatPercent(row.marginPercent)}</span>
      </div>
      {tiers.length >= 2 && (
        <>
          <div className="my-1 border-t border-terminal-border" />
          <div className="text-slate-100">{tr("Price tiers (top 5)", "价格档位（前5档）")}</div>
          {tiers.map((tier, index) => (
            <div key={tier.price} className="flex items-center justify-between gap-2">
              <span className="text-terminal-muted">{L(lang, `T${index + 1}`, `档${index + 1}`)}</span>
              <span className="flex items-center gap-1">
                <CopperAmount copper={tier.price} />
                <span className="text-terminal-muted">×{tier.qty.toLocaleString("en-US")}</span>
              </span>
            </div>
          ))}
        </>
      )}
      <div className="mt-1 text-[9px] text-terminal-muted">{tr("Cost spread over 1 unit of the cheapest crafting recipe; prices include the 5% AH cut; \"floor\" marks NPC-buy fallback prices (no live AH price).", "成本按最便宜制作配方摊到 1 单位；售价已含 5% 拍卖税；标\"保底\"的价格为 NPC 收购价兜底（无实时 AH 价）。")}</div>
    </>
    );
  };

  // 按制作配方的专业分组：行已在 lib 里按利润率全局降序，组内保持该顺序；
  // 组间按组内最高利润率从高到低排列。先按各专业当前等级过滤掉还做不了的
  // （craftRecipe.skillLevel > 该专业等级；skillLevel=0 无数据视为可做）。
  const groups = new Map<string, SecondaryMaterialRow[]>();
  for (const row of rows) {
    if (row.craftRecipe.skillLevel > levelFor(row.craftRecipe.profession || "General")) continue;
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
        <span>{tr("Intermediate Material Profit", "中间材料利润")}</span>
        <Eye size={13} />
      </button>
    );
  }

  return (
    <Panel>
      <PanelHeader
        title={tr("Intermediate Material Profit", "中间材料利润")}
        action={
          <span className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-terminal-muted">{tr(`${[...groups.values()].reduce((n, g) => n + g.length, 0)} items`, `${[...groups.values()].reduce((n, g) => n + g.length, 0)} 种`)}</span>
            <button onClick={() => setOpen(false)} aria-label={tr("Collapse", "收起")} className="text-terminal-muted hover:text-terminal-amber"><EyeOff size={13} /></button>
          </span>
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-terminal-border px-3 py-2 font-mono text-xs">
        <select
          value={profession}
          onChange={(event) => setProfession(event.target.value)}
          className="border border-terminal-border bg-terminal-panel2 px-2 py-1 text-slate-100 focus:outline-none"
        >
          <option value="">{tr("All professions", "全部专业")}</option>
          {groupEntries.map(([entry]) => (
            <option key={entry} value={entry}>{professionLabel(entry, lang)}</option>
          ))}
        </select>
        <span className="flex items-center gap-1">
          <span className="text-terminal-muted">{tr("Lv", "等级")}</span>
          <input
            type="number"
            min={1}
            max={DEFAULT_LEVEL}
            inputMode="numeric"
            value={profession ? skillLevels[profession] ?? String(DEFAULT_LEVEL) : ""}
            disabled={!profession}
            placeholder="1-300"
            onChange={(event) => {
              const n = Number.parseInt(event.target.value, 10);
              const clamped = Number.isNaN(n) ? event.target.value : String(Math.min(Math.max(n, 1), DEFAULT_LEVEL));
              setSkillLevels((prev) => ({ ...prev, [profession]: clamped }));
            }}
            title={tr("Current profession level (1-300): intermediate materials below the recipe's learn level are hidden; shared memory with the Recipes page, default 300", "当前专业等级（1-300）：低于配方学会等级（还做不了）的中间材料不显示；与配方库页共享记忆，默认 300")}
            className="w-20 border border-terminal-border bg-terminal-panel2 px-2 py-1 text-slate-100 placeholder:text-terminal-muted/70 focus:outline-none disabled:opacity-50"
          />
        </span>
      </div>
      <div className="max-h-[300px] space-y-3 overflow-y-auto p-3 font-mono text-xs">
        {rows.length === 0 && (
          <div className="text-terminal-muted">
            {tr("No data yet. Run a full Auctionator scan in game and import, or check material prices in the ", "暂无数据。先在游戏内用 Auctionator 全量扫描并导入，或到 ")}<Link href="/recipes" target="_blank" rel="noopener noreferrer" className="text-terminal-amber hover:underline">{tr("Recipes", "配方库")}</Link>{tr(" page.", " 确认材料价格。")}
          </div>
        )}
        {visibleGroups.map(([profession, groupRows]) => (
          <div key={profession}>
            <div className="flex items-center justify-between border-b border-terminal-border/60 pb-1 text-[10px] uppercase tracking-wide text-terminal-muted">
              <span>{professionLabel(profession, lang)}</span>
              <span>{tr(`${groupRows.length} items`, `${groupRows.length} 种`)}</span>
            </div>
            <div className="space-y-2 pt-1">
              {groupRows.map((row) => (
                <div
                  key={row.item.itemId}
                  onMouseEnter={(event) => {
                    setHoveredRow(row);
                    setHoveredRect(event.currentTarget.getBoundingClientRect());
                  }}
                  onMouseLeave={() => setHoveredRow((r) => (r?.item.itemId === row.item.itemId ? null : r))}
                  className="relative flex w-full items-center justify-between gap-2"
                >
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
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {hoveredRow && hoveredRect && createPortal(
        <div
          className="pointer-events-none fixed z-50 w-80 whitespace-normal border border-terminal-border bg-terminal-panel p-2 font-mono text-[10px] leading-relaxed text-slate-200 shadow-lg"
          style={{
            top: hoveredRect.bottom + 4 + TOOLTIP_H > (typeof window !== "undefined" ? window.innerHeight : 900)
              ? Math.max(8, hoveredRect.top - TOOLTIP_H)
              : hoveredRect.bottom + 4,
            left: Math.min(hoveredRect.left, (typeof window !== "undefined" ? window.innerWidth : 1200) - 340),
          }}
        >
          {renderCraftTooltip(hoveredRow)}
        </div>,
        document.body
      )}
    </Panel>
  );
}
