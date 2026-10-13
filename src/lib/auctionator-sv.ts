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

/** 顶层变量块（从 `NAME = {` 到第一个行首 `}`）。 */
export function extractTopLevelVariable(source: string, name: string): string | null {
  const re = new RegExp(`^${name} = \\{([\\s\\S]*?)^\\}`, "m");
  const m = re.exec(source);
  return m ? m[1] : null;
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
  if (text === null) {
    throw new Error(`AUCTIONATOR_PRICE_DATABASE 找不到 [${realmSlot}] 槽（__dbversion=${version ?? "?"}；请先在游戏内用 Auctionator 扫描）`);
  }
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

  return { priceDatabase, vendorPriceCache, postingHistory, timeOfLastBrowseScan, rawGlobals };
}
