// 英文物品名批量回填：抓 foreverchanges.pro 英文站物品页（/item/{id}，无
// /zh-cn 前缀 = 英文版），把 <h1><span class="qN">英文名</span> 写进
// Item.nameEn。EN 界面（默认）与"复制清单到游戏 Auctionator"都用它——
// 欧服英文客户端需要英文名才能命中搜索。
//
// 与 backfill-item-names.ts（中文占位补名）同源结构：限速 NAMES_EN_INTERVAL_MS
// （默认 250ms）+ 403 退避 15s×3 + 断点续跑（scripts/.names-en-progress.json）。
// 幂等：只处理 nameEn 为空的行；不碰中文名/品类等其它字段。
//
// 跑法：npx tsx scripts/backfill-item-names-en.ts   （~6200 件 ≈ 40-70 分钟；
// 冒烟可 NAMES_EN_MAX=20 跑一小段）
import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROGRESS_FILE = join(__dirname, ".names-en-progress.json");
const LOG_FILE = join(__dirname, "backfill-item-names-en.log");
const INTERVAL_MS = Number(process.env.NAMES_EN_INTERVAL_MS ?? 250);
const RETRY_DELAY_MS = 15000;
const MAX_ITEMS = Number(process.env.NAMES_EN_MAX ?? 0); // 0=全部；冒烟可设小值

const p = new PrismaClient();

function log(msg: string) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  try { writeFileSync(LOG_FILE, line + "\n", { flag: "a" }); } catch {}
}

async function fetchText(url: string, retries = 3): Promise<string | null> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9"
        },
        redirect: "follow"
      });
      if (res.status === 403) {
        log(`403 on ${url} — 退避 ${RETRY_DELAY_MS / 1000}s（第 ${attempt + 1} 次）`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      if (res.status === 404 || res.status === 410 || res.status === 500) return null;
      if (!res.ok) { log(`HTTP ${res.status} on ${url}`); return null; }
      return await res.text();
    } catch (e) {
      log(`fetch error ${url}: ${(e as Error).message.slice(0, 80)}`);
      return null;
    }
  }
  log(`仍 403/失败，跳过 ${url}`);
  return null;
}

// HTML 实体解码（&#x27; / &apos; / &quot; / &amp; / 数字实体等）——
// 站点把名字里的撇号写成 &#x27;，不解码会原样进库（2026-11-15 修过 1926 条）。
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseNameEn(html: string): string | null {
  // 物品名：<h1><span class="q1">Linen Cloth</span>…（与中文页同构）
  const nameM = html.match(/<h1[^>]*><span class="q(\d+)"[^>]*>([^<]+)<\/span>/);
  if (!nameM) return null;
  const name = decodeEntities(nameM[2]).trim();
  // 站点英文页偶发回落中文名（未翻译物品）——与中文名相同则没有意义，跳过。
  if (/^[\u4e00-\u9fff]/.test(name)) return null;
  return name;
}

async function main() {
  const targets = await p.item.findMany({
    where: { nameEn: null },
    select: { itemId: true },
    orderBy: { itemId: "asc" }
  });
  log(`待回填英文名共 ${targets.length} 件`);
  const done = new Set<number>(existsSync(PROGRESS_FILE) ? JSON.parse(readFileSync(PROGRESS_FILE, "utf8")) : []);
  const todo = targets.filter((r) => !done.has(r.itemId)).map((r) => r.itemId);
  if (MAX_ITEMS > 0) todo.length = Math.min(todo.length, MAX_ITEMS);
  log(`已处理 ${done.size}，本次 ${todo.length}`);

  let ok = 0, noParse = 0, fail = 0;
  for (let i = 0; i < todo.length; i++) {
    const itemId = todo[i];
    const html = await fetchText(`https://foreverchanges.pro/item/${itemId}`);
    if (html === null) { fail++; }
    else {
      const nameEn = parseNameEn(html);
      if (!nameEn) noParse++;
      else {
        await p.item.update({ where: { itemId }, data: { nameEn } });
        ok++;
      }
    }
    done.add(itemId);
    if ((i + 1) % 100 === 0 || i === todo.length - 1) {
      writeFileSync(PROGRESS_FILE, JSON.stringify([...done]));
      log(`进度 ${i + 1}/${todo.length} 累计: 回填 ${ok} 无解析 ${noParse} 失败 ${fail}`);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  writeFileSync(PROGRESS_FILE, JSON.stringify([...done]));
  log(`完成: 回填 ${ok} / 无解析 ${noParse} / 失败 ${fail}（404=站点无此物品页）`);
  await p.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
