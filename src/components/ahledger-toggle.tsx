"use client";

import { useState } from "react";

// Terminal switch for the AHledger website scanning channel. The value lives
// in AppState; the importer process polls it every cycle and pauses while
// disabled. Independent from the addon channel — the game scan path is
// unaffected by this toggle.
export function AhledgerToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const next = !enabled;
    try {
      const res = await fetch("/api/ahledger/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next })
      });
      if (res.ok) setEnabled(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={`flex items-center gap-1 font-mono text-xs ${enabled ? "text-terminal-green" : "text-terminal-muted"} hover:text-terminal-amber`}
      title="控制 AHledger 网站数据扫描（游戏内插件扫描不受影响）"
    >
      <span className="text-[10px]">●</span>
      网站扫描：{enabled ? "开" : "关"}
    </button>
  );
}
