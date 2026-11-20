/**
 * 抓取食物产出物的英文"Use:"效果描述（foreverchanges.pro 英文页 /item/{id}
 * 的 <meta name="description"> tooltip），生成 src/data/food-effects-en.ts。
 * 与 scrape-food-effects.ts（中文版）同源结构；物品清单直接复用中文字典的键。
 * 跑法：npx tsx scripts/scrape-food-effects-en.ts
 */
import { writeFileSync } from "fs";
import { FOOD_EFFECTS } from "../src/data/food-effects";

const INTERVAL_MS = 400;

function extractEffectEn(html: string): string | undefined {
  const meta = html.match(/<meta name="description" content="([^"]*)"/i);
  if (!meta) return undefined;
  const desc = meta[1]
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const use = desc.search(/\bUse:\s/i);
  if (use < 0) return undefined;
  return desc.slice(use).trim();
}

async function main() {
  const ids = Object.keys(FOOD_EFFECTS).map(Number).sort((a, b) => a - b);
  console.log("食物产出物数量:", ids.length);
  const effects: Record<number, string> = {};
  let missing = 0;
  for (const [i, itemId] of ids.entries()) {
    try {
      const res = await fetch(`https://foreverchanges.pro/item/${itemId}`, {
        headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.9" }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const effect = extractEffectEn(html);
      if (effect) {
        effects[itemId] = effect;
        console.log(`[${i + 1}/${ids.length}] ${itemId} OK`);
      } else {
        missing++;
        console.log(`[${i + 1}/${ids.length}] ${itemId} — no "Use:" effect`);
      }
    } catch (err) {
      missing++;
      console.log(`[${i + 1}/${ids.length}] ${itemId} — fetch failed: ${String(err)}`);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  const lines = Object.entries(effects)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([id, text]) => `  ${id}: ${JSON.stringify(text)},`);
  const out = `// 由 scripts/scrape-food-effects-en.ts 生成（foreverchanges.pro 英文页 tooltip）。
// 食物产出物的英文"Use:"功能描述；EN 模式优先，缺失回退中文 FOOD_EFFECTS。
export const FOOD_EFFECTS_EN: Record<number, string> = {\n${lines.join("\n")}\n};\n`;
  writeFileSync("src/data/food-effects-en.ts", out, "utf8");
  console.log(`完成：命中 ${Object.keys(effects).length}/${ids.length}，缺失 ${missing}，已写入 src/data/food-effects-en.ts`);
}

main().catch((e) => { console.error(e); process.exit(1); });
