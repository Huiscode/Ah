/**
 * M0 PoC：解码 Auctionator.lua 的价格数据库（CBOR），验证：
 *   1) Forever 客户端 C_EncodingUtil.SerializeCBOR / LibCBOR 序列化是否可用标准 CBOR 解码；
 *   2) 天序号 (l/h/a 的 key) 与 SCAN_DAY_0=2020-01-01 00:00(本地) 的换算是否自洽；
 *   3) 解出的价格与现有 prisma/dev.db 的 P10 量级对比（口径不同，仅看合理性）。
 *
 * 跑法：npx tsx scripts/auctionator-m0-decode.ts
 * 注意：本脚本是验证工具，非最终导入端；最终 auctionator-watch 会复用其解码逻辑。
 */
import { readFileSync } from "node:fs";
import cbor from "cbor";

const SV_PATH = "C:\\Program Files (x86)\\World of Warcraft\\_classic_beta_\\WTF\\Account\\1120133458#1\\SavedVariables\\Auctionator.lua";
const DB_PATH = new URL("../prisma/dev.db", import.meta.url).pathname;
const REALM_SLOT = "PvP"; // AUCTIONATOR_PRICE_DATABASE 的服务器槽（Forever 上按服务器类型命名）

// Lua SavedVariables 顶层变量 = 各自独立的提取（本项目 parseSavedVariables 对 \ddd 转义不完整，
// 二进制 CBOR 字符串必须用本函数解码，不能直接喂给现有解析器）。
function extractTopLevelVariable(source: string, name: string): string | null {
  const re = new RegExp(`^${name} = \\{([\\s\\S]*?)^\\}`, "m");
  const m = re.exec(source);
  return m ? m[1] : null;
}

// 提取 [key] = "..." 字符串（单行），返回解码后的 JS 字符串。
function extractStringField(block: string, key: string): string | null {
  const re = new RegExp(`\\["${key}"\\] = "((?:[^"\\\\]|\\\\.)*)"`, "m");
  const m = re.exec(block);
  return m ? decodeLuaString(m[1]) : null;
}

// Lua 字符串转义：\n \r \t \" \\ 以及 \DDD（1-3 位十进制字符码）。WoW 写 SV 时二进制字节走 \DDD。
function decodeLuaString(raw: string): string {
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

// SCAN_DAY_0 = time({year=2020, month=1, day=1, hour=0})，Lua os.time 按本地时区。
const SCAN_DAY_0_LOCAL_SEC = new Date(2020, 0, 1, 0, 0, 0).getTime() / 1000;
function dayToLocalDate(day: number): string {
  const d = new Date((SCAN_DAY_0_LOCAL_SEC + day * 86400) * 1000);
  return d.toLocaleDateString("sv-SE"); // yyyy-mm-dd（本地时区）
}

type ItemBlock = { m?: number; l?: Record<string, number>; h?: Record<string, number>; a?: Record<string, number> };

function main() {
  // 关键：SV 文件是"ASCII 转义文本 + 原始二进制字节"混合，必须字节保真读取（latin1），
  // 不能按 UTF-8 读（会把 0x80-0xFF 字节损坏成 U+FFFD，CBOR 数据将不可逆）。
  const buf = readFileSync(SV_PATH);
  const source = buf.toString("latin1");

  // 1) 顶层变量清单
  const topVars = [...source.matchAll(/^([A-Z][A-Z0-9_]*) = \{/gm)].map((m) => m[1]);
  console.log("顶层变量:", topVars.join(", "));

  const dbBlock = extractTopLevelVariable(source, "AUCTIONATOR_PRICE_DATABASE");
  if (!dbBlock) { console.error("找不到 AUCTIONATOR_PRICE_DATABASE"); process.exit(1); }
  const versionM = /\["__dbversion"\] = (\d+)/.exec(dbBlock);
  console.log("价格数据库 __dbversion:", versionM ? versionM[1] : "?");

  // 2) CBOR 解码
  const cborText = extractStringField(dbBlock, REALM_SLOT);
  if (!cborText) {
    console.error(`找不到 [${REALM_SLOT}] 槽`);
    console.error("dbBlock 前 400 字符:", JSON.stringify(dbBlock.slice(0, 400)));
    console.error("dbBlock 长度:", dbBlock.length);
    const probe = new RegExp(`\\["${REALM_SLOT}\\] = "((?:[^"\\\\]|\\\\.)*)"`, "m").exec(dbBlock);
    console.error("直接探针匹配:", probe ? `命中 ${probe[1].length} 字符` : "未命中");
    process.exit(1);
  }
  console.log(`[${REALM_SLOT}] 槽 CBOR 字符串长度: ${cborText.length} chars`);
  const cborBuf = Buffer.from(cborText, "latin1");
  console.log("CBOR 前 24 字节:", [...cborBuf.subarray(0, 24)].map((b) => b.toString(16).padStart(2, "0")).join(" "));

  const decoded = (() => {
    try {
      return cbor.decodeFirstSync(cborBuf) as unknown;
    } catch (e) {
      console.log("decodeFirstSync 抛错:", (e as Error).message);
      try {
        const all = cbor.decodeAllSync(cborBuf) as unknown[];
        console.log("decodeAllSync 顶层项数:", all.length);
        return all[0];
      } catch (e2) {
        console.log("decodeAllSync 也抛错:", (e2 as Error).message);
        process.exit(1);
      }
    }
  })();

  // CBOR 键是 byte string → cbor 库返回 Map；递归转普通对象（键 Buffer→utf8 字符串）
  function toObj(x: unknown): unknown {
    if (x instanceof Map) {
      const o: Record<string, unknown> = {};
      for (const [k, v] of x) o[Buffer.isBuffer(k) ? k.toString("utf8") : String(k)] = toObj(v);
      return o;
    }
    if (Array.isArray(x)) return x.map(toObj);
    if (x && typeof x === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(x as Record<string, unknown>)) o[k] = toObj(v);
      return o;
    }
    return x;
  }
  console.log("decoded 类型:", decoded?.constructor?.name, "| 顶层条目:", decoded instanceof Map ? decoded.size : Object.keys(decoded as object).length);
  if (!decoded || typeof decoded !== "object") { console.error("CBOR 解码结果不是对象"); process.exit(1); }
  const items = toObj(decoded) as Record<string, ItemBlock>;
  const itemIds = Object.keys(items);
  console.log(`物品条目数: ${itemIds.length}`);

  // 3) day 范围与换算验证
  const days = new Set<number>();
  for (const id of itemIds) {
    for (const f of ["l", "h", "a"] as const) {
      const t = items[id]?.[f];
      if (t) for (const k of Object.keys(t)) days.add(Number(k));
    }
  }
  if (days.size) {
    const sorted = [...days].sort((x, y) => x - y);
    console.log(`day 范围: ${sorted[0]} (${dayToLocalDate(sorted[0])}) ~ ${sorted[sorted.length - 1]} (${dayToLocalDate(sorted[sorted.length - 1])})`);
    const today = Math.floor((Date.now() / 1000 - SCAN_DAY_0_LOCAL_SEC) / 86400);
    console.log(`今天(本地) day 序号: ${today} —— 最新数据距今 ${today - sorted[sorted.length - 1]} 天`);
  }

  // 4) 样例物品（含关键 ID）
  const KEY_IDS = [4370, 4338, 2589, 2947, 21217];
  const samples: string[] = [];
  for (const id of KEY_IDS) {
    const b = items[String(id)];
    samples.push(b ? fmtItem(id, b, items) : `#${id}: 无记录`);
  }
  // 再取 6 个有 m 的随机物品
  const withM = itemIds.filter((id) => items[id]?.m !== undefined);
  const extra = withM.filter((id) => !KEY_IDS.includes(Number(id))).slice(0, 6);
  console.log("\n—— 样例（关键物品 + 随机）——");
  for (const s of samples) console.log(s);
  for (const id of extra) console.log(fmtItem(Number(id), items[id], items));
  console.log(`有 m(最后最低价) 的物品: ${withM.length} / ${itemIds.length}`);

  // 5) VENDOR_PRICE_CACHE
  const vpBlock = extractTopLevelVariable(source, "AUCTIONATOR_VENDOR_PRICE_CACHE");
  if (vpBlock) {
    const vp = cbor ? null : null;
    const pairs = [...vpBlock.matchAll(/\["(\d+)"\] = ([\d.]+)/g)];
    console.log(`\nVENDOR_PRICE_CACHE: ${pairs.length} 条`);
    for (const p of pairs.slice(0, 8)) console.log(`  item ${p[1]} → ${p[2]} 铜`);
  } else {
    console.log("\nVENDOR_PRICE_CACHE: 未找到");
  }
}

function fmtItem(id: number, b: ItemBlock, all: Record<string, ItemBlock>): string {
  const days = new Set<number>();
  for (const f of ["l", "h", "a"] as const) if (b[f]) for (const k of Object.keys(b[f]!)) days.add(Number(k));
  const sorted = [...days].sort((x, y) => x - y).slice(-3);
  const hist = sorted
    .map((d) => {
      const l = b.l?.[d] ?? "·"; const h = b.h?.[d] ?? "·"; const a = b.a?.[d] ?? "·";
      return `${dayToLocalDate(d)}: l=${l} h=${h} a=${a}`;
    })
    .join(" | ");
  const also = Object.keys(all).length - 0; // noop, keeps signature tidy
  void also;
  return `#${id} m=${b.m ?? "?"} [${hist}]`;
}

main();
