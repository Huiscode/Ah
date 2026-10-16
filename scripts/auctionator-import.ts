// M1 数据层：Auctionator 全量导入（一次性脚本，可重复跑，幂等）。
//
// 数据流：Auctionator.lua（登出落盘）→ 字节保真读取 + Lua 转义还原 → CBOR 解码价格数据库
//   → ① AuctionSnapshot 重建"每物品最新价"（先删后插）
//   → ② DailySummary 重建每日 l/h/a（先删后插）
//   → ③ Item.vendorPrice 由 foreverchanges.pro 实测价维护（Auctionator VENDOR_PRICE_CACHE 因 ×400 失真弃用）
//   → ④ POSTING_HISTORY 结构待版本适配（当前为空，解析器就绪）
//
// 两个市场分槽导入（2026-10-15 用户拍板：数据严禁混槽）：
//   联盟（faction）← AUCTIONATOR_PRICE_DATABASE[PvP]（AQ_AUCTIONATOR_REALM_SLOT）
//   中立（neutral）← AUCTIONATOR_PRICE_DATABASE[PvP_N]（AQ_AUCTIONATOR_NEUTRAL_SLOT）
//   中立槽缺失（还没扫过中立市场）时跳过中立导入，联盟照常。
//
// 幂等性：快照与每日都是"当前全量"语义（Auctionator 保留 21 天窗口），先删后插天然幂等；
// 快照/每日 DELETE 按 market 隔离，联盟与中立互不污染；旧 source='addon' 数据不触碰。
//
// 跑法：npx tsx scripts/auctionator-import.ts
import { writeFileSync } from "node:fs";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readAuctionatorSavedVars, auctionatorDayToUtcDay, type AuctionatorItemBlock, type AuctionatorParsed } from "@/lib/auctionator-sv";

process.loadEnvFile();

const SV_PATH = process.env.AQ_AUCTIONATOR_SV_PATH
  ?? "C:\\Program Files (x86)\\World of Warcraft\\_classic_beta_\\WTF\\Account\\1120133458#1\\SavedVariables\\Auctionator.lua";
const REALM_SLOT = process.env.AQ_AUCTIONATOR_REALM_SLOT ?? "PvP";
const NEUTRAL_SLOT = process.env.AQ_AUCTIONATOR_NEUTRAL_SLOT ?? "PvP_N";
const SERVER = process.env.AQ_SERVER ?? "Classic Beta PvP 2";
const FACTION = process.env.AQ_FACTION ?? "Alliance";
const NEUTRAL_FACTION = process.env.AQ_AUCTIONATOR_NEUTRAL_FACTION ?? "Neutral";
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

/** 指定 day 的在售量（a[day]）；无记录 = 0。 */
function quantityOnDay(block: AuctionatorItemBlock, day: number): number {
  return block.a?.[day] ?? 0;
}

/** 本次扫描日：价格库中所有 day 桶（l/h/a）的最大值。Auctionator 只给
 *  "本次扫到在售"的物品写当天 a——某物品 a 无此 day = 本次扫描无在售，
 *  其残留 m（最后见到的买入价）不可当作当前行情，否则会把上周的旧价
 *  显示成今天的价（如墨水 10-08 后无在售，却被显示成 1 金）。 */
function latestSeenDayOf(entries: Array<[string, AuctionatorItemBlock]>): number {
  let maxDay = -Infinity;
  for (const [, block] of entries) {
    for (const bucket of [block.l, block.h, block.a]) {
      if (!bucket) continue;
      for (const k of Object.keys(bucket)) {
        const d = Number(k);
        if (d > maxDay) maxDay = d;
      }
    }
  }
  return maxDay;
}

type SnapshotRow = {
  itemId: number; timestamp: Date; server: string; faction: string; market: string; source: string;
  minPrice: bigint; marketPrice: bigint; altPrice: null; quantity: number; numAuctions: number; rawPayload: Prisma.InputJsonValue;
};
type DailyRow = {
  itemId: number; date: Date; market: string; source: string;
  openPrice: bigint; closePrice: bigint; highPrice: bigint; lowPrice: bigint; volume: number;
};
type MarketData = {
  market: string; faction: string; entries: Array<[string, AuctionatorItemBlock]>;
  scannedAt: Date; latestSeenDay: number; snapshots: SnapshotRow[]; daily: DailyRow[]; itemIds: number[]; dayRange: number[];
};

/** 单个市场（槽）的完整数据构建：联盟或中立。 */
function buildMarketData(parsed: AuctionatorParsed, market: string, factionLabel: string): MarketData {
  const entries = Object.entries(parsed.priceDatabase);
  const latestSeenDay = latestSeenDayOf(entries);
  // 快照时间戳优先级：
  //   1) 本市场扫描完成时间（WAHScanTimes，按 market 独立）；
  //   2) 无本市场扫描时间时，若该市场数据最后一天 == 全局时间当天 → 用全局时间（数据到今天）；
  //      否则该市场已停更 → 用其最后数据日的正午近似（避免"扫中立后联盟也显示刚刚"）；
  //   3) 空市场回退全局 TimeOfLastBrowseScan / 现在。
  // 防御：WAHScanTimes 若被旧插件写成 GetTime()（游戏启动相对秒，远小于 Unix 秒阈值 1e9），视为无效。
  const scanTime = parsed.scanTimes?.[market];
  const validScanTime = scanTime !== undefined && scanTime > 1_000_000_000;
  let scannedAtSec: number;
  if (validScanTime) {
    scannedAtSec = scanTime;
  } else if (Number.isFinite(latestSeenDay) && latestSeenDay > 0) {
    const globalSec = parsed.timeOfLastBrowseScan ?? Math.floor(Date.now() / 1000);
    const dayDate = auctionatorDayToUtcDay(latestSeenDay);
    const globalDate = new Date(globalSec * 1000);
    const sameDay =
      dayDate.getUTCFullYear() === globalDate.getUTCFullYear() &&
      dayDate.getUTCMonth() === globalDate.getUTCMonth() &&
      dayDate.getUTCDate() === globalDate.getUTCDate();
    scannedAtSec = sameDay ? globalSec : dayDate.getTime() / 1000 + 12 * 3600;
  } else {
    scannedAtSec = parsed.timeOfLastBrowseScan ?? Math.floor(Date.now() / 1000);
  }
  const scannedAt = new Date(scannedAtSec * 1000);
  const snapshots: SnapshotRow[] = [];
  const daily: DailyRow[] = [];
  const itemIds: number[] = [];
  const dayKeys = new Set<number>();

  for (const [dbKey, block] of entries) {
    const itemId = Number(dbKey);
    if (!Number.isInteger(itemId)) continue; // 跳过装备 g:/gr:/p: 等复合键（本方案只做普通物品）
    itemIds.push(itemId);
    if (block.m !== undefined) {
      const m = BigInt(block.m);
      const seenToday = quantityOnDay(block, latestSeenDay) > 0; // 本次扫描有在售
      const qty = seenToday ? quantityOnDay(block, latestSeenDay) : 0;
      snapshots.push({
        itemId, timestamp: scannedAt, server: SERVER, faction: factionLabel, market, source: SOURCE,
        // 无在售物品 price=0（本次未扫到），前端按"缺货"处理，绝不复用残留 m。
        minPrice: seenToday ? m : 0n, marketPrice: seenToday ? m : 0n, altPrice: null,
        quantity: qty, numAuctions: qty,
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
        itemId, date: auctionatorDayToUtcDay(day), market, source: SOURCE,
        openPrice: price, closePrice: price, highPrice: BigInt(h ?? l ?? 0), lowPrice: price,
        volume: block.a?.[dayKey] ?? 0
      });
    }
  }

  const dayRange = [...dayKeys].sort((a, b) => a - b);
  return { market, faction: factionLabel, entries, scannedAt, latestSeenDay, snapshots, daily, itemIds, dayRange };
}

async function main() {
  const parsedFaction = readAuctionatorSavedVars(SV_PATH, REALM_SLOT);
  const factionEntries = Object.entries(parsedFaction.priceDatabase);
  if (factionEntries.length === 0) {
    console.error("价格数据库为空——请先在游戏内用 Auctionator 扫描（全量扫描按钮），登出后重试。");
    process.exit(1);
  }

  // 中立槽缺失（还没扫过中立市场）时跳过中立导入，联盟照常。
  let parsedNeutral: AuctionatorParsed | null = null;
  try {
    parsedNeutral = readAuctionatorSavedVars(SV_PATH, NEUTRAL_SLOT);
  } catch (e) {
    console.log(`中立槽 ${NEUTRAL_SLOT} 未找到，跳过中立导入（${e instanceof Error ? e.message : String(e)}）`);
  }

  const faction = buildMarketData(parsedFaction, "faction", FACTION);
  const neutral = parsedNeutral ? buildMarketData(parsedNeutral, "neutral", NEUTRAL_FACTION) : null;

  console.log(`联盟槽 ${REALM_SLOT}: ${faction.entries.length} 物品 | TimeOfLastBrowseScan=${parsedFaction.timeOfLastBrowseScan ?? "无"} (${faction.scannedAt.toISOString()})`);
  if (neutral) {
    console.log(`中立槽 ${NEUTRAL_SLOT}: ${neutral.entries.length} 物品 | TimeOfLastBrowseScan=${parsedNeutral!.timeOfLastBrowseScan ?? "无"} (${neutral.scannedAt.toISOString()})`);
  }

  // ---- ① Item 表：占位创建缺失（两市场合并去重）。vendor 价不再从 VENDOR_PRICE_CACHE 写入 ----
  // 2026-10-14 实测：Auctionator VENDOR_PRICE_CACHE 对多数物品失真（真价 ×400，如墨水 5 银被记为 2000 银），
  // 必赚/配方 floor 依赖 vendorPrice，已全面改用 foreverchanges.pro 游戏内实测价（scripts/_tmp-vendor-fix.ts 已修正 72 条）。
  const existingItems = await prisma.item.findMany({ select: { itemId: true, vendorPrice: true } });
  const existingIds = new Set(existingItems.map((row) => row.itemId));
  const allItemIds = new Set([...faction.itemIds, ...(neutral?.itemIds ?? [])]);
  const itemCreates = [...allItemIds]
    .filter((itemId) => !existingIds.has(itemId))
    .map((itemId) => ({ itemId, name: `Item ${itemId}`, quality: "unknown", category: "unknown", subCategory: "unknown", vendorPrice: 0 }));
  // vendorUpdates 有意置空：避免下次导入把失真的 VENDOR_PRICE_CACHE 值重新写回。
  const vendorUpdates: Array<{ itemId: number; price: number }> = [];

  console.log(`快照行: 联盟 ${faction.snapshots.length}${neutral ? ` / 中立 ${neutral.snapshots.length}` : ""} | 每日行: 联盟 ${faction.daily.length}${neutral ? ` / 中立 ${neutral.daily.length}` : ""} | day 范围: 联盟 ${faction.dayRange[0] ?? "-"}~${faction.dayRange[faction.dayRange.length - 1] ?? "-"}`);
  console.log(`Item 占位创建: ${itemCreates.length} | vendor 更新: ${vendorUpdates.length} | PostingRecord: 未适配（结构随版本变化，当前为空）`);

  // ---- 事务：先删后插（market 隔离，联盟与中立互不污染；旧 addon 数据不受影响） ----
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  if (itemCreates.length > 0) ops.push(prisma.item.createMany({ data: itemCreates }));
  ops.push(...vendorUpdates.map((u) => prisma.item.update({ where: { itemId: u.itemId }, data: { vendorPrice: u.price } })));
  for (const marketData of [faction, neutral].filter((m): m is MarketData => m !== null)) {
    ops.push(prisma.auctionSnapshot.deleteMany({ where: { server: SERVER, faction: marketData.faction, market: marketData.market, source: SOURCE } }));
    ops.push(...chunk(marketData.snapshots, BULK_CHUNK).map((slice) => prisma.auctionSnapshot.createMany({ data: slice })));
    ops.push(prisma.dailySummary.deleteMany({ where: { source: SOURCE, market: marketData.market } }));
    ops.push(...chunk(marketData.daily, BULK_CHUNK).map((slice) => prisma.dailySummary.createMany({ data: slice })));
  }
  await prisma.$transaction(ops);

  writeFileSync(statePath, JSON.stringify({ lastMtime: new Date().toISOString(), lastSeenBrowseTs: parsedFaction.timeOfLastBrowseScan ?? null, importedAt: new Date().toISOString() }), "utf8");

  console.log(`✅ 导入完成：联盟 ${faction.snapshots.length} 快照 + ${faction.daily.length} 每日${neutral ? `；中立 ${neutral.snapshots.length} 快照 + ${neutral.daily.length} 每日` : ""} + ${itemCreates.length} 新 Item + ${vendorUpdates.length} vendor 更新`);
}

main().catch((e) => { console.error(e); process.exit(1); });
