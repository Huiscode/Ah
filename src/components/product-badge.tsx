"use client";

// "产品"徽章：标记配方产出物（区别于材料），用于配方上下文的展示。
// 配方做出来的食物显示"食物"（必须是有配方产出的食物——字典来自
// 配方库食物产出物抓取，掉落的普通食物不在此列）。
import { FOOD_EFFECTS } from "@/data/food-effects";
import { useLL } from "@/components/lang-provider";

export function ProductBadge({ itemId }: { itemId: number }) {
  const tr = useLL();
  const isFood = FOOD_EFFECTS[itemId] !== undefined;
  return (
    <span
      className="ml-0.5 shrink-0 rounded bg-sky-500/15 px-1 py-px align-middle text-[9px] text-sky-400"
      title={isFood ? tr("Crafted food", "配方食物") : tr("Crafted product", "配方产出物")}
    >
      {isFood ? tr("Food", "食物") : tr("Product", "产品")}
    </span>
  );
}
