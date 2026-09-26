"use client";

import { useState } from "react";

// In-game icon by texture name when the addon uploaded one (Forever item IDs
// collide with retail, so the old itemId-keyed local cache is wrong for many
// items): zamimg hosts every client icon file by name. Falls back to the
// self-hosted itemId cache for legacy rows, and hides itself when neither
// exists yet (icon lands with the next addon scan).
export function ItemIcon({ itemId, icon, size = 20 }: { itemId: number; icon?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  const src = icon
    ? `https://wow.zamimg.com/images/wow/icons/large/${icon}.jpg`
    : `/icons/${itemId}.jpg`;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny static image
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
