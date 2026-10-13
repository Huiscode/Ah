// M4 数据层：转录插件（WoWderhoiAH-Transcript）存档导入。
//
// 数据流：游戏内 /wahscan start 扫描 → 登出落盘 WAHTranscribeDB.lua
//   → 本脚本用 fengari（Lua 运行时）执行存档文件取出 WAHTranscribeDB 表
//   → ① AuctionTier 重建完整档位（source='transcript'，先删后插）
//   → ② DailySummary 聚合 transcript 源每日代表价（close=该日最后一次扫描的
//      tier-filter 有效最低价；volume=有效档在售量；先删后插）
//   → ③ 旧 addon / auctionator 源数据不触碰。
//
// 幂等性：档位与每日都是"当前全量"语义（插件 SV 每物品只留最新一轮），先删后插天然幂等。
//
// 跑法：npx tsx scripts/transcript-import.ts
import { readFileSync } from "node:fs";
import { lua, lauxlib, lualib, to_luastring, to_jsstring, type LuaState } from "fengari";
import { prisma } from "@/lib/prisma";
import { effectiveLowestPrice } from "@/lib/tier-filter";

process.loadEnvFile();

const SV_PATH = process.env.AQ_TRANSCRIPT_SV_PATH
  ?? "C:\\Program Files (x86)\\World of Warcraft\\_classic_beta_\\WTF\\Account\\1120133458#1\\SavedVariables\\WAHTranscribeDB.lua";
const SERVER = process.env.AQ_SERVER ?? "Classic Beta PvP 2";
const FACTION = process.env.AQ_FACTION ?? "Alliance";
const MARKET = "faction";
const SOURCE = "transcript";

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
const BULK_CHUNK = 3000;

/** Lua 值 → JS（只处理数字/字符串/布尔/表；表自动区分数组与记录）。 */
function luaToJs(L: LuaState, idx: number): unknown {
  idx = lua.lua_absindex(L, idx); // 锁定绝对索引：后续 push/pop 不改变它
  const t = lua.lua_type(L, idx);
  if (t === lua.LUA_TNUMBER) return lua.lua_tonumber(L, idx);
  if (t === lua.LUA_TSTRING) return to_jsstring(lua.lua_tostring(L, idx));
  if (t === lua.LUA_TBOOLEAN) return lua.lua_toboolean(L, idx);
  if (t === lua.LUA_TNIL) return null;
  if (t === lua.LUA_TTABLE) {
    // 第一遍：只收集 key（迭代体内不递归，保持 lua_next 的 key 栈干净）。
    // 关键：按 Lua key 的**类型**区分数组（number 键）与记录（string 键），
    // 不能用字符串内容判断——Lua 里 "2589" 与 2589 是不同键。
    const keys: Array<{ name: string; numeric: boolean }> = [];
    let isArray = true;
    let maxIdx = -1;
    lua.lua_pushnil(L);
    while (lua.lua_next(L, idx) !== 0) {
      const keyType = lua.lua_type(L, -2);
      const numeric = keyType === lua.LUA_TNUMBER;
      const name = numeric ? String(lua.lua_tonumber(L, -2)) : to_jsstring(lua.lua_tostring(L, -2));
      keys.push({ name, numeric });
      if (!numeric) isArray = false;
      else maxIdx = Math.max(maxIdx, parseInt(name, 10));
      lua.lua_pop(L, 1); // 弹 value，key 留在栈顶供下一次 lua_next
    }
    // 第二遍：按 key 取 value 并递归（数字键用 rawgeti，字符串键用 getfield）。
    const arr: unknown[] = [];
    const obj: Record<string, unknown> = {};
    for (const { name, numeric } of keys) {
      if (numeric) {
        lua.lua_rawgeti(L, idx, parseInt(name, 10));
      } else {
        lua.lua_getfield(L, idx, to_luastring(name));
      }
      const val = luaToJs(L, -1);
      lua.lua_pop(L, 1);
      if (numeric) arr[parseInt(name, 10)] = val;
      else obj[name] = val;
    }
    if (isArray) {
      arr.length = maxIdx + 1; // 1-based Lua 数组 → 0-based
      return arr.slice(1);
    }
    return obj;
  }
  return null;
}

type RawTier = { p?: number; q?: number };
type RawScan = { t?: number; tiers?: RawTier[] };

async function main() {
  let source: string;
  try {
    source = readFileSync(SV_PATH, "utf8");
  } catch {
    console.error(`找不到存档 ${SV_PATH}——请先在游戏内 /wahscan start 扫描并正常登出。`);
    process.exit(1);
  }

  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const buffer = to_luastring(source);
  if (lauxlib.luaL_loadbuffer(L, buffer, buffer.length, to_luastring("WAHTranscribeDB.lua")) !== lua.LUA_OK) {
    console.error(`Lua 解析失败：${to_jsstring(lua.lua_tostring(L, -1))}`);
    process.exit(1);
  }
  if (lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
    console.error(`存档执行失败：${to_jsstring(lua.lua_tostring(L, -1))}`);
    process.exit(1);
  }
  lua.lua_getglobal(L, to_luastring("WAHTranscribeDB"));
  const db = luaToJs(L, -1) as { version?: number; scans?: Record<string, RawScan> } | null;
  lua.lua_close(L);
  if (!db || typeof db !== "object" || !db.scans) {
    console.error("存档里没有 WAHTranscribeDB.scans——请先扫描。");
    process.exit(1);
  }

  const scans = Object.entries(db.scans);
  if (scans.length === 0) {
    console.error("WAHTranscribeDB.scans 为空——请先在游戏内 /wahscan start 扫描。");
    process.exit(1);
  }

  const tiers: Array<{ itemId: number; ts: Date; server: string; faction: string; market: string; source: string; price: bigint; qty: number }> = [];
  const daily: Array<{ itemId: number; date: Date; source: string; openPrice: bigint; closePrice: bigint; highPrice: bigint; lowPrice: bigint; volume: number }> = [];
  const byDay = new Map<string, Map<number, { ts: number; price: bigint; qty: number }>>();

  for (const [key, scan] of scans) {
    const itemId = Number(key);
    if (!Number.isInteger(itemId) || !scan || typeof scan.t !== "number") continue;
    const ts = new Date(scan.t * 1000);
    const utcDay = new Date(Date.UTC(ts.getUTCFullYear(), ts.getUTCMonth(), ts.getUTCDate())).getTime();
    const raw = (scan.tiers ?? []).map((t) => ({ price: Math.round(t.p ?? 0), qty: Math.round(t.q ?? 0) }));
    const result = effectiveLowestPrice(raw);
    for (const t of raw) {
      if (t.price > 0 && t.qty > 0) {
        tiers.push({ itemId, ts, server: SERVER, faction: FACTION, market: MARKET, source: SOURCE, price: BigInt(t.price), qty: t.qty });
      }
    }
    if (result.effectivePrice !== null) {
      const dayMap = byDay.get(String(utcDay)) ?? new Map<number, { ts: number; price: bigint; qty: number }>();
      const prev = dayMap.get(itemId);
      // 同日多次扫描：保留最后一次（ts 最大）的有效价。
      if (!prev || scan.t > prev.ts) dayMap.set(itemId, { ts: scan.t, price: BigInt(result.effectivePrice), qty: result.effectiveQty });
      byDay.set(String(utcDay), dayMap);
    }
  }

  for (const [dayKey, itemMap] of byDay) {
    const date = new Date(Number(dayKey));
    for (const [itemId, v] of itemMap) {
      daily.push({
        itemId, date, source: SOURCE,
        openPrice: v.price, closePrice: v.price, highPrice: v.price, lowPrice: v.price, volume: v.qty
      });
    }
  }

  console.log(`存档解析：${scans.length} 物品 | ${tiers.length} 档位 | ${daily.length} 每日行（${byDay.size} 天）`);

  // 事务：先删后插（source 隔离，addon/auctionator 数据不受影响）
  await prisma.$transaction([
    prisma.auctionTier.deleteMany({ where: { server: SERVER, faction: FACTION, market: MARKET, source: SOURCE } }),
    ...chunk(tiers, BULK_CHUNK).map((slice) => prisma.auctionTier.createMany({ data: slice })),
    prisma.dailySummary.deleteMany({ where: { source: SOURCE } }),
    ...chunk(daily, BULK_CHUNK).map((slice) => prisma.dailySummary.createMany({ data: slice }))
  ]);

  console.log(`✅ 导入完成：${tiers.length} 档位 + ${daily.length} transcript 每日`);
}

main().catch((e) => { console.error(e); process.exit(1); });
