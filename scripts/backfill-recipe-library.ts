// 配方库完整性回填（2026-10-02 审计结论落地）：
//  ① 补 2 条工程消耗品配方进 Recipe 表（4365 粗制炸药、274048 9-60电池组）
//  ③ 补 Recipe.outputs 引用但 Item 表缺失的产出物品行（名字/品质来自
//     foreverchanges 物品清单归档 + 配方 JSON，兜底价暂不补）
// 数据来源：
//  - 配方详情（技能档位/分类/法术）来自 docs/archive/.tmp-page-engineering.html
//    （foreverchanges.pro/zh-cn/professions/engineering，build 1.60.1.70124）
//  - 物品清单来自 docs/archive/.tmp-items-list-1..20.html（9,708 件新增/改动）
// 幂等：Recipe 按 (name, profession, category) upsert，Item 按 itemId upsert，可重跑。
import { prisma } from "../src/lib/prisma";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));

// wx-wow 种子 quality 0-7 → 表内英文小写（与现有 Item 行一致）。
function qualityFromNum(q: number | undefined | null): string {
  const map = ["poor", "common", "uncommon", "rare", "epic", "legendary", "artifact", "heirloom"];
  if (q === undefined || q === null || q < 0 || q > 7) return "unknown";
  return map[q];
}

// 解析 foreverchanges 物品列表页归档：
// <li><a class="q1" href="/zh-cn/item/6292">名称</a><small>普通，副手物品，物品等级15</small></li>
function parseItemsListFiles(): Map<number, { name: string; quality: string; slot: string; ilvl: number }> {
  const out = new Map<number, { name: string; quality: string; slot: string; ilvl: number }>();
  const re = /<a class="q(\d)" href="\/zh-cn\/item\/(\d+)">([^<]+)<\/a><small>([^<]+)<\/small>/g;
  for (let page = 1; page <= 20; page++) {
    const html = readFileSync(join(ROOT, "docs", "archive", `.tmp-items-list-${page}.html`), "utf8");
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const quality = qualityFromNum(Number(m[1]));
      const ilvl = Number((m[4].match(/物品等级(\d+)/) ?? [])[1] ?? 0);
      out.set(Number(m[2]), { name: m[3], quality, slot: m[4], ilvl });
    }
  }
  return out;
}

// ① 两条缺失的工程消耗品配方（foreverchanges 工程页实抓）。
// 命名规则：配方名 = 物品同名 + "配方"两字（用户指定），即 4365 产出"劣质炸药"
// 的配方命名为"劣质炸药配方"——与低级配方 4358"劣质炸药"（skill 30）区分开，
// 避免 Recipe 唯一键 (name, profession, category) 冲突。
const MISSING_RECIPES = [
  {
    name: "劣质炸药配方",
    profession: "Engineering",
    skillLevel: 75,
    category: "craft",
    difficulty: [75, 90, 97, 105], // 75学会；90变黄，97变绿，105变灰（训练师）
    categoryName: "炸弹和炸药",
    reagents: [
      { itemId: 4364, name: "粗制火药粉", quantity: 3 },
      { itemId: 2589, name: "亚麻布", quantity: 1 }
    ],
    outputs: [{ itemId: 4365, name: "劣质炸药", quantity: 2 }]
  },
  {
    name: "9-60电池组",
    profession: "Engineering",
    skillLevel: 125,
    category: "craft",
    difficulty: [125, 125, 135, 145], // 125学会/变黄；135变绿，145变灰（结构图 274049）
    categoryName: "其它",
    spellId: 1293088,
    reagents: [
      { itemId: 249409, name: "天蓝染料", quantity: 1 },
      { itemId: 249391, name: "黄铁矿", quantity: 1 },
      { itemId: 3575, name: "铁锭", quantity: 1 }
    ],
    outputs: [{ itemId: 274048, name: "9-60电池组", quantity: 1 }]
  }
];

async function main() {
  // ---------- ① 配方入表 ----------
  for (const recipe of MISSING_RECIPES) {
    const existing = await prisma.recipe.findUnique({
      where: { name_profession_category: { name: recipe.name, profession: recipe.profession, category: recipe.category } }
    });
    if (existing) {
      console.log(`① recipe exists, skipping: ${recipe.name} (${recipe.profession})`);
      continue;
    }
    await prisma.recipe.create({
      data: {
        name: recipe.name,
        profession: recipe.profession,
        skillLevel: recipe.skillLevel,
        category: recipe.category,
        difficulty: recipe.difficulty,
        categoryName: recipe.categoryName,
        spellId: recipe.spellId,
        reagents: recipe.reagents,
        outputs: recipe.outputs
      }
    });
    console.log(`① recipe inserted: ${recipe.name} (${recipe.profession}, skill ${recipe.skillLevel})`);
  }

  // ---------- ③ 产出物品 Item 行补录 ----------
  const itemsFromList = parseItemsListFiles();
  console.log("\n③ items parsed from foreverchanges list pages:", itemsFromList.size);

  const outputRows = await prisma.$queryRaw<{ itemId: bigint; name: string; quality: bigint | null }[]>`
    WITH r AS (SELECT json_each.value reg FROM Recipe, json_each(outputs))
    SELECT json_extract(reg, '$.itemId') itemId,
           json_extract(reg, '$.name') name,
           json_extract(reg, '$.quality') quality
    FROM r WHERE json_extract(reg, '$.itemId') IS NOT NULL
    GROUP BY 1, 2, 3`;
  const existingRows = await prisma.$queryRaw<{ item_id: number }[]>`SELECT item_id FROM Item`;
  const existingSet = new Set(existingRows.map((r) => Number(r.item_id)));

  const toCreate = outputRows
    .map((r) => ({ itemId: Number(r.itemId), name: r.name, quality: r.quality === null ? undefined : Number(r.quality) }))
    .filter((r) => !existingSet.has(r.itemId));

  console.log("③ recipe outputs missing Item rows:", toCreate.length);

  let created = 0;
  let namedFromList = 0;
  let qualityFromList = 0;
  for (let i = 0; i < toCreate.length; i += 100) {
    const chunk = toCreate.slice(i, i + 100);
    await Promise.all(chunk.map(async (r) => {
      const fromList = itemsFromList.get(r.itemId);
      const name = fromList?.name ?? r.name ?? `item:${r.itemId}`;
      const quality = fromList?.quality ?? qualityFromNum(r.quality);
      if (fromList) { namedFromList++; if (fromList.quality !== "unknown") qualityFromList++; }
      await prisma.item.upsert({
        where: { itemId: r.itemId },
        create: {
          itemId: r.itemId,
          name,
          quality,
          category: "其它",
          subCategory: "未知",
          vendorPrice: 0,
          turnoverScore: 0,
          isVendorItem: false
        },
        // 幂等：重跑时只补名/品质（不覆盖已有分类/价格等）
        update: { name, quality }
      });
      created++;
    }));
  }
  console.log(`③ created/updated Item rows: ${created} (名字取自列表页 ${namedFromList} 件，品质取自列表页 ${qualityFromList} 件)`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
