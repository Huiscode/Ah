import { describe, expect, it } from "vitest";
import { categoryMatches, categoryLabel, groupedCategoryOptions, normalizeCategory } from "@/lib/category-zh";

describe("布皮草矿并入材料分组", () => {
  it("布皮草矿不再作为独立下拉选项出现", () => {
    expect(groupedCategoryOptions(["Gathering", "Trade Goods", "Reagent"])).not.toContain("Gathering");
    expect(groupedCategoryOptions(["Gathering"])).toContain("材料");
  });

  it("Gathering 物品在材料分组下匹配", () => {
    expect(categoryMatches("Gathering", "材料")).toBe(true);
    expect(categoryMatches("Gathering", "布皮草矿")).toBe(false); // 旧类目已删除
    expect(categoryMatches("Trade Goods", "材料")).toBe(true);
  });

  it("中文与英文原始分类都被归一化后匹配", () => {
    expect(normalizeCategory("布皮草矿")).toBe("Gathering");
    expect(categoryMatches("布皮草矿", "材料")).toBe(true);
    expect(categoryLabel("Gathering")).toBe("布皮草矿"); // 显示名保留，仅不再出现在下拉
  });
});
