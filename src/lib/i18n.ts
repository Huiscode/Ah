// 双语界面基础件：英文为默认语言（欧服/英文客户端），中文经 cookie 切换保留。
// 设计取舍：不做集中式字典——文案直接在调用点以内联 (en, zh) 二元组书写
// （L(lang, "English", "中文")），避免海量 key 的命名/同步开销；并行改动
// 也不会挤在一个字典文件里冲突。服务端组件用 getLang()（i18n-server.ts），
// 客户端组件用 useLang()/useLL()（components/lang-provider.tsx）。
export type Lang = "en" | "zh";

export const DEFAULT_LANG: Lang = "en";
export const LANG_COOKIE = "wah_lang";

export function parseLang(raw: string | null | undefined): Lang {
  return raw === "zh" ? "zh" : DEFAULT_LANG;
}

/** 内联双语取词：L(lang, "English text", "中文文案")。 */
export function L(lang: Lang, en: string, zh: string): string {
  return lang === "zh" ? zh : en;
}

/** 物品显示名：EN 模式优先英文名（Item.name_en 回填），缺失回退中文名；ZH 模式直接中文名。 */
export function displayName(name: string, nameEn: string | null | undefined, lang: Lang): string {
  return lang === "en" && nameEn ? nameEn : name;
}
