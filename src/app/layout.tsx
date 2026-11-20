import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { LANG_COOKIE, parseLang } from "@/lib/i18n";
import { LangProvider } from "@/components/lang-provider";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist({ variable: "--font-geist-mono", subsets: ["latin"] });

// 双语（默认英文）：标题相同，描述按语言；<html lang> 跟随 cookie。
export async function generateMetadata(): Promise<Metadata> {
  const jar = await cookies();
  const lang = parseLang(jar.get(LANG_COOKIE)?.value);
  return {
    title: "AH",
    description:
      lang === "zh"
        ? "面向魔兽世界经典版拍卖行交易者的短周期市场情报终端。"
        : "Short-horizon market intelligence terminal for Classic WoW auction house traders."
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const jar = await cookies();
  const lang = parseLang(jar.get(LANG_COOKIE)?.value);
  return (
    <html lang={lang === "zh" ? "zh-CN" : "en"} className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-terminal-bg font-sans antialiased`}>
        <LangProvider lang={lang}>{children}</LangProvider>
      </body>
    </html>
  );
}
