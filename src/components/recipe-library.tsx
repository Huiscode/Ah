"use client";

import { useMemo, useState } from "react";
import { Hammer, Search } from "lucide-react";
import type { RecipeProfitRow } from "@/lib/recipe-profits";
import { professionLabel, categoryLabel } from "@/lib/recipe-profits";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { formatPercent } from "@/lib/utils";
import { CopperAmount } from "@/components/copper-amount";
import { ProductBadge } from "@/components/product-badge";
import { AddToListButton } from "@/components/add-to-list-button";
import { usePersistedState } from "@/lib/use-persisted-state";
import { useLang, useLL } from "@/components/lang-provider";

// Unambiguous compact copper: 193 -> "1g93c", -113 -> "-1s13c".
function fmtCopper(copper: number): string {
  const sign = copper < 0 ? "-" : "";
  const abs = Math.abs(copper);
  const g = Math.floor(abs / 10000);
  const s = Math.floor((abs % 10000) / 100);
  const c = abs % 100;
  const parts: string[] = [];
  if (g > 0) parts.push(`${g}g`);
  if (s > 0) parts.push(`${s}s`);
  if (c > 0 || parts.length === 0) parts.push(`${c}c`);
  return sign + parts.join("");
}

const QUALITY_NAMES = ["", "普通", "优秀", "精良", "史诗", "传说", "神器", "传家宝"];
// 魔兽物品品质标准色：普通白 / 优秀绿 / 精良蓝 / 史诗紫 / 传说橙。
const QUALITY_COLORS = [
  "",
  "text-slate-300",
  "text-terminal-green",
  "text-sky-400",
  "text-purple-400",
  "text-orange-400",
  "",
  ""
];

// 来源/专业/分类的持久化筛选值改用稳定代码（localStorage 里可能还有旧中文值，
// normalizeXxx 兼容映射，写回时统一写代码）。
type SourceFilter = "all" | "craft" | "merchant";
const normalizeSource = (v: string): SourceFilter =>
  v === "craft" || v === "专业配方" ? "craft" : v === "merchant" || v === "商人兑换" ? "merchant" : "all";
const normalizeAllToken = (v: string): string => (v === "全部" ? "all" : v);

type SortKey = "profit" | "skillAsc" | "skillDesc" | "name";
// 收藏配方：localStorage 共享 key（首页"关注配方"面板读取同一份）。
type FavoriteKey = { category: string; profession: string; name: string };
const FAVORITES_KEY = "wah:favorite-recipes";

// 技能等级档（入门技能等级口径，经典 60 级标准）。
const SKILL_BANDS: Array<{ key: string; label: string; test: (level: number) => boolean }> = [
  { key: "all", label: "Any", test: () => true },
  { key: "1-75", label: "1-75", test: (l) => l >= 1 && l <= 75 },
  { key: "76-150", label: "76-150", test: (l) => l >= 76 && l <= 150 },
  { key: "151-225", label: "151-225", test: (l) => l >= 151 && l <= 225 },
  { key: "226-300", label: "226-300", test: (l) => l >= 226 && l <= 300 },
  { key: "301+", label: "301+", test: (l) => l >= 301 }
];

const PAGE_SIZE = 20;

// 专业 tab 固定顺序（经典 60 级专业顺序）：
// 炼金→锻造→附魔→工程→制皮→裁缝→采矿→草药→剥皮→烹饪→钓鱼→急救。
// 未出现在列表中的专业（如"贸易通用"）自动排到最后，再按拼音兜底。
const PROFESSION_ORDER = [
  "Alchemy",        // 炼金术
  "Blacksmithing",  // 锻造
  "Enchanting",     // 附魔
  "Engineering",    // 工程学
  "Leatherworking", // 制皮
  "Tailoring",      // 裁缝
  "Mining",         // 采矿
  "Herbalism",      // 草药学
  "Skinning",       // 剥皮
  "Cooking",        // 烹饪
  "Fishing",        // 钓鱼
  "First Aid"       // 急救
];

// 配方库（独立页面）：专业配方页——来源/专业 tab 横条、
// 左侧技能等级+分类筛选、搜索框、排序、两列卡片网格、分页。卡片保留本项目
// 的核心增值：利润率与利润额（绿色/红色），缺价配方排最后并标"缺价"。
export function RecipeLibrary({ rows, lists, marketAvailable = true }: { rows: RecipeProfitRow[]; lists: Array<{ id: string; name: string }>; marketAvailable?: boolean }) {
  const lang = useLang();
  const tr = useLL();
  const [sourceRaw, setSource] = usePersistedState<SourceFilter>("wah:recipes:source", "all");
  const source = normalizeSource(sourceRaw);
  // 筛选状态持久化：刷新后保留用户上次选的专业/技能档/分类/搜索/排序。
  const [professionRaw, setProfession] = usePersistedState<string>("wah:recipes:profession", "all");
  const profession = normalizeAllToken(professionRaw);
  const [skillBand, setSkillBand] = usePersistedState<string>("wah:recipes:skillBand", "all");
  const [categoryRaw, setCategory] = usePersistedState<string>("wah:recipes:category", "all");
  const category = normalizeAllToken(categoryRaw);
  const [query, setQuery] = usePersistedState<string>("wah:recipes:query", "");
  const [sort, setSort] = usePersistedState<SortKey>("wah:recipes:sort", "profit");
  // 配方筛选条件（排序下拉右侧）：材料总价上限（g/s/c）+ 最小利润（%）。
  // 留空即不过滤；缺价配方无法满足价格条件，激活任一筛选时自动排除。
  const [costMax, setCostMax] = usePersistedState<{ g: string; s: string; c: string }>("wah:recipes:costMax", { g: "", s: "", c: "" });
  const [minMargin, setMinMargin] = usePersistedState<string>("wah:recipes:minMargin", "");
  // 当前等级（按专业分别持久化）：选专业后输入如 223 → 只显示该等级已可学
  // （skillLevel ≤ 等级）的配方，并按难度阈值（学会/黄/绿/灰）给行加色徽。
  const [myLevels, setMyLevels] = usePersistedState<Record<string, string>>("wah:recipes:myLevel", {});
  const [page, setPage] = useState(1);
  // 收藏的配方（首页"关注配方"面板读取同一份 localStorage）。
  const [favorites, setFavorites] = usePersistedState<FavoriteKey[]>(FAVORITES_KEY, []);

  const locale = lang === "zh" ? "zh-CN" : "en";
  const nameCompare = (a: string, b: string) => a.localeCompare(b, locale);

  const isFavorite = (row: RecipeProfitRow): boolean =>
    favorites.some(
      (f) =>
        f.category === (row.recipe.category ?? "") &&
        f.profession === row.recipe.profession &&
        f.name === row.recipe.name
    );

  const toggleFavorite = (row: RecipeProfitRow) => {
    const key: FavoriteKey = { category: row.recipe.category ?? "", profession: row.recipe.profession, name: row.recipe.name };
    setFavorites((prev) =>
      isFavorite(row)
        ? prev.filter((f) => !(f.category === key.category && f.profession === key.profession && f.name === key.name))
        : [...prev, key]
    );
  };

  const bySource = useMemo(() => {
    const craft: RecipeProfitRow[] = [];
    const merchant: RecipeProfitRow[] = [];
    for (const row of rows) {
      (row.recipe.category === "merchant" ? merchant : craft).push(row);
    }
    return { craft, merchant };
  }, [rows]);

  const baseRows = useMemo(
    () => (source === "all" ? rows : source === "craft" ? bySource.craft : bySource.merchant),
    [rows, bySource, source]
  );

  const professions = useMemo(() => {
    const seen = new Set<string>();
    for (const row of baseRows) if (row.recipe.profession) seen.add(row.recipe.profession);
    const order = new Map(PROFESSION_ORDER.map((p, i) => [p, i]));
    return Array.from(seen).sort(
      (a, b) =>
        (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER) ||
        nameCompare(a, b)
    );
  }, [baseRows, lang]);

  // 默认"all"，无空值回退。
  const effectiveProfession = profession;
  const activeLevel = effectiveProfession !== "all" ? Number.parseInt(myLevels[effectiveProfession] ?? "", 10) || 0 : 0;

  // 来源+专业+技能档+当前等级 → 分类计数（左栏）。切换专业/技能档时回到第一页。
  // 当前等级过滤：只保留已可学（skillLevel ≤ 等级）的配方；无阈值数据的行
  // （skillLevel=0，如商人兑换）不受等级过滤影响。
  const scopeRows = useMemo(
    () =>
      baseRows.filter(
        (row) =>
          (effectiveProfession === "all" || row.recipe.profession === effectiveProfession) &&
          SKILL_BANDS.find((band) => band.key === skillBand)!.test(row.recipe.skillLevel) &&
          (!activeLevel || row.recipe.skillLevel <= activeLevel)
      ),
    [baseRows, effectiveProfession, skillBand, activeLevel]
  );

  // 等级色徽：当前等级落在难度区间（学会/黄/绿/灰）的位置决定涨点颜色。
  const diffBadge = (row: RecipeProfitRow): { text: string; cls: string; tip: string } | null => {
    if (!activeLevel) return null;
    const d = row.recipe.difficulty;
    if (!d || d.length < 4) return null;
    if (activeLevel < d[1]) return { text: tr("O", "橙"), cls: "text-[#ff8000]", tip: tr(`Level ${activeLevel}: guaranteed skill-up`, `等级${activeLevel}：必涨点`) };
    if (activeLevel < d[2]) return { text: tr("Y", "黄"), cls: "text-[#ffd100]", tip: tr(`Level ${activeLevel}: likely skill-up`, `等级${activeLevel}：较易涨点`) };
    if (activeLevel < d[3]) return { text: tr("G", "绿"), cls: "text-[#3ddc5f]", tip: tr(`Level ${activeLevel}: occasional skill-up`, `等级${activeLevel}：偶尔涨点`) };
    return { text: tr("—", "灰"), cls: "text-terminal-muted", tip: tr(`Level ${activeLevel}: no more skill-ups`, `等级${activeLevel}：不再涨点`) };
  };

  const merchantLabel = () => tr("Merchant exchange", "商人兑换");
  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const row of scopeRows) {
      const name = row.recipe.categoryName || (row.recipe.category === "merchant" ? merchantLabel() : tr("Uncategorized", "未分类"));
      seen.add(name);
    }
    return Array.from(seen).sort(nameCompare);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeRows, lang]);

  const countForBand = (band: string) =>
    baseRows.filter(
      (row) =>
        (effectiveProfession === "all" || row.recipe.profession === effectiveProfession) &&
        SKILL_BANDS.find((b) => b.key === band)!.test(row.recipe.skillLevel)
    ).length;
  const countForCategory = (name: string) =>
    scopeRows.filter(
      (row) => (row.recipe.categoryName || (row.recipe.category === "merchant" ? merchantLabel() : tr("Uncategorized", "未分类"))) === name
    ).length;

  // 搜索：成品名（中文标识名或显示名）/ 成品物品ID / 材料名。
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scopeRows;
    return scopeRows.filter((row) => {
      if (row.recipe.name.toLowerCase().includes(q)) return true;
      if (row.recipe.displayName && row.recipe.displayName.toLowerCase().includes(q)) return true;
      if (row.recipe.outputs.some((o) => String(o.itemId).includes(q))) return true;
      if (row.recipe.reagents.some((m) => m.name.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [scopeRows, query]);

  const filtered = useMemo(() => {
    if (category === "all") return searched;
    const target = category;
    return searched.filter(
      (row) => (row.recipe.categoryName || (row.recipe.category === "merchant" ? merchantLabel() : tr("Uncategorized", "未分类"))) === target
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searched, category, lang]);

  // 价格/利润筛选：材料总价 ≤ g/s/c 上限 且 盈利百分比 ≥ 最小值。
  // 任一条件激活时排除缺价行（材料成本不完整）；cost-only（附魔）有成本，
  // 参与材料总价筛选，但不参与利润率筛选。
  const costLimitCopper = useMemo(() => {
    const g = Number.parseInt(costMax.g || "0", 10) || 0;
    const s = Number.parseInt(costMax.s || "0", 10) || 0;
    const c = Number.parseInt(costMax.c || "0", 10) || 0;
    return g * 10000 + s * 100 + c;
  }, [costMax]);
  const costFilterActive = costMax.g !== "" || costMax.s !== "" || costMax.c !== "";
  const marginLimit = minMargin.trim() === "" || Number.isNaN(Number(minMargin)) ? null : Number(minMargin);
  const priced = useMemo(() => {
    if (!costFilterActive && marginLimit === null) return filtered;
    return filtered.filter((row) => {
      if (row.status === "missing") return false;
      if (costFilterActive && row.cost > costLimitCopper) return false;
      if (marginLimit !== null && marketAvailable && row.status === "ok" && row.marginPercent < marginLimit) return false;
      return true;
    });
  }, [filtered, costFilterActive, costLimitCopper, marginLimit]);

  const sorted = useMemo(() => {
    const arr = [...priced];
    const rank: Record<string, number> = { ok: 0, "cost-only": 1, missing: 2 };
    switch (sort) {
      case "profit":
        if (!marketAvailable) return arr.sort((a, b) => nameCompare(a.recipe.name, b.recipe.name));
        return arr.sort((a, b) => {
          if (a.status !== b.status) return rank[a.status] - rank[b.status];
          if (a.status === "ok") return b.marginPercent - a.marginPercent;
          if (a.status === "cost-only") return a.cost - b.cost;
          return nameCompare(a.recipe.name, b.recipe.name);
        });
      case "skillAsc":
        return arr.sort((a, b) => a.recipe.skillLevel - b.recipe.skillLevel || nameCompare(a.recipe.name, b.recipe.name));
      case "skillDesc":
        return arr.sort((a, b) => b.recipe.skillLevel - a.recipe.skillLevel || nameCompare(a.recipe.name, b.recipe.name));
      case "name":
        return arr.sort((a, b) => nameCompare(a.recipe.name, b.recipe.name));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priced, sort, lang]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const shown = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const sourceTabs: Array<{ key: SourceFilter; label: string; count: number }> = [
    { key: "all", label: tr("All", "全部"), count: rows.length },
    { key: "craft", label: tr("Craft recipes", "专业配方"), count: bySource.craft.length },
    { key: "merchant", label: tr("Merchant exchanges", "商人兑换"), count: bySource.merchant.length }
  ];

  const selectSource = (key: SourceFilter) => {
    setSource(key);
    setProfession("all"); // 回到"all"
    setSkillBand("all");
    setCategory("all");
    setPage(1);
  };

  const difficultyLabel = (row: RecipeProfitRow): string => {
    const d = row.recipe.difficulty;
    if (!d || d.length < 4) return "";
    const parts: string[] = [];
    if (d[0] > 0) parts.push(`${d[0]}`);
    if (d[1] > 0) parts.push(`${d[1]}`);
    if (d[2] > 0) parts.push(`${d[2]}`);
    if (d[3] > 0) parts.push(`${d[3]}`);
    return parts.join(" ");
  };

  return (
    <Panel>
      <PanelHeader
        title={tr("Recipes", "配方库")}
        action={
          <span className="flex items-center gap-2 font-mono text-[10px] text-terminal-muted">
            <Hammer size={13} className="text-terminal-muted" />
            {tr(`${rows.length} total`, `共 ${rows.length} 条`)} · {marketAvailable ? <>{tr(`${rows.filter((row) => row.status === "ok").length} with profit`, `可算利润 ${rows.filter((row) => row.status === "ok").length} 条`)} · {tr(`${rows.filter((row) => row.status === "cost-only").length} enchant-cost`, `附魔成本 ${rows.filter((row) => row.status === "cost-only").length} 条`)}</> : <>{tr("No market data on this server — profit calc unavailable", "本服务器暂无行情，利润计算不可用")}</>} · {tr(`${favorites.length} starred`, `已收藏 ${favorites.length} 条`)}
          </span>
        }
      />

      {/* 来源 tab */}
      <div className="flex flex-wrap gap-1 border-b border-terminal-border px-3 py-2">
        {sourceTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => selectSource(tab.key)}
            className={`px-2 py-0.5 font-mono text-[10px] outline-none transition-colors ${
              source === tab.key
                ? "bg-terminal-amber text-terminal-bg"
                : "border border-terminal-border text-terminal-muted hover:text-slate-200"
            }`}
          >
            {tab.label} <span className="opacity-70">{tab.count}</span>
          </button>
        ))}
      </div>

      {/* 专业 tab（横条；默认"全部"） */}
      <div className="flex flex-wrap gap-1 border-b border-terminal-border px-3 py-2">
        <button
          key="all"
          type="button"
          onClick={() => { setProfession("all"); setSkillBand("all"); setCategory("all"); setPage(1); }}
          className={`px-2 py-0.5 font-mono text-[10px] outline-none transition-colors ${
            effectiveProfession === "all"
              ? "bg-terminal-amber text-terminal-bg"
              : "border border-terminal-border text-terminal-muted hover:text-slate-200"
          }`}
        >
          {tr("All", "全部")} <span className="opacity-70">{baseRows.length}</span>
        </button>
        {professions.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => { setProfession(name); setSkillBand("all"); setCategory("all"); setPage(1); }}
            className={`px-2 py-0.5 font-mono text-[10px] outline-none transition-colors ${
              effectiveProfession === name
                ? "bg-terminal-amber text-terminal-bg"
                : "border border-terminal-border text-terminal-muted hover:text-slate-200"
            }`}
          >
            {professionLabel(name, lang)} <span className="opacity-70">{baseRows.filter((r) => r.recipe.profession === name).length}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 p-3 lg:flex-row">
        {/* 左栏：技能等级 + 分类 */}
        <aside className="w-full shrink-0 font-mono text-[10px] lg:w-44">
          <div className="mb-1 text-terminal-muted">{tr("My level", "当前等级")}</div>
          <input
            type="number"
            min={1}
            max={300}
            inputMode="numeric"
            value={effectiveProfession === "all" ? "" : myLevels[effectiveProfession] ?? ""}
            disabled={effectiveProfession === "all"}
            onChange={(event) => {
              const n = Number.parseInt(event.target.value, 10);
              const v = Number.isNaN(n) ? event.target.value : String(Math.min(Math.max(n, 1), 300));
              setMyLevels((prev) => ({ ...prev, [effectiveProfession]: v }));
              setPage(1);
            }}
            placeholder={effectiveProfession === "all" ? tr("pick a profession first", "先选专业") : "1-300"}
            className="mb-3 w-full border border-terminal-border bg-terminal-panel2 px-2 py-1 text-slate-100 placeholder:text-terminal-muted/70 focus:outline-none disabled:opacity-50"
          />
          <div className="mb-1 text-terminal-muted">{tr("Skill level", "技能等级")}</div>
          <div className="mb-3 flex flex-wrap gap-1 lg:flex-col">
            <button
              key="band-all"
              type="button"
              onClick={() => { setSkillBand("all"); setCategory("all"); setPage(1); }}
              className={`px-2 py-0.5 text-left outline-none transition-colors ${
                skillBand === "all"
                  ? "bg-terminal-amber/90 text-terminal-bg"
                  : "border border-terminal-border text-terminal-muted hover:text-slate-200"
              }`}
            >
              {tr("Any", "不限")} <span className="opacity-70">{countForBand("all")}</span>
            </button>
            {SKILL_BANDS.filter((band) => band.key !== "all").map((band) => (
              <button
                key={band.key}
                type="button"
                onClick={() => { setSkillBand(band.key); setCategory("all"); setPage(1); }}
                className={`px-2 py-0.5 text-left outline-none transition-colors ${
                  skillBand === band.key
                    ? "bg-terminal-amber/90 text-terminal-bg"
                    : "border border-terminal-border text-terminal-muted hover:text-slate-200"
                }`}
              >
                {band.label} <span className="opacity-70">{countForBand(band.key)}</span>
              </button>
            ))}
          </div>
          <div className="mb-1 text-terminal-muted">{tr("Category", "分类")}</div>
          <div className="flex max-h-64 flex-wrap gap-1 overflow-y-auto lg:flex-col">
            <button
              key="cat-all"
              type="button"
              onClick={() => { setCategory("all"); setPage(1); }}
              className={`px-2 py-0.5 text-left outline-none transition-colors ${
                category === "all"
                  ? "bg-terminal-amber/90 text-terminal-bg"
                  : "border border-terminal-border text-terminal-muted hover:text-slate-200"
              }`}
            >
              {tr("All", "全部")} <span className="opacity-70">{scopeRows.length}</span>
            </button>
            {categories.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => { setCategory(name); setPage(1); }}
                className={`px-2 py-0.5 text-left outline-none transition-colors ${
                  category === name
                    ? "bg-terminal-amber/90 text-terminal-bg"
                    : "border border-terminal-border text-terminal-muted hover:text-slate-200"
                }`}
              >
                {name} <span className="opacity-70">{countForCategory(name)}</span>
              </button>
            ))}
          </div>
        </aside>

        {/* 主区：工具条 + 卡片网格 + 分页 */}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2 font-mono text-[10px]">
            <div className="relative flex items-center">
              <Search size={12} className="pointer-events-none absolute left-2 text-terminal-muted" />
              <input
                type="text"
                value={query}
                onChange={(event) => { setQuery(event.target.value); setPage(1); }}
                placeholder={tr("Search product / item ID…", "搜成品名 / 物品ID…")}
                className="w-44 border border-terminal-border bg-terminal-bg py-1 pl-6 pr-2 text-[10px] text-slate-200 outline-none placeholder:text-terminal-muted focus:border-terminal-amber/60"
              />
            </div>
            <select
              value={sort}
              onChange={(event) => { setSort(event.target.value as SortKey); setPage(1); }}
              className="border border-terminal-border bg-terminal-bg px-1 py-1 text-[10px] text-terminal-muted outline-none"
            >
              <option value="profit">{tr("Margin high→low", "利润率 高→低")}</option>
              <option value="skillAsc">{tr("Skill low→high", "技能 低→高")}</option>
              <option value="skillDesc">{tr("Skill high→low", "技能 高→低")}</option>
              <option value="name">{tr("Name", "名称 排序")}</option>
            </select>
            <span className="flex items-center gap-1 border border-terminal-border bg-terminal-bg px-1.5 py-1 text-terminal-muted">
              {tr("Mats cost ≤", "材料总价 ≤")}
              <input
                type="text"
                inputMode="numeric"
                value={costMax.g}
                onChange={(event) => { setCostMax({ ...costMax, g: event.target.value.replace(/[^\d]/g, "") }); setPage(1); }}
                placeholder="g"
                title={tr("Material total cost cap (gold)", "材料总价上限（金币）")}
                className="w-9 bg-transparent text-center text-slate-200 outline-none placeholder:text-terminal-muted/60"
              />
              <span>g</span>
              <input
                type="text"
                inputMode="numeric"
                value={costMax.s}
                onChange={(event) => { setCostMax({ ...costMax, s: event.target.value.replace(/[^\d]/g, "") }); setPage(1); }}
                placeholder="s"
                title={tr("Material total cost cap (silver)", "材料总价上限（银币）")}
                className="w-7 bg-transparent text-center text-slate-200 outline-none placeholder:text-terminal-muted/60"
              />
              <span>s</span>
              <input
                type="text"
                inputMode="numeric"
                value={costMax.c}
                onChange={(event) => { setCostMax({ ...costMax, c: event.target.value.replace(/[^\d]/g, "") }); setPage(1); }}
                placeholder="c"
                title={tr("Material total cost cap (copper)", "材料总价上限（铜币）")}
                className="w-7 bg-transparent text-center text-slate-200 outline-none placeholder:text-terminal-muted/60"
              />
              <span>c</span>
            </span>
            <span className="flex items-center gap-1 border border-terminal-border bg-terminal-bg px-1.5 py-1 text-terminal-muted">
              {tr("Min margin ≥", "最小利润 ≥")}
              <input
                type="text"
                inputMode="decimal"
                value={minMargin}
                onChange={(event) => { setMinMargin(event.target.value.replace(/[^\d.]/g, "")); setPage(1); }}
                placeholder="%"
                title={tr("Minimum margin percent (missing-price recipes excluded)", "最小盈利百分比（缺价配方不参与）")}
                className="w-12 bg-transparent text-center text-slate-200 outline-none placeholder:text-terminal-muted/60"
              />
              <span>%</span>
            </span>
            <span className="ml-auto text-terminal-muted">
              {source === "all" ? tr("All sources", "全库") : sourceTabs.find((tab) => tab.key === source)?.label}
              {effectiveProfession === "all" ? "" : ` · ${professionLabel(effectiveProfession, lang)}`}
              {category === "all" ? "" : ` · ${category}`} · {tr(`${sorted.length} recipes`, `共 ${sorted.length} 个配方`)}
              {sorted.length > PAGE_SIZE && <>，{tr(`page ${safePage} / ${pageCount}`, `第 ${safePage} / ${pageCount} 页`)}</>}
            </span>
          </div>

          {shown.length === 0 && (
            <div className="border border-terminal-border bg-terminal-panel p-6 text-center font-mono text-[10px] text-terminal-muted">
              {tr("No recipes under these filters — try another term, or reset skill band to \"Any\" and category to \"All\".", "这个条件下没有配方 —— 换个词，或者把技能等级换回\"不限\"、分类换回\"全部\"。")}
            </div>
          )}

          <div className="grid gap-2 font-mono text-xs md:grid-cols-2">
            {shown.map((row) => (
              <div
                key={`${row.recipe.category}|${row.recipe.profession}|${row.recipe.name}`}
                className={`min-w-0 border p-2 leading-relaxed ${
                  row.status === "ok"
                    ? "border-terminal-border bg-terminal-panel/60 hover:border-terminal-amber/50"
                    : "border-terminal-border/40 bg-terminal-panel/30"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={`truncate ${QUALITY_COLORS[row.recipe.outputs[0]?.quality ?? 0] ?? "text-slate-100"}`}
                    title={row.recipe.displayName ?? row.recipe.name}
                  >
                    {row.recipe.displayName ?? row.recipe.name}
                    {row.recipe.category === "merchant" && (
                      <span className="ml-1 text-[9px] text-terminal-amber/80">{tr("Exchange", "兑换")}</span>
                    )}
                    {(() => {
                      const badge = diffBadge(row);
                      return badge ? (
                        <span className={`ml-1 ${badge.cls}`} title={badge.tip}>{badge.text}</span>
                      ) : null;
                    })()}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <AddToListButton items={row.recipe.reagents.map((m) => ({ itemId: m.itemId, name: m.name, quantity: m.quantity }))} lists={lists} label={tr("Add reagents", "原料入清单")} />
                    <button
                      type="button"
                      onClick={() => toggleFavorite(row)}
                      title={isFavorite(row) ? tr("Unstar", "取消收藏") : tr("Star recipe", "收藏配方")}
                      className={isFavorite(row) ? "text-terminal-amber" : "text-terminal-muted hover:text-slate-300"}
                    >
                      {isFavorite(row) ? "★" : "☆"}
                    </button>
                    <span className="text-[9px] text-terminal-muted">
                      {difficultyLabel(row)}
                      {difficultyLabel(row) ? " · " : ""}{tr(`${row.recipe.reagents.length} mats`, `${row.recipe.reagents.length}种材料`)}
                      {row.recipe.categoryName ? ` · ${row.recipe.categoryName}` : ""}
                    </span>
                  </span>
                </div>
                <div className="mt-1 flex h-4 items-baseline justify-between gap-2">
                  {row.recipe.category === "merchant" ? (
                    <>
                      <span className="truncate text-[10px] text-terminal-amber">
                        {(row.recipe.favorCost ?? 0) > 0 ? <>{tr("Scroll: Favor", "图纸：青睐")} ×{row.recipe.favorCost}</> : tr("Scroll: Favor n/a", "图纸：青睐暂无数据")}
                        {row.linkedCraft ? (
                          <>
                            {" · "}{tr("Crafts:", "制造：")}{row.linkedCraft.outputName}
                            {marketAvailable && (
                              <span className={row.linkedCraft.marginPercent >= 0 ? "text-terminal-green" : "text-terminal-red"}> {formatPercent(row.linkedCraft.marginPercent)}{row.linkedCraft.revenueFromFloor ? <span className="text-[9px]"> NPC</span> : ""}</span>
                            )}
                          </>
                        ) : (
                          <span className="text-terminal-muted"> · {tr("Crafts: no product record", "制造：无成品记录")}</span>
                        )}
                      </span>
                    </>
                  ) : marketAvailable ? (
                    row.status === "ok" ? (
                      <>
                        <span className={`text-sm ${row.marginPercent >= 0 ? "text-terminal-green" : "text-terminal-red"}`}>
                          {formatPercent(row.marginPercent)}{row.revenueFromFloor ? <span className="text-[9px]"> NPC</span> : ""}
                        </span>
                        <span className={`text-[10px] ${row.profit >= 0 ? "text-terminal-green" : "text-terminal-red"}`}>
                          {row.profit >= 0 ? tr("Profit ", "利润 ") : tr("Loss ", "亏损 ")}<CopperAmount copper={row.profit} hideSign={row.profit < 0} />
                        </span>
                      </>
                    ) : row.status === "cost-only" ? (
                      <>
                        <span className="text-[10px] text-terminal-muted">{tr("Enchant", "附魔")}</span>
                        <span className="text-[10px] text-slate-200">{tr("Cost", "成本")} <CopperAmount copper={row.cost} /></span>
                      </>
                    ) : (
                      <span className="truncate text-[10px] text-terminal-muted">{tr("No stock", "缺货")} · {tr("missing", "缺")} {row.missing.join("、")}</span>
                    )
                  ) : (
                    <span className="truncate text-[10px] text-terminal-muted">{tr("No market data on this server — profit unavailable", "本服务器暂无行情，利润不可用")}</span>
                  )}
                </div>
                {row.recipe.category !== "merchant" && row.scrollItemId !== undefined && row.scrollItemId !== null && (
                  <div className="mt-0.5 h-4 truncate text-[9px]">
                    <span className="text-terminal-amber">{tr("Scroll", "图纸")} </span>
                    {row.scrollPrice !== undefined ? (
                      <>
                        <CopperAmount copper={row.scrollPrice} />
                        <span className="text-terminal-muted"> AH</span>
                      </>
                    ) : (
                      <span className="text-terminal-muted">{tr("No listing", "暂无挂单")}</span>
                    )}
                  </div>
                )}
                <div className="mt-0.5 h-4 truncate text-[9px] text-terminal-muted/90" title={row.recipe.reagents.map((m) => `${m.name}×${m.quantity}`).join(" + ") || (row.recipe.category === "merchant" ? tr("Merchant favor exchange: no craft materials, costs Favor", "商人青睐兑换：无制造材料，需青睐币") : "—")}>                  {tr("Materials:", "材料：")}
                  {row.recipe.reagents.map((m, i) => {
                    const mp = row.materials.find((p) => p.name === m.name && p.quantity === m.quantity);
                    return (
                      <span key={i}>
                        {i > 0 ? " + " : ""}
                        <span className={QUALITY_COLORS[m.quality ?? 0] ?? ""}>{m.name}×{m.quantity}</span>
                        {mp ? (
                          <span>
                            {" "}
                            <span className="text-terminal-muted">(</span>
                            <CopperAmount copper={mp.price} />
                            {mp.source === "vendor" && <span className="text-terminal-amber"> NPC</span>}
                            <span className="text-terminal-muted">)</span>
                          </span>
                        ) : (
                          <span className="text-terminal-muted"> ({tr("no stock", "缺货")})</span>
                        )}
                      </span>
                    );
                  }) || (row.recipe.category === "merchant" ? tr("none (favor exchange)", "无（青睐兑换）") : "—")}
                </div>
                <div className="h-4 truncate text-[9px] text-slate-300/80" title={row.recipe.outputs.map((m) => `${m.name}×${m.quantity}`).join(" + ") || tr("The enchant's effect", "附魔的效果")}>
                  {row.recipe.category === "merchant" && (
                    <span className="text-terminal-amber">{tr("Total craft cost", "总制造成本")} <CopperAmount copper={row.cost} /> · </span>
                  )}
                  {row.recipe.category !== "merchant" && row.status === "ok" && (
                    <span className="text-terminal-amber">{tr("Total cost", "总成本")} <CopperAmount copper={row.cost} /> · </span>
                  )}
                  {tr("Output:", "产出：")}
                  {row.recipe.outputs.length === 0 ? (
                    <span className="text-terminal-muted">{tr("The enchant's effect", "附魔的效果")}</span>
                  ) : (
                    row.recipe.outputs.map((m, i) => (
                      <span key={i}>
                        {i > 0 ? " + " : ""}
                        <span className={QUALITY_COLORS[m.quality ?? 0] ?? ""}>{m.name}×{m.quantity}</span>
                        <ProductBadge itemId={m.itemId} />
                      </span>
                    ))
                  )}
                  {row.recipe.outputs[0]?.ilvl ? ` · ${tr("ilvl", "物品等级")}${row.recipe.outputs[0].ilvl}` : ""}
                  {row.recipe.outputs[0]?.req ? ` · ${tr("req level", "需要等级")}${row.recipe.outputs[0].req}` : ""}
                </div>
              </div>
            ))}
          </div>

          {sorted.length > PAGE_SIZE && (
            <div className="mt-2 flex items-center justify-end gap-2 font-mono text-[10px]">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage(Math.max(1, safePage - 1))}
                className="border border-terminal-border px-2 py-0.5 text-terminal-muted outline-none transition-colors hover:text-slate-200 disabled:opacity-40"
              >
                ← {tr("Prev", "上一页")}
              </button>
              <span className="text-terminal-muted">
                {tr(`${safePage} / ${pageCount} · rows ${((safePage - 1) * PAGE_SIZE) + 1}-${Math.min(safePage * PAGE_SIZE, sorted.length)}`, `${safePage} / ${pageCount} 页 · 第${((safePage - 1) * PAGE_SIZE) + 1}-${Math.min(safePage * PAGE_SIZE, sorted.length)}条`)}
              </span>
              <button
                type="button"
                disabled={safePage >= pageCount}
                onClick={() => setPage(Math.min(pageCount, safePage + 1))}
                className="border border-terminal-border px-2 py-0.5 text-terminal-muted outline-none transition-colors hover:text-slate-200 disabled:opacity-40"
              >
                {tr("Next", "下一页")} →
              </button>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
