"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { usePersistedState } from "@/lib/use-persisted-state";
import { MoneyInput } from "@/components/money-input";

export type RadarRules = Record<string, unknown>;

export function RadarParamsPanel({ initialRules }: { initialRules: RadarRules }) {
  const [open, setOpen] = usePersistedState<boolean>("wah:radar-panel:open", true);
  const [minPrice, setMinPrice] = usePersistedState<number>("wah:filter:minPrice", 0);
  const [maxPrice, setMaxPrice] = usePersistedState<number>("wah:filter:maxPrice", 0);
  const [gap1Pct, setGap1Pct] = usePersistedState<number>("wah:filter:gap1", 0);
  const [gap2Pct, setGap2Pct] = usePersistedState<number>("wah:filter:gap2", 0);
  const [vendorMinProfit, setVendorMinProfit] = usePersistedState<number>("wah:filter:vendorMinProfit", 0);

  const field = "rounded border border-terminal-border bg-terminal-panel2 px-2 py-1 text-right text-slate-100 focus:border-terminal-amber focus:outline-none";
  const row = "flex items-center justify-between gap-3 py-1.5 border-b border-terminal-border/40 last:border-0";

  const notify = () => setTimeout(() => window.dispatchEvent(new Event("wah:filter")), 100);

  if (!open) {
    return (
      <Panel>
        <PanelHeader
          title="捡漏池筛选"
          action={
            <button onClick={() => setOpen(true)} aria-label="展开" className="text-terminal-muted hover:text-terminal-amber">
              <Eye size={13} />
            </button>
          }
        />
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader
        title="捡漏池筛选"
        action={
          <button onClick={() => setOpen(false)} aria-label="收起" className="text-terminal-muted hover:text-terminal-amber">
            <EyeOff size={13} />
          </button>
        }
      />
      <div className="space-y-0 p-3 font-mono text-xs">
        <div className={row}>
          <span className="text-slate-100">价格下限 (0=关)</span>
          <MoneyInput value={minPrice} onChange={(v) => { setMinPrice(v); notify(); }} fieldClass={field} />
        </div>
        <div className={row}>
          <span className="text-slate-100">价格上限 (0=关)</span>
          <MoneyInput value={maxPrice} onChange={(v) => { setMaxPrice(v); notify(); }} fieldClass={field} />
        </div>
        <div className={row}>
          <span className="text-slate-100">价格1比2低 (%)</span>
          <input type="number" min="0" className={field + " w-20"} value={gap1Pct} onChange={(e) => { setGap1Pct(Number(e.target.value) || 0); notify(); }} />
        </div>
        <div className={row}>
          <span className="text-slate-100">价格2比3低 (%)</span>
          <input type="number" min="0" className={field + " w-20"} value={gap2Pct} onChange={(e) => { setGap2Pct(Number(e.target.value) || 0); notify(); }} />
        </div>
        <div className={row}>
          <span className="text-slate-100">必赚最低盈利 (0=关)</span>
          <MoneyInput value={vendorMinProfit} onChange={(v) => { setVendorMinProfit(v); notify(); }} fieldClass={field} />
        </div>
        <p className="pt-2 text-[10px] leading-relaxed text-terminal-muted">
          所有条件仅对本地数据库的捡漏池做筛选。必赚最低盈利只过滤必赚 行。
        </p>
      </div>
    </Panel>
  );
}