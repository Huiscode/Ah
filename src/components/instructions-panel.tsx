"use client";

import { useState } from "react";
import { HelpCircle, ChevronDown, ChevronRight } from "lucide-react";
import { useLL } from "@/components/lang-provider";

export function InstructionsPanel() {
  const tr = useLL();
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 border border-terminal-border bg-terminal-panel">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2 font-mono text-xs text-terminal-amber hover:bg-slate-800/30"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <HelpCircle size={14} />
        {tr("How to use (click to expand)", "使用说明（点我展开）")}
      </button>
      {open && (
        <div className="border-t border-terminal-border px-4 py-3 font-mono text-xs leading-relaxed text-slate-300">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-terminal-amber">{tr("▍Panels", "▍页面板块")}</div>
              <ul className="space-y-1 list-disc pl-4">
                <li><b>{tr("Deal Radar", "捡漏雷达")}</b>{tr(": items whose lowest buyout sits below the 7-day reference — a buy signal. Sorted by turnover score; fast sellers first.", "：最低买入价低于 7 日参考价的物品，低买信号。按流通分排序，卖得快的排前面。")}</li>
                <li><b>{tr("Market Monitor", "市场监控")}</b>{tr(": live quotes of every scanned item; click ☆ to watch.", "：所有扫描物品的实时行情，点 ☆ 加入关注。")}</li>
                <li><b>{tr("Crafting Profit", "制造利润")}</b>{tr(": margins on processed goods (ore→bar, cloth→bolt etc.) — material cost vs product price.", "：矿石→锭、布→卷等加工品的利润，按材料成本 vs 成品售价算。")}</li>
                <li><b>{tr("Recipes", "配方库")}</b>{tr(": all profession recipes and merchant exchanges, sorted by margin; items with no AH price/record are marked \"no stock\".", "：全部专业配方与商人兑换，按利润率排序；拍卖行无价/无记录的标\"缺货\"。")}</li>
              </ul>
            </div>
            <div>
              <div className="mb-1 text-terminal-amber">{tr("▍Turnover score (number beside item names)", "▍流通分（物品名旁的数字）")}</div>
              <p className="mb-1">{tr("How many profession recipes use it as a material. Higher = flips faster after you buy:", "被多少个专业配方当材料使用。分数越高 = 买了越快能转手：")}</p>
              <ul className="space-y-1 list-disc pl-4">
                <li><span className="text-green-400">{tr("Green 50+", "绿色 50+")}</span>{tr(": high turnover, needed by many recipes", "：高流通，多个配方需要")}</li>
                <li><span className="text-amber-400">{tr("Yellow 15-49", "黄色 15-49")}</span>{tr(": medium turnover", "：中等流通")}</li>
                <li><span className="text-slate-400">{tr("Gray &lt;15", "灰色 &lt;15")}</span>{tr(": niche, dead-stock risk", "：冷门，压货风险")}</li>
                <li><span className="text-terminal-red">{tr("Auto-filtered", "已自动过滤")}</span>{tr(": NPC-stocked goods (vials, dyes, thread…) — their AH price never beats the NPC price, unfit for sniping.", "：空瓶/染料/细线等 NPC 常驻出售品，AH 价不会超过 NPC 价，不适合捡漏。")}</li>
              </ul>
              <div className="mt-2 mb-1 text-terminal-amber">{tr("▍Data basis", "▍数据口径")}</div>
              <p>{tr("Price = the Auctionator addon's recorded ", "价格 = Auctionator 插件记录的")}<b>{tr("lowest buyout", "最低买入价")}</b>{tr(" (m). Keep Auctionator scanning every time you visit the in-game AH, then run the import — the web updates itself. 7-day reference = median of the last 7 daily closes.", "（m）。进入游戏拍卖行时保持 Auctionator 全量扫描，然后运行导入脚本，网页即更新。7 日参考 = 近 7 日每日收盘中位数。")}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
