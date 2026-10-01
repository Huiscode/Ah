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

type ParsedRecipe = {
  outputId: number;
  outputName: string;
  materials: Array<{ itemId: number; name: string; quantity: number }>;
};

function parseRecipes(html: string): ParsedRecipe[] {
  const recipes: ParsedRecipe[] = [];
  // Each full recipe is <li id="r-XXX" class="cr-row"> ... </li>
  // (The en3-lv-step leveling guide is a subset; cr-row covers every recipe.)
  const liRegex = /<li id="r-\d+" class="cr-row">([\s\S]*?)<\/li>/g;
  let liMatch;
  while ((liMatch = liRegex.exec(html)) !== null) {
    const block = liMatch[1];
    // Output item: <a href="/zh-cn/item/{id}" class="cr-made">...<span class="cr-name q{N}">{name}</span>...<span class="v2-tag">新增</span>...</a>
    const outMatch = block.match(/<a href="\/zh-cn\/item\/(\d+)" class="cr-made">[\s\S]*?<span class="cr-name[^"]*">([^<]+)<\/span>/);
    if (!outMatch) continue;
    const outputId = parseInt(outMatch[1], 10);
    const outputName = outMatch[2];
    // Materials
    const mats: ParsedRecipe["materials"] = [];
    const matRegex = /<a href="\/zh-cn\/item\/(\d+)" class="cr-mat" aria-label="([^"]*)">/g;
    let matMatch;
    while ((matMatch = matRegex.exec(block)) !== null) {
      const matId = parseInt(matMatch[1], 10);
      const aria = matMatch[2]; // e.g. "6 青铜锭" or "银锭"
      const qtyMatch = aria.match(/^(\d+)\s+/);
      const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
      const name = qtyMatch ? aria.slice(qtyMatch[0].length) : aria;
      mats.push({ itemId: matId, name, quantity: qty });
    }
    recipes.push({ outputId, outputName, materials: mats });
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

  for (const prof of PROFESSIONS) {
    const url = `https://foreverchanges.pro/zh-cn/professions/${prof.url}`;
    console.log(`Fetching ${prof.name}...`);
    const html = await fetchUrl(url);
    const recipes = parseRecipes(html);
    console.log(`  parsed ${recipes.length} recipes`);
    totalRecipes += recipes.length;

    for (const r of recipes) {
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
          reagents: reagents as object,
          outputs: outputs as object,
        },
        update: {
          reagents: reagents as object,
          outputs: outputs as object,
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
