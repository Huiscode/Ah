// 跨市场倒卖的成本常量（M2）。
//
// 经典怀旧服：普通拍卖行成交费 5%，中立拍卖行 15%（押金更高、未成交不退）。
// Forever 私服可能魔改费率 —— 成交一单核对实收后改这里的数字即可；
// 页面会标注"费率按经典值，以游戏实收为准"。倒卖毛利估算只用费率，
// 不包含跑图/时间机会成本（方向文案里提示）。
export const MARKET_FEES = {
  faction: 0.05,
  neutral: 0.15
} as const;

export type MarketFeeRates = { faction: number; neutral: number };
