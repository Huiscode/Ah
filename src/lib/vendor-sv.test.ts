import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTranscriptSvPath } from "@/lib/vendor-sv";

describe("resolveTranscriptSvPath", () => {
  const dir = mkdtempSync(join(tmpdir(), "wah-sv-"));
  const legacy = join(dir, "Auctionator.lua");
  const sidecar = join(dir, "WoWderhoiAH-Transcript.lua");
  writeFileSync(legacy, "");
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const setMtime = (path: string, msAgo: number) => {
    const t = new Date(Date.now() - msAgo);
    utimesSync(path, t, t);
  };

  it("keeps a legacy Auctionator.lua path while the sidecar save is missing or dead", () => {
    expect(resolveTranscriptSvPath(legacy, legacy)).toBe(legacy);
    writeFileSync(sidecar, "");
    setMtime(sidecar, 30 * 24 * 3600 * 1000); // 2026-10-15 前独立插件留下的死文件
    setMtime(legacy, 0);
    expect(resolveTranscriptSvPath(legacy, legacy)).toBe(legacy);
  });

  it("switches to the sidecar save once it is written alongside Auctionator.lua", () => {
    writeFileSync(sidecar, "");
    setMtime(sidecar, 0);
    setMtime(legacy, 60 * 1000);
    expect(resolveTranscriptSvPath(legacy, legacy)).toBe(sidecar);
  });

  it("honours an explicit non-legacy path and derives the sidecar when unset", () => {
    expect(resolveTranscriptSvPath("D:\\x\\Other.lua", legacy)).toBe("D:\\x\\Other.lua");
    expect(resolveTranscriptSvPath(undefined, legacy)).toBe(sidecar);
  });
});
