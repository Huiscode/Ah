"use client";

import { useState } from "react";

// 一键复制 Auctionator 购物清单导入文本（8.3+ 格式：清单名^物品1^物品2），
// 粘贴到游戏内 Auctionator 购物清单 → 导入 对话框即可导入。
// 清单名每次复制都带唯一时间戳（listNamePrefix + 月日时分，如 捡漏10161530 / 关注10161530），
// 防止覆盖同名旧清单。
// COPY_LIMIT：一次最多复制 100 项——无限版客户端一次性解析过多物品名会触发
// Lua 错误风暴（"你的插件有大量错误"弹窗）；超出时截断并提示缩小筛选/分批。
const COPY_LIMIT = 100;

function uniqueListName(prefix: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${prefix}${stamp}`;
}

export function CopyListButton({ names, label = "复制清单", listNamePrefix = "捡漏" }: {
  names: string[];
  label?: string;
  listNamePrefix?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [lastName, setLastName] = useState<string | null>(null);

  const copy = async () => {
    const listName = uniqueListName(listNamePrefix);
    setLastName(listName);
    const slice = names.slice(0, COPY_LIMIT);
    const text = listName + "^" + slice.join("^");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // fallback：textarea + execCommand（非安全上下文等）
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const tooMany = names.length > COPY_LIMIT;
  const shown = `${Math.min(names.length, COPY_LIMIT)} 项`;

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1 whitespace-nowrap border border-terminal-border px-1.5 py-0.5 text-[10px] text-terminal-muted outline-none transition-colors hover:border-terminal-amber/50 hover:text-terminal-amber"
      title={`复制为 Auctionator 导入文本（清单名唯一：${listNamePrefix} + 月日时分，如 ${listNamePrefix}10161530，不会覆盖旧清单）。一次最多 ${COPY_LIMIT} 项：当前 ${names.length} 项${tooMany ? "，已截断取前 100——建议先缩小筛选范围，或分批导入不同清单" : ""}`}
    >
      {copied ? (lastName ? `已复制：${lastName}` : `已复制 ${shown}`) : "复制Max100条"}
    </button>
  );
}
