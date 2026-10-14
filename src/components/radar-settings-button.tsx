"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings } from "lucide-react";
import { MoneyInput } from "@/components/money-input";

type FormState = {
  minProfit: string;
  minHistory: string;
  minMed7Distinct: string;
  staleWindowDays: string;
};

const FLOOR_KEY = "wah:filter:minPrice";

// 雷达条件设置：把 buildDealRadar 的阈值暴露为网页可调设置，保存到
// RadarRule 单行（/api/radar-rules）；价格下限是前端本地筛选（localStorage
// wah:filter:minPrice），与雷达表共用。鼠标移出面板自动关闭。
export function RadarSettingsButton() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [floorCopper, setFloorCopper] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    if (form === null) {
      fetch("/api/radar-rules")
        .then((res) => res.json())
        .then((data) => {
          setForm({
            minProfit: String(data.minProfit),
            minHistory: String(data.minHistory),
            minMed7Distinct: String(data.minMed7Distinct),
            staleWindowDays: String(data.staleWindowDays),
          });
        })
        .catch(() => setMessage("加载设置失败"));
    }
    try {
      const raw = localStorage.getItem(FLOOR_KEY);
      if (raw !== null) setFloorCopper(Number(JSON.parse(raw)) || 0);
    } catch {
      // 损坏的缓存保持当前值
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setMessage(null);
    try {
      // 价格下限：本地筛选，写 localStorage 并广播 storage 事件，
      // 雷达表（usePersistedState 同 key）即时应用。
      try {
        localStorage.setItem(FLOOR_KEY, JSON.stringify(floorCopper));
        window.dispatchEvent(new StorageEvent("storage", { key: FLOOR_KEY, newValue: JSON.stringify(floorCopper) }));
      } catch {
        // 写不进去时静默失败
      }
      const res = await fetch("/api/radar-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minProfit: Number(form.minProfit),
          minHistory: Number(form.minHistory),
          minMed7Distinct: Number(form.minMed7Distinct),
          staleWindowDays: Number(form.staleWindowDays),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "保存失败");
        return;
      }
      setMessage("已保存，雷达已按新条件重算");
      router.refresh();
    } catch {
      setMessage("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, key: keyof FormState, hint: string) => (
    <label className="flex items-center justify-between gap-3" title={hint}>
      <span className="text-terminal-muted">{label}</span>
      <input
        type="number"
        min={0}
        value={form?.[key] ?? ""}
        onChange={(event) => setForm((f) => (f ? { ...f, [key]: event.target.value } : f))}
        className="w-20 border border-terminal-border bg-terminal-panel2 px-2 py-0.5 text-right text-slate-100 focus:outline-none"
      />
    </label>
  );

  return (
    <div className="relative">
      <button
        onClick={() => { setOpen((o) => !o); setMessage(null); }}
        className="flex items-center gap-1 border border-terminal-border bg-terminal-panel2 px-2 py-1 text-slate-300 hover:text-slate-100"
        title="雷达筛选条件设置（保存到本地，立即生效）"
      >
        <Settings size={12} /> 设置
      </button>
      {open && (
        <div
          className="absolute right-0 z-30 mt-1 w-80 border border-terminal-border bg-terminal-panel2 p-3 font-mono text-xs shadow-lg"
          onMouseLeave={() => { setOpen(false); setMessage(null); }}
        >
          <div className="mb-2 text-[10px] uppercase tracking-wide text-terminal-muted">雷达条件（捡漏门槛）</div>
          <div className="flex flex-col gap-1.5">
            {field("最低盈利（铜）", "minProfit", "净利（7日参考×0.95 − 最低买入价）低于此值不进雷达")}
            {field("最少历史（天）", "minHistory", "med7 需要 N 天以上日线才有意义")}
            {field("参考可信度（不同收盘数）", "minMed7Distinct", "7 日窗口内至少 N 个不同收盘价（防单人压价曲线）")}
            {field("新鲜度（天）", "staleWindowDays", "最新观测超过 N 天视为过期，不进雷达")}
            <label className="flex items-center justify-between gap-3" title="只保留最低买入价 ≥ 该值的行；0 = 关">
              <span className="text-terminal-muted">价格下限</span>
              <MoneyInput value={floorCopper} onChange={setFloorCopper} fieldClass="bg-transparent text-right text-slate-100 focus:outline-none" />
            </label>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-terminal-green">{message ?? ""}</span>
            <button
              onClick={save}
              disabled={saving}
              className="border border-terminal-amber/70 bg-terminal-amber/10 px-3 py-1 text-terminal-amber hover:bg-terminal-amber/20 disabled:opacity-50"
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
          <div className="mt-1.5 text-[10px] text-terminal-muted">必赚（NPC 倒卖）无门槛，不受这些条件影响。</div>
        </div>
      )}
    </div>
  );
}
