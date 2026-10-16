// WAHScanTimes（每市场扫描时间）解析测试：钉住"扫中立后联盟不误报刚刚"的修复。
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { readAuctionatorSavedVars } from "./auctionator-sv";

const tmpDirs: string[] = [];
function writeSv(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "auc-sv-test-"));
  tmpDirs.push(dir);
  const p = join(dir, "Auctionator.lua");
  writeFileSync(p, content, "latin1");
  return p;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("readAuctionatorSavedVars scanTimes", () => {
  it("解析 WAHScanTimes（驼峰顶层变量）为按市场时间戳", () => {
    const p = writeSv(
      [
        `AUCTIONATOR_PRICE_DATABASE = { ["PvP"] = { } }`,
        `AUCTIONATOR_SAVEDVARS = { ["TimeOfLastBrowseScan"] = 1792159254 }`,
        `WAHScanTimes = { ["faction"] = 1792159254, ["neutral"] = 1792000000 }`,
      ].join("\n"),
    );
    const parsed = readAuctionatorSavedVars(p, "PvP");
    expect(parsed.scanTimes.faction).toBe(1792159254);
    expect(parsed.scanTimes.neutral).toBe(1792000000);
    expect(parsed.timeOfLastBrowseScan).toBe(1792159254);
  });

  it("WAHScanTimes 缺失时 scanTimes 为空对象（导入回退全局 TimeOfLastBrowseScan）", () => {
    const p = writeSv(
      [
        `AUCTIONATOR_PRICE_DATABASE = { ["PvP"] = { } }`,
        `AUCTIONATOR_SAVEDVARS = { ["TimeOfLastBrowseScan"] = 1792159254 }`,
      ].join("\n"),
    );
    const parsed = readAuctionatorSavedVars(p, "PvP");
    expect(parsed.scanTimes).toEqual({});
    expect(parsed.timeOfLastBrowseScan).toBe(1792159254);
  });
});
