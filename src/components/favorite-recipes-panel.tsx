"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, Star } from "lucide-react";
import type { RecipeProfitRow } from "@/lib/recipe-profits";
import { formatPercent } from "@/lib/utils";
import { qualityColorClassById } from "@/lib/quality";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Coins } from "@/components/coins";
import { CopperAmount } from "@/components/copper-amount";
import { ProductBadge } from "@/components/product-badge";
import { usePersistedState } from "@/lib/use-persisted-state";

// 关注配方：配方库页收藏的配方（localStorage 共享同一 key），这里只读过滤。
// 收藏身份 =（分类|专业|名称），与 Recipe 表的唯一键一致。
type FavoriteKey = { category: string; profession: string; name: string };

const FAVORITES_KEY = "wah:favorite-recipes";

function favoriteKeyOf(row: RecipeProfitRow): FavoriteKey {
  return { category: row.recipe.category ?? "", profession: row.recipe.profession, name: row.recipe.name };
}

function isFavorite(row: RecipeProfitRow, favorites: FavoriteKey[]): boolean {
  const key = favoriteKeyOf(row);
  return favorites.some(
    (f) => f.category === key.category && f.profession === key.profession && f.name === key.name
  );
}

// 关注配方面板：只显示被收藏的配方，每行 = 产出物×数量 + 利润 + 盈利百分比；
// 悬停显示完整制作链路（材料名/数量/单价、产出物×数量）与利润明细。
export function FavoriteRecipesPanel({ rows, prices, floorPrices }: {
  rows: RecipeProfitRow[];
  prices: Map<number, number>;
  floorPrices: Map<number, number>;
}) {
  const [favorites, setFavorites] = usePersistedState<FavoriteKey[]>(FAVORITES_KEY, []);
  const [open, setOpen] = useState(true);

  const toggleFavorite = (row: RecipeProfitRow) => {
    const key = favoriteKeyOf(row);
    setFavorites((prev) =>
      isFavorite(row, prev)
        ? prev.filter((f) => !(f.category === key.category && f.profession === key.profession && f.name === key.name))
        : [...prev, key]
    );
  };

  const favRows = rows.filter((row) => isFavorite(row, favorites));

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex h-9 w-full items-center justify-between border border-terminal-border bg-terminal-panel px-3 font-mono text-[11px] uppercase tracking-wide text-terminal-muted hover:text-terminal-amber"
      >
        <span>关注配方</span>
        <Eye size={13} />
      </button>
    );
  }

  return (
    <Panel>
      <PanelHeader
        title="关注配方"
        action={
          <span className="flex items-center gap-2">
            <Star size={13} className="text-terminal-amber" />
            <span className="font-mono text-[10px] text-terminal-muted">共 {favRows.length} 条</span>
            <button onClick={() => setOpen(false)} aria-label="收起" className="text-terminal-muted hover:text-terminal-amber"><EyeOff size={13} /></button>
          </span>
        }
      />
      <div className="space-y-2 p-3 font-mono text-xs">
        {favRows.length === 0 && (
          <div className="text-terminal-muted">
            还没有关注配方。到 <Link href="/recipes" target="_blank" rel="noopener noreferrer" className="text-terminal-amber hover:underline">配方库</Link> 点 ☆ 收藏配方，会显示在这里。
          </div>
        )}
        {favRows.map((row) => (
          <div key={`${row.recipe.category}|${row.recipe.profession}|${row.recipe.name}`} className="group relative flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <button
                onClick={() => toggleFavorite(row)}
                title="取消收藏"
                className="shrink-0 text-terminal-amber hover:text-slate-300"
              >
                ★
              </button>
              <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
              {row.recipe.outputs.map((output, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  {i > 0 && <span className="text-terminal-muted">+</span>}
                  <Link
                    href={`/items/${output.itemId}`}
                    target="_blank"
                    data-no-ladder
                    className={`inline-flex items-center gap-1 truncate ${qualityColorClassById(output.quality)}`}
                  >
                    {output.name}×{output.quantity}
                  </Link>
                  <ProductBadge itemId={output.itemId} />
                </span>
              ))}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-3">
              {row.status === "ok" ? (
                <>
                  <span className={row.profit >= 0 ? "text-terminal-green" : "text-terminal-red"}><Coins copper={row.profit} /></span>
                  <span className={row.marginPercent >= 0 ? "text-terminal-green" : "text-terminal-red"}>{formatPercent(row.marginPercent)}</span>
                </>
              ) : (
                <span className="truncate text-[10px] text-terminal-muted">缺价 · 缺 {row.missing.join("、")}</span>
              )}
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
                      <span className="shrink-0 text-terminal-muted">×{output.quantity}</span>
                      <ProductBadge itemId={output.itemId} />
                    </span>
                    <span>
                      {unit === undefined ? "无价" : <><span className="text-terminal-muted">@</span><CopperAmount copper={unit} /></>}
                      {subtotal !== undefined && <span className="ml-1 text-terminal-muted">=<CopperAmount copper={subtotal} /></span>}
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
        ))}
      </div>
    </Panel>
  );
}
