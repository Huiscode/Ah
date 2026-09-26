// One rule for every price-movement percentage in the UI (CN convention):
// up = red, down = green, flat = blue. Zero is FLAT, not up — callers that
// previously wrote `change >= 0 ? red : green` rendered 0.0% as red, which
// contradicts the K-line "flat = blue" rule. Use these two helpers wherever
// a percentage describes a price change, never hand-roll the ternary.
export function trendTextClass(change: number): string {
  if (change > 0) return "text-terminal-red";
  if (change < 0) return "text-terminal-green";
  return "text-terminal-cyan";
}

// Signed percentage without a direction sign on zero: "+1.5%" / "-2.0%" /
// "0.0%" (flat carries no direction). `digits` controls decimal places.
export function formatTrendPercent(change: number, digits = 2): string {
  return `${change > 0 ? "+" : ""}${change.toFixed(digits)}%`;
}
