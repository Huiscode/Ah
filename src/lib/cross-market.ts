// 跨市场倒卖比较（M2）：联盟主城市场 × 中立（三角路口营地）市场的最新轮
// 配对。DB 查询在 repositories.ts；这里是纯函数部分 —— 价差、方向、预计
// 毛利、新鲜度 —— 全部可单测，页面只负责渲染与筛选。
import { MARKET_FEES, type MarketFeeRates } from "@/data/market-fees";

export type CrossMarketSide = {
  itemId: number;
  // P10 市场价（买家真实成交价，口径与 buildMarketSignal 一致）
  marketPrice: number;
  // 最低挂单价；无挂单时与 marketPrice 同值（正常扫描总有挂单）
  minPrice: number;
  // rawPayload.ladder 第 1 档价格（真实买入成本），无 ladder 时为 null
  ladderFloor: number | null;
  quantity: number;
  numAuctions: number;
  timestamp: Date | null;
};

export type CrossMarketDirection = "faction→neutral" | "neutral→faction";

export type CrossMarketRow = {
  itemId: number;
  name: string;
  quality: string;
  category: string;
  subCategory: string;
  icon: string | null;
  faction: CrossMarketSide;
  neutral: CrossMarketSide;
  // |fP10 − nP10| / min(两边 P10)，百分比 —— 排序主指标
  diffPct: number;
  // faction 便宜 → "faction→neutral"（联盟买、中立卖）；反之亦然
  direction: CrossMarketDirection;
  // 买入侧实际成本：ladder 第 1 档，无 ladder 回退 P10
  buySideFloor: number;
  // 预计净利（铜）：卖侧 P10 × (1 − 卖侧费率) − 买侧实际成本
  estProfit: number;
  // 任一侧最新轮超过陈旧门槛（默认 7 天）→ true，不参与"可操作"判定
  stale: boolean;
};

export const STALE_DAYS = 7;
const MS_PER_DAY = 86_400_000;

function ladderFloorOf(side: CrossMarketSide): number {
  return side.ladderFloor ?? side.marketPrice;
}

export function buildCrossMarketRows(
  faction: CrossMarketSide[],
  neutral: CrossMarketSide[],
  fees: MarketFeeRates = MARKET_FEES,
  now: Date = new Date(),
  staleDays: number = STALE_DAYS
): CrossMarketRow[] {
  const byId = new Map(neutral.map((side) => [side.itemId, side]));
  const rows: CrossMarketRow[] = [];
  for (const f of faction) {
    const n = byId.get(f.itemId);
    // 只比较两市场都出现过的物品：一方没有则无套利机会。
    if (!n) continue;
    const fP = f.marketPrice;
    const nP = n.marketPrice;
    const base = Math.min(fP, nP);
    const diffPct = base > 0 ? (Math.abs(fP - nP) / base) * 100 : 0;
    const direction: CrossMarketDirection = fP < nP ? "faction→neutral" : "neutral→faction";
    const buy = fP < nP ? f : n;
    const sellSide = fP < nP ? n : f;
    const sellFee = fP < nP ? fees.neutral : fees.faction;
    const buySideFloor = ladderFloorOf(buy);
    const estProfit = Math.round(sellSide.marketPrice * (1 - sellFee) - buySideFloor);
    const stale =
      f.timestamp === null || n.timestamp === null ||
      now.getTime() - f.timestamp.getTime() > staleDays * MS_PER_DAY ||
      now.getTime() - n.timestamp.getTime() > staleDays * MS_PER_DAY;
    rows.push({
      itemId: f.itemId,
      // 元数据（name/quality/分类/icon）由查询层 attachItemMeta 回填；
      // 纯函数本身不查库，此处留空。
      name: "",
      quality: "unknown",
      category: "unknown",
      subCategory: "unknown",
      icon: null,
      faction: f,
      neutral: n,
      diffPct: Math.round(diffPct * 10) / 10,
      direction,
      buySideFloor,
      estProfit,
      stale
    });
  }
  return rows;
}

// 查询层把 Item 元数据回填进配对结果（纯函数，可测）。faction/neutral 的
// itemId 集合必须与 rows 里的两侧一致（都由同一配对产生）。
export function attachItemMeta(
  rows: CrossMarketRow[],
  meta: Map<number, { name: string; quality: string; category: string; subCategory: string; icon: string | null }>
): CrossMarketRow[] {
  for (const row of rows) {
    const item = meta.get(row.itemId);
    if (!item) continue;
    row.name = item.name;
    row.quality = item.quality;
    row.category = item.category;
    row.subCategory = item.subCategory;
    row.icon = item.icon;
  }
  return rows;
}
