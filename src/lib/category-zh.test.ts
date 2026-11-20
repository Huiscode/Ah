import { describe, expect, it } from "vitest";
import { categoryMatches, categoryLabel, groupedCategoryOptions, normalizeCategory } from "@/lib/category-zh";

describe("布皮草矿并入材料分组", () => {
  it("布皮草矿不再作为独立下拉选项出现", () => {
    expect(groupedCategoryOptions(["Gathering", "Trade Goods", "Reagent"])).not.toContain("Gathering");
    expect(groupedCategoryOptions(["Gathering"])).toContain("Materials");
  });

  it("Gathering 物品在材料分组下匹配（分组令牌固定英文）", () => {
    expect(categoryMatches("Gathering", "Materials")).toBe(true);
    expect(categoryMatches("Gathering", "布皮草矿")).toBe(false); // 旧类目已删除
    expect(categoryMatches("Trade Goods", "Materials")).toBe(true);
  });

  it("中文与英文原始分类都被归一化后匹配", () => {
    expect(normalizeCategory("布皮草矿")).toBe("Gathering");
    expect(categoryMatches("布皮草矿", "Materials")).toBe(true);
    expect(categoryLabel("Gathering")).toBe("Gathering"); // EN 默认显示 canonical key
    expect(categoryLabel("Gathering", "zh")).toBe("布皮草矿"); // 中文显示名保留，仅不再出现在下拉
  });

  it("分组令牌按语言显示（Equipment/Materials ↔ 装备/材料）", () => {
    expect(categoryLabel("Equipment")).toBe("Equipment");
    expect(categoryLabel("Equipment", "zh")).toBe("装备");
    expect(categoryLabel("Materials")).toBe("Materials");
    expect(categoryLabel("Materials", "zh")).toBe("材料");
    expect(categoryLabel("Armor")).toBe("Armor");
    expect(categoryLabel("Armor", "zh")).toBe("护甲");
  });
});
