// 流通分徽章色彩规则：被多少配方当材料使用（越高周转越快）。
// 与捡漏雷达/市场监控共用同一套五档 WoW 品质色：
// ≥100 橙（传家宝） / ≥50 紫（史诗） / ≥15 蓝（稀有） / ≥5 绿（优秀） / >0 白（普通）。
// score <= 0 时不显示徽章（返回 null）。
export function turnoverBadgeClass(score: number): string | null {
  if (score <= 0) return null;
  if (score >= 100) return "bg-[#ff8000]/15 text-[#ff8000]";
  if (score >= 50) return "bg-[#a335ee]/15 text-[#a335ee]";
  if (score >= 15) return "bg-[#0070dd]/15 text-[#0070dd]";
  if (score >= 5) return "bg-[#1eff00]/15 text-[#1eff00]";
  return "bg-white/15 text-white";
}
