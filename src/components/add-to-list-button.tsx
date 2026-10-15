"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addItemsToList, getShoppingListOptions, type ListItemInput } from "@/app/actions";

// 通用"加入清单"入口：雷达/收藏/配方共用。
// 默认模式：按钮 + 点击展开清单选择器（展开时实时拉取最新清单）。
// inline 模式：直接内联一行"清单 [下拉] [加入]"，无按钮无浮层（关注物品面板用，
// 对应"全部加入清单按钮删除、整行放标题右侧、无清单显示标注"的用户要求）。
export function AddToListButton({ items, lists: initialLists, label = "加入清单", inline = false }: {
  items: ListItemInput[];
  lists: Array<{ id: string; name: string }>;
  label?: string;
  inline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState(initialLists);
  const [listId, setListId] = useState(initialLists[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  // inline 模式：挂载即拉取，且每次窗口重新聚焦 / 页面恢复可见时再拉一次，
  // 保证 /lists 里新建或删除清单后切回主页无需手动刷新即可看到最新结果。
  useEffect(() => {
    if (!inline) return;
    const refresh = () => {
      getShoppingListOptions()
        .then((fresh) => {
          setLists(fresh);
          setListId((prev) => (fresh.some((l) => l.id === prev) ? prev : fresh[0]?.id ?? ""));
        })
        .catch(() => {});
    };
    const onVisibility = () => {
      if (!document.hidden) refresh();
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [inline]);

  // 展开时实时拉取最新清单（/lists 新建后无需刷新页面即可看到）
  const toggleOpen = async () => {
    const next = !open;
    setOpen(next);
    if (next) {
      try {
        const fresh = await getShoppingListOptions();
        setLists(fresh);
        setListId((prev) => (fresh.some((l) => l.id === prev) ? prev : fresh[0]?.id ?? ""));
      } catch {
        // 拉取失败保持现状（仍可用初始列表）
      }
    }
  };

  const submit = () => {
    if (!listId || pending) return;
    setError("");
    setDone(false);
    startTransition(async () => {
      try {
        await addItemsToList(listId, items);
        setDone(true);
        setOpen(false);
        router.refresh();
        setTimeout(() => setDone(false), 1600);
      } catch (err) {
        setError(err instanceof Error ? err.message : "加入失败");
      }
    });
  };

  if (lists.length === 0) {
    return (
      <a
        href="/lists"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 border border-terminal-border px-1.5 py-0.5 text-[10px] text-terminal-muted outline-none hover:text-terminal-amber"
        title="还没有购物清单，去 /lists 新建"
      >
        {inline ? "清单（先去建清单）" : `${label}（先去建清单）`}
      </a>
    );
  }

  if (inline) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <span className="text-[10px] text-terminal-muted">清单</span>
        <select
          value={listId}
          onChange={(e) => setListId(e.target.value)}
          className="min-w-[84px] max-w-[140px] border border-terminal-border bg-terminal-bg px-1 py-0.5 text-[10px] text-slate-200 outline-none"
        >
          {lists.map((list) => (
            <option key={list.id} value={list.id}>{list.name}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="shrink-0 whitespace-nowrap border border-terminal-amber/60 px-1.5 py-0.5 text-[10px] text-terminal-amber outline-none hover:bg-terminal-amber/10 disabled:opacity-40"
        >
          {pending ? "加入中…" : "加入"}
        </button>
        {done && <span className="text-[10px] text-terminal-green">已加入</span>}
        {error && <span className="text-[10px] text-terminal-red" title={error}>失败</span>}
      </span>
    );
  }

  return (
    <span className="relative inline-flex items-center gap-1">
      <button
        type="button"
        onClick={toggleOpen}
        disabled={pending}
        className="inline-flex items-center gap-1 whitespace-nowrap border border-terminal-border px-1.5 py-0.5 text-[10px] text-terminal-muted outline-none transition-colors hover:border-terminal-amber/50 hover:text-terminal-amber disabled:opacity-40"
        title={`把当前 ${items.length} 个物品加入购物清单`}
      >
        {label}
      </button>
      {open && (
        <span className="absolute right-0 top-full z-30 mt-1 flex items-center gap-1 whitespace-nowrap border border-terminal-border bg-terminal-panel px-1.5 py-1 shadow-lg">
          <select
            value={listId}
            onChange={(e) => setListId(e.target.value)}
            className="min-w-[96px] max-w-[160px] border border-terminal-border bg-terminal-bg px-1 py-0.5 text-[10px] text-slate-200 outline-none"
          >
            {lists.map((list) => (
              <option key={list.id} value={list.id}>{list.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="shrink-0 whitespace-nowrap border border-terminal-amber/60 px-1.5 py-0.5 text-[10px] text-terminal-amber outline-none hover:bg-terminal-amber/10 disabled:opacity-40"
          >
            {pending ? "加入中…" : "加入"}
          </button>
        </span>
      )}
      {done && <span className="text-[10px] text-terminal-green">已加入</span>}
      {error && <span className="text-[10px] text-terminal-red" title={error}>失败</span>}
    </span>
  );
}
