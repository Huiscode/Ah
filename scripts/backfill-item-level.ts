// backfill-item-level.ts：从 foreverchanges 物品列表页批量回填 Item.item_level。
//
// 分解榜（buildDisenchantBoard）按 品质×护甲/武器×物品等级段 匹配经典分解表，
// 需要每件装备的 ilvl。站点物品页不直接给全量对照，但列表页每条 small 文本带
// "物品等级X"，且无 URL 筛选参数，故逐页翻全量列表建 itemId→ilvl 映射再回写。
//
// 限速 2.5s/页 + 403 退避 15s×3 + 断点续跑（scripts/.ilvl-progress.json）。
// 幂等：只更新库里存在且 ilvl>0 的物品；公测清空后重跑一次即可。
//
// 跑法：npx tsx scripts/backfill-item-level.ts
import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROGRESS_FILE = join(__dirname, ".ilvl-progress.json");
const LOG_FILE = join(__dirname, "backfill-item-level.log");
const INTERVAL_MS = Number(process.env.ILVL_INTERVAL_MS ?? 2500);
const RETRY_DELAY_MS = 15000;
const MAX_PAGES = Number(process.env.ILVL_MAX_PAGES ?? 0); // 0 = 全量；冒烟可设小值
const BASE = "https://foreverchanges.pro/zh-cn/items/list";

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
          "Accept-Language": "zh-CN,zh;q=0.9"
        }
      });
      if (res.status === 403) {
        log(`403 on ${url} — 退避 ${RETRY_DELAY_MS / 1000}s（第 ${attempt + 1} 次）`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
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

// <a class="q1" href="/zh-cn/item/6292">名</a><small>普通，副手物品，物品等级15</small>
function parseListPage(html: string): Map<number, number> {
  const out = new Map<number, number>();
  const re = /<a class="q\d" href="\/zh-cn\/item\/(\d+)">[^<]+<\/a><small>[^<]*物品等级(\d+)[^<]*<\/small>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const itemId = Number(m[1]);
    const ilvl = Number(m[2]);
    if (itemId > 0 && ilvl > 0) out.set(itemId, ilvl);
  }
  return out;
}

// 导航里出现的最大页号；抓不到返回 null。
function maxPageOf(html: string): number | null {
  let max = 0;
  const re = /items\/list\/(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const n = Number(m[1]);
    if (n > max) max = n;
  }
  return max > 0 ? max : null;
}

async function updateRows(mapping: Map<number, number>): Promise<number> {
  if (mapping.size === 0) return 0;
  const ids = [...mapping.keys()];
  // 只更新库里存在的物品（raw SQL 绕过 client 类型，列已 db push）。
  const existing = await p.$queryRawUnsafe<{ item_id: number }[]>(
    `SELECT item_id FROM "Item" WHERE item_id IN (${ids.map(() => "?").join(",")})`,
    ...ids
  );
  let updated = 0;
  for (const row of existing) {
    const ilvl = mapping.get(Number(row.item_id));
    if (!ilvl) continue;
    await p.$executeRawUnsafe(
      `UPDATE "Item" SET item_level = ? WHERE item_id = ?`,
      ilvl,
      Number(row.item_id)
    );
    updated++;
  }
  return updated;
}

async function main() {
  const done = new Set<number>(existsSync(PROGRESS_FILE) ? JSON.parse(readFileSync(PROGRESS_FILE, "utf8")) : []);
  // 第 1 页：既拿总页数，也参与解析。
  const first = await fetchText(`${BASE}/1`);
  if (!first) throw new Error("第 1 页抓取失败，终止。");
  const totalPages = maxPageOf(first) ?? Infinity;
  log(`总页数探测为 ${totalPages === Infinity ? "未知（跑到空页为止）" : totalPages}`);

  let updated = 0;
  let page = 1;
  const pageLimit = MAX_PAGES > 0 ? MAX_PAGES : totalPages;
  while (page <= pageLimit) {
    let html: string | null;
    if (page === 1) html = first;
    else {
      if (done.has(page)) { page++; continue; }
      html = await fetchText(`${BASE}/${page}`);
    }
    if (html === null) {
      done.add(page);
      writeFileSync(PROGRESS_FILE, JSON.stringify([...done]));
      page++;
      await new Promise((r) => setTimeout(r, INTERVAL_MS));
      continue;
    }
    const mapping = parseListPage(html);
    if (mapping.size === 0 && page > 1) {
      log(`第 ${page} 页无标准条目，判定到末页，停止。`);
      break;
    }
    updated += await updateRows(mapping);
    done.add(page);
    writeFileSync(PROGRESS_FILE, JSON.stringify([...done]));
    log(`第 ${page}/${totalPages === Infinity ? "?" : totalPages} 页：解析 ${mapping.size} 件，本次累计更新 ${updated}`);
    page++;
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  log(`完成：共更新 ${updated} 件物品的 item_level。`);
  await p.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
