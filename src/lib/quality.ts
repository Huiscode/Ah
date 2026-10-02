// Canonical WoW item-quality colors as Tailwind classes (declared in
// tailwind.config.ts under colors.wow).

const classByQuality: Record<string, string> = {
  poor: "text-wow-poor",
  common: "text-wow-common",
  uncommon: "text-wow-uncommon",
  rare: "text-wow-rare",
  epic: "text-wow-epic",
  legendary: "text-wow-legendary"
};

export function qualityColorClass(quality: string): string {
  return classByQuality[quality] ?? "text-wow-common";
}

// WoW 数字品质（0-7，wx-wow 种子附带）→ 颜色 class；缺失/未知按 common 白兜底。
const QUALITY_KEY_BY_ID: Record<number, string> = {
  0: "poor",
  1: "common",
  2: "uncommon",
  3: "rare",
  4: "epic",
  5: "legendary"
};

export function qualityColorClassById(quality?: number): string {
  return qualityColorClass(quality === undefined ? "common" : (QUALITY_KEY_BY_ID[quality] ?? "common"));
}
