"use client";

import { useState } from "react";

export function ItemIcon({ itemId, icon, size = 20 }: { itemId: number; icon?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed || !icon) return null;
  const src = `https://wow.zamimg.com/images/wow/icons/large/${icon}.jpg`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className="inline-block rounded-sm border border-terminal-border align-middle"
    />
  );
}
