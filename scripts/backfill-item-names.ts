// 占位物品批量补名：站点的物品列表页（/items/list/N）只收录"新增/改动"物品，
// 未改动的经典物品（亚麻包 4238 这类）不在列表里——扫描导入后只能以
// "Item {id}" 占位名出现，市场表/搜索全是马甲。本脚本对全部占位行逐个抓
// 物品页（/zh-cn/item/{id}，经典物品页面存在，已验证 2589）补
// name/quality/category/subCategory/vendorPrice/itemLevel。
//
// 解析与 m1b-forever-library.ts 的 parseItems 同源（2026-11 站点改版后的结构：
// 名字 <h1><span class="qN">名</span>；it-sub "普通，商品，布料，物品等级5"；
// 卖价 it-add 行优先）。
//
// 限速 INTERVAL_MS（默认 150ms）+ 403 退避 15s×3 + 断点续跑
// （scripts/.names-progress.json）。幂等：只处理 name 为 "Item {id}" 占位的行。
//
// 跑法：npx tsx scripts/backfill-item-names.ts   （约 3600+ 件 ≈ 10-20 分钟）
import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROGRESS_FILE = join(__dirname, ".names-progress.json");
const LOG_FILE = join(__dirname, "backfill-item-names.log");
const INTERVAL_MS = Number(process.env.NAMES_INTERVAL_MS ?? 150);
const RETRY_DELAY_MS = 15000;
const MAX_PAGES = Number(process.env.NAMES_MAX ?? 0); // 0=全部；冒烟可设小值

const p = new PrismaClient();
const G: Record<string, number> = { 金: 10000, 银: 100, 铜: 1 };
const QUALITY_OF_Q: Record<number, string> = {
  0: "poor", 1: "common", 2: "uncommon", 3: "rare", 4: "epic", 5: "legendary", 6: "artifact", 7: "heirloom",
};

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
          "Accept-Language": "zh-CN,zh;q=0.9"
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

type ParsedItem = { name: string; quality: string; category: string; subCategory: string; vendorPrice: number | null; ilvl: number | null };

// HTML 实体解码：中文页没有的物品会回落英文名（含 &#x27; 撇号等），必须解码再入库。
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

function parseItem(html: string): ParsedItem | null {
  // 物品名：<h1><span class="q1">亚麻布</span>…（2026-11 改版结构）
  const nameM = html.match(/<h1[^>]*><span class="q(\d+)"[^>]*>([^<]+)<\/span>/);
  if (!nameM) return null;
  const name = decodeEntities(nameM[2]).trim();
  const quality = QUALITY_OF_Q[Number(nameM[1])] ?? "unknown";
  // <p class="it-sub">普通，商品，布料，物品等级5，物品 2589。</p>
  const subM = html.match(/<p class="it-sub">([\s\S]*?)<\/p>/);
  let category = "unknown";
  let subCategory = "unknown";
  let ilvl: number | null = null;
  if (subM) {
    const parts = subM[1].replace(/<!--[\s\S]*?-->/g, "").split("，").map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) category = parts[1];
    if (parts.length >= 3) subCategory = parts[2];
    const ilvlM = subM[1].match(/物品等级(\d+)/);
    if (ilvlM) ilvl = Number(ilvlM[1]);
  }
  // 卖价：无限服差异行（it-add）优先；经典版为 it-del。两段式物品页
  // （头部/侧栏对比）中第一处卖价是经典值，it-add 行是无限服修改值。
  let vendorPrice: number | null = null;
  const addM = html.match(/class="it-line[^"]*it-add[^"]*"[^>]*>卖价[：:]\s*([^<\n]+)/);
  const sellM = addM ?? html.match(/卖价[：:]\s*([^<\n]+)/);
  if (sellM) {
    const s = sellM[1];
    const total = (s.match(/(\d+)(金|银|铜)/g) ?? []).reduce((sum, part) => {
      const v = parseInt(part, 10);
      return sum + v * (G[part.slice(-1)] ?? 1);
    }, 0);
    if (s.includes("金") || s.includes("银") || s.includes("铜")) vendorPrice = total;
  }
  return { name, quality, category, subCategory, vendorPrice, ilvl };
}

async function main() {
  // 目标：全部占位名行（auctionator-import 创建的 "Item {id}"）。
  const placeholders = await p.item.findMany({
    where: { name: { startsWith: "Item " } },
    select: { itemId: true, name: true },
    orderBy: { itemId: "asc" }
  });
  log(`占位物品共 ${placeholders.length} 件`);
  const done = new Set<number>(existsSync(PROGRESS_FILE) ? JSON.parse(readFileSync(PROGRESS_FILE, "utf8")) : []);
  const todo = placeholders.filter((r) => !done.has(r.itemId)).map((r) => r.itemId);
  if (MAX_PAGES > 0) todo.length = Math.min(todo.length, MAX_PAGES);
  log(`已处理 ${done.size}，本次 ${todo.length}`);

  let ok = 0, noParse = 0, fail = 0;
  for (let i = 0; i < todo.length; i++) {
    const itemId = todo[i];
    const html = await fetchText(`https://foreverchanges.pro/zh-cn/item/${itemId}`);
    if (html === null) { fail++; }
    else {
      const parsed = parseItem(html);
      if (!parsed) noParse++;
      else {
        // 只补缺：已有非占位名（其它渠道先补过）不覆盖；vendor/ilvl 始终刷新。
        const cur = await p.item.findUnique({ where: { itemId }, select: { name: true } });
        const isPlaceholder = !cur?.name || /^Item \d+$/.test(cur.name);
        await p.item.update({
          where: { itemId },
          data: {
            ...(isPlaceholder ? { name: parsed.name, quality: parsed.quality, category: parsed.category, subCategory: parsed.subCategory } : {}),
            ...(parsed.vendorPrice !== null ? { vendorPrice: parsed.vendorPrice } : {}),
            ...(parsed.ilvl !== null ? { itemLevel: parsed.ilvl } : {})
          }
        });
        ok++;
      }
    }
    done.add(itemId);
    if ((i + 1) % 100 === 0 || i === todo.length - 1) {
      writeFileSync(PROGRESS_FILE, JSON.stringify([...done]));
      log(`进度 ${i + 1}/${todo.length} 累计: 补名 ${ok} 无解析 ${noParse} 失败 ${fail}`);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  writeFileSync(PROGRESS_FILE, JSON.stringify([...done]));
  log(`完成: 补名 ${ok} / 无解析 ${noParse} / 失败 ${fail}（404=站点无此物品页）`);
  await p.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
