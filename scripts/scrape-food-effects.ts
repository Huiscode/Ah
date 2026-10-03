/**
 * 抓取配方库中食物产出物的"使用："效果描述（foreverchanges.pro 详情页
 * <meta name="description"> 里的 tooltip 文本），生成 src/data/food-effects.ts
 * 离线字典，供商品终端"制作配方"面板显示食物功能。
 * 跑法：npx tsx scripts/scrape-food-effects.ts
 */
import { writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

const EXTRA_FOODS = [
  { itemId: 5476, name: "狂鱼肉片", sub: "unknown" },
  { itemId: 12209, name: "瘦狼排", sub: "unknown" },
  { itemId: 249872, name: "黏滑冰沙", sub: "unknown" }
];

async function getFoodOutputIds(): Promise<Array<{ itemId: number; name: string; sub: string }>> {
  const rows = await p.$queryRaw<Array<{ itemId: number; name: string; sub: string }>>`
    SELECT DISTINCT i."item_id" AS itemId, i."name" AS name, i."sub_category" AS sub
    FROM "Recipe" r, json_each(r."outputs") AS e
    JOIN "Item" i ON i."item_id" = json_extract(e.value, '$.itemId')
    WHERE i."sub_category" = '食物和饮料'
    ORDER BY i."name"
  `;
  const known = new Set(rows.map((r) => r.itemId));
  return [...rows, ...EXTRA_FOODS.filter((e) => !known.has(e.itemId))];
}

function extractEffect(html: string, itemId: number): string | undefined {
  // <meta name="description" content="…"/> 里包含完整 tooltip（含"使用："效果）。
  const meta = html.match(/<meta name="description" content="([^"]*)"/i);
  if (!meta) return undefined;
  const desc = meta[1]
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const use = desc.indexOf("使用：");
  if (use < 0) return undefined;
  return desc.slice(use).trim();
}

async function main() {
  const foods = await getFoodOutputIds();
  console.log("食物产出物数量:", foods.length);
  const effects: Record<number, string> = {};
  let missing = 0;
  for (const [i, food] of foods.entries()) {
    try {
      const res = await fetch(`https://foreverchanges.pro/zh-cn/item/${food.itemId}`, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const effect = extractEffect(html, food.itemId);
      if (effect) {
        effects[food.itemId] = effect;
        console.log(`[${i + 1}/${foods.length}] ${food.name} (${food.itemId}) ✓`);
      } else {
        missing++;
        console.log(`[${i + 1}/${foods.length}] ${food.name} (${food.itemId}) — 无"使用："效果`);
      }
    } catch (err) {
      missing++;
      console.log(`[${i + 1}/${foods.length}] ${food.name} (${food.itemId}) — 抓取失败: ${String(err)}`);
    }
    await new Promise((r) => setTimeout(r, 400)); // 礼貌延时
  }
  const lines = Object.entries(effects)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([id, text]) => `  ${id}: ${JSON.stringify(text)},`);
  const out = `// 由 scripts/scrape-food-effects.ts 生成（foreverchanges.pro 详情页 tooltip）。
// 食物产出物的"使用："功能描述，供商品终端"制作配方"面板展示。
export const FOOD_EFFECTS: Record<number, string> = {\n${lines.join("\n")}\n};\n`;
  writeFileSync("src/data/food-effects.ts", out, "utf8");
  console.log(`完成：命中 ${Object.keys(effects).length}/${foods.length}，缺失 ${missing}，已写入 src/data/food-effects.ts`);
  await p.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
