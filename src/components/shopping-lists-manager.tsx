"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  createShoppingList,
  renameShoppingList,
  deleteShoppingList,
  addItemsToList,
  removeShoppingListItem,
  importShoppingListText,
  searchItems
} from "@/app/actions";
import { buildListImportText } from "@/lib/shopping-list";
import type { ShoppingListWithItems } from "@/lib/repositories";
import { ItemIcon } from "@/components/item-icon";
import { qualityColorClassById } from "@/lib/quality";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { useLang, useLL } from "@/components/lang-provider";
import { displayName } from "@/lib/i18n";

type SearchHit = { itemId: number; name: string; nameEn?: string | null; quality: string; icon: string | null };

const inputClass = "border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-slate-200 outline-none placeholder:text-terminal-muted/60 focus:border-terminal-amber/60";
const btnClass = "border border-terminal-border px-2 py-1 text-xs text-terminal-muted outline-none transition-colors hover:border-terminal-amber/50 hover:text-terminal-amber disabled:opacity-40";

// /lists 购物清单管理页：清单 CRUD + 物品管理 + 一键复制 Auctionator 导入文本
// + 粘贴导入（解析游戏端导出的文本）。数据存数据库，变更后 router.refresh()
// 拉新 RSC 重新渲染（props 即真相，不做本地缓存）。
export function ShoppingListsManager({ lists }: { lists: ShoppingListWithItems[] }) {
  const lang = useLang();
  const tr = useLL();
  const [selectedId, setSelectedId] = useState(lists[0]?.id ?? "");
  const [newName, setNewName] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [importText, setImportText] = useState("");
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState<ShoppingListWithItems | null>(null);
  const router = useRouter();

  // 进入 /lists 或切回标签时强制拉取最新 RSC：主页"加入"后服务端已 revalidatePath，
  // 但 Next 客户端路由缓存不会自动失效，直接导航回来会显示旧数据——这里自动刷新，
  // 无需手动刷新页面。
  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden) router.refresh();
    };
    router.refresh();
    window.addEventListener("focus", onVisibility);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onVisibility);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router]);

  const selected = lists.find((list) => list.id === selectedId) ?? null;
  const refresh = () => {
    router.refresh();
    // RSC 刷新后组件重挂载，selectedId 可能失效——保留在当前清单 id（若被删则回退首个）。
    if (selected && !lists.some((l) => l.id === selectedId)) {
      setSelectedId(lists[0]?.id ?? "");
    }
  };

  const act = (fn: () => Promise<unknown>, okText: string) => {
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await fn();
        if (typeof result === "string" && lists.every((l) => l.id !== result)) setSelectedId(result);
        setFeedback({ kind: "ok", text: okText });
        refresh();
      } catch (err) {
        setFeedback({ kind: "err", text: err instanceof Error ? err.message : tr("Operation failed", "操作失败") });
      }
    });
  };

  const doSearch = () => {
    if (!query.trim()) { setHits([]); return; }
    startTransition(async () => {
      try {
        setHits(await searchItems(query));
      } catch {
        setHits([]);
      }
    });
  };

  const copyImportText = async () => {
    if (!selected) return;
    const text = buildListImportText(selected.name, selected.items.map((i) => i.name));
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setFeedback({ kind: "err", text: tr("Copy failed (browser permission) — select and copy the text manually", "复制失败（浏览器权限），请手动选择文本复制") });
    }
  };

  return (
    <>
    <div className="grid gap-3 xl:grid-cols-[320px_1fr]">
      {/* 左栏：清单列表 + 新建 */}
      <Panel>
        <PanelHeader title={tr("Shopping Lists", "购物清单")} action={<span className="text-[10px] text-terminal-muted">{tr(`${lists.length} total`, `共 ${lists.length} 个`)}</span>} />
        <div className="space-y-1 p-3">
          {lists.length === 0 && (
            <div className="font-mono text-xs text-terminal-muted">{tr("No lists yet. Enter a name on the right to create one.", "还没有清单。右侧输入名字新建一个。")}</div>
          )}
          {lists.map((list) => (
            <button
              key={list.id}
              type="button"
              onClick={() => setSelectedId(list.id)}
              className={`flex w-full items-center justify-between gap-2 border px-2 py-1.5 font-mono text-xs text-left outline-none transition-colors ${
                list.id === selectedId
                  ? "border-terminal-amber/60 bg-terminal-amber/10 text-terminal-amber"
                  : "border-terminal-border text-slate-200 hover:border-terminal-border/70 hover:bg-slate-800/35"
              }`}
            >
              <span className="truncate">{list.name}</span>
              <span className="shrink-0 text-[10px] text-terminal-muted">{tr(`${list.items.length} items`, `${list.items.length} 项`)}</span>
            </button>
          ))}
          <div className="flex gap-1 pt-1">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) { act(() => createShoppingList(newName).then((id) => { setNewName(""); return id; }), tr("Created", "已新建")); } }}
              placeholder={tr("New list name…", "新清单名…")}
              className={`${inputClass} min-w-0 flex-1`}
            />
            <button
              type="button"
              disabled={pending || !newName.trim()}
              onClick={() => act(() => createShoppingList(newName).then((id) => { setNewName(""); return id; }), tr("Created", "已新建"))}
              className={btnClass}
            >
              {tr("Create", "新建")}
            </button>
          </div>

          {/* 搜索单个物品添加（用户要求放在左栏新建清单下面） */}
          <div className="flex gap-1 pt-1">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") doSearch(); }}
              placeholder={tr("Search item name / ID to add…", "搜物品名 / 物品 ID 添加…")}
              className={`${inputClass} min-w-0 flex-1`}
            />
            <button type="button" onClick={doSearch} disabled={pending} className={btnClass}>{tr("Search", "搜索")}</button>
          </div>
          {hits.length > 0 && (
            <div className="max-h-40 overflow-y-auto border border-terminal-border bg-terminal-bg">
              {hits.map((hit) => (
                <button
                  key={hit.itemId}
                  type="button"
                  onClick={() => {
                    if (!selected) { setFeedback({ kind: "err", text: tr("Select a list to add to first", "先选择要加入的清单") }); return; }
                    const name = displayName(hit.name, hit.nameEn, lang);
                    act(() => addItemsToList(selected.id, [{ itemId: hit.itemId, name }]), tr(`Added ${name}`, `已加入 ${name}`));
                  }}
                  className="flex w-full items-center gap-2 px-2 py-1 text-left font-mono text-[11px] text-slate-200 outline-none hover:bg-slate-800/40"
                >
                  <ItemIcon itemId={hit.itemId} icon={hit.icon} size={16} />
                  <span className={`truncate ${qualityColorClassById(Number(hit.quality) || 0)}`}>{displayName(hit.name, hit.nameEn, lang)}</span>
                  <span className="ml-auto shrink-0 text-[9px] text-terminal-muted">#{hit.itemId} · {tr("Add", "加入")}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </Panel>

      {/* 右栏：当前清单详情 */}
      <div className="space-y-3">
        <Panel>
          <PanelHeader
            title={selected ? tr(`List: ${selected.name}`, `清单：${selected.name}`) : tr("No list selected", "未选择清单")}
            action={
              selected && (
                <span className="flex items-center gap-2 text-[10px]">
                  <button type="button" onClick={copyImportText} className={btnClass} title={tr("Copy as Auctionator import text (listName^item1^item2)", "复制为 Auctionator 可导入文本（清单名^物品1^物品2）")}>
                    {copied ? tr("Copied ✓", "已复制 ✓") : tr("Copy import text", "复制导入文本")}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => selected && setConfirmDelete(selected)}
                    className={`${btnClass} text-terminal-red hover:text-terminal-red`}
                  >
                    {tr("Delete list", "删除清单")}
                  </button>
                </span>
              )
            }
          />
          <div className="p-3">
            {!selected ? (
              <div className="font-mono text-xs text-terminal-muted">{tr("Pick a list on the left, or create one.", "左侧选择一个清单，或新建一个。")}</div>
            ) : (
              <>
                {/* 重命名 */}
                <div className="mb-2 flex items-center gap-1">
                  <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} placeholder={tr("Rename (empty = unchanged)…", "重命名（留空不变）…")} className={`${inputClass} flex-1`} />
                  <button
                    type="button"
                    disabled={pending || !renameValue.trim()}
                    onClick={() => act(() => renameShoppingList(selected.id, renameValue).then(() => { setRenameValue(""); }), tr("Renamed", "已重命名"))}
                    className={btnClass}
                  >
                    {tr("Rename", "重命名")}
                  </button>
                </div>

                {/* 物品列表 */}
                {selected.items.length === 0 ? (
                  <div className="font-mono text-xs text-terminal-muted">{tr("List is empty. Add via search on the left, or paste-import below.", "清单为空。用左侧搜索添加，或用下方\"粘贴导入\"。")}</div>
                ) : (
                  <div className="max-h-[320px] overflow-y-auto border border-terminal-border">
                    {selected.items.map((item) => (
                      <div key={item.id} className="flex items-center gap-2 border-b border-terminal-border/50 px-2 py-1 font-mono text-[11px] last:border-b-0">
                        {item.itemId !== null ? (
                          <Link href={`/items/${item.itemId}`} target="_blank" data-no-ladder className="flex min-w-0 items-center gap-1.5 text-slate-200 hover:text-terminal-amber">
                            <ItemIcon itemId={item.itemId} icon={item.icon} size={16} />
                            <span className="truncate">{item.name}</span>
                            <span className="shrink-0 text-[9px] text-terminal-muted">#{item.itemId}</span>
                          </Link>
                        ) : (
                          <span className="min-w-0 truncate text-slate-200">{item.name}</span>
                        )}
                        <span className="shrink-0 text-[9px] text-terminal-muted">×{item.quantity}</span>
                        <button
                          type="button"
                          onClick={() => act(() => removeShoppingListItem(item.id), tr(`Removed ${item.name}`, `已移除 ${item.name}`))}
                          className="ml-auto shrink-0 text-[10px] text-terminal-muted outline-none hover:text-terminal-red"
                          title={tr("Remove from list", "移出清单")}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </Panel>

        {/* 粘贴导入（游戏端导出文本 → 网页） */}
        <Panel>
          <PanelHeader title={tr("Paste import (Auctionator export text → web)", "粘贴导入（Auctionator 导出文本 → 网页）")} />
          <div className="space-y-2 p-3">
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={4}
              placeholder={lang === "zh"
                ? "粘贴游戏内 Auctionator「导出」的文本，例如：\n清单名^物品1^物品2\n（新版格式：^ 分隔物品，换行分清单；同名清单会覆盖）"
                : "Paste the in-game Auctionator \"Export\" text, e.g.:\nlistName^item1^item2\n(8.3+ format: ^ separates items, newlines separate lists; same-name lists are overwritten)"}
              className={`${inputClass} w-full resize-y leading-relaxed`}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={pending || !importText.trim()}
                onClick={() => act(() => importShoppingListText(importText).then((n) => { setImportText(""); return n; }), tr("Imported", "已导入"))}
                className={btnClass}
              >
                {tr("Import", "导入")}
              </button>
              {feedback && (
                <span className={`font-mono text-[11px] ${feedback.kind === "ok" ? "text-terminal-green" : "text-terminal-red"}`}>
                  {feedback.text}
                </span>
              )}
            </div>
          </div>
        </Panel>
      </div>
    </div>

    {/* 删除清单二次确认（自定义弹窗，避免浏览器原生 confirm 的英文标题与 OK/Cancel） */}
    {confirmDelete && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
        onClick={() => setConfirmDelete(null)}
      >
        <div
          className="w-full max-w-[360px] border border-terminal-border bg-terminal-panel p-4 font-mono shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 text-sm text-terminal-amber">{tr("Delete list", "删除清单")}</div>
          <div className="mb-1 text-xs leading-relaxed text-slate-200">
            {tr(`Delete list "${confirmDelete.name}"?`, `确认删除清单「${confirmDelete.name}」吗？`)}
          </div>
          <div className="mb-4 text-[11px] leading-relaxed text-terminal-muted">
            {tr(`Its ${confirmDelete.items.length} items will be deleted too. This cannot be undone.`, `其中 ${confirmDelete.items.length} 项物品将一并删除，此操作不可恢复。`)}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmDelete(null)} className={btnClass}>
              {tr("Cancel", "取消")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                const id = confirmDelete.id;
                setConfirmDelete(null);
                act(() => deleteShoppingList(id), tr("Deleted", "已删除"));
              }}
              className={`${btnClass} border-terminal-red/60 text-terminal-red hover:bg-terminal-red/10`}
            >
              {pending ? tr("Deleting…", "删除中…") : tr("Confirm delete", "确认删除")}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
