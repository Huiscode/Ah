"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings } from "lucide-react";
import { categoryLabel } from "@/lib/category-zh";
import { useLang, useLL } from "@/components/lang-provider";
import { RADAR_FILTER_KEYS, type RadarFilterState } from "@/lib/radar-filters";
import { DEAL_KIND_LABELS } from "@/components/deal-radar-table";
import type { DealKind } from "@/lib/analytics";

// 雷达条件（后端规则，/api/radar-rules）。UI 用银为单位，存储/计算用铜。
type RuleKey = "vendorMinTotalProfit" | "flipMinUnitProfit" | "flipMinUnitRatio" | "flipMinTotalProfit" | "minHistory" | "minMed7Distinct";
const RULE_KEYS: RuleKey[] = ["vendorMinTotalProfit", "flipMinUnitProfit", "flipMinUnitRatio", "flipMinTotalProfit", "minHistory", "minMed7Distinct"];
const SILVER_RULES: RuleKey[] = ["vendorMinTotalProfit", "flipMinUnitProfit", "flipMinTotalProfit"];
type FormState = Record<RuleKey, string>;

type FilterForm = {
  strategy: string;
  category: string;
  minTotalProfitSilver: string;
  onlyLiquid: boolean;
  minQuantity: string;
  minTierGap: string;
};

const KINDS: DealKind[] = ["vendor", "flip", "cross", "band"];

// 雷达设置：两节。
//  ① 筛选（本地，localStorage + storage 广播）：策略/品类/总利润/高流通/在售量/档位差距——改动即生效
//  ② 进池条件（后端规则，/api/radar-rules）：输入停顿 600ms 自动提交
// 无保存按钮；鼠标移出面板自动关闭。
export function RadarSettingsButton({ categories }: { categories: string[] }) {
  const lang = useLang();
  const tr = useLL();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [filters, setFilters] = useState<FilterForm>({ strategy: "", category: "", minTotalProfitSilver: "0", onlyLiquid: false, minQuantity: "0", minTierGap: "0" });
  const [message, setMessage] = useState<string | null>(null);
  const postTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    if (form === null) {
      fetch("/api/radar-rules")
        .then((res) => res.json())
        .then((data: Record<RuleKey, number>) => {
          const next = {} as FormState;
          for (const key of RULE_KEYS) {
            next[key] = String(SILVER_RULES.includes(key) ? data[key] / 100 : data[key]);
          }
          setForm(next);
        })
        .catch(() => setMessage(tr("Failed to load settings", "加载设置失败")));
    }
    try {
      const read = (key: string): string => {
        const raw = localStorage.getItem(key);
        return raw === null ? "" : String(JSON.parse(raw));
      };
      setFilters({
        strategy: read(RADAR_FILTER_KEYS.strategy),
        category: read(RADAR_FILTER_KEYS.category),
        minTotalProfitSilver: read(RADAR_FILTER_KEYS.minTotalProfitSilver) || "0",
        onlyLiquid: localStorage.getItem(RADAR_FILTER_KEYS.onlyLiquid) === "true",
        minQuantity: read(RADAR_FILTER_KEYS.minQuantity) || "0",
        minTierGap: read(RADAR_FILTER_KEYS.minTierGap) || "0",
      });
    } catch {
      // 损坏的缓存保持当前值
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 本地筛选：改动即写入 localStorage 并广播，雷达表（usePersistedState 同 key）即时应用。
  // 注意：setState 的 updater 会在渲染阶段执行，绝不能在 updater 内 dispatchEvent。
  const updateFilter = (key: keyof FilterForm & keyof RadarFilterState, value: string | boolean) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    const storageKey = RADAR_FILTER_KEYS[key];
    try {
      localStorage.setItem(storageKey, JSON.stringify(next[key]));
      window.dispatchEvent(new StorageEvent("storage", { key: storageKey, newValue: JSON.stringify(next[key]), storageArea: localStorage }));
    } catch {
      // 写不进去时静默失败
    }
  };

  const schedulePost = (next: FormState) => {
    if (postTimer.current) clearTimeout(postTimer.current);
    setMessage(null);
    postTimer.current = setTimeout(async () => {
      const body: Record<string, number> = {};
      for (const key of RULE_KEYS) {
        const value = Number(next[key]);
        body[key] = SILVER_RULES.includes(key) ? Math.round(value * 100) : value;
      }
      try {
        const res = await fetch("/api/radar-rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
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

  const updateRule = (key: RuleKey, value: string) => {
    if (!form) return;
    const next = { ...form, [key]: value };
    setForm(next);
    schedulePost(next);
  };

  const inputClass = "w-20 border border-terminal-border bg-terminal-panel2 px-2 py-0.5 text-right text-slate-100 focus:outline-none";

  const ruleField = (label: string, key: RuleKey, hint: string) => (
    <label className="flex items-center justify-between gap-3" title={hint}>
      <span className="text-terminal-muted">{label}</span>
      <input type="number" min={0} value={form?.[key] ?? ""} onChange={(event) => updateRule(key, event.target.value)} className={inputClass} />
    </label>
  );

  const filterField = (label: string, key: "minTotalProfitSilver" | "minQuantity" | "minTierGap", hint: string) => (
    <label className="flex items-center justify-between gap-3" title={hint}>
      <span className="text-terminal-muted">{label}</span>
      <input type="number" min={0} value={filters[key]} onChange={(event) => updateFilter(key, event.target.value)} className={inputClass} />
    </label>
  );

  const selectClass = "min-w-[96px] border border-terminal-border bg-terminal-panel2 px-2 py-0.5 text-slate-100 focus:outline-none";

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
          className="absolute right-0 z-30 mt-1 w-[26rem] border border-terminal-border bg-terminal-panel2 p-3 font-mono text-xs shadow-lg"
          onMouseLeave={() => { setOpen(false); setMessage(null); }}
        >
          <div className="mb-2 text-[10px] uppercase tracking-wide text-terminal-muted">{tr("Filters (current list)", "筛选（当前列表过滤）")}</div>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center justify-between gap-3" title={tr("Vendor: buy below NPC price, sell to NPC. Flip: buy cheap tiers, relist under the next tier. Cross: buy here, sell in the other market. Band: volatile item below its 7-day band, sell back at the 7d ref.", "必赚：低于 NPC 收购价买入卖给 NPC；扫货：买下便宜档位、在下一档下方回挂；跨市场：这里买、另一市场卖；波段：高波动物品跌破 7 日带下沿，回到 7 日参考价卖出。")}>
              <span className="text-terminal-muted">{tr("Play", "策略")}</span>
              <select value={filters.strategy} onChange={(event) => updateFilter("strategy", event.target.value)} className={selectClass}>
                <option value="">{tr("All plays", "全部策略")}</option>
                {KINDS.map((kind) => (
                  <option key={kind} value={kind}>{tr(DEAL_KIND_LABELS[kind][0], DEAL_KIND_LABELS[kind][1])}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center justify-between gap-3" title={tr("Filter the radar list by category", "按品类过滤雷达列表")}>
              <span className="text-terminal-muted">{tr("Category", "品类")}</span>
              <select value={filters.category} onChange={(event) => updateFilter("category", event.target.value)} className={selectClass}>
                <option value="">{tr("All categories", "全部品类")}</option>
                {categories.map((value) => (
                  <option key={value} value={value}>{categoryLabel(value, lang)}</option>
                ))}
              </select>
            </label>
            {filterField(tr("Total profit ≥ (silver)", "总利润 ≥（银）"), "minTotalProfitSilver", tr("Keep rows whose total net profit is at least this; 0 = off", "只保留总净利 ≥ 该值的行；0 = 关"))}
            <label className="flex items-center justify-between gap-3" title={tr("Only items with a turnover score (used by N recipes)", "只显示有流通分的商品（被 N 个配方使用）")}>
              <span className="text-terminal-muted">{tr("High turnover only", "高流通")}</span>
              <input type="checkbox" checked={filters.onlyLiquid} onChange={(event) => updateFilter("onlyLiquid", event.target.checked)} className="h-3.5 w-3.5 accent-terminal-amber" />
            </label>
            {filterField(tr("Listed qty ≥", "在售量 ≥"), "minQuantity", tr("Keep rows with total listed quantity ≥ this value; 0 = off", "只保留在售总量 ≥ 该值的行；0 = 关"))}
            {filterField(tr("Tier gap ≥ %", "价格档位差距 ≥ %"), "minTierGap", tr("Lowest vs 5th-lowest price tier differ by ≥ this percent; 0 = off", "前五档里最低档与第五档的价差 ≥ 该百分比；0 = 关"))}
          </div>
          <div className="mb-2 mt-3 border-t border-terminal-border pt-3 text-[10px] uppercase tracking-wide text-terminal-muted">{tr("Entry rules (who enters the radar)", "进池条件（决定谁进雷达）")}</div>
          <div className="flex flex-col gap-1.5">
            {ruleField(tr("Vendor: min total (silver)", "必赚：总利润 ≥（银）"), "vendorMinTotalProfit", tr("Sum over all listings below the NPC price", "所有低于 NPC 收购价的档位合计"))}
            {ruleField(tr("Flip/Cross: min unit (silver)", "扫货/跨市场：单件 ≥（银）"), "flipMinUnitProfit", tr("Net per unit after the 5% AH cut", "扣 5% 拍卖行税后的单件净利"))}
            {ruleField(tr("Flip/Cross: min unit % of buy", "扫货/跨市场：单件 ≥ 买价 %"), "flipMinUnitRatio", tr("Unit profit must also be at least this share of the buy price", "单件净利还必须 ≥ 买入价的该百分比"))}
            {ruleField(tr("Flip/Cross: min total (silver)", "扫货/跨市场：总利润 ≥（银）"), "flipMinTotalProfit", tr("Checked only when real price tiers are known", "只在有前五档真实档位时校验"))}
            {ruleField(tr("Min history (days)", "最少历史（天）"), "minHistory", tr("7d reference needs at least N daily closes", "7 日参考至少需要 N 天日线"))}
            {ruleField(tr("Ref credibility (distinct closes)", "参考可信度（不同收盘数）"), "minMed7Distinct", tr("At least N distinct closes inside the 7-day window (guards vs one camper's curve)", "7 日窗口内至少 N 个不同收盘价（防单人压价曲线）"))}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] text-terminal-muted">{tr("Applies instantly", "改动即生效")}</span>
            <span className="text-terminal-red">{message ?? ""}</span>
          </div>
        </div>
      )}
    </div>
  );
}
