/**
 * 从 foreverchanges.pro 抓取所有专业配方（不依赖角色已学），
 * 写入 Recipe 表，然后重算流通分。
 *
 * 网站页面结构（已确认）：
 *   <li class="en3-lv-step">
 *     <a href="/zh-cn/item/{outId}" class="en3-lv-made"><strong>{产出名}</strong></a>
 *     <span class="cr-mats">
 *       <a href="/zh-cn/item/{matId}" class="cr-mat" aria-label="{qty} {mat名}"><b>{qty}</b></a>
 *       ...
 *     </span>
 *   </li>
 *
 * 跑法：npx tsx scripts/scrape-forever-recipes.ts
 * 幂等：重复跑会 upsert 同名同专业配方，不会产生重复。
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const p = new PrismaClient();

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

type ParsedRecipe = {
  outputId: number;
  outputName: string;
  materials: Array<{ itemId: number; name: string; quantity: number }>;
  skill?: { learn: number; yellow: number; green: number; grey: number };
};

function parseRecipes(html: string): ParsedRecipe[] {
  const recipes: ParsedRecipe[] = [];
  // Each full recipe is <li id="r-XXX" class="cr-row"> ... </li>
  // (The en3-lv-step leveling guide is a subset; cr-row covers every recipe.)
  const liRegex = /<li id="r-\d+" class="cr-row">([\s\S]*?)<\/li>/g;
  let liMatch;
  while ((liMatch = liRegex.exec(html)) !== null) {
    const block = liMatch[1];
    // Output item: <a href="/zh-cn/item/{id}[/slug]" class="cr-made">...<span class="cr-name q{N}">{name}</span>...
    // （2026-11 站点改版：href 数字后多了英文 slug 后缀，正则需允许 /slug）
    const outMatch = block.match(/<a href="\/zh-cn\/item\/(\d+)(?:\/[^"]*)?" class="cr-made">[\s\S]*?<span class="cr-name[^"]*">([^<]+)<\/span>/);
    if (!outMatch) continue;
    const outputId = parseInt(outMatch[1], 10);
    const outputName = outMatch[2];
    // 技能阈值：<span class="en3-skill en3-c-orange" title="15学会；55变黄，75变绿，95变灰">15</span>
    // （2026-11-07 起提取入库：配方库"当前等级"过滤/难度色徽依赖）
    const skillMatch = block.match(/title="(\d+)学会；(\d+)变黄，(\d+)变绿，(\d+)变灰"/);
    const skill = skillMatch
      ? { learn: +skillMatch[1], yellow: +skillMatch[2], green: +skillMatch[3], grey: +skillMatch[4] }
      : undefined;
    // Materials
    const mats: ParsedRecipe["materials"] = [];
    const matRegex = /<a href="\/zh-cn\/item\/(\d+)(?:\/[^"]*)?" class="cr-mat" aria-label="([^"]*)">/g;
    let matMatch;
    while ((matMatch = matRegex.exec(block)) !== null) {
      const matId = parseInt(matMatch[1], 10);
      const aria = matMatch[2]; // e.g. "6 青铜锭" or "银锭"
      const qtyMatch = aria.match(/^(\d+)\s+/);
      const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
      const name = qtyMatch ? aria.slice(qtyMatch[0].length) : aria;
      mats.push({ itemId: matId, name, quantity: qty });
    }
    recipes.push({ outputId, outputName, materials: mats, skill });
  }
  return recipes;
}

async function fetchUrl(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function main() {
  let totalRecipes = 0;
  let totalMats = new Set<number>();
  // SCRAPE_HTML_DIR：本地收割模式——2026-11 站点改版后专业页只服务端渲染
  // 第一个部位标签，其余标签数据在页面内、需真实浏览器点标签收割 DOM
  // （见 scripts/.tmp-scrape/*.html，浏览器收割一次后离线重放导入）。
  // 缺省仍走在线抓取（只能拿到每专业第一个标签）。
  const htmlDir = process.env.SCRAPE_HTML_DIR;

  for (const prof of PROFESSIONS) {
    // 每个 (配方, categoryName) 对：本地 JSON 模式带部位标签名（收割时逐标签
    // 记录 tab 名），在线模式无标签信息（categoryName=null）。
    let parsed: Array<{ recipe: ParsedRecipe; categoryName: string | null }> = [];
    if (htmlDir) {
      let tabs: Array<{ tab: string; html: string }>;
      try {
        tabs = JSON.parse(readFileSync(join(htmlDir, `${prof.url}.json`), "utf8"));
      } catch {
        console.log(`  本地收割文件缺失：${prof.url}.json，跳过`);
        continue;
      }
      for (const t of tabs ?? []) {
        for (const recipe of parseRecipes(t.html)) parsed.push({ recipe, categoryName: t.tab || null });
      }
    } else {
      const url = `https://foreverchanges.pro/zh-cn/professions/${prof.url}`;
      console.log(`Fetching ${prof.name}...`);
      const html = await fetchUrl(url);
      parsed = parseRecipes(html).map((recipe) => ({ recipe, categoryName: null }));
    }
    console.log(`  ${prof.name}: parsed ${parsed.length} recipes`);
    totalRecipes += parsed.length;

    for (const { recipe: r, categoryName } of parsed) {
      // Upsert into Recipe table. identity = (name, profession, category="craft")
      // We store output itemId in outputs JSON, materials in reagents JSON.
      const reagents = r.materials.map((m) => ({
        itemId: m.itemId,
        name: m.name,
        quantity: m.quantity,
      }));
      const outputs = [{ itemId: r.outputId, name: r.outputName, quantity: 1 }];
      for (const m of r.materials) totalMats.add(m.itemId);

      await p.recipe.upsert({
        where: { name_profession_category: { name: r.outputName, profession: prof.name, category: "craft" } },
        create: {
          name: r.outputName,
          profession: prof.name,
          category: "craft",
          categoryName,
          reagents: reagents as object,
          outputs: outputs as object,
          ...(r.skill ? { skillLevel: r.skill.learn, difficulty: [r.skill.learn, r.skill.yellow, r.skill.green, r.skill.grey] } : {}),
        },
        update: {
          categoryName,
          reagents: reagents as object,
          outputs: outputs as object,
          ...(r.skill ? { skillLevel: r.skill.learn, difficulty: [r.skill.learn, r.skill.yellow, r.skill.green, r.skill.grey] } : {}),
        },
      });
    }
  }

  console.log(`\nTotal: ${totalRecipes} recipes, ${totalMats.size} distinct materials`);
  console.log("Now run compute-turnover.ts to refresh turnover scores.");
  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
