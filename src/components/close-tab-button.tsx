"use client";

export function CloseTabButton() {
  return (
    <button
      onClick={() => window.close()}
      title="关闭标签页"
      className="rounded border border-terminal-border bg-terminal-panel2 px-5 py-2 font-mono text-sm text-terminal-muted hover:text-terminal-red hover:border-terminal-red transition-colors"
    >
      关闭
    </button>
  );
}
