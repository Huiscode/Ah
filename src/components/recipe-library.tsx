"use client";

import { useMemo, useState } from "react";
import { Hammer, Search } from "lucide-react";
import type { RecipeProfitRow } from "@/lib/recipe-profits";
import { professionLabel, categoryLabel } from "@/lib/recipe-profits";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { formatPercent } from "@/lib/utils";
import { CopperAmount } from "@/components/copper-amount";
import { ProductBadge } from "@/components/product-badge";
import { usePersistedState } from "@/lib/use-persisted-state";

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

type SourceFilter = "全部" | "专业配方" | "商人兑换";
type SortKey = "profit" | "skillAsc" | "skillDesc" | "name";
// 收藏配方：localStorage 共享 key（首页"关注配方"面板读取同一份）。
type FavoriteKey = { category: string; profession: string; name: string };
const FAVORITES_KEY = "wah:favorite-recipes";

// 技能等级档（入门技能等级口径，与 wx-wow.com 一致）。
const SKILL_BANDS: Array<{ key: string; label: string; test: (level: number) => boolean }> = [
  { key: "all", label: "不限", test: () => true },
  { key: "1-75", label: "1-75", test: (l) => l >= 1 && l <= 75 },
  { key: "76-150", label: "76-150", test: (l) => l >= 76 && l <= 150 },
  { key: "151-225", label: "151-225", test: (l) => l >= 151 && l <= 225 },
  { key: "226-300", label: "226-300", test: (l) => l >= 226 && l <= 300 },
  { key: "301+", label: "301+", test: (l) => l >= 301 }
];

const PAGE_SIZE = 20;

// 配方库（独立页面）：模仿 wx-wow.com 专业配方页——来源/专业 tab 横条、
// 左侧技能等级+分类筛选、搜索框、排序、两列卡片网格、分页。卡片保留本项目
// 的核心增值：利润率与利润额（绿色/红色），缺价配方排最后并标"缺价"。
export function RecipeLibrary({ rows }: { rows: RecipeProfitRow[] }) {
  const [source, setSource] = usePersistedState<SourceFilter>("wah:recipes:source", "全部");
  // 筛选状态持久化：刷新后保留用户上次选的专业/技能档/分类/搜索/排序。
  const [profession, setProfession] = usePersistedState<string>("wah:recipes:profession", "全部");
  const [skillBand, setSkillBand] = usePersistedState<string>("wah:recipes:skillBand", "all");
  const [category, setCategory] = usePersistedState<string>("wah:recipes:category", "全部");
  const [query, setQuery] = usePersistedState<string>("wah:recipes:query", "");
  const [sort, setSort] = usePersistedState<SortKey>("wah:recipes:sort", "profit");
  // 配方筛选条件（排序下拉右侧）：材料总价上限（g/s/c）+ 最小利润（%）。
  // 留空即不过滤；缺价配方无法满足价格条件，激活任一筛选时自动排除。
  const [costMax, setCostMax] = usePersistedState<{ g: string; s: string; c: string }>("wah:recipes:costMax", { g: "", s: "", c: "" });
  const [minMargin, setMinMargin] = usePersistedState<string>("wah:recipes:minMargin", "");
  const [page, setPage] = useState(1);
  // 收藏的配方（首页"关注配方"面板读取同一份 localStorage）。
  const [favorites, setFavorites] = usePersistedState<FavoriteKey[]>(FAVORITES_KEY, []);

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
    () => (source === "全部" ? rows : source === "专业配方" ? bySource.craft : bySource.merchant),
    [rows, bySource, source]
  );

  const professions = useMemo(() => {
    const seen = new Set<string>();
    for (const row of baseRows) if (row.recipe.profession) seen.add(row.recipe.profession);
    return Array.from(seen).sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [baseRows]);

  // 默认"全部"，无空值回退。
  const effectiveProfession = profession;

  // 来源+专业+技能档 → 分类计数（左栏）。切换专业/技能档时回到第一页。
  const scopeRows = useMemo(
    () =>
      baseRows.filter(
        (row) =>
          (effectiveProfession === "全部" || row.recipe.profession === effectiveProfession) &&
          SKILL_BANDS.find((band) => band.key === skillBand)!.test(row.recipe.skillLevel)
      ),
    [baseRows, effectiveProfession, skillBand]
  );

  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const row of scopeRows) {
      const name = row.recipe.categoryName || (row.recipe.category === "merchant" ? "商人兑换" : "未分类");
      seen.add(name);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [scopeRows]);

  const countForBand = (band: string) =>
    baseRows.filter(
      (row) =>
        (effectiveProfession === "全部" || row.recipe.profession === effectiveProfession) &&
        SKILL_BANDS.find((b) => b.key === band)!.test(row.recipe.skillLevel)
    ).length;
  const countForCategory = (name: string) =>
    scopeRows.filter(
      (row) => (row.recipe.categoryName || (row.recipe.category === "merchant" ? "商人兑换" : "未分类")) === name
    ).length;

  // 搜索：成品名 / 成品物品ID / 材料名。
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scopeRows;
    return scopeRows.filter((row) => {
      if (row.recipe.name.toLowerCase().includes(q)) return true;
      if (row.recipe.outputs.some((o) => String(o.itemId).includes(q))) return true;
      if (row.recipe.reagents.some((m) => m.name.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [scopeRows, query]);

  const filtered = useMemo(() => {
    if (category === "全部") return searched;
    const target = category;
    return searched.filter(
      (row) => (row.recipe.categoryName || (row.recipe.category === "merchant" ? "商人兑换" : "未分类")) === target
    );
  }, [searched, category]);

  // 价格/利润筛选：材料总价 ≤ g/s/c 上限 且 盈利百分比 ≥ 最小值。
  // 任一条件激活时只保留 status="ok"（缺价行材料成本不完整，无法判定）。
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
      if (row.status !== "ok") return false;
      if (costFilterActive && row.cost > costLimitCopper) return false;
      if (marginLimit !== null && row.marginPercent < marginLimit) return false;
      return true;
    });
  }, [filtered, costFilterActive, costLimitCopper, marginLimit]);

  const sorted = useMemo(() => {
    const arr = [...priced];
    switch (sort) {
      case "profit":
        return arr.sort((a, b) => {
          if (a.status !== b.status) return a.status === "ok" ? -1 : 1;
          if (a.status === "ok") return b.marginPercent - a.marginPercent;
          return a.recipe.name.localeCompare(b.recipe.name, "zh-CN");
        });
      case "skillAsc":
        return arr.sort((a, b) => a.recipe.skillLevel - b.recipe.skillLevel || a.recipe.name.localeCompare(b.recipe.name, "zh-CN"));
      case "skillDesc":
        return arr.sort((a, b) => b.recipe.skillLevel - a.recipe.skillLevel || a.recipe.name.localeCompare(b.recipe.name, "zh-CN"));
      case "name":
        return arr.sort((a, b) => a.recipe.name.localeCompare(b.recipe.name, "zh-CN"));
    }
  }, [priced, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const shown = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const sourceTabs: Array<{ key: SourceFilter; count: number }> = [
    { key: "全部", count: rows.length },
    { key: "专业配方", count: bySource.craft.length },
    { key: "商人兑换", count: bySource.merchant.length }
  ];

  const selectSource = (key: SourceFilter) => {
    setSource(key);
    setProfession("全部"); // 回到"全部"
    setSkillBand("all");
    setCategory("全部");
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
        title="配方库"
        action={
          <span className="flex items-center gap-2 font-mono text-[10px] text-terminal-muted">
            <Hammer size={13} className="text-terminal-muted" />
            共 {rows.length} 条 · 可算利润 {rows.filter((row) => row.status === "ok").length} 条 · 已收藏 {favorites.length} 条
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
            {tab.key} <span className="opacity-70">{tab.count}</span>
          </button>
        ))}
      </div>

      {/* 专业 tab（横条，同 wx-wow.com；默认选中首个专业） */}
      <div className="flex flex-wrap gap-1 border-b border-terminal-border px-3 py-2">
        <button
          key="全部"
          type="button"
          onClick={() => { setProfession("全部"); setSkillBand("all"); setCategory("全部"); setPage(1); }}
          className={`px-2 py-0.5 font-mono text-[10px] outline-none transition-colors ${
            effectiveProfession === "全部"
              ? "bg-terminal-amber text-terminal-bg"
              : "border border-terminal-border text-terminal-muted hover:text-slate-200"
          }`}
        >
          全部 <span className="opacity-70">{baseRows.length}</span>
        </button>
        {professions.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => { setProfession(name); setSkillBand("all"); setCategory("全部"); setPage(1); }}
            className={`px-2 py-0.5 font-mono text-[10px] outline-none transition-colors ${
              effectiveProfession === name
                ? "bg-terminal-amber text-terminal-bg"
                : "border border-terminal-border text-terminal-muted hover:text-slate-200"
            }`}
          >
            {professionLabel(name)} <span className="opacity-70">{baseRows.filter((r) => r.recipe.profession === name).length}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 p-3 lg:flex-row">
        {/* 左栏：技能等级 + 分类 */}
        <aside className="w-full shrink-0 font-mono text-[10px] lg:w-44">
          <div className="mb-1 text-terminal-muted">技能等级</div>
          <div className="mb-3 flex flex-wrap gap-1 lg:flex-col">
            {SKILL_BANDS.map((band) => (
              <button
                key={band.key}
                type="button"
                onClick={() => { setSkillBand(band.key); setCategory("全部"); setPage(1); }}
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
          <div className="mb-1 text-terminal-muted">分类</div>
          <div className="flex max-h-64 flex-wrap gap-1 overflow-y-auto lg:flex-col">
            <button
              key="全部"
              type="button"
              onClick={() => { setCategory("全部"); setPage(1); }}
              className={`px-2 py-0.5 text-left outline-none transition-colors ${
                category === "全部"
                  ? "bg-terminal-amber/90 text-terminal-bg"
                  : "border border-terminal-border text-terminal-muted hover:text-slate-200"
              }`}
            >
              全部 <span className="opacity-70">{scopeRows.length}</span>
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
                {categoryLabel(name)} <span className="opacity-70">{countForCategory(name)}</span>
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
                placeholder="搜成品名 / 物品ID…"
                className="w-44 border border-terminal-border bg-terminal-bg py-1 pl-6 pr-2 text-[10px] text-slate-200 outline-none placeholder:text-terminal-muted focus:border-terminal-amber/60"
              />
            </div>
            <select
              value={sort}
              onChange={(event) => { setSort(event.target.value as SortKey); setPage(1); }}
              className="border border-terminal-border bg-terminal-bg px-1 py-1 text-[10px] text-terminal-muted outline-none"
            >
              <option value="profit">利润率 高→低</option>
              <option value="skillAsc">技能 低→高</option>
              <option value="skillDesc">技能 高→低</option>
              <option value="name">名称 排序</option>
            </select>
            <span className="flex items-center gap-1 border border-terminal-border bg-terminal-bg px-1.5 py-1 text-terminal-muted">
              材料总价&nbsp;≤
              <input
                type="text"
                inputMode="numeric"
                value={costMax.g}
                onChange={(event) => { setCostMax({ ...costMax, g: event.target.value.replace(/[^\d]/g, "") }); setPage(1); }}
                placeholder="g"
                title="材料总价上限（金币）"
                className="w-9 bg-transparent text-center text-slate-200 outline-none placeholder:text-terminal-muted/60"
              />
              <span>g</span>
              <input
                type="text"
                inputMode="numeric"
                value={costMax.s}
                onChange={(event) => { setCostMax({ ...costMax, s: event.target.value.replace(/[^\d]/g, "") }); setPage(1); }}
                placeholder="s"
                title="材料总价上限（银币）"
                className="w-7 bg-transparent text-center text-slate-200 outline-none placeholder:text-terminal-muted/60"
              />
              <span>s</span>
              <input
                type="text"
                inputMode="numeric"
                value={costMax.c}
                onChange={(event) => { setCostMax({ ...costMax, c: event.target.value.replace(/[^\d]/g, "") }); setPage(1); }}
                placeholder="c"
                title="材料总价上限（铜币）"
                className="w-7 bg-transparent text-center text-slate-200 outline-none placeholder:text-terminal-muted/60"
              />
              <span>c</span>
            </span>
            <span className="flex items-center gap-1 border border-terminal-border bg-terminal-bg px-1.5 py-1 text-terminal-muted">
              最小利润&nbsp;≥
              <input
                type="text"
                inputMode="decimal"
                value={minMargin}
                onChange={(event) => { setMinMargin(event.target.value.replace(/[^\d.]/g, "")); setPage(1); }}
                placeholder="%"
                title="最小盈利百分比（缺价配方不参与）"
                className="w-12 bg-transparent text-center text-slate-200 outline-none placeholder:text-terminal-muted/60"
              />
              <span>%</span>
            </span>
            <span className="ml-auto text-terminal-muted">
              {source === "全部" ? "全库" : source}
              {effectiveProfession === "全部" ? "" : ` · ${professionLabel(effectiveProfession)}`}
              {category === "全部" ? "" : ` · ${categoryLabel(category)}`} · 共 <b className="text-slate-200">{sorted.length}</b> 个配方
              {sorted.length > PAGE_SIZE && <>，第 <b className="text-slate-200">{safePage}</b> / {pageCount} 页</>}
            </span>
          </div>

          {shown.length === 0 && (
            <div className="border border-terminal-border bg-terminal-panel p-6 text-center font-mono text-[10px] text-terminal-muted">
              这个条件下没有配方 —— 换个词，或者把技能等级换回"不限"、分类换回"全部"。
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
                    title={row.recipe.name}
                  >
                    {row.recipe.name}
                    {row.recipe.category === "merchant" && (
                      <span className="ml-1 text-[9px] text-terminal-amber/80">兑换{(row.recipe.favorCost ?? 0) > 0 ? `·青睐${row.recipe.favorCost}` : ""}</span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => toggleFavorite(row)}
                      title={isFavorite(row) ? "取消收藏" : "收藏配方"}
                      className={isFavorite(row) ? "text-terminal-amber" : "text-terminal-muted hover:text-slate-300"}
                    >
                      {isFavorite(row) ? "★" : "☆"}
                    </button>
                    <span className="text-[9px] text-terminal-muted">
                      {difficultyLabel(row)}
                      {difficultyLabel(row) ? " · " : ""}{row.recipe.reagents.length}种材料
                      {row.recipe.categoryName ? ` · ${categoryLabel(row.recipe.categoryName)}` : ""}
                    </span>
                  </span>
                </div>
                <div className="mt-1 flex h-4 items-baseline justify-between gap-2">
                  {row.status === "ok" ? (
                    <>
                      <span className={`text-sm ${row.marginPercent >= 0 ? "text-terminal-green" : "text-terminal-red"}`}>
                        {formatPercent(row.marginPercent)}
                      </span>
                      <span className={`text-[10px] ${row.profit >= 0 ? "text-terminal-green" : "text-terminal-red"}`}>
                        {row.profit >= 0 ? "利润 " : "亏损 "}<CopperAmount copper={row.profit} hideSign={row.profit < 0} />
                      </span>
                    </>
                  ) : (
                    <span className="truncate text-[10px] text-terminal-muted">缺价 · 缺 {row.missing.join("、")}</span>
                  )}
                </div>
                <div className="mt-0.5 h-4 truncate text-[9px] text-terminal-muted/90" title={row.recipe.reagents.map((m) => `${m.name}×${m.quantity}`).join(" + ") || "—"}>
                  材料：
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
                          <span className="text-terminal-muted"> (缺价)</span>
                        )}
                      </span>
                    );
                  }) || "—"}
                </div>
                <div className="h-4 truncate text-[9px] text-slate-300/80" title={row.recipe.outputs.map((m) => `${m.name}×${m.quantity}`).join(" + ")}>
                  产出：
                  {row.recipe.outputs.map((m, i) => (
                    <span key={i}>
                      {i > 0 ? " + " : ""}
                      <span className={QUALITY_COLORS[m.quality ?? 0] ?? ""}>{m.name}×{m.quantity}</span>
                      <ProductBadge itemId={m.itemId} />
                    </span>
                  )) || "—"}
                  {row.recipe.outputs[0]?.ilvl ? ` · 物品等级${row.recipe.outputs[0].ilvl}` : ""}
                  {row.recipe.outputs[0]?.req ? ` · 需要等级${row.recipe.outputs[0].req}` : ""}
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
                ← 上一页
              </button>
              <span className="text-terminal-muted">
                {safePage} / {pageCount} 页 · 第{((safePage - 1) * PAGE_SIZE) + 1}-{Math.min(safePage * PAGE_SIZE, sorted.length)}条
              </span>
              <button
                type="button"
                disabled={safePage >= pageCount}
                onClick={() => setPage(Math.min(pageCount, safePage + 1))}
                className="border border-terminal-border px-2 py-0.5 text-terminal-muted outline-none transition-colors hover:text-slate-200 disabled:opacity-40"
              >
                下一页 →
              </button>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
