"use client";

// View-state shell for the server-filtered market table: every control
// writes URL search params and the server re-renders just the visible
// page, so the client never receives the full signal universe.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { MarketSignal } from "@/lib/analytics";
import type { MarketView, SignalSortKey } from "@/lib/market-filter";
import { formatPercent } from "@/lib/utils";
import { zoneBadge } from "@/lib/utils";
import { formatTrendPercent, trendTextClass } from "@/lib/trend";
import { categoryLabel, MATERIALS_GROUP } from "@/lib/category-zh";
import { qualityColorClass } from "@/lib/quality";
import { turnoverBadgeClass } from "@/lib/turnover";
import { Coins } from "@/components/coins";
import { WatchStar } from "@/components/watch-star";
import { ItemIcon } from "@/components/item-icon";
import { ProductBadge } from "@/components/product-badge";
import { usePersistedState } from "@/lib/use-persisted-state";
import { useLang, useLL } from "@/components/lang-provider";
import { displayName, type Lang } from "@/lib/i18n";

// 列结构与上方捡漏雷达一致（★/物品/最低价/最低买入/7日参考/折扣%/环比%/在售量），
// 上下对齐；流通分徽章并入物品列，配色规则见 lib/turnover.ts。
function sortableColumns(lang: Lang): Array<{ key: SignalSortKey; heading: string }> {
  const tr = (en: string, zh: string) => (lang === "zh" ? zh : en);
  return [
    { key: "minPrice", heading: tr("Min", "最低价") },
    { key: "price", heading: tr("Min Buyout", "最低买入") },
    { key: "med7", heading: tr("7d Ref", "7日参考") },
    { key: "discountPercent", heading: tr("Disc%", "折扣%") },
    { key: "changePercent", heading: tr("Chg%", "环比%") },
    { key: "quantity", heading: tr("Qty", "在售量") }
  ];
}

export function MarketTable({ rows, watchedItemIds, view, categories, totalCount, filteredCount, page, pageCount, productItemIds, server }: {
  rows: MarketSignal[];
  watchedItemIds: number[];
  view: MarketView;
  categories: string[];
  totalCount: number;
  filteredCount: number;
  page: number;
  pageCount: number;
  productItemIds: Set<number>;
  server?: string; // 当前服务器视图（"eu"/"cn"），物品链接保持同服跳转
}) {
  const router = useRouter();
  const pathname = usePathname();
  const lang = useLang();
  const tr = useLL();
  const watched = new Set(watchedItemIds);

  // A hard refresh (full page load) must not keep a stale column sort: the
  // URL sort/dir params are in-session view state for client navigation, not
  // for a reload. Clearing them on mount falls back to the default ordering;
  // clicking a header (client-side replace, no remount) still sorts normally.
  // Also: restore the last category/query from localStorage so a refresh
  // keeps the user's filter instead of resetting to 全部.
  // 品类必须先校验再恢复：公测清库/换服务器后 localStorage 与 URL 里的旧品类
  // 可能已不存在——恢复会把列表过滤成 0 行，而 <select> 值无效时又显示回
  // "全部品类"，看起来像没筛选（2026-11-07 国服首扫实际踩中）。不存在的品类
  // 直接从 URL 与 localStorage 清除，自愈。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const valid = new Set<string>([...categories, MATERIALS_GROUP]);
    let changed = false;
    if (params.has("sort") || params.has("dir")) {
      params.delete("sort");
      params.delete("dir");
      changed = true;
    }
    const savedCat = params.get("cat") ?? localStorage.getItem("wah:market:category");
    if (savedCat && !valid.has(savedCat)) {
      params.delete("cat");
      localStorage.removeItem("wah:market:category");
      changed = true;
    } else if (!params.has("cat") && savedCat) {
      params.set("cat", savedCat);
      changed = true;
    }
    if (!params.has("q")) {
      const savedQ = localStorage.getItem("wah:market:query");
      if (savedQ) { params.set("q", savedQ); changed = true; }
    }
    if (changed) {
      const search = params.toString();
      router.replace(`${pathname}${search ? `?${search}` : ""}` as Parameters<typeof router.replace>[0], { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [query, setQuery] = useState(view.query);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Rebuild params from the server-provided view so the URL stays the
  // single source of table state; `page` resets on any other change.
  // 以当前 URL 的表格外参数（server/market/history…）为基底重建：否则国服
  // 视图里点品类/翻页/排序会丢 ?server=cn 跳回欧服空态（2026-11-07 实际踩中）。
  const apply = (patch: Partial<MarketView> & { page?: number }) => {
    const next = { ...view, page: 1, ...patch };
    const params = new URLSearchParams();
    for (const [key, value] of new URLSearchParams(window.location.search)) {
      if (key !== "q" && key !== "cat" && key !== "sort" && key !== "dir" && key !== "page" && value) {
        params.set(key, value);
      }
    }
    if (next.query) params.set("q", next.query);
    if (next.category) {
      params.set("cat", next.category);
      localStorage.setItem("wah:market:category", next.category);
    } else {
      localStorage.removeItem("wah:market:category");
    }
    if (next.sortKey !== "quantity") params.set("sort", next.sortKey);
    if (next.sortAsc) params.set("dir", "asc");
    if (next.page > 1) params.set("page", String(next.page));
    const search = params.toString();
    router.replace(`${pathname}${search ? `?${search}` : ""}` as Parameters<typeof router.replace>[0], { scroll: false });
  };

  const onQueryChange = (value: string) => {
    setQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (value) localStorage.setItem("wah:market:query", value);
      else localStorage.removeItem("wah:market:query");
      apply({ query: value });
    }, 300);
  };

  const toggleSort = (key: SignalSortKey) => {
    apply(key === view.sortKey ? { sortAsc: !view.sortAsc } : { sortKey: key, sortAsc: false });
  };
  const sortMark = (key: SignalSortKey) => (key === view.sortKey ? (view.sortAsc ? " ▲" : " ▼") : "");
  const inputClass = "border border-terminal-border bg-terminal-panel2 px-2 py-1 text-slate-100 focus:outline-none";

  if (totalCount === 0) {
    return (
      <div className="p-6 font-mono text-xs text-terminal-muted">
        {tr("No market data yet. After scanning at the AH, /reload to flush — the watcher (2s poll) imports automatically.", "暂无市场数据。在对应拍卖行扫描完成后 /reload 落盘，watcher（2 秒轮询）会自动导入。")}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-terminal-border px-3 py-2 font-mono text-xs">
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={tr("Search items...", "搜索物品...")}
          className={`${inputClass} w-44 placeholder:text-terminal-muted`}
        />
        <select
          value={view.category}
          onChange={(event) => apply({ category: event.target.value })}
          className={inputClass}
        >
          <option value="">{tr("All categories", "全部品类")}</option>
          {categories.map((value) => (
            <option key={value} value={value}>{categoryLabel(value, lang)}</option>
          ))}
        </select>
        <span className="text-terminal-muted">{tr(`${filteredCount} / ${totalCount} items`, `${filteredCount} / ${totalCount} 项`)}</span>
        <span className="ml-auto flex items-center gap-2">
          <button
            onClick={() => apply({ page: page - 1 })}
            disabled={page <= 1}
            className={`${inputClass} disabled:opacity-40`}
          >
            {tr("Prev", "上一页")}
          </button>
          <span className="text-terminal-muted">{page} / {pageCount}</span>
          <button
            onClick={() => apply({ page: page + 1 })}
            disabled={page >= pageCount}
            className={`${inputClass} disabled:opacity-40`}
          >
            {tr("Next", "下一页")}
          </button>
        </span>
      </div>
      <div className="overflow-x-auto pr-[5mm]">
        <table className="w-full min-w-[1000px] table-fixed border-collapse font-mono text-xs">
          <colgroup>
            <col className="w-11" />
            <col />
            <col className="w-[100px]" />
            <col className="w-[104px]" />
            <col className="w-[120px]" />
            <col className="w-[140px]" />
            <col className="w-[96px]" />
            <col className="w-[96px]" />
            <col className="w-[88px]" />
          </colgroup>
          <thead className="bg-terminal-panel2 text-[10px] uppercase text-terminal-muted">
            <tr>
              <th className="border-b border-terminal-border px-2 py-2 text-center">★</th>
              <th className="border-b border-terminal-border px-3 py-2 text-left">{tr("Item", "物品")}</th>
              {sortableColumns(lang).map((column) => (
                <th
                  key={column.key}
                  onClick={() => toggleSort(column.key)}
                  className="cursor-pointer select-none border-b border-terminal-border px-3 py-2 text-right hover:text-slate-200"
                >
                  {column.heading}{sortMark(column.key)}
                </th>
              ))}
              <th className="border-b border-terminal-border px-3 py-2 text-right" title={tr("Where the current price sits vs the 7-day band: below the low edge = BUY, above the high edge = SELL", "当前价相对 7 日价格带的位置：跌破下沿=买入区，冲穿上沿=卖出区")}>{tr("Band", "区间")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((signal) => (
              <tr key={signal.itemId} className="border-b border-terminal-border/70 hover:bg-slate-800/35">
                <td className="px-2 py-2 text-center"><WatchStar itemId={signal.itemId} watched={watched.has(signal.itemId)} /></td>
                <td className="px-3 py-2 text-left">
                  <Link href={`/items/${signal.itemId}`} target="_blank" className={`inline-flex items-center gap-2 ${qualityColorClass(signal.quality)}`}>
                    <ItemIcon itemId={signal.itemId} icon={signal.icon} />
                    {displayName(signal.name, signal.nameEn, lang)}
                  </Link>
                  {productItemIds.has(signal.itemId) && <ProductBadge itemId={signal.itemId} />}
                  {turnoverBadgeClass(signal.turnoverScore) !== null && (
                    <span className={`ml-1.5 rounded px-1 py-0.5 align-middle text-[9px] ${turnoverBadgeClass(signal.turnoverScore)}`} title={tr("Used by N recipes", "被 N 个配方使用")}>{signal.turnoverScore}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right"><Coins copper={signal.minPrice} /></td>
                <td className="px-3 py-2 text-right"><Coins copper={signal.price} /></td>
                <td className="px-3 py-2 text-right"><Coins copper={signal.med7} /></td>
                <td className={signal.discountPercent >= 15 ? "px-3 py-2 text-right text-terminal-green" : "px-3 py-2 text-right text-slate-300"}>{signal.discountPercent.toFixed(0)}%</td>
                <td className={"px-3 py-2 text-right " + trendTextClass(signal.changePercent)}>{formatTrendPercent(signal.changePercent)}</td>
                <td className="px-3 py-2 text-right text-slate-300">{signal.quantity.toLocaleString("en-US")}</td>
                <td className={`whitespace-nowrap px-3 py-2 text-right ${zoneBadge(signal.zone, lang).className}`}>{zoneBadge(signal.zone, lang).label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
