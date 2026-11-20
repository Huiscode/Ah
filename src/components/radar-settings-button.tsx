"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings } from "lucide-react";
import { categoryLabel } from "@/lib/category-zh";
import { useLang, useLL } from "@/components/lang-provider";

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
  const lang = useLang();
  const tr = useLL();
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
        .catch(() => setMessage(tr("Failed to load settings", "加载设置失败")));
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
          setMessage(data.error ?? tr("Save failed", "保存失败"));
          return;
        }
        router.refresh();
      } catch {
        setMessage(tr("Save failed", "保存失败"));
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
        title={tr("Radar filter settings (applies instantly)", "雷达筛选条件设置（改动即生效）")}
      >
        <Settings size={12} /> {tr("Settings", "设置")}
      </button>
      {open && (
        <div
          className="absolute right-0 z-30 mt-1 w-96 border border-terminal-border bg-terminal-panel2 p-3 font-mono text-xs shadow-lg"
          onMouseLeave={() => { setOpen(false); setMessage(null); }}
        >
          <div className="mb-2 text-[10px] uppercase tracking-wide text-terminal-muted">{tr("Filters (current list)", "筛选（当前列表过滤）")}</div>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center justify-between gap-3" title={tr("Filter the radar list by category", "按品类过滤雷达列表")}>
              <span className="text-terminal-muted">{tr("Category", "品类")}</span>
              <select
                value={filters.category}
                onChange={(event) => updateFilter("category", event.target.value)}
                className="min-w-[96px] border border-terminal-border bg-terminal-panel2 px-2 py-0.5 text-slate-100 focus:outline-none"
              >
                <option value="">{tr("All categories", "全部品类")}</option>
                {categories.map((value) => (
                  <option key={value} value={value}>{categoryLabel(value, lang)}</option>
                ))}
              </select>
            </label>
            {check(tr("High turnover only", "高流通"), "onlyLiquid", tr("Only items with a turnover score (used by N recipes); default sort is turnover descending", "只显示有流通分的商品（被 N 个配方使用），默认按流通分从高到低排列"))}
            {check(tr("Vendor flips only", "必赚"), "onlyVendor", tr("Only NPC vendor-flip rows (risk-free)", "只显示 NPC 倒卖行（必赚）"))}
            {filterField(tr("Listed qty ≥", "在售量 ≥"), "minQuantity", tr("Keep rows with total listed quantity ≥ this value; 0 = off", "只保留在售总量 ≥ 该值的行；0 = 关"))}
            {filterField(tr("Tier gap ≥ %", "价格档位差距 ≥ %"), "minTierGap", tr("Any two of the top five price tiers differ by ≥ this percent; 0 = off", "前五个价格档位中任意两档的价格差距百分比 ≥ 该值；0 = 关"))}
          </div>
          <div className="mb-2 mt-3 border-t border-terminal-border pt-3"></div>
          <div className="flex flex-col gap-1.5">
            {ruleField(tr("Min profit (copper)", "最低盈利（铜）"), "minProfit", tr("Rows with net profit (7d ref×0.95 − min buyout) below this never enter the radar", "净利（7日参考×0.95 − 最低买入价）低于此值不进雷达"))}
            {ruleField(tr("Min history (days)", "最少历史（天）"), "minHistory", tr("med7 needs more than N days of dailies to be meaningful", "med7 需要 N 天以上日线才有意义"))}
            {ruleField(tr("Ref credibility (distinct closes)", "参考可信度（不同收盘数）"), "minMed7Distinct", tr("At least N distinct closes inside the 7-day window (guards vs one camper's curve)", "7 日窗口内至少 N 个不同收盘价（防单人压价曲线）"))}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] text-terminal-muted">{tr("Applies instantly", "改动即生效")}</span>
            <span className="text-terminal-red">{message ?? ""}</span>
          </div>
          <div className="mt-1.5 text-[10px] text-terminal-muted">{tr("Vendor flips (NPC arbitrage) have no threshold and ignore the deal gates; the \"Vendor flips only\" switch controls display only.", "必赚（NPC 倒卖）无门槛，不受捡漏门槛影响；筛选的\"必赚\"开关只控制显示。")}</div>
        </div>
      )}
    </div>
  );
}
