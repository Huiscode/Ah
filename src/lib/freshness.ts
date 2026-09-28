// Data freshness label for scan timestamps. The terminal must make
// "how old is this data" visible everywhere prices render. The AH moves
// hourly, so anything older than 2 hours is stale for trading decisions.

export type Freshness = { label: string; stale: boolean };

const STALE_MINUTES = 2 * 60;

// Trading gate: a deal whose latest observation is older than this is stale.
export const STALE_MAX_AGE_MS = STALE_MINUTES * 60_000;

export function isStale(latest: Date | null, now: Date): boolean {
  if (!latest) return true;
  return now.getTime() - latest.getTime() > STALE_MAX_AGE_MS;
}

export function describeFreshness(latest: Date | null, now: Date): Freshness {
  if (!latest) return { label: "无数据", stale: true };
  const minutes = Math.floor((now.getTime() - latest.getTime()) / 60_000);
  if (minutes < 1) return { label: "刚刚", stale: false };
  if (minutes < 60) return { label: `${minutes} 分钟前`, stale: minutes >= STALE_MINUTES };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { label: `${hours} 小时前`, stale: minutes >= STALE_MINUTES };
  return { label: `${Math.floor(hours / 24)} 天前`, stale: true };
}
