"use client";

// 客户端语言上下文：根布局（服务端）读 cookie 后把 lang 注入 Provider，
// 客户端组件用 useLang()/useLL() 取词，无需层层透传 props。
import { createContext, useContext } from "react";
import { L as pick, type Lang } from "@/lib/i18n";

const LangContext = createContext<Lang>("en");

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang(): Lang {
  return useContext(LangContext);
}

/** 绑定了当前语言的取词函数：const tr = useLL(); tr("Min", "最低价")。 */
export function useLL(): (en: string, zh: string) => string {
  const lang = useContext(LangContext);
  return (en, zh) => pick(lang, en, zh);
}
