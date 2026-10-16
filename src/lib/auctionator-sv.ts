// Auctionator SavedVariables 读取与解码（M1 共享库，由 M0 验证脚本抽出）。
//
// 关键事实（M0 验证，2026-10-13）：
// - Auctionator.lua 是"ASCII 转义文本 + 原始二进制字节"混合，必须字节保真读取
//   （readFileSync 无编码 → toString("latin1")）；按 UTF-8 读会把 0x80-0xFF 损坏，CBOR 不可逆。
// - Lua 字符串转义含 \DDD（1-3 位十进制字符码），通用 SV 解析器（parseSavedVariables）不完整，
//   二进制字符串必须用 decodeLuaString 还原。
// - 价格数据库按服务器槽存储（Forever 上按服务器类型命名，如 "PvP"），CBOR 序列化（标准 CBOR，
//   C_EncodingUtil.SerializeCBOR / LibCBOR），Node `cbor` 包可解；键是 byte string → 返回 Map，
//   需递归转普通对象。
// - 天序号 day = floor((time() - SCAN_DAY_0) / 86400)，SCAN_DAY_0 = 2020-01-01 00:00 本地时区
//   （Lua os.time 表参数按本地时区）。day 边界 = 玩家本地午夜。
import { readFileSync } from "node:fs";
import cbor from "cbor";
import { lua, lauxlib, lualib, to_luastring, type LuaState } from "fengari";

export type AuctionatorItemBlock = {
  /** 最后见到的买入最低价（铜）；最新价锚点 */
  m?: number;
  /** day -> 当日最低低价（仅当日最低 < 当日最高时记录；多数日子缺失） */
  l?: Record<string, number>;
  /** day -> 当日最高低价 */
  h?: Record<string, number>;
  /** day -> 当日最高在售量 */
  a?: Record<string, number>;
};

export type AuctionatorParsed = {
  /** dbKey -> 价格块；普通物品 dbKey = itemId 字符串（装备才带 g:/gr:/p: 前缀） */
  priceDatabase: Record<string, AuctionatorItemBlock>;
  /** itemId -> NPC 卖价（VENDOR_PRICE_CACHE，明文）；单位 = **银**（经典 GetMerchantItemPrice 返回银，
   *  CraftingInfo 里 price/stack 得小数）；导入端需 ×100 转铜与现有 Item.vendorPrice 语义一致 */
  vendorPriceCache: Record<number, number>;
  /** 挂单历史（明文，当前为空对象）；结构随 Auctionator 版本变化，导入端做最小适配 */
  postingHistory: Record<string, unknown>;
  /** AUCTIONATOR_SAVEDVARS.TimeOfLastBrowseScan：最近浏览/扫描时间戳（秒）；新鲜度锚点候选 */
  timeOfLastBrowseScan?: number;
  /** WAHScanTimes：每市场最近扫描完成时间（market="faction"|"neutral" → 秒时间戳）。
   *  全局 TimeOfLastBrowseScan 会被任一市场扫描刷新，快照共用它会让"扫中立后联盟也显示刚刚"；
   *  此字段按市场独立记录（插件 AutoReload 扫描完成事件写入）。旧存档缺失时回退全局时间。 */
  scanTimes: Record<string, number>;
  /** 原始解析出的全部顶层变量（供导入端按需取用） */
  rawGlobals: Record<string, unknown>;
};

const SCAN_DAY_0_LOCAL_SEC = new Date(2020, 0, 1, 0, 0, 0).getTime() / 1000;

/** day 序号 → UTC 午夜日期（DailySummary.date 用 UTC 日语义，与现有 addon 数据一致） */
export function auctionatorDayToUtcDay(day: number): Date {
  const localMidnight = new Date((SCAN_DAY_0_LOCAL_SEC + day * 86400) * 1000);
  return new Date(Date.UTC(localMidnight.getFullYear(), localMidnight.getMonth(), localMidnight.getDate()));
}

/** 今天（玩家本地）的 day 序号 */
export function auctionatorTodayDay(): number {
  return Math.floor((Date.now() / 1000 - SCAN_DAY_0_LOCAL_SEC) / 86400);
}

/** Lua 字符串转义：\n \r \t \" \\ 以及 \DDD（1-3 位十进制字符码）。WoW 写 SV 时二进制字节走 \DDD。 */
export function decodeLuaString(raw: string): string {
  return raw.replace(
    /\\(?:([0-9]{1,3})|(n)|(r)|(t)|(a)|(b)|(f)|(v)|(")|(')|(\\))/g,
    (_m, d: string | undefined, n: string | undefined, r: string | undefined, t: string | undefined,
     a: string | undefined, b: string | undefined, f: string | undefined, v: string | undefined,
     q: string | undefined, sq: string | undefined, bs: string | undefined) => {
      if (d !== undefined) return String.fromCharCode(parseInt(d, 10));
      if (n !== undefined) return "\n";
      if (r !== undefined) return "\r";
      if (t !== undefined) return "\t";
      if (a !== undefined) return "\x07";
      if (b !== undefined) return "\b";
      if (f !== undefined) return "\f";
      if (v !== undefined) return "\x0B";
      if (q !== undefined) return '"';
      if (sq !== undefined) return "'";
      if (bs !== undefined) return "\\";
      return "";
    }
  );
}

/** 顶层变量块（从 `NAME = {` 到配对的 `}`，含外层大括号）。用大括号配对扫描，
 *  而非 `^}` 正则——明文多行嵌套表（如 PvP_N）的闭括号在行首，`^}` 会提前截断。 */
export function extractTopLevelVariable(source: string, name: string): string | null {
  const startRe = new RegExp(`^${name} = \\{`, "m");
  const start = startRe.exec(source);
  if (!start) return null;
  const openIdx = start.index + start[0].length - 1; // '{' 位置
  let depth = 0;
  let i = openIdx;
  let inString = false;
  let quote: string | null = null;
  while (i < source.length) {
    const c = source[i];
    if (inString) {
      if (c === "\\") { i += 2; continue; }
      if (c === quote) inString = false;
    } else {
      if (c === '"' || c === "'") { inString = true; quote = c; }
      else if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) break; }
    }
    i++;
  }
  if (depth !== 0) return null;
  return source.slice(openIdx, i + 1);
}

/** 提取 [key] = "..." 字符串（单行），返回 Lua 转义还原后的 JS 字符串。 */
function extractStringField(block: string, key: string): string | null {
  const re = new RegExp(`\\["${key}"\\] = "((?:[^"\\\\]|\\\\.)*)"`, "m");
  const m = re.exec(block);
  return m ? decodeLuaString(m[1]) : null;
}

/** 提取 [key] = 数字（整数）。 */
function extractIntField(block: string, key: string): number | null {
  const re = new RegExp(`\\["${key}"\\] = (\\d+)`, "m");
  const m = re.exec(block);
  return m ? Number(m[1]) : null;
}

/** CBOR 键是 byte string → cbor 库返回 Map；递归转普通对象（键 Buffer→utf8 字符串）。 */
function toPlainObject(x: unknown): unknown {
  if (x instanceof Map) {
    const o: Record<string, unknown> = {};
    for (const [k, v] of x) o[Buffer.isBuffer(k) ? k.toString("utf8") : String(k)] = toPlainObject(v);
    return o;
  }
  if (Array.isArray(x)) return x.map(toPlainObject);
  if (x && typeof x === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) o[k] = toPlainObject(v);
    return o;
  }
  return x;
}

function decodePriceDatabase(block: string, realmSlot: string): Record<string, AuctionatorItemBlock> {
  const version = extractIntField(block, "__dbversion");
  const text = extractStringField(block, realmSlot);
  if (text !== null) {
    const buf = Buffer.from(text, "latin1");
    let decoded: unknown;
    try {
      decoded = cbor.decodeFirstSync(buf);
    } catch (e) {
      throw new Error(`CBOR 解码失败（槽 ${realmSlot}）: ${e instanceof Error ? e.message : String(e)}`);
    }
    const obj = toPlainObject(decoded);
    if (!obj || typeof obj !== "object") throw new Error(`CBOR 解码结果不是对象（槽 ${realmSlot}）`);
    return obj as Record<string, AuctionatorItemBlock>;
  }
  // 明文 Lua 表槽（Forever：PvP_N 已排除 Auctionator 启动串行化编码，以表保存在存档）。
  const plain = parsePlainTableSlot(block, realmSlot);
  if (plain !== null) return plain;
  throw new Error(`AUCTIONATOR_PRICE_DATABASE 找不到 [${realmSlot}] 槽（__dbversion=${version ?? "?"}；请先在游戏内用 Auctionator 扫描）`);
}

/** 提取 `["key"] = { ... }` 的完整表文本（大括号配对，跨行、含嵌套与字符串）。 */
function extractTableField(block: string, key: string): string | null {
  const startRe = new RegExp(`\\["${key}"\\] = \\{`, "m");
  const start = startRe.exec(block);
  if (!start) return null;
  const openIdx = start.index + start[0].length - 1; // '{' 位置
  let depth = 0;
  let i = openIdx;
  let inString = false;
  let quote: string | null = null;
  while (i < block.length) {
    const c = block[i];
    if (inString) {
      if (c === "\\") { i += 2; continue; }
      if (c === quote) inString = false;
    } else {
      if (c === '"' || c === "'") { inString = true; quote = c; }
      else if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) break; }
    }
    i++;
  }
  if (depth !== 0) return null;
  return block.slice(openIdx, i + 1);
}

/** Lua 栈值 → JS 值（数字→number、字符串→string、表→普通对象递归）。
 *  注意：fengari 的 lua_tostring 返回 Uint8Array，须用 lua_tojsstring 正确解码。 */
function luaValueToJS(L: LuaState): unknown {
  const t = lua.lua_type(L, -1);
  if (t === lua.LUA_TNUMBER) return lua.lua_tonumber(L, -1);
  if (t === lua.LUA_TSTRING) {
    const js = (lua as unknown as { lua_tojsstring: (L: LuaState, i: number) => string }).lua_tojsstring(L, -1);
    return js;
  }
  if (t === lua.LUA_TBOOLEAN) return lua.lua_toboolean(L, -1) ? true : false;
  if (t === lua.LUA_TTABLE) {
    const obj: Record<string, unknown> = {};
    lua.lua_pushnil(L);
    while (lua.lua_next(L, -2) !== 0) {
      const key = lua.lua_tostring(L, -2);
      const keyStr = key instanceof Uint8Array ? String.fromCharCode(...key) : String(key);
      const val = luaValueToJS(L);
      if (val !== undefined) obj[keyStr] = val;
      lua.lua_pop(L, 1);
    }
    return obj;
  }
  return undefined;
}

/** 用 fengari 解析明文 Lua 表槽（`["PvP_N"] = { ... }`）→ 物品块记录。 */
function parsePlainTableSlot(block: string, key: string): Record<string, AuctionatorItemBlock> | null {
  const tableText = extractTableField(block, key);
  if (tableText === null) return null;
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  try {
    const status = lauxlib.luaL_loadbuffer(L, to_luastring("return " + tableText), 0, to_luastring("@neutral-slot"));
    if (status !== 0) return null;
    if (lua.lua_pcall(L, 0, 1, 0) !== 0) return null;
    const obj = luaValueToJS(L);
    if (!obj || typeof obj !== "object") return null;
    return obj as Record<string, AuctionatorItemBlock>;
  } finally {
    lua.lua_close(L);
  }
}

function decodeVendorPriceCache(block: string): Record<number, number> {
  const out: Record<number, number> = {};
  for (const m of block.matchAll(/\["(\d+)"\] = ([\d.]+)/g)) {
    out[Number(m[1])] = Number(m[2]);
  }
  return out;
}

/**
 * 读取并解码 Auctionator.lua 的全部网页可用数据。
 * @param path Auctionator.lua 绝对路径
 * @param realmSlot 价格数据库槽名（Forever 上按服务器类型命名，如 "PvP"；如服务器变化需配置）
 */
export function readAuctionatorSavedVars(path: string, realmSlot: string): AuctionatorParsed {
  const buf = readFileSync(path);
  const source = buf.toString("latin1");

  const rawGlobals: Record<string, unknown> = {};
  for (const m of source.matchAll(/^([A-Z][A-Z0-9_]*) = \{/gm)) {
    const name = m[1];
    const block = extractTopLevelVariable(source, name);
    if (block !== null) rawGlobals[name] = block;
  }

  const dbBlock = rawGlobals.AUCTIONATOR_PRICE_DATABASE as string | undefined;
  const vendorBlock = rawGlobals.AUCTIONATOR_VENDOR_PRICE_CACHE as string | undefined;
  const savedVarsBlock = rawGlobals.AUCTIONATOR_SAVEDVARS as string | undefined;
  const postingBlock = rawGlobals.AUCTIONATOR_POSTING_HISTORY as string | undefined;

  const priceDatabase = dbBlock !== undefined ? decodePriceDatabase(dbBlock, realmSlot) : {};
  const vendorPriceCache = vendorBlock !== undefined ? decodeVendorPriceCache(vendorBlock) : {};
  const timeOfLastBrowseScan = savedVarsBlock !== undefined ? extractIntField(savedVarsBlock, "TimeOfLastBrowseScan") ?? undefined : undefined;

  // POSTING_HISTORY 是明文（当前 { __dbversion=1 } 空对象）；结构随版本变化，导入端做最小适配。
  const postingHistory: Record<string, unknown> = { __dbversion: postingBlock !== undefined ? extractIntField(postingBlock, "__dbversion") : undefined };

  // WAHScanTimes 是驼峰顶层变量（rawGlobals 正则只抓全大写名），单独提取明文表：
  // WAHScanTimes = { ["faction"] = <秒>, ["neutral"] = <秒> }
  const scanTimesBlock = extractTopLevelVariable(source, "WAHScanTimes");
  const scanTimes: Record<string, number> = {};
  if (scanTimesBlock !== null) {
    for (const key of ["faction", "neutral"]) {
      const v = extractIntField(scanTimesBlock, key);
      if (v !== null) scanTimes[key] = v;
    }
  }

  return { priceDatabase, vendorPriceCache, postingHistory, timeOfLastBrowseScan, scanTimes, rawGlobals };
}
