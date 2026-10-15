import { describe, expect, it } from "vitest";
import { baseNameOf, buildListImportText, parseImportText } from "@/lib/shopping-list";

describe("baseNameOf", () => {
  it("随机前缀：取'之'后基础名", () => {
    expect(baseNameOf("孤狼之轻身法杖")).toBe("轻身法杖");
    expect(baseNameOf("精神之卷刃的短剑")).toBe("卷刃的短剑");
  });

  it("无'之'保留原名", () => {
    expect(baseNameOf("符文布")).toBe("符文布");
    expect(baseNameOf("宁神花")).toBe("宁神花");
  });

  it("固定名含'之'的取舍：退化为基础词（已知限制）", () => {
    expect(baseNameOf("河爪之斧")).toBe("斧");
  });

  it("空值/空白安全", () => {
    expect(baseNameOf("")).toBe("");
    expect(baseNameOf("  ")).toBe("");
  });
});

describe("buildListImportText", () => {
  it("生成新版格式：清单名^基础名…", () => {
    expect(buildListImportText("捡漏清单", ["孤狼之轻身法杖", "符文布", "宁神花"])).toBe(
      "捡漏清单^轻身法杖^符文布^宁神花"
    );
  });

  it("清洗清单名与物品中的 ^ 与换行", () => {
    expect(buildListImportText("A^B", ["x\ny"])).toBe("AB^xy");
  });

  it("空物品列表只输出清单名", () => {
    expect(buildListImportText("空清单", [])).toBe("空清单");
  });
});

describe("parseImportText（只认新版 ^ 格式）", () => {
  it("新版格式：一行一清单，^ 分隔", () => {
    const lists = parseImportText("必赚清单^轻身法杖^符文布\n材料清单^宁神花^银叶草");
    expect(lists).toEqual([
      { name: "必赚清单", names: ["轻身法杖", "符文布"] },
      { name: "材料清单", names: ["宁神花", "银叶草"] }
    ]);
  });

  it("旧版（*）与 TSM（,）格式不再识别，返回空", () => {
    expect(parseImportText("**清单A\n物品1\n物品2")).toEqual([]);
    expect(parseImportText("i:3185, 2589,p:4306")).toEqual([]);
  });

  it("无法识别返回空", () => {
    expect(parseImportText("随便一段文字")).toEqual([]);
    expect(parseImportText("")).toEqual([]);
  });
});
