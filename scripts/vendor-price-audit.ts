// vendor 价全量核对：以 foreverchanges.pro 物品页"卖价"为权威，逐条核对
// Item.vendor_price（旧 Auctionator 缓存值失真，须全部重核）。
// - 断点续跑：scripts/.vendor-audit-progress.json 记录已成功的 itemId
// - 限速：间隔 2.5s；403 退避 15s 重试 3 次
// - 页面无"卖价" → vendor_price=0（NPC 不收）
// - 游戏内实时商人价优先：启动时解析 WAHVendorDB，已有游戏内值的物品跳过
//   （游戏内值由服务器下发，比网站核对更实时更准）
// 用法：npx tsx scripts/vendor-price-audit.ts
import { prisma } from "../src/lib/prisma";
import { loadVendorGamePrices } from "../src/lib/vendor-sv";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROGRESS_FILE = join(__dirname, ".vendor-audit-progress.json");
const LOG_FILE = join(__dirname, "vendor-audit.log");
const INTERVAL_MS = 2500;
const RETRY_DELAY_MS = 15000;

const G: Record<string, number> = { 金: 10000, 银: 100, 铜: 1 };

function parseSellPrice(html: string): number | null {
  const m = html.match(/卖价[：:]\s*([^<\n]+)/);
  if (!m) return null;
  const s = m[1];
  const total = (s.match(/(\d+)(金|银|铜)/g) ?? []).reduce((sum, part) => {
    const v = parseInt(part, 10);
    return sum + v * (G[part.slice(-1)] ?? 1);
  }, 0);
  return s.includes("金") || s.includes("银") || s.includes("铜") ? total : 0;
}

function log(msg: string) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  try { writeFileSync(LOG_FILE, line + "\n", { flag: "a" }); } catch {}
}

async function main() {
  const rows = await prisma.$queryRaw<Array<{ itemId: number; v: bigint | null }>>`
    SELECT "item_id" AS "itemId", "vendor_price" AS v FROM "Item" WHERE "vendor_price" > 0 ORDER BY "item_id"`;
  const total = rows.length;
  log(`待核对 ${total} 条`);

  const done = new Set<number>(existsSync(PROGRESS_FILE) ? JSON.parse(readFileSync(PROGRESS_FILE, "utf8")) : []);
  // 游戏内实时商人价优先：启动时解析 WAHVendorDB，有游戏内值的物品不进核对队列。
  const gamePrices = loadVendorGamePrices();
  const gameIds = gamePrices ? new Set(gamePrices.keys()) : new Set<number>();
  const remaining = rows.filter((r) => !done.has(r.itemId) && !gameIds.has(r.itemId));
  log(`已核对 ${done.size}，游戏内实时价跳过 ${gameIds.size}，本次续跑 ${remaining.length}`);

  let ok = 0, zero = 0, fail = 0;
  for (let i = 0; i < remaining.length; i++) {
    const { itemId } = remaining[i];
    let status = "?";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`https://foreverchanges.pro/zh-cn/item/${itemId}`, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36", "Accept-Language": "zh-CN,zh;q=0.9" }
        });
        if (res.status === 403) { status = "403"; await new Promise((r) => setTimeout(r, RETRY_DELAY_MS)); continue; }
        if (!res.ok) { status = `HTTP ${res.status}`; break; }
        const html = await res.text();
        const parsed = parseSellPrice(html);
        if (parsed === null) { status = "no-sell"; break; } // 页面无卖价 → NPC 不收
        await prisma.$executeRaw`UPDATE "Item" SET "vendor_price" = ${parsed} WHERE "item_id" = ${itemId}`;
        if (parsed === 0) zero++; else ok++;
        status = "ok";
        break;
      } catch (e) { status = `ERR ${(e as Error).message.slice(0, 50)}`; break; }
    }
    if (status === "no-sell") {
      await prisma.$executeRaw`UPDATE "Item" SET "vendor_price" = 0 WHERE "item_id" = ${itemId}`;
      zero++;
    }
    if (status === "ok" || status === "no-sell") {
      done.add(itemId);
      writeFileSync(PROGRESS_FILE, JSON.stringify([...done]));
    } else fail++;
    if ((i + 1) % 25 === 0 || i === remaining.length - 1) {
      log(`进度 ${i + 1}/${remaining.length} 累计: 有效 ${ok} 置0 ${zero} 失败 ${fail} 待重试: ${status}`);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  log(`完成: 有效 ${ok} 置0 ${zero} 失败 ${fail}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
