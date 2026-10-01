import type { MarketSignal } from "@/lib/analytics";
import { categoryMatches, MATERIALS_GROUP } from "@/lib/category-zh";

export type SignalSortKey = "turnoverScore" | "price" | "minPrice" | "med7" | "discountPercent" | "changePercent" | "quantity" | "numAuctions";

const SORT_KEYS: readonly SignalSortKey[] = ["turnoverScore", "price", "minPrice", "med7", "discountPercent", "changePercent", "quantity", "numAuctions"];

export type MarketView = { query: string; category: string; sortKey: SignalSortKey; sortAsc: boolean; page: number };

export const MARKET_PAGE_SIZE = 50;

// Parses URL search params into a validated table view; unknown or
// malformed values fall back to defaults instead of leaking into queries.
export function parseMarketView(params: Record<string, string | string[] | undefined>): MarketView {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  const sort = first(params.sort);
  const page = Number.parseInt(first(params.page), 10);
  // 布皮草矿已并入材料分组；旧 URL / localStorage 里残留的
  // "Gathering"/"布皮草矿" 筛选值映射到材料分组，避免刷新后列表只剩 6 项。
  const rawCategory = first(params.cat);
  const category = rawCategory === "Gathering" || rawCategory === "布皮草矿" ? MATERIALS_GROUP : rawCategory;
  return {
    query: first(params.q),
    category,
    sortKey: SORT_KEYS.includes(sort as SignalSortKey) ? (sort as SignalSortKey) : "quantity",
    sortAsc: first(params.dir) === "asc",
    page: Number.isInteger(page) && page > 0 ? page : 1
  };
}

// 布皮草矿分类已并入材料分组，其按材料等级的特殊排序随之移除；
// 材料分组与其他分类一样，默认按在售量（quantity）排序，可点击表头切换。
// component holds only view state.
export function filterSortSignals(
  signals: MarketSignal[],
  view: { query?: string; category?: string; minPriceCopper?: number; sortKey?: SignalSortKey; sortAsc?: boolean }
): MarketSignal[] {
  const query = (view.query ?? "").trim().toLowerCase();
  let rows = signals;
  if (query) rows = rows.filter((signal) => signal.name.toLowerCase().includes(query));
  if (view.category) {
    const cat = view.category;
    rows = rows.filter((signal) => categoryMatches(signal.category, cat));
  }
  if (view.minPriceCopper) rows = rows.filter((signal) => signal.price >= view.minPriceCopper!);

  // 布皮草矿已并入材料分组，不再有特殊排序；统一按 sortKey（默认在售量）
  // 排序，用户点表头即切换。
  if (view.sortKey) {
    const key = view.sortKey;
    const direction = view.sortAsc ? 1 : -1;
    rows = [...rows].sort((left, right) => (left[key] - right[key]) * direction);
  }
  return rows;
}

export function paginate<T>(rows: T[], page: number, pageSize: number): { rows: T[]; page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const clamped = Math.min(Math.max(page, 1), pageCount);
  return { rows: rows.slice((clamped - 1) * pageSize, clamped * pageSize), page: clamped, pageCount };
}
