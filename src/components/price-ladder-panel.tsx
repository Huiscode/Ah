"use client";

import { useEffect, useState } from "react";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Coins } from "@/components/coins";
import { X } from "lucide-react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { qualityColorClass } from "@/lib/quality";

type PricePoint = { price: number; count: number };

export function PriceLadderPanel() {
  const [itemId, setItemId] = usePersistedState<number | null>("wah:selected-item", null);
  const [data, setData] = useState<{ name: string; quality: string; ladder: PricePoint[] } | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a[href^='/items/']") as HTMLAnchorElement | null;
      if (!anchor) return;
      // 带 data-no-ladder 的链接（如制造利润面板的物品名）不触发价格档位。
      if (anchor.hasAttribute("data-no-ladder")) return;
      const m = anchor.href.match(/\/items\/(\d+)/);
      if (m) setItemId(Number(m[1]));
    };
    document.addEventListener("mouseover", handler);
    return () => document.removeEventListener("mouseover", handler);
  }, [setItemId]);

  useEffect(() => {
    if (!itemId) return;
    fetch(`/api/items/${itemId}/ladder`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, [itemId]);

  if (!itemId || !data || !data.ladder?.length) return null;

  return (
    <Panel>
      <PanelHeader
        title={
          <span>
            价格档位 — <span className={qualityColorClass(data.quality)}>{data.name}</span>
          </span>
        }
        action={
          <button onClick={() => setItemId(null)} aria-label="关闭" className="text-terminal-muted hover:text-terminal-amber">
            <X size={13} />
          </button>
        }
      />
      <div className="space-y-1 p-3 font-mono text-xs">
        {data.ladder.map((p, i) => (
          <div key={i} className="flex items-center justify-between">
            <span className="text-terminal-muted">价格{i + 1}</span>
            <span className="flex items-center gap-2">
              <Coins copper={p.price} />
              <span className="text-terminal-muted">×{p.count}</span>
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
