// 商人青睐兑换导入：每专业页（foreverchanges.pro/zh-cn/professions/<slug>）
// 服务端渲染的 <section id="favor"> 章节含按青睐币分档的兑换清单
//（"30 商人青睐 技能60到125" → <ul> 内逐条 物品id/名字/技能等级）。
// 入库为 Recipe { category: "merchant", favorCost: 档位青睐数 }；
// 材料从同专业同名（去 设计图/公式/图纸/图样/食谱/结构图 前缀）craft
// 成品配方复制（图纸学会后制造需材料——merchant 卡展示"图纸价值（青睐）"
// + "制造物成本"两维度，沿用 beta 期口径，见 scripts/.tmp-merchant-restore.ts）。
//
// 2026-11-07 公测重建：beta 库商人兑换随 dev.db 清空，本脚本从站点全量恢复。
//
// 跑法：npx tsx scripts/import-merchant-favor.ts   （幂等，可重跑）
import { PrismaClient } from "@prisma/client";

const PROFESSIONS: Array<{ url: string; name: string }> = [
  { url: "alchemy", name: "Alchemy" },
  { url: "blacksmithing", name: "Blacksmithing" },
  { url: "mining", name: "Mining" },
  { url: "enchanting", name: "Enchanting" },
  { url: "engineering", name: "Engineering" },
  { url: "leatherworking", name: "Leatherworking" },
  { url: "tailoring", name: "Tailoring" },
  { url: "cooking", name: "Cooking" },
  { url: "fishing", name: "Fishing" },
  { url: "first-aid", name: "First Aid" },
];

const PREFIX = /^(设计图|公式|图纸|图样|食谱|结构图)：/;
const strip = (n: string) => n.replace(PREFIX, "").trim();

type FavorEntry = { itemId: number; name: string; quality: number; skill: number; favorCost: number };

// 解析 <section id="favor"> 内的兑换清单：先按档位 h3 切块，再逐 li 取物品。
function parseFavorSection(html: string): FavorEntry[] {
  const start = html.indexOf('<section id="favor"');
  if (start < 0) return [];
  const end = html.indexOf("</section>", start);
  const section = html.slice(start, end > 0 ? end : undefined);
  const out: FavorEntry[] = [];
  // 档位标题：<h3 class="en3-h3">30 商人青睐 <small>技能60到125</small></h3>
  const tierRegex = /<h3 class="en3-h3">(\d+)\s*商人青睐/g;
  const tiers: Array<{ cost: number; at: number }> = [];
  let tm: RegExpExecArray | null;
  while ((tm = tierRegex.exec(section))) tiers.push({ cost: Number(tm[1]), at: tm.index });
  if (tiers.length === 0) return [];
  // 条目：<a href="/zh-cn/item/{id}/{slug}">…<span class="q{N}">名</span>…</a><span class="en3-skill…">60</span>
  const liRegex = /<a href="\/zh-cn\/item\/(\d+)(?:\/[^"]*)?">[\s\S]*?<span class="q(\d)">([^<]+)<\/span>[\s\S]*?<span class="en3-skill[^"]*"[^>]*>(\d+)<\/span>/g;
  let lm: RegExpExecArray | null;
  while ((lm = liRegex.exec(section))) {
    const at = lm.index;
    // 归属档位：条目位置之前最近的档位标题。
    let cost = 0;
    for (const t of tiers) if (t.at < at) cost = t.cost;
    if (cost <= 0) continue;
    out.push({ itemId: Number(lm[1]), name: lm[3].trim(), quality: Number(lm[2]), skill: Number(lm[4]), favorCost: cost });
  }
  return out;
}

async function main() {
  const p = new PrismaClient();
  let total = 0;
  const restored: number[] = [];
  for (const prof of PROFESSIONS) {
    const res = await fetch(`https://foreverchanges.pro/zh-cn/professions/${prof.url}`, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "zh-CN,zh;q=0.9" },
    });
    if (!res.ok) {
      console.log(`${prof.name}: HTTP ${res.status}，跳过`);
      continue;
    }
    const html = await res.text();
    const entries = parseFavorSection(html);
    // 同名 craft 成品配方（去前缀）：复制制造材料到 merchant 行。
    const crafts = await p.recipe.findMany({
      where: { profession: prof.name, category: "craft" },
      select: { name: true, reagents: true },
    });
    const craftByName = new Map<string, unknown>();
    for (const c of crafts) craftByName.set(strip(c.name), c.reagents);
    let n = 0;
    for (const e of entries) {
      const reagents = craftByName.get(strip(e.name)) ?? [];
      await p.recipe.upsert({
        where: { name_profession_category: { name: e.name, profession: prof.name, category: "merchant" } },
        create: {
          name: e.name,
          profession: prof.name,
          category: "merchant",
          skillLevel: e.skill,
          favorCost: e.favorCost,
          outputs: [{ itemId: e.itemId, name: e.name, quality: e.quality, quantity: 1 }] as object,
          reagents: reagents as object,
        },
        update: {
          skillLevel: e.skill,
          favorCost: e.favorCost,
          outputs: [{ itemId: e.itemId, name: e.name, quality: e.quality, quantity: 1 }] as object,
          reagents: reagents as object,
        },
      });
      n++;
      if ((reagents as Array<unknown>).length > 0) restored.push(e.itemId);
    }
    total += n;
    console.log(`${prof.name}: ${n} 条商人兑换${entries.length !== n ? `（解析 ${entries.length}）` : ""}`);
    await new Promise((r) => setTimeout(r, 1200));
  }
  console.log(`\n合计入库 ${total} 条商人兑换；其中 ${restored.length} 条已从同名 craft 配方复制制造材料。`);
  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
