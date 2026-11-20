"use client";

import { useState } from "react";

// 图标走自托管文件 public/icons/{itemId}.jpg（npm run icons:fetch 下载维护），
// 不依赖 DB 的 icon 名与外网 CDN——beta 期旧导入通道清库后 Item.icon 列恒空，
// zamimg 直链方案随之失效（2026-11-08 切换）。文件缺失时 onError 静默隐藏。
export function ItemIcon({ itemId, size = 20 }: { itemId: number; icon?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/icons/${itemId}.jpg`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className="inline-block rounded-sm border border-terminal-border align-middle"
    />
  );
}
