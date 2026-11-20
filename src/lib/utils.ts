import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Zone } from "@/lib/analytics";
import { L, type Lang } from "@/lib/i18n";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatGold(copper: number) {
  const gold = copper / 10_000;
  return `${gold.toLocaleString("en-US", { maximumFractionDigits: 2 })}g`;
}

export function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

// 7 日带区间徽章：买入区（跌破下沿）/ 卖出区（冲穿上沿）/ 均衡（带内）/ 无数据。
export function zoneBadge(zone: Zone, lang: Lang = "en"): { label: string; className: string } {
  switch (zone) {
    case "buy":
      return { label: L(lang, "BUY", "买入区"), className: "text-terminal-green" };
    case "sell":
      return { label: L(lang, "SELL", "卖出区"), className: "text-terminal-red" };
    case "flat":
      return { label: L(lang, "FLAT", "均衡"), className: "text-terminal-muted" };
    default:
      return { label: "—", className: "text-terminal-muted" };
  }
}