import { describe, expect, it } from "vitest";
import { pickLatestDate } from "./repositories";

describe("pickLatestDate", () => {
  it("returns the newest of several dates", () => {
    const d1 = new Date("2026-07-20T10:00:00Z");
    const d2 = new Date("2026-07-21T10:00:00Z");
    expect(pickLatestDate(d1, d2)).toEqual(d2);
  });

  it("ignores null/undefined candidates (market channel with no data)", () => {
    const d = new Date("2026-07-20T10:00:00Z");
    expect(pickLatestDate(undefined, null, d)).toEqual(d);
  });

  it("returns null when every candidate is empty", () => {
    expect(pickLatestDate(undefined, undefined)).toBeNull();
    expect(pickLatestDate(null, null, undefined)).toBeNull();
    expect(pickLatestDate()).toBeNull();
  });
});
