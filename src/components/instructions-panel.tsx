"use client";

import { useState } from "react";
import { HelpCircle, ChevronDown, ChevronRight } from "lucide-react";

export function InstructionsPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 border border-terminal-border bg-terminal-panel">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2 font-mono text-xs text-terminal-amber hover:bg-slate-800/30"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <HelpCircle size={14} />
        使用说明（点我展开）
      </button>
      {open && (
        <div className="border-t border-terminal-border px-4 py-3 font-mono text-xs leading-relaxed text-slate-300">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-terminal-amber">▍页面板块</div>
              <ul className="space-y-1 list-disc pl-4">
                <li><b>捡漏雷达</b>：最低买入价低于 7 日参考价的物品，低买信号。按流通分排序，卖得快的排前面。</li>
                <li><b>市场监控</b>：所有扫描物品的实时行情，点 ☆ 加入关注。</li>
                <li><b>制造利润</b>：矿石→锭、布→卷等加工品的利润，按材料成本 vs 成品售价算。</li>
                <li><b>配方库</b>：全部专业配方与商人兑换，按利润率排序；拍卖行无价/无记录的标"缺货"。</li>
              </ul>
            </div>
            <div>
              <div className="mb-1 text-terminal-amber">▍流通分（物品名旁的数字）</div>
              <p className="mb-1">被多少个专业配方当材料使用。分数越高 = 买了越快能转手：</p>
              <ul className="space-y-1 list-disc pl-4">
                <li><span className="text-green-400">绿色 50+</span>：高流通，多个配方需要</li>
                <li><span className="text-amber-400">黄色 15-49</span>：中等流通</li>
                <li><span className="text-slate-400">灰色 &lt;15</span>：冷门，压货风险</li>
                <li><span className="text-terminal-red">已自动过滤</span>：空瓶/染料/细线等 NPC 常驻出售品，AH 价不会超过 NPC 价，不适合捡漏。</li>
              </ul>
              <div className="mt-2 mb-1 text-terminal-amber">▍数据口径</div>
              <p>价格 = Auctionator 插件记录的<b>最低买入价</b>（m）。进入游戏拍卖行时保持 Auctionator 全量扫描，然后运行导入脚本，网页即更新。7 日参考 = 近 7 日每日收盘中位数。</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
