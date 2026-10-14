// M1b：foreverchanges 物品/配方全量抓取与核对。
//
// 目标（用户 2026-10-14 拍板）：
//   1. 配方表核对：以网站专业页为准，对齐 Recipe 表的材料/产出（网站没有的保留）；
//   2. 物品名补全：Recipe 材料/产出的 itemId 逐条抓物品页，补齐 Item 的
//      name / quality / category / subCategory（当前 196 个占位名"Item N"待补）；
//   3. vendor 补充：页面"卖价"（NPC 收购价）同步更新 Item.vendorPrice
//      （与 vendor-price-audit 同源同值；audit 覆盖全部 vendor_price>0，本脚本
//      覆盖 Recipe 相关物品——包括当前 vendor_price=0 但 NPC 实际收购的）。
//
// 网站结构（已实测确认）：
//   物品页：<h1 class="q1">亚麻布</h1> / <p class="it-sub">普通，商品，布料，物品等级5，物品 2589。</p>
//           / 卖价：13铜（收购价）
//   专业页：<li id="r-N" class="cr-row"> … <a class="cr-made">产出</a> <a class="cr-mat" aria-label="{qty} {名}">材料</a>
//
// 限速 2.5s/条 + 403 退避 15s×3 + 断点续跑（scripts/.m1b-progress.json）。
// 注意：与 vendor-price-audit 并发会叠加请求密度——等 audit 跑完再启动本脚本。
//
// 跑法：npx tsx scripts/m1b-forever-library.ts
import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROGRESS_FILE = join(__dirname, ".m1b-progress.json");
const LOG_FILE = join(__dirname, "m1b.log");
const INTERVAL_MS = 2500;
const RETRY_DELAY_MS = 15000;

const p = new PrismaClient();

const PROFESSIONS: Array<{ url: string; name: string }> = [
  { url: "alchemy", name: "Alchemy" },
  { url: "blacksmithing", name: "Blacksmithing" },
  { url: "enchanting", name: "Enchanting" },
  { url: "engineering", name: "Engineering" },
  { url: "leatherworking", name: "Leatherworking" },
  { url: "tailoring", name: "Tailoring" },
  { url: "cooking", name: "Cooking" },
  { url: "fishing", name: "Fishing" },
  { url: "first-aid", name: "First Aid" },
];

const QUALITY_Q_TO_EN: Record<number, string> = {
  0: "poor", 1: "common", 2: "uncommon", 3: "rare", 4: "epic", 5: "legendary", 6: "artifact"
};

const G: Record<string, number> = { 金: 10000, 银: 100, 铜: 1 };

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
        log(`403 on ${url} — 退避 ${RETRY_DELAY_MS / 1000}s`);
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

// ---- 阶段 1：专业页 → 配方核对 ----

type ParsedRecipe = {
  outputId: number;
  outputName: string;
  materials: Array<{ itemId: number; name: string; quantity: number }>;
};

function parseRecipes(html: string): ParsedRecipe[] {
  const recipes: ParsedRecipe[] = [];
  const liRegex = /<li id="r-\d+" class="cr-row">([\s\S]*?)<\/li>/g;
  let liMatch;
  while ((liMatch = liRegex.exec(html)) !== null) {
    const block = liMatch[1];
    const outMatch = block.match(/<a href="\/zh-cn\/item\/(\d+)" class="cr-made">[\s\S]*?<span class="cr-name[^"]*">([^<]+)<\/span>/);
    if (!outMatch) continue;
    const outputId = parseInt(outMatch[1], 10);
    const outputName = outMatch[2];
    const mats: ParsedRecipe["materials"] = [];
    const matRegex = /<a href="\/zh-cn\/item\/(\d+)" class="cr-mat" aria-label="([^"]*)">/g;
    let matMatch;
    while ((matMatch = matRegex.exec(block)) !== null) {
      const matId = parseInt(matMatch[1], 10);
      const aria = matMatch[2];
      const qtyMatch = aria.match(/^(\d+)\s+/);
      const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
      const name = qtyMatch ? aria.slice(qtyMatch[0].length) : aria;
      mats.push({ itemId: matId, name, quantity: qty });
    }
    recipes.push({ outputId, outputName, materials: mats });
  }
  return recipes;
}

async function stage1Recipes(): Promise<Set<number>> {
  log("── 阶段 1：专业页配方核对 ──");
  const touched = new Set<number>();
  let totalRecipes = 0;
  for (const prof of PROFESSIONS) {
    const html = await fetchText(`https://foreverchanges.pro/zh-cn/professions/${prof.url}`);
    if (!html) { log(`专业页失败：${prof.name}`); continue; }
    const recipes = parseRecipes(html);
    totalRecipes += recipes.length;
    for (const r of recipes) {
      touched.add(r.outputId);
      for (const m of r.materials) touched.add(m.itemId);
      const reagents = r.materials.map((m) => ({ itemId: m.itemId, name: m.name, quantity: m.quantity }));
      const outputs = [{ itemId: r.outputId, name: r.outputName, quantity: 1 }];
      await p.recipe.upsert({
        where: { name_profession_category: { name: r.outputName, profession: prof.name, category: "craft" } },
        create: { name: r.outputName, profession: prof.name, category: "craft", reagents: reagents as object, outputs: outputs as object },
        update: { reagents: reagents as object, outputs: outputs as object },
      });
    }
    log(`  ${prof.name}: ${recipes.length} 配方`);
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  log(`阶段 1 完成：${totalRecipes} 配方（核对/更新），涉及物品 ${touched.size}`);
  return touched;
}

// ---- 阶段 2：物品页 → Item 补全 ----

type ParsedItem = {
  name: string;
  quality: string | null;
  category: string | null;
  subCategory: string | null;
  vendorPrice: number | null;
};

function parseItem(html: string): ParsedItem | null {
  const nameM = html.match(/<h1 class="q\d+">([^<]+)<\/h1>/);
  if (!nameM) return null;
  const name = nameM[1].trim();
  const qM = html.match(/<h1 class="q(\d)">/);
  const quality = qM ? (QUALITY_Q_TO_EN[parseInt(qM[1], 10)] ?? null) : null;
  // <p class="it-sub">普通，商品，布料，物品等级5，物品 2589。</p>
  const subM = html.match(/<p class="it-sub">([\s\S]*?)<\/p>/);
  let category: string | null = null;
  let subCategory: string | null = null;
  if (subM) {
    const parts = subM[1].replace(/<!--[\s\S]*?-->/g, "").split("，").map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 3) {
      category = parts[1];
      subCategory = parts[2];
    }
  }
  // 卖价：13铜 / 卖价: 1银20铜
  let vendorPrice: number | null = null;
  const sellM = html.match(/卖价[：:]\s*([^<\n]+)/);
  if (sellM) {
    const s = sellM[1];
    const total = (s.match(/(\d+)(金|银|铜)/g) ?? []).reduce((sum, part) => {
      const v = parseInt(part, 10);
      return sum + v * (G[part.slice(-1)] ?? 1);
    }, 0);
    if (s.includes("金") || s.includes("银") || s.includes("铜")) vendorPrice = total;
  }
  return { name, quality, category, subCategory, vendorPrice };
}

async function stage2Items(itemIds: number[]) {
  log(`── 阶段 2：物品页抓取补全（${itemIds.length} 个，限速 ${INTERVAL_MS / 1000}s/条） ──`);
  const done = new Set<number>(existsSync(PROGRESS_FILE) ? JSON.parse(readFileSync(PROGRESS_FILE, "utf8")) : []);
  const remaining = itemIds.filter((id) => !done.has(id));
  log(`已抓 ${done.size}，本次续跑 ${remaining.length}`);
  if (remaining.length === 0) { log("全部已完成，跳过阶段 2。"); return; }

  let ok = 0, noParse = 0, fail = 0;
  for (let i = 0; i < remaining.length; i++) {
    const itemId = remaining[i];
    const html = await fetchText(`https://foreverchanges.pro/zh-cn/item/${itemId}`);
    if (html === null) { fail++; }
    else {
      const parsed = parseItem(html);
      if (!parsed) { noParse++; }
      else {
        // 名字：占位/缺失时补；quality/category 直接更新（网站为准）
        const cur = await p.item.findUnique({ where: { itemId }, select: { name: true, quality: true } });
        if (cur) {
          await p.item.update({
            where: { itemId },
            data: {
              name: parsed.name,
              quality: parsed.quality ?? cur.quality ?? "unknown",
              category: parsed.category ?? "unknown",
              subCategory: parsed.subCategory ?? "unknown",
              ...(parsed.vendorPrice !== null ? { vendorPrice: parsed.vendorPrice } : {}),
            },
          });
        } else {
          await p.item.create({
            data: {
              itemId,
              name: parsed.name,
              quality: parsed.quality ?? "unknown",
              category: parsed.category ?? "unknown",
              subCategory: parsed.subCategory ?? "unknown",
              vendorPrice: parsed.vendorPrice ?? 0,
            },
          });
        }
        ok++;
      }
    }
    done.add(itemId);
    writeFileSync(PROGRESS_FILE, JSON.stringify([...done]));
    if ((i + 1) % 25 === 0 || i === remaining.length - 1) {
      log(`进度 ${i + 1}/${remaining.length} 累计: 更新 ${ok} 无解析 ${noParse} 失败 ${fail}`);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  log(`阶段 2 完成: 更新 ${ok} 无解析 ${noParse} 失败 ${fail}`);
}

async function main() {
  const touched = await stage1Recipes();
  // 补全范围：Recipe 全部材料+产出（含种子配方已有的 Recipe 表物品）
  const dbRecipes = await p.recipe.findMany({ select: { reagents: true, outputs: true, category: true } });
  for (const r of dbRecipes) {
    for (const m of (r.reagents as Array<{ itemId: number }>) ?? []) touched.add(m.itemId);
    for (const o of (r.outputs as Array<{ itemId: number }>) ?? []) touched.add(o.itemId);
  }
  const itemIds = Array.from(touched).filter((id) => Number.isInteger(id) && id > 0).sort((a, b) => a - b);
  log(`全部涉及物品（去重）: ${itemIds.length}`);
  await stage2Items(itemIds);
  log("完成。如需刷新流通分，请再跑：npx tsx scripts/compute-turnover.ts");
  await p.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
