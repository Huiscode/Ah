// Data freshness label for scan timestamps. The terminal must make
// "how old is this data" visible everywhere prices render.

export type Freshness = { label: string; stale: boolean };

const STALE_MINUTES = 2 * 60;

// Trading gate: a deal whose latest observation is older than this is stale.
export const STALE_MAX_AGE_MS = STALE_MINUTES * 60_000;

// Auctionator 数据是手动全量扫描（无插件自动回传，扫描频率天然低）：
// 新鲜度窗口放宽到 7 天——超过 7 天未扫描才视为过期。
export const AUCTIONATOR_STALE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function isStale(latest: Date | null, now: Date, maxAgeMs: number = STALE_MAX_AGE_MS): boolean {
  if (!latest) return true;
  return now.getTime() - latest.getTime() > maxAgeMs;
}

export function describeFreshness(latest: Date | null, now: Date, maxAgeMs: number = STALE_MAX_AGE_MS): Freshness {
  if (!latest) return { label: "无数据", stale: true };
  const minutes = Math.floor((now.getTime() - latest.getTime()) / 60_000);
  if (minutes < 1) return { label: "刚刚", stale: false };
  if (minutes < 60) return { label: `${minutes} 分钟前`, stale: minutes * 60_000 > maxAgeMs };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { label: `${hours} 小时前`, stale: minutes * 60_000 > maxAgeMs };
  return { label: `${Math.floor(hours / 24)} 天前`, stale: minutes * 60_000 > maxAgeMs };
}
