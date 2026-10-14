// M1 数据层：Auctionator 全量导入（一次性脚本，可重复跑，幂等）。
//
// 数据流：Auctionator.lua（登出落盘）→ 字节保真读取 + Lua 转义还原 → CBOR 解码价格数据库
//   → ① AuctionSnapshot 重建"每物品最新价"（source='auctionator'，先删后插）
//   → ② DailySummary 重建每日 l/h/a（source='auctionator'，先删后插）
//   → ③ Item.vendorPrice 由 foreverchanges.pro 实测价维护（Auctionator VENDOR_PRICE_CACHE 因 ×400 失真弃用）
//   → ④ POSTING_HISTORY 结构待版本适配（当前为空，解析器就绪）
//
// 幂等性：快照与每日都是"当前全量"语义（Auctionator 保留 21 天窗口），先删后插天然幂等；
// 旧 source='addon' 数据不触碰（断点标注依据）。
//
// 跑法：npx tsx scripts/auctionator-import.ts
import { readFileSync, writeFileSync } from "node:fs";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readAuctionatorSavedVars, auctionatorDayToUtcDay, type AuctionatorItemBlock } from "@/lib/auctionator-sv";

process.loadEnvFile();

const SV_PATH = process.env.AQ_AUCTIONATOR_SV_PATH
  ?? "C:\\Program Files (x86)\\World of Warcraft\\_classic_beta_\\WTF\\Account\\1120133458#1\\SavedVariables\\Auctionator.lua";
const REALM_SLOT = process.env.AQ_AUCTIONATOR_REALM_SLOT ?? "PvP";
const SERVER = process.env.AQ_SERVER ?? "Classic Beta PvP 2";
const FACTION = process.env.AQ_FACTION ?? "Alliance";
const MARKET = "faction";
const SOURCE = "auctionator";

const statePath = new URL("./.watch-state.json", import.meta.url);

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
const BULK_CHUNK = 3000;

/** 最新 day 的在售量（Auctionator 语义：当日见过的最高量）。 */
function latestQuantity(block: AuctionatorItemBlock): number {
  const a = block.a;
  if (!a) return 0;
  let best = 0;
  let bestDay = -Infinity;
  for (const [k, v] of Object.entries(a)) {
    const d = Number(k);
    if (d > bestDay) { bestDay = d; best = v; }
  }
  return best;
}

async function main() {
  const parsed = readAuctionatorSavedVars(SV_PATH, REALM_SLOT);
  const entries = Object.entries(parsed.priceDatabase);
  if (entries.length === 0) {
    console.error("价格数据库为空——请先在游戏内用 Auctionator 扫描（全量扫描按钮），登出后重试。");
    process.exit(1);
  }

  const scannedAt = new Date((parsed.timeOfLastBrowseScan ?? Math.floor(Date.now() / 1000)) * 1000);
  console.log(`槽 ${REALM_SLOT}: ${entries.length} 物品 | TimeOfLastBrowseScan=${parsed.timeOfLastBrowseScan ?? "无"} (${scannedAt.toISOString()})`);

  // ---- ① Item 表：占位创建缺失。vendor 价不再从 VENDOR_PRICE_CACHE 写入 ----
  // 2026-10-14 实测：Auctionator VENDOR_PRICE_CACHE 对多数物品失真（真价 ×400，如墨水 5 银被记为 2000 银），
  // 必赚/配方 floor 依赖 vendorPrice，已全面改用 foreverchanges.pro 游戏内实测价（scripts/_tmp-vendor-fix.ts 已修正 72 条）。
  const existingItems = await prisma.item.findMany({ select: { itemId: true, vendorPrice: true } });
  const existingIds = new Set(existingItems.map((row) => row.itemId));
  const itemCreates = entries
    .map(([dbKey]) => Number(dbKey))
    .filter((itemId) => Number.isInteger(itemId) && !existingIds.has(itemId))
    .map((itemId) => ({ itemId, name: `Item ${itemId}`, quality: "unknown", category: "unknown", subCategory: "unknown", vendorPrice: 0 }));
  // vendorUpdates 有意置空：避免下次导入把失真的 VENDOR_PRICE_CACHE 值重新写回。
  const vendorUpdates: Array<{ itemId: number; price: number }> = [];

  // ---- ② 快照（有 m 的物品）与 ③ 每日汇总（l/h/a by day） ----
  const snapshots: Array<{
    itemId: number; timestamp: Date; server: string; faction: string; market: string; source: string;
    minPrice: bigint; marketPrice: bigint; altPrice: null; quantity: number; numAuctions: number; rawPayload: Prisma.InputJsonValue;
  }> = [];
  const daily: Array<{
    itemId: number; date: Date; source: string; openPrice: bigint; closePrice: bigint; highPrice: bigint; lowPrice: bigint; volume: number;
  }> = [];
  const dayKeys = new Set<number>();

  for (const [dbKey, block] of entries) {
    const itemId = Number(dbKey);
    if (!Number.isInteger(itemId)) continue; // 跳过装备 g:/gr:/p: 等复合键（本方案只做普通物品）
    if (block.m !== undefined) {
      const m = BigInt(block.m);
      snapshots.push({
        itemId, timestamp: scannedAt, server: SERVER, faction: FACTION, market: MARKET, source: SOURCE,
        minPrice: m, marketPrice: m, altPrice: null,
        quantity: latestQuantity(block), numAuctions: 0,
        rawPayload: { m: block.m, l: block.l ?? {}, h: block.h ?? {}, a: block.a ?? {} }
      });
    }
    for (const dayKey of new Set([...Object.keys(block.l ?? {}), ...Object.keys(block.h ?? {}), ...Object.keys(block.a ?? {})])) {
      const day = Number(dayKey);
      if (!Number.isInteger(day)) continue;
      dayKeys.add(day);
      const l = block.l?.[dayKey] ?? block.h?.[dayKey];
      const h = block.h?.[dayKey] ?? block.l?.[dayKey];
      if (l === undefined && h === undefined) continue;
      const price = BigInt(l ?? h ?? 0);
      daily.push({
        itemId, date: auctionatorDayToUtcDay(day), source: SOURCE,
        openPrice: price, closePrice: price, highPrice: BigInt(h ?? l ?? 0), lowPrice: price,
        volume: block.a?.[dayKey] ?? 0
      });
    }
  }

  console.log(`快照行: ${snapshots.length} | 每日行: ${daily.length} (day ${[...dayKeys].sort((a, b) => a - b)[0] ?? "-"} ~ ${[...dayKeys].sort((a, b) => b - a)[0] ?? "-"})`);
  console.log(`Item 占位创建: ${itemCreates.length} | vendor 更新: ${vendorUpdates.length} | PostingRecord: 未适配（结构随版本变化，当前为空）`);

  // ---- 事务：先删后插（source 隔离，旧 addon 数据不受影响） ----
  await prisma.$transaction([
    ...(itemCreates.length > 0 ? [prisma.item.createMany({ data: itemCreates })] : []),
    ...vendorUpdates.map((u) => prisma.item.update({ where: { itemId: u.itemId }, data: { vendorPrice: u.price } })),
    prisma.auctionSnapshot.deleteMany({ where: { server: SERVER, faction: FACTION, market: MARKET, source: SOURCE } }),
    ...chunk(snapshots, BULK_CHUNK).map((slice) => prisma.auctionSnapshot.createMany({ data: slice })),
    prisma.dailySummary.deleteMany({ where: { source: SOURCE } }),
    ...chunk(daily, BULK_CHUNK).map((slice) => prisma.dailySummary.createMany({ data: slice }))
  ]);

  writeFileSync(statePath, JSON.stringify({ lastMtime: new Date().toISOString(), lastSeenBrowseTs: parsed.timeOfLastBrowseScan ?? null, importedAt: new Date().toISOString() }), "utf8");

  console.log(`✅ 导入完成：${snapshots.length} 快照 + ${daily.length} 每日 + ${itemCreates.length} 新 Item + ${vendorUpdates.length} vendor 更新`);
}

main().catch((e) => { console.error(e); process.exit(1); });
