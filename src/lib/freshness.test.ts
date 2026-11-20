import { describe, expect, it } from "vitest";
import { describeFreshness } from "@/lib/freshness";

const now = new Date("2026-07-24T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

describe("describeFreshness", () => {
  it("reports missing data as stale", () => {
    expect(describeFreshness(null, now)).toEqual({ label: "no data", stale: true });
    expect(describeFreshness(null, now, undefined, "zh")).toEqual({ label: "无数据", stale: true });
  });

  it("labels sub-minute data as just now", () => {
    expect(describeFreshness(minutesAgo(0), now)).toEqual({ label: "just now", stale: false });
    expect(describeFreshness(minutesAgo(0), now, undefined, "zh")).toEqual({ label: "刚刚", stale: false });
  });

  it("marks data stale from 2 hours in an hourly market", () => {
    expect(describeFreshness(minutesAgo(45), now)).toEqual({ label: "45m ago", stale: false });
    expect(describeFreshness(minutesAgo(90), now)).toEqual({ label: "1h ago", stale: false });
    expect(describeFreshness(minutesAgo(3 * 60), now)).toEqual({ label: "3h ago", stale: true });
    expect(describeFreshness(minutesAgo(90), now, undefined, "zh")).toEqual({ label: "1 小时前", stale: false });
  });

  it("labels days as always stale", () => {
    expect(describeFreshness(minutesAgo(2 * 24 * 60), now)).toEqual({ label: "2d ago", stale: true });
    expect(describeFreshness(minutesAgo(2 * 24 * 60), now, undefined, "zh")).toEqual({ label: "2 天前", stale: true });
  });
});
