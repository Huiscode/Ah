"use client";

// 机会总览：捡漏雷达 / 可做差价 / 异动 三个榜单共用左列一块区域，
// 页签切换，互不干扰。捡漏 tab 保留原 DealRadarTable 全部能力
// （复制清单、筛选设置、localStorage 持久化）。
// 计数与复制名单跟随雷达筛选（与 DealRadarTable 共用 radar-filters.ts 谓词，
// 同一批 localStorage key 经 storage 广播双组件同步）。
import { useMemo, useState } from "react";
import type { DealRadarRow, SpreadCandidateRow, MoverRow, DisenchantRow } from "@/lib/analytics";
import { DealRadarTable } from "@/components/deal-radar-table";
import { SpreadCandidatesTable } from "@/components/spread-candidates-table";
import { MoverBoardTable } from "@/components/mover-board-table";
import { DisenchantTable } from "@/components/disenchant-table";
import { CopyListButton } from "@/components/copy-list-button";
import { RadarSettingsButton } from "@/components/radar-settings-button";
import { useLang, useLL } from "@/components/lang-provider";
import { displayName, type Lang } from "@/lib/i18n";
import { filterRadarRows } from "@/lib/radar-filters";
import { usePersistedState } from "@/lib/use-persisted-state";

type TabKey = "deals" | "spreads" | "movers" | "disenchant";

export function OpportunityTabs({ deals, spreads, movers, disenchant, prices, radarCategories, watchedItemIds, productItemIds, tierGapByItemId, server, lang }: {
  deals: DealRadarRow[];
  spreads: SpreadCandidateRow[];
  movers: MoverRow[];
  disenchant: DisenchantRow[];
  prices: Map<number, number>;
  radarCategories: string[];
  watchedItemIds: number[];
  productItemIds: Set<number>;
  tierGapByItemId?: Map<number, number>;
  server?: string;
  lang?: Lang;
}) {
  const [tab, setTab] = useState<TabKey>("deals");
  // 雷达筛选值：与 DealRadarTable / RadarSettingsButton 共用同一批 localStorage key
  // （storage 广播同步），这里只读不写，用于计数与复制名单。
  const [category] = usePersistedState<string>("wah:deal-radar:category", "");
  const [onlyLiquid] = usePersistedState<boolean>("wah:deal-radar:onlyLiquid", false);
  const [onlyVendor] = usePersistedState<boolean>("wah:deal-radar:onlyVendor", false);
  const [minQuantity] = usePersistedState<number>("wah:deal-radar:minQuantity", 0);
  const [minTierGap] = usePersistedState<number>("wah:deal-radar:minTierGap", 0);
  const filteredDeals = useMemo(
    () => filterRadarRows(deals, { category, onlyLiquid, onlyVendor, minQuantity, minTierGap }, tierGapByItemId),
    [deals, category, onlyLiquid, onlyVendor, minQuantity, minTierGap, tierGapByItemId]
  );
  const filtersActive = tab === "deals" && (!!category || onlyLiquid || onlyVendor || Number(minQuantity) > 0 || Number(minTierGap) > 0);
  // 优先用 prop 注入的服务端语言（与页面渲染同源）；客户端直挂时回退上下文。
  const ctxLang = useLang();
  const effectiveLang = lang ?? ctxLang;
  const tr = (en: string, zh: string) => (effectiveLang === "zh" ? zh : en);
  const tabs: Array<{ key: TabKey; label: string; count: number }> = [
    { key: "deals", label: tr("Deals", "捡漏"), count: deals.length },
    { key: "spreads", label: tr("Spreads", "可做差价"), count: spreads.length },
    { key: "movers", label: tr("Movers", "异动"), count: movers.length },
    { key: "disenchant", label: tr("Disenchant", "分解"), count: disenchant.length }
  ];
  const tabClass = (active: boolean) =>
    `cursor-pointer select-none rounded px-2.5 py-1 font-mono text-xs ${
      active ? "bg-terminal-panel2 text-terminal-amber" : "text-terminal-muted hover:text-slate-200"
    }`;
  const localizedNames = (rows: Array<{ name: string; nameEn?: string | null }>) => rows.map((row) => displayName(row.name, row.nameEn, effectiveLang));
  const activeNames =
    tab === "deals" ? localizedNames(filteredDeals)
    : tab === "spreads" ? localizedNames(spreads)
    : tab === "movers" ? localizedNames(movers)
    : localizedNames(disenchant);
  const countText = tab === "deals"
    ? (filtersActive ? tr(`${filteredDeals.length} / ${deals.length} rows`, `${filteredDeals.length} / ${deals.length} 条`) : tr(`${deals.length} rows`, `${deals.length} 条`))
    : tr(`${activeNames.length} rows`, `${activeNames.length} 条`);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 border-b border-terminal-border px-3 py-2">
        {tabs.map((item) => (
          <button key={item.key} onClick={() => setTab(item.key)} className={tabClass(tab === item.key)}>
            {item.label} <span className="opacity-80">{item.count}</span>
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2">
          <CopyListButton names={activeNames} label={tr("Copy list", "复制清单")} listNamePrefix={tr("Deals", "捡漏")} />
          {tab === "deals" && <RadarSettingsButton categories={radarCategories} />}
          <span className="font-mono text-[10px] text-terminal-muted">{countText}</span>
        </span>
      </div>
      {tab === "deals" && (
        <DealRadarTable
          deals={deals}
          prices={prices}
          categories={radarCategories}
          watchedItemIds={watchedItemIds}
          productItemIds={productItemIds}
          tierGapByItemId={tierGapByItemId}
          server={server}
        />
      )}
      {tab === "spreads" && (
        <SpreadCandidatesTable
          rows={spreads}
          prices={prices}
          watchedItemIds={watchedItemIds}
          productItemIds={productItemIds}
          server={server}
        />
      )}
      {tab === "movers" && (
        <MoverBoardTable
          rows={movers}
          prices={prices}
          watchedItemIds={watchedItemIds}
          productItemIds={productItemIds}
          server={server}
        />
      )}
      {tab === "disenchant" && (
        <DisenchantTable
          rows={disenchant}
          prices={prices}
          watchedItemIds={watchedItemIds}
          productItemIds={productItemIds}
          server={server}
        />
      )}
    </div>
  );
}
