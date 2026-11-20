"use client";

// 机会总览：捡漏雷达 / 异动 / 分解 三个榜单共用左列一块区域，页签切换。
// "可做差价"榜 2026-11-20 并入捡漏雷达（策略 = 波段）。
// 计数与复制名单跟随雷达筛选（与 DealRadarTable 共用 radar-filters.ts 谓词，
// 同一批 localStorage key 经 storage 广播双组件同步）。
import { useMemo, useState } from "react";
import type { DealRadarRow, MoverRow, DisenchantRow } from "@/lib/analytics";
import { DealRadarTable } from "@/components/deal-radar-table";
import { MoverBoardTable } from "@/components/mover-board-table";
import { DisenchantTable } from "@/components/disenchant-table";
import { CopyListButton } from "@/components/copy-list-button";
import { RadarSettingsButton } from "@/components/radar-settings-button";
import { useLang } from "@/components/lang-provider";
import { displayName, type Lang } from "@/lib/i18n";
import { filterRadarRows, radarFiltersActive, RADAR_FILTER_KEYS } from "@/lib/radar-filters";
import { usePersistedState } from "@/lib/use-persisted-state";

type TabKey = "deals" | "movers" | "disenchant";

export function OpportunityTabs({ deals, movers, disenchant, prices, radarCategories, watchedItemIds, productItemIds, tierGapByItemId, server, lang }: {
  deals: DealRadarRow[];
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
  // 雷达筛选值：与 DealRadarTable / RadarSettingsButton 共用同一批 localStorage key，这里只读。
  const [strategy] = usePersistedState<string>(RADAR_FILTER_KEYS.strategy, "");
  const [category] = usePersistedState<string>(RADAR_FILTER_KEYS.category, "");
  const [minTotalProfitSilver] = usePersistedState<number>(RADAR_FILTER_KEYS.minTotalProfitSilver, 0);
  const [onlyLiquid] = usePersistedState<boolean>(RADAR_FILTER_KEYS.onlyLiquid, false);
  const [minQuantity] = usePersistedState<number>(RADAR_FILTER_KEYS.minQuantity, 0);
  const [minTierGap] = usePersistedState<number>(RADAR_FILTER_KEYS.minTierGap, 0);
  const filters = useMemo(
    () => ({ strategy, category, minTotalProfitSilver, onlyLiquid, minQuantity, minTierGap }),
    [strategy, category, minTotalProfitSilver, onlyLiquid, minQuantity, minTierGap]
  );
  const filteredDeals = useMemo(() => filterRadarRows(deals, filters, tierGapByItemId), [deals, filters, tierGapByItemId]);
  const filtersActive = tab === "deals" && radarFiltersActive(filters);
  // 优先用 prop 注入的服务端语言（与页面渲染同源）；客户端直挂时回退上下文。
  const ctxLang = useLang();
  const effectiveLang = lang ?? ctxLang;
  const tr = (en: string, zh: string) => (effectiveLang === "zh" ? zh : en);
  const tabs: Array<{ key: TabKey; label: string; count: number }> = [
    { key: "deals", label: tr("Deals", "捡漏"), count: deals.length },
    { key: "movers", label: tr("Movers", "异动"), count: movers.length },
    { key: "disenchant", label: tr("Disenchant", "分解"), count: disenchant.length }
  ];
  const tabClass = (active: boolean) =>
    `cursor-pointer select-none rounded px-2.5 py-1 font-mono text-xs ${
      active ? "bg-terminal-panel2 text-terminal-amber" : "text-terminal-muted hover:text-slate-200"
    }`;
  // 同一物品可能同时是"扫货"和"跨市场"两行，复制清单去重。
  const localizedNames = (rows: Array<{ name: string; nameEn?: string | null }>) =>
    [...new Set(rows.map((row) => displayName(row.name, row.nameEn, effectiveLang)))];
  const activeNames =
    tab === "deals" ? localizedNames(filteredDeals)
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
          categories={radarCategories}
          watchedItemIds={watchedItemIds}
          productItemIds={productItemIds}
          tierGapByItemId={tierGapByItemId}
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
