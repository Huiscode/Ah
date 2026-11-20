"use client";

// 语言切换按钮：写 wah_lang cookie（一年）后 router.refresh()，
// 服务端组件（含根布局的 <html lang>）随之按新语言重渲染。
import { useRouter } from "next/navigation";
import { LANG_COOKIE, type Lang } from "@/lib/i18n";

export function LangToggle({ lang }: { lang: Lang }) {
  const router = useRouter();
  const set = (next: Lang) => {
    document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };
  const item = (value: Lang, label: string) => (
    <button
      type="button"
      onClick={() => set(value)}
      className={`px-1.5 py-0.5 leading-none ${lang === value ? "text-terminal-amber" : "text-terminal-muted hover:text-slate-200"}`}
      aria-pressed={lang === value}
    >
      {label}
    </button>
  );
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap border border-terminal-border px-1 py-0.5 text-[10px]" title="Language / 语言">
      {item("en", "EN")}
      <span className="text-terminal-border">|</span>
      {item("zh", "中文")}
    </span>
  );
}
