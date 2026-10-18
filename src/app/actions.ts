"use server";

// Single mutation surface for watchlist and shopping-list writes. All writes
// revalidate the pages that render them.
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { parseImportText, baseNameOf } from "@/lib/shopping-list";

export async function toggleWatchlist(itemId: number) {
  const existing = await prisma.watchlist.findUnique({ where: { itemId } });
  if (existing) {
    await prisma.watchlist.delete({ where: { itemId } });
  } else {
    await prisma.watchlist.create({ data: { itemId } });
  }
  revalidatePath("/");
  revalidatePath(`/items/${itemId}`);
}

// ---------------------------------------------------------------------------
// 购物清单（2026-10-15 用户需求）：数据库版清单 + Auctionator 导入文本。
// 清单以名称为唯一键；物品以 (listId, name) 为唯一键，重复加入自动跳过。
// ---------------------------------------------------------------------------

export type ListItemInput = { itemId: number | null; name: string; quantity?: number };

function revalidateLists() {
  revalidatePath("/lists");
  revalidatePath("/");
  revalidatePath("/recipes");
}

// 各页"加入清单"入口展开下拉时实时拉取最新清单（/lists 新建后无需刷新页面）。
export async function getShoppingListOptions(): Promise<{ id: string; name: string }[]> {
  return prisma.shoppingList.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
}

export async function createShoppingList(name: string) {
  const cleaned = (name ?? "").trim().replace(/[\n^]/g, "");
  if (!cleaned) throw new Error("清单名不能为空");
  const existing = await prisma.shoppingList.findUnique({ where: { name: cleaned } });
  if (existing) throw new Error(`清单"${cleaned}"已存在`);
  const created = await prisma.shoppingList.create({ data: { name: cleaned } });
  revalidateLists();
  return created.id;
}

export async function renameShoppingList(id: string, name: string) {
  const cleaned = (name ?? "").trim().replace(/[\n^]/g, "");
  if (!cleaned) throw new Error("清单名不能为空");
  const existing = await prisma.shoppingList.findUnique({ where: { name: cleaned } });
  if (existing && existing.id !== id) throw new Error(`清单"${cleaned}"已存在`);
  await prisma.shoppingList.update({ where: { id }, data: { name: cleaned } });
  revalidateLists();
}

export async function deleteShoppingList(id: string) {
  await prisma.shoppingList.delete({ where: { id } });
  revalidateLists();
}

// 加入物品：按名称去重（忽略已在清单中的条目）；清单项统一存搜索词
// （baseNameOf 剥离随机前缀，导入 Auctionator 一次命中全部前缀变体）。
export async function addItemsToList(listId: string, items: ListItemInput[]) {
  if (!items.length) return;
  const list = await prisma.shoppingList.findUnique({ where: { id: listId }, include: { items: true } });
  if (!list) throw new Error("清单不存在");
  const existing = new Set(list.items.map((item) => item.name));
  const seen = new Set<string>();
  const rows = items
    .map((item) => ({
      name: baseNameOf(item.name ?? ""),
      itemId: item.itemId ?? null,
      quantity: Math.max(1, item.quantity ?? 1)
    }))
    .filter((row) => {
      if (!row.name || existing.has(row.name) || seen.has(row.name)) return false;
      seen.add(row.name);
      return true;
    });
  if (rows.length) {
    await prisma.shoppingListItem.createMany({ data: rows.map((row) => ({ listId, ...row })) });
  }
  revalidateLists();
}

export async function removeShoppingListItem(id: string) {
  await prisma.shoppingListItem.delete({ where: { id } });
  revalidateLists();
}

// 解析并导入 Auctionator 新版文本（"清单名^物品1^物品2"，^ 分隔、换行分清单），
// 同名清单覆盖（与游戏内 Import 语义一致：ClearItems + AppendItems）。
// 物品名匹配 Item 表：先按原名精确匹配，未命中按基础名匹配（兼容全名/搜索词）。
export async function importShoppingListText(text: string) {
  const parsed = parseImportText(text);
  if (!parsed.length) throw new Error("未识别到可导入的清单文本（需为'清单名^物品1^物品2'格式）");

  const allItems = await prisma.item.findMany({ select: { itemId: true, name: true } });
  const byName = new Map(allItems.map((i) => [i.name, i.itemId]));
  const byBase = new Map<string, number>();
  for (const i of allItems) {
    const b = baseNameOf(i.name);
    if (!byBase.has(b)) byBase.set(b, i.itemId);
  }

  for (const entry of parsed) {
    const cleaned = entry.name.trim().replace(/[\n^]/g, "");
    if (!cleaned) continue;

    // 批内去重：同一文本里重复出现的物品只保留一条（避免撞 unique(list_id,name) 约束）
    const seen = new Set<string>();
    const rows: { name: string; itemId: number | null; quantity: number }[] = [];
    for (const n of entry.names) {
      const name = baseNameOf(n);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      rows.push({ name, itemId: byName.get(n) ?? byBase.get(name) ?? null, quantity: 1 });
    }

    // 覆盖：删除旧清单（如有）后重建
    const existing = await prisma.shoppingList.findUnique({ where: { name: cleaned } });
    if (existing) {
      await prisma.shoppingListItem.deleteMany({ where: { listId: existing.id } });
      if (rows.length) {
        await prisma.shoppingListItem.createMany({ data: rows.map((row) => ({ listId: existing.id, ...row })) });
      }
    } else {
      await prisma.shoppingList.create({
        data: { name: cleaned, items: { create: rows } }
      });
    }
  }
  revalidateLists();
  return parsed.length;
}

// 添加物品用的轻量搜索：按名称子串或精确物品 ID 匹配，返回前 20。
export async function searchItems(query: string) {
  const q = (query ?? "").trim();
  if (!q) return [];
  const numeric = /^\d+$/.test(q) ? Number.parseInt(q, 10) : null;
  const rows = await prisma.item.findMany({
    where: numeric ? { OR: [{ itemId: numeric }, { name: { contains: q } }] } : { name: { contains: q } },
    select: { itemId: true, name: true, quality: true, icon: true },
    orderBy: { itemId: "asc" },
    take: 20
  });
  return rows;
}



