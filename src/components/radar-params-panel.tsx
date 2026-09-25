"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui/panel";

// Route-2 dashboard panel: the in-game settings panel is the authority, this
// card only follows. The collapse switch hides the whole block; while hidden a
// single slim row remains so the card can be brought back.
export function RadarParamsPanel({
  note,
  children
}: {
  note: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between border border-terminal-border bg-terminal-panel/92 px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-terminal-muted hover:text-terminal-amber"
      >
        <span>雷达参数</span>
        <Eye size={13} />
      </button>
    );
  }

  return (
    <Panel>
      <PanelHeader
        title="雷达参数"
        action={
          <span className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-terminal-muted">{note}</span>
            <button
              onClick={() => setOpen(false)}
              aria-label="隐藏雷达参数"
              title="隐藏雷达参数"
              className="text-terminal-muted hover:text-terminal-amber"
            >
              <EyeOff size={13} />
            </button>
          </span>
        }
      />
      <div className="space-y-2 p-3 font-mono text-xs">{children}</div>
    </Panel>
  );
}
