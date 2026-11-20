// Single source of truth for the deal-radar rules. The in-game addon is
// retired (2026-10-13): rules no longer compile into Lua and there is no
// game-side authority panel. The web constants below are the defaults; a
// 网页"雷达设置"面板（src/app/api/radar-rules）可覆盖并存进 RadarRule 单行，
// page.tsx 用 mergeRadarRules 合并后传给 buildDealRadar。

// Pricing pipeline version, stamped into every scan. Consumers (tooltip,
// deal radar, desktop importer) reject any other value: a bump means the
// meaning of the stored prices changed, not just their values.
// 旧自研插件管线版本 = 4（插件已下线，不再产生新扫描；Auctionator 导入
// 不校验此版本）。保留原值以便历史 addon 数据与其测试继续成立。
export const SCAN_PIPELINE_VERSION = 4;

// Auction house cut on a successful sale (5%). Vendor deals are exempt:
// selling to an NPC charges no cut. Used to turn gross spreads into net profit.
export const AH_CUT = 0.05;

// DealRadarRules are web-side thresholds (no plugin authority anymore).
//
// 2026-11-20 雷达重构（用户拍板"完整版"）：进池按"总利润 = 单件利润 × 可买量"判定，
// 四种赚金策略各有明确的买/卖动作：
//   vendor 必赚：买下所有低于 NPC 收购价的档位 → 卖给 NPC（零风险）
//   flip   扫货回挂：买下便宜档位 → 以 min(下一档 −1 铜, 7日参考) 重新挂出
//   cross  跨市场：本市场买 → 另一市场以其最低价 −1 铜挂出（联盟 ↔ 中立）
//   band   波段（原"可做差价"榜并入）：高波动、需求广的物品跌破 7 日带下沿 → 回到 7 日参考价卖出
// 前五档（转录补档）存在时按真实档位算可买量；没有档位的物品可买量按 1 计、只校验单件门槛。
//
// version：RadarRule 表保存的是"整份规则"。口径变了必须升版本，旧版本的保存值整体作废，
// 否则旧的 minProfit=50c 等会悄悄覆盖新默认值。
export const RADAR_RULES_VERSION = 2;

export type DealRadarRules = {
  version: number;
  vendorMinTotalProfit: number; // 必赚：总利润下限（铜）
  flipMinUnitProfit: number;    // 扫货/跨市场：单件净利下限（铜）
  flipMinUnitRatio: number;     // 扫货/跨市场：单件净利 ≥ 买入价 × N%
  flipMinTotalProfit: number;   // 扫货/跨市场：总净利下限（铜；仅在有真实档位时校验）
  minHistory: number;           // 7 日参考至少 N 天日线
  minMed7Distinct: number;      // 7 日窗口内至少 N 个不同收盘价（防单人压价曲线）
  staleWindowMs: number;        // 本市场数据新鲜度窗口
  crossMaxAgeMs: number;        // 跨市场：两边数据都必须在此窗口内（中立市场时有时无）
};

export const dealRadarRules: DealRadarRules = {
  version: RADAR_RULES_VERSION,
  vendorMinTotalProfit: 1000,     // 10 银
  flipMinUnitProfit: 2000,        // 20 银
  flipMinUnitRatio: 15,           // 15%
  flipMinTotalProfit: 10000,      // 1 金
  minHistory: 3,
  minMed7Distinct: 2,
  // 新鲜度窗口：手动全量扫描低频，默认 7 天。
  staleWindowMs: 7 * 24 * 60 * 60 * 1000,
  crossMaxAgeMs: 48 * 60 * 60 * 1000
};

// LocalFilterRules are web-only secondary filters over the current database.
// They are never compiled to Lua and never sent to the plugin; they live in
// localStorage and are applied client-side in the deal-radar table.
export type LocalFilterRules = {
  minPrice: number; // only rows with min price >= this (0 = off)
  maxPrice: number; // only rows with min price <= this (0 = off)
};

export const localFilterDefaults: LocalFilterRules = {
  minPrice: 0,
  maxPrice: 0
};

// Saved overrides (RadarRule row) merge over the defaults, accepting only known
// numeric fields. Rows saved under an older rule version are ignored entirely.
export function mergeRadarRules(overrides: unknown): DealRadarRules {
  if (typeof overrides !== "object" || overrides === null) return dealRadarRules;
  const source = overrides as Record<string, unknown>;
  if (source.version !== RADAR_RULES_VERSION) return dealRadarRules;
  const merged = { ...dealRadarRules } as Record<string, unknown>;
  for (const key of Object.keys(dealRadarRules)) {
    if (key === "version") continue;
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) merged[key] = value;
  }
  return merged as DealRadarRules;
}

// 波段策略（原"可做差价"榜，2026-11-20 并入雷达）阈值：起伏大 × 需求广 × 有人在卖。
export type SpreadRules = {
  minVolatilityRatio: number; // 7 日带宽 ÷ 参考价（%）：低于此起伏视为无差价空间
  minTurnover: number;        // 流通分下限：至少被 N 个配方使用（需求广度）
  minQuantity: number;        // 在售量下限：买得到（至少 N 单在卖）
  staleWindowMs: number;      // 新鲜度窗口（与雷达一致，手动扫描默认 7 天）
};

export const spreadRules: SpreadRules = {
  minVolatilityRatio: 15,
  minTurnover: 1,
  minQuantity: 3,
  staleWindowMs: 7 * 24 * 60 * 60 * 1000
};

// 异动榜（buildMoverBoard）阈值。
export type MoverRules = {
  minMovePercent: number; // |环比%| 下限：低于此视为正常波动
  minQuantity: number;    // 在售量下限
  staleWindowMs: number;
};

export const moverRules: MoverRules = {
  minMovePercent: 20,
  minQuantity: 1,
  staleWindowMs: 7 * 24 * 60 * 60 * 1000
};

// 分解榜（buildDisenchantBoard）阈值：买绿/蓝装 → 分解 → 材料挂 AH 的套利评估。
export type DisenchantRules = {
  minQuantity: number;     // 在售量下限：至少 N 件可买
  minNetProfit: number;   // 分解净赚下限（铜）；0 = 不过滤，全部列出按净赚降序
  staleWindowMs: number;  // 新鲜度窗口（与其他榜一致，手动扫描默认 7 天）
};

export const disenchantRules: DisenchantRules = {
  minQuantity: 1,
  minNetProfit: 0,
  staleWindowMs: 7 * 24 * 60 * 60 * 1000
};
