// Classic WoW item-class names as rendered by the zhCN client. Filtering
// keeps the English value (DB + API stay English); only the visible text
// is translated.
export const CATEGORY_ZH: Record<string, string> = {
  Armor: "护甲",
  Weapon: "武器",
  Consumable: "消耗品",
  "Trade Goods": "交易物品",
  Recipe: "配方",
  Miscellaneous: "杂物",
  Container: "容器",
  Key: "钥匙",
  Quest: "任务",
  Quiver: "箭袋",
  Projectile: "弹药",
  Reagent: "材料",
  unknown: "未知"
};

export function categoryLabel(category: string): string {
  return CATEGORY_ZH[category] ?? category;
}
