// 雷达筛选的共享逻辑：DealRadarTable（行过滤）与 OpportunityTabs（计数/复制名单）
// 用同一份谓词，保证"筛选后 N / 总数"与表格行数、复制内容一致。
// 值可能以字符串形式从 localStorage 读出（设置面板存字符串），数值统一 Number() 归一。
import { categoryMatches } from "@/lib/category-zh";
import type { DealKind, DealRadarRow } from "@/lib/analytics";

export type RadarFilterState = {
  strategy: DealKind | "" | string;
  category: string;
  minTotalProfitSilver: number | string; // 总利润下限（银）
  onlyLiquid: boolean;
  minQuantity: number | string;
  minTierGap: number | string;
};

export const RADAR_FILTER_DEFAULTS: RadarFilterState = {
  strategy: "",
  category: "",
  minTotalProfitSilver: 0,
  onlyLiquid: false,
  minQuantity: 0,
  minTierGap: 0
};

// localStorage key（DealRadarTable / OpportunityTabs / RadarSettingsButton 三处共用）。
export const RADAR_FILTER_KEYS: Record<keyof RadarFilterState, string> = {
  strategy: "wah:deal-radar:strategy",
  category: "wah:deal-radar:category",
  minTotalProfitSilver: "wah:deal-radar:minTotalProfitSilver",
  onlyLiquid: "wah:deal-radar:onlyLiquid",
  minQuantity: "wah:deal-radar:minQuantity",
  minTierGap: "wah:deal-radar:minTierGap"
};

export function radarFiltersActive(filters: RadarFilterState): boolean {
  return !!filters.strategy || !!filters.category || filters.onlyLiquid
    || Number(filters.minTotalProfitSilver) > 0 || Number(filters.minQuantity) > 0 || Number(filters.minTierGap) > 0;
}

export function filterRadarRows(
  deals: DealRadarRow[],
  filters: RadarFilterState,
  tierGapByItemId?: Map<number, number>
): DealRadarRow[] {
  const minTotal = (Number(filters.minTotalProfitSilver) || 0) * 100;
  const minQuantity = Number(filters.minQuantity) || 0;
  const minTierGap = Number(filters.minTierGap) || 0;
  let rows = [...deals];
  if (filters.strategy) rows = rows.filter((deal) => deal.kind === filters.strategy);
  if (filters.category) rows = rows.filter((deal) => categoryMatches(deal.category, filters.category));
  if (minTotal > 0) rows = rows.filter((deal) => deal.totalProfit >= minTotal);
  // 仅限高流通：只保留有流通分的商品（turnoverScore > 0）。
  if (filters.onlyLiquid) rows = rows.filter((deal) => deal.turnoverScore > 0);
  // 在售量下限。
  if (minQuantity > 0) rows = rows.filter((deal) => deal.quantity >= minQuantity);
  // 价格档位差距：无档位数据或只有一档的物品 gap === undefined → 过滤。
  if (minTierGap > 0) {
    rows = rows.filter((deal) => {
      const gap = tierGapByItemId?.get(deal.itemId);
      return gap !== undefined && gap >= minTierGap;
    });
  }
  return rows;
}
