"use client";

// 机会总览：捡漏雷达 / 可做差价 / 异动 三个榜单共用左列一块区域，
// 页签切换，互不干扰。捡漏 tab 保留原 DealRadarTable 全部能力
// （复制清单、筛选设置、localStorage 持久化）。
import { useState } from "react";
import type { DealRadarRow, SpreadCandidateRow, MoverRow, DisenchantRow } from "@/lib/analytics";
import { DealRadarTable } from "@/components/deal-radar-table";
import { SpreadCandidatesTable } from "@/components/spread-candidates-table";
import { MoverBoardTable } from "@/components/mover-board-table";
import { DisenchantTable } from "@/components/disenchant-table";
import { CopyListButton } from "@/components/copy-list-button";
import { RadarSettingsButton } from "@/components/radar-settings-button";

type TabKey = "deals" | "spreads" | "movers" | "disenchant";

export function OpportunityTabs({ deals, spreads, movers, disenchant, prices, radarCategories, watchedItemIds, productItemIds, tierGapByItemId, server }: {
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
}) {
  const [tab, setTab] = useState<TabKey>("deals");
  const tabs: Array<{ key: TabKey; label: string; count: number }> = [
    { key: "deals", label: "捡漏", count: deals.length },
    { key: "spreads", label: "可做差价", count: spreads.length },
    { key: "movers", label: "异动", count: movers.length },
    { key: "disenchant", label: "分解", count: disenchant.length }
  ];
  const tabClass = (active: boolean) =>
    `cursor-pointer select-none rounded px-2.5 py-1 font-mono text-xs ${
      active ? "bg-terminal-panel2 text-terminal-amber" : "text-terminal-muted hover:text-slate-200"
    }`;
  const activeNames =
    tab === "deals" ? deals.map((deal) => deal.name)
    : tab === "spreads" ? spreads.map((row) => row.name)
    : tab === "movers" ? movers.map((row) => row.name)
    : disenchant.map((row) => row.name);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 border-b border-terminal-border px-3 py-2">
        {tabs.map((item) => (
          <button key={item.key} onClick={() => setTab(item.key)} className={tabClass(tab === item.key)}>
            {item.label} <span className="opacity-80">{item.count}</span>
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2">
          <CopyListButton names={activeNames} label="复制清单" />
          {tab === "deals" && <RadarSettingsButton categories={radarCategories} />}
          <span className="font-mono text-[10px] text-terminal-muted">{activeNames.length} 条</span>
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
