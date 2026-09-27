import type { MarketSignal } from "@/lib/analytics";
import { categoryMatches } from "@/lib/category-zh";

export type SignalSortKey = "price" | "minPrice" | "med7" | "discountPercent" | "changePercent" | "quantity" | "numAuctions";

const SORT_KEYS: readonly SignalSortKey[] = ["price", "minPrice", "med7", "discountPercent", "changePercent", "quantity", "numAuctions"];

export type MarketView = { query: string; category: string; sortKey: SignalSortKey; sortAsc: boolean; page: number };

export const MARKET_PAGE_SIZE = 50;

// Parses URL search params into a validated table view; unknown or
// malformed values fall back to defaults instead of leaking into queries.
export function parseMarketView(params: Record<string, string | string[] | undefined>): MarketView {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  const sort = first(params.sort);
  const page = Number.parseInt(first(params.page), 10);
  return {
    query: first(params.q),
    category: first(params.cat),
    sortKey: SORT_KEYS.includes(sort as SignalSortKey) ? (sort as SignalSortKey) : "quantity",
    sortAsc: first(params.dir) === "asc",
    page: Number.isInteger(page) && page > 0 ? page : 1
  };
}

// 布皮草矿子分类排序：按名称前缀判断大组（布=0, 皮=1, 草=2, 矿=3），
// 组内按 WoW 材料等级从低到高排。
const MATERIAL_ORDER: Array<[string, number]> = [
  // 布 + 缝纫线
  ["亚麻", 0], ["粗线", 0], ["细线", 0],
  ["毛料", 1], ["毛布", 1], ["粗丝线", 1],
  ["丝绸", 2], ["丝线", 2],
  ["魔纹", 3],
  ["符文", 4],
  // 皮
  ["轻皮", 10], ["轻毛", 10],
  ["中皮", 11], ["中毛", 11],
  ["重皮", 12], ["重毛", 12],
  ["厚皮", 13], ["厚毛", 13],
  ["硬甲", 14], ["无瑕", 14],
  ["完美", 15], ["迅猛龙的外皮", 15], ["鲁伯斯", 15], ["破损的熊皮", 15], ["薄科多兽皮", 15], ["破烂的皮革", 15],
  ["熟化", 12],
  // 草 + 种子
  ["宁神花", 20], ["银叶草", 20], ["地根草", 20], ["秋葵", 20],
  ["魔皇草", 21], ["石南草", 21], ["雨燕", 21], ["草药种子", 21], ["枫树种子", 21],
  ["跌打草", 22], ["活根草", 22], ["舒心草", 22],
  ["野钢花", 23], ["皇血草", 23], ["迅蓟", 23],
  ["荆棘藻", 24], ["金棘草", 24],
  ["枯叶草", 25], ["卡德加", 25], ["蛇麻草", 25],
  ["火焰花", 26], ["紫莲花", 26], ["墓地苔", 26],
  ["太阳草", 27], ["盲目草", 27], ["黄金参", 27],
  ["格罗姆", 28], ["梦叶草", 28], ["山鼠草", 28],
  ["黑莲花", 29], ["瘟疫花", 29], ["阿尔萨斯", 29],
  // 矿/锭/石
  ["铜矿", 30], ["铜锭", 30], ["劣质的石头", 30],
  ["锡矿", 31], ["锡锭", 31], ["青铜", 31], ["粗糙的石头", 31],
  ["银矿", 32], ["银锭", 32],
  ["铁矿", 33], ["铁锭", 33], ["火岩", 33], ["沉重的石头", 33],
  ["金矿", 34], ["金锭", 34],
  ["真银", 35], ["钢锭", 35],
  ["秘银", 36], ["黄铁矿", 36], ["坚固的石头", 36],
  ["瑟银", 37], ["黑铁", 37], ["厚重的石头", 37],
];

function materialTier(name: string): number {
  if (name.includes("草药种子")) return 21;
  for (const [prefix, tier] of MATERIAL_ORDER) {
    if (name.startsWith(prefix)) return tier;
  }
  return 99;
}

// Single filtering/sorting authority for the market table; the client
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

  // 布皮草矿特殊排序：按子分类+等级排，除非用户明确点了其他列。
  const isGathering = view.category === "Gathering" || view.category === "布皮草矿";
  const defaultSort = !view.sortKey || view.sortKey === "quantity";
  if (isGathering && defaultSort) {
    rows = [...rows].sort((a, b) => materialTier(a.name) - materialTier(b.name) || a.name.localeCompare(b.name, "zh"));
  } else if (view.sortKey) {
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
