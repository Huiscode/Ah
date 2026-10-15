import { ShoppingCart } from "lucide-react";
import { getShoppingLists } from "@/lib/repositories";
import { ShoppingListsManager } from "@/components/shopping-lists-manager";
import { CloseTabButton } from "@/components/close-tab-button";
import { Panel, PanelHeader } from "@/components/ui/panel";

export const dynamic = "force-dynamic";

// 购物清单（2026-10-15 用户需求）：数据库版清单管理器。清单是物品搜索词的
// 集合，可生成 Auctionator 可导入文本（"清单名^物品1^物品2"）→ 游戏内
// Shopping 页 Import 粘贴 → Search All 批量搜索拍下。支持从游戏端导出的
// 新版文本反向导入（同名清单覆盖）。旧版（*）与 TSM（逗号）格式已按用户
// 拍板移除（v3.4 修订）。
export default async function ListsPage() {
  const lists = await getShoppingLists();
  const totalItems = lists.reduce((sum, list) => sum + list.items.length, 0);

  return (
    <main className="terminal-grid min-h-screen bg-terminal-bg p-3 text-slate-200">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border border-terminal-border bg-terminal-panel px-4 py-3">
        <div>
          <h1 className="font-mono text-lg font-semibold uppercase text-terminal-amber">购物清单</h1>
          <p className="font-mono text-xs text-terminal-muted">Auctionator 购物清单 · 数据库版 · 一键复制导入文本</p>
        </div>
        <div className="flex items-center gap-3 font-mono text-xs text-terminal-muted">
          <span className="flex items-center gap-1"><ShoppingCart size={14} /> {lists.length} 个清单 · {totalItems} 项</span>
          <CloseTabButton />
        </div>
      </div>

      <div className="mb-3 border border-terminal-border bg-terminal-panel2 px-4 py-2 font-mono text-[10px] leading-relaxed text-terminal-muted">
        用法：<span className="text-terminal-amber">复制导入文本</span> → 游戏内拍卖行 Shopping 页 → <span className="text-terminal-amber">Import</span> 粘贴 → 自动建清单 → <span className="text-terminal-amber">Search All</span> 批量搜索逐个拍下。
        搜索词统一用基础名（去随机前缀，如"轻身法杖"而非"孤狼之轻身法杖"），一次命中全部前缀变体。反向：游戏端「导出」的文本可粘贴到下方导入框回存网页。
      </div>

      <ShoppingListsManager lists={lists} />

      <footer className="mt-3 border border-terminal-border bg-terminal-panel px-4 py-2 font-mono text-[10px] leading-relaxed text-terminal-muted">
        清单数据存储在本地 SQLite（ShoppingList / ShoppingListItem 表）。物品名去随机前缀（"之"后部分）作为搜索词；固定名如"河爪之斧"会退化为基础词"斧"（多匹配同词物品，可在清单内删除不想要的）。
      </footer>
    </main>
  );
}
