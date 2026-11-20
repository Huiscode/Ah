// backfill-item-level.ts：从 foreverchanges 物品列表页批量回填 Item.item_level。
//
// 分解榜（buildDisenchantBoard）按 品质×护甲/武器×物品等级段 匹配经典分解表，
// 需要每件装备的 ilvl。站点物品页不直接给全量对照，但列表页每条 small 文本带
// "物品等级X"，且无 URL 筛选参数，故逐页翻全量列表建 itemId→ilvl 映射再回写。
//
// 2026-11 公测清场扩展：beta 期的物品名库来自 docs/archive 归档 HTML（已清理），
// 列表页每条同时带 名称/品质/分类 —— 顺手一并回填（已存在的名字不覆盖，
// 仅补占位 "Item N" 与缺失行），21 页即可恢复全量物品名库。
//
// 限速 2.5s/页 + 403 退避 15s×3 + 断点续跑（scripts/.ilvl-progress.json）。
// 幂等：ilvl 始终刷新；名字只补缺失/占位；公测清空后重跑一次即可。
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

// <a class="q1" href="/zh-cn/item/6292/10-pound-mud-snapper">名</a><small>普通，副手物品，物品等级15</small>
// （2026-11 站点改版：href 数字后多了英文 slug 后缀）
type ListEntry = { name: string; quality: string; category: string | null; ilvl: number };
const QUALITY_OF_Q: Record<number, string> = {
  0: "poor", 1: "common", 2: "uncommon", 3: "rare", 4: "epic", 5: "legendary", 6: "artifact", 7: "heirloom",
};
function parseListPage(html: string): Map<number, ListEntry> {
  const out = new Map<number, ListEntry>();
  const re = /<a class="q(\d)" href="\/zh-cn\/item\/(\d+)(?:\/[^"]*)?">([^<]+)<\/a><small>([^<]*)<\/small>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const itemId = Number(m[2]);
    if (itemId <= 0) continue;
    const ilvlM = m[4].match(/物品等级(\d+)/);
    const parts = m[4].replace(/<!--[\s\S]*?-->/g, "").split("，").map((s) => s.trim()).filter(Boolean);
    // 两段式 small 文本（如"普通，物品等级55"）没有中间分类段——parts[1] 会是
    // "物品等级55"，不能当品类写入（否则品类下拉出现"物品等级15"这类怪选项）。
    const categoryPart = parts.length >= 2 && !/^物品等级/.test(parts[1]) ? parts[1] : null;
    out.set(itemId, {
      name: m[3].trim(),
      quality: QUALITY_OF_Q[Number(m[1])] ?? "unknown",
      category: categoryPart,
      ilvl: ilvlM ? Number(ilvlM[1]) : 0,
    });
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

async function updateRows(mapping: Map<number, ListEntry>): Promise<{ touched: number; named: number; created: number }> {
  if (mapping.size === 0) return { touched: 0, named: 0, created: 0 };
  const ids = [...mapping.keys()];
  // 现有行一次性取回（含占位名判定），避免逐条 findUnique。
  const existing = await p.item.findMany({ where: { itemId: { in: ids } }, select: { itemId: true, name: true } });
  const nameById = new Map(existing.map((r) => [r.itemId, r.name]));
  let touched = 0, named = 0, created = 0;
  for (const [itemId, e] of mapping) {
    const cur = nameById.get(itemId);
    if (cur !== undefined) {
      const patch: { itemLevel?: number; name?: string; quality?: string; category?: string } = {};
      if (e.ilvl > 0) patch.itemLevel = e.ilvl;
      // 名字只补缺失/占位 "Item N"，不覆盖 m1b 物品页等更权威来源已填的名字。
      if (!cur || /^Item \d+$/.test(cur)) {
        patch.name = e.name;
        patch.quality = e.quality;
        if (e.category) patch.category = e.category;
        named++;
      }
      if (Object.keys(patch).length > 0) {
        await p.item.update({ where: { itemId }, data: patch });
        touched++;
      }
    } else {
      await p.item.create({
        data: { itemId, name: e.name, quality: e.quality, category: e.category ?? "unknown", subCategory: "unknown", itemLevel: e.ilvl },
      });
      created++;
    }
  }
  return { touched, named, created };
}

async function main() {
  const done = new Set<number>(existsSync(PROGRESS_FILE) ? JSON.parse(readFileSync(PROGRESS_FILE, "utf8")) : []);
  // 第 1 页：既拿总页数，也参与解析。
  const first = await fetchText(`${BASE}/1`);
  if (!first) throw new Error("第 1 页抓取失败，终止。");
  const totalPages = maxPageOf(first) ?? Infinity;
  log(`总页数探测为 ${totalPages === Infinity ? "未知（跑到空页为止）" : totalPages}`);

  let touched = 0, named = 0, created = 0;
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
    const r = await updateRows(mapping);
    touched += r.touched; named += r.named; created += r.created;
    done.add(page);
    writeFileSync(PROGRESS_FILE, JSON.stringify([...done]));
    log(`第 ${page}/${totalPages === Infinity ? "?" : totalPages} 页：解析 ${mapping.size} 件，累计 更新${touched}/补名${named}/新建${created}`);
    page++;
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  log(`完成：共 更新${touched}/补名${named}/新建${created} 件物品。`);
  await p.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
