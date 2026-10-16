"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings } from "lucide-react";
import { categoryLabel } from "@/lib/category-zh";

type FormState = {
  minProfit: string;
  minHistory: string;
  minMed7Distinct: string;
};

type FilterState = {
  category: string;
  onlyLiquid: boolean;
  onlyVendor: boolean;
  minQuantity: string;
  minTierGap: string;
};

const FILTER_KEYS: Record<keyof FilterState, string> = {
  category: "wah:deal-radar:category",
  onlyLiquid: "wah:deal-radar:onlyLiquid",
  onlyVendor: "wah:deal-radar:onlyVendor",
  minQuantity: "wah:deal-radar:minQuantity",
  minTierGap: "wah:deal-radar:minTierGap",
};

// 雷达设置：两节。
//  ① 筛选（本地，localStorage + storage 广播）：品类/高流通/必赚/在售量/价格档位——改动即生效
//  ② 雷达条件（后端规则，/api/radar-rules）：最低盈利/最少历史/参考可信度——输入停顿 600ms 自动提交
// 无保存按钮；鼠标移出面板自动关闭。
export function RadarSettingsButton({ categories }: { categories: string[] }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [filters, setFilters] = useState<FilterState>({ category: "", onlyLiquid: false, onlyVendor: false, minQuantity: "0", minTierGap: "0" });
  const [message, setMessage] = useState<string | null>(null);
  const postTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
          });
        })
        .catch(() => setMessage("加载设置失败"));
    }
    try {
      const read = (key: string): string => {
        const raw = localStorage.getItem(key);
        return raw === null ? "" : (JSON.parse(raw) as string);
      };
      setFilters({
        category: read(FILTER_KEYS.category),
        onlyLiquid: localStorage.getItem(FILTER_KEYS.onlyLiquid) === "true",
        onlyVendor: localStorage.getItem(FILTER_KEYS.onlyVendor) === "true",
        minQuantity: read(FILTER_KEYS.minQuantity) || "0",
        minTierGap: read(FILTER_KEYS.minTierGap) || "0",
      });
    } catch {
      // 损坏的缓存保持当前值
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 本地筛选：改动即写入 localStorage 并广播，雷达表（usePersistedState 同 key）即时应用。
  // 注意：setState 的 updater 会在渲染阶段执行，绝不能在 updater 内 dispatchEvent（会
  // 同步触发其他组件的 setState 导致 "Cannot update a component while rendering"）。
  const updateFilter = (key: keyof FilterState, value: string | boolean) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    const storageKey = FILTER_KEYS[key];
    try {
      localStorage.setItem(storageKey, JSON.stringify(next[key]));
      window.dispatchEvent(new StorageEvent("storage", { key: storageKey, newValue: JSON.stringify(next[key]), storageArea: localStorage }));
    } catch {
      // 写不进去时静默失败
    }
  };

  // 雷达条件：输入停顿 600ms 自动提交并重算雷达池（无需保存按钮）。
  const schedulePost = (next: FormState) => {
    if (postTimer.current) clearTimeout(postTimer.current);
    setMessage(null);
    postTimer.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/radar-rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            minProfit: Number(next.minProfit),
            minHistory: Number(next.minHistory),
            minMed7Distinct: Number(next.minMed7Distinct),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setMessage(data.error ?? "保存失败");
          return;
        }
        router.refresh();
      } catch {
        setMessage("保存失败");
      }
    }, 600);
  };

  const updateRule = (key: keyof FormState, value: string) => {
    if (!form) return;
    const next = { ...form, [key]: value };
    setForm(next);
    schedulePost(next);
  };

  const ruleField = (label: string, key: keyof FormState, hint: string) => (
    <label className="flex items-center justify-between gap-3" title={hint}>
      <span className="text-terminal-muted">{label}</span>
      <input
        type="number"
        min={0}
        value={form?.[key] ?? ""}
        onChange={(event) => updateRule(key, event.target.value)}
        className="w-20 border border-terminal-border bg-terminal-panel2 px-2 py-0.5 text-right text-slate-100 focus:outline-none"
      />
    </label>
  );

  const filterField = (label: string, key: "minQuantity" | "minTierGap", hint: string) => (
    <label className="flex items-center justify-between gap-3" title={hint}>
      <span className="text-terminal-muted">{label}</span>
      <input
        type="number"
        min={0}
        value={filters[key]}
        onChange={(event) => updateFilter(key, event.target.value)}
        className="w-20 border border-terminal-border bg-terminal-panel2 px-2 py-0.5 text-right text-slate-100 focus:outline-none"
      />
    </label>
  );

  const check = (label: string, key: "onlyLiquid" | "onlyVendor", hint: string) => (
    <label className="flex items-center justify-between gap-3" title={hint}>
      <span className="text-terminal-muted">{label}</span>
      <input
        type="checkbox"
        checked={filters[key]}
        onChange={(event) => updateFilter(key, event.target.checked)}
        className="h-3.5 w-3.5 accent-terminal-amber"
      />
    </label>
  );

  return (
    <div className="relative">
      <button
        onClick={() => { setOpen((o) => !o); setMessage(null); }}
        className="flex items-center gap-1 border border-terminal-border bg-terminal-panel2 px-2 py-1 text-slate-300 hover:text-slate-100"
        title="雷达筛选条件设置（改动即生效）"
      >
        <Settings size={12} /> 设置
      </button>
      {open && (
        <div
          className="absolute right-0 z-30 mt-1 w-96 border border-terminal-border bg-terminal-panel2 p-3 font-mono text-xs shadow-lg"
          onMouseLeave={() => { setOpen(false); setMessage(null); }}
        >
          <div className="mb-2 text-[10px] uppercase tracking-wide text-terminal-muted">筛选（当前列表过滤）</div>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center justify-between gap-3" title="按品类过滤雷达列表">
              <span className="text-terminal-muted">品类</span>
              <select
                value={filters.category}
                onChange={(event) => updateFilter("category", event.target.value)}
                className="min-w-[96px] border border-terminal-border bg-terminal-panel2 px-2 py-0.5 text-slate-100 focus:outline-none"
              >
                <option value="">全部品类</option>
                {categories.map((value) => (
                  <option key={value} value={value}>{categoryLabel(value)}</option>
                ))}
              </select>
            </label>
            {check("高流通", "onlyLiquid", "只显示有流通分的商品（被 N 个配方使用），默认按流通分从高到低排列")}
            {check("必赚", "onlyVendor", "只显示 NPC 倒卖行（必赚）")}
            {filterField("在售量 ≥", "minQuantity", "只保留在售总量 ≥ 该值的行；0 = 关")}
            {filterField("价格档位差距 ≥ %", "minTierGap", "前五个价格档位中任意两档的价格差距百分比 ≥ 该值；0 = 关")}
          </div>
          <div className="mb-2 mt-3 border-t border-terminal-border pt-3"></div>
          <div className="flex flex-col gap-1.5">
            {ruleField("最低盈利（铜）", "minProfit", "净利（7日参考×0.95 − 最低买入价）低于此值不进雷达")}
            {ruleField("最少历史（天）", "minHistory", "med7 需要 N 天以上日线才有意义")}
            {ruleField("参考可信度（不同收盘数）", "minMed7Distinct", "7 日窗口内至少 N 个不同收盘价（防单人压价曲线）")}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] text-terminal-muted">改动即生效</span>
            <span className="text-terminal-red">{message ?? ""}</span>
          </div>
          <div className="mt-1.5 text-[10px] text-terminal-muted">必赚（NPC 倒卖）无门槛，不受捡漏门槛影响；筛选的"必赚"开关只控制显示。</div>
        </div>
      )}
    </div>
  );
}
