"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, AlertTriangle } from "lucide-react";

// One-click "clear ledger" with a two-step confirmation. Calls
// POST /api/ledger/clear (wipes tradeRecord + stamps ledgerClearedAt so the
// SavedVariables watcher never re-imports the old records), then refreshes
// the server-rendered ledger page.
export function ClearLedgerButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClear() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ledger/clear", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setOpen(false);
      router.refresh();
    } catch {
      setError("清空失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="清空账本"
        className="inline-flex items-center gap-1.5 rounded border border-terminal-red/50 px-3 py-1.5 font-mono text-xs text-terminal-red transition-colors hover:border-terminal-red hover:bg-terminal-red/10"
      >
        <Trash2 size={14} />
        清空账本
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-ledger-title"
        >
          <div className="w-full max-w-md border border-terminal-border bg-terminal-panel p-5 font-mono text-xs text-slate-200 shadow-2xl">
            <div className="mb-3 flex items-center gap-2 border-b border-terminal-border pb-2 text-terminal-red">
              <AlertTriangle size={16} />
              <span id="clear-ledger-title" className="text-sm font-semibold uppercase tracking-wide">清空账本</span>
            </div>
            <p className="mb-1">此操作将永久删除全部买入 / 卖出 / 流拍记录，持仓与盈亏统计随之清空，无法恢复。</p>
            <p className="mb-4 text-terminal-muted">清空后，游戏内 SavedVariables 中的旧记录也不会再导入。确定继续吗？</p>
            {error && <p className="mb-3 text-terminal-red">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded border border-terminal-border px-4 py-1.5 font-mono text-xs text-terminal-muted transition-colors hover:text-slate-200 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleClear}
                disabled={busy}
                className="rounded border border-terminal-red bg-terminal-red/10 px-4 py-1.5 font-mono text-xs text-terminal-red transition-colors hover:bg-terminal-red hover:text-white disabled:opacity-50"
              >
                {busy ? "清空中…" : "确认清空"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
