/**
 * 从 foreverchanges.pro 附魔页导入**附魔效果配方**（Enchanting，无物品产出）：
 *   - 页面内嵌 JSON 含 165 条真附魔（按装备栏位 group 分组）——
 *     旧 scrape-forever-recipes.ts 的 cr-made 正则要求 <a href="/item/...">，
 *     附魔效果名是 <span>（无物品链接），全部被跳过，导致 DB 里 Enchanting
 *     只剩"公式：xxx"卷轴等物品配方。
 *   - 本条解析内嵌 JSON：name/local/short/group/learn/yellow/green/grey/
 *     reagents[{id,count}]/isNew/formula，材料名按 Item 表反查。
 *   - outputs=[]（附魔无物品产出），difficulty=[learn,yellow,green,grey]，
 *     categoryName=栏位中文，skillLevel=learn。
 *
 * 幂等：upsert(name, profession=Enchanting, category=craft)。重复跑不产生重复。
 * 跑法：npx tsx scripts/scrape-enchanting.ts
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

const GROUP_ZH: Record<string, string> = {
  Weapon: "武器",
  "2H Weapon": "双手武器",
  Shield: "盾牌",
  "Off-Hand": "副手",
  Chest: "胸部",
  Cloak: "背部",
  Bracer: "手腕",
  Gloves: "手",
  Boots: "脚",
  Necklace: "颈部",
};

type RawEntry = {
  name?: string;
  local?: string;
  short?: string;
  group?: string;
  text?: string;
  isNew?: boolean;
  fromSod?: boolean;
  learn?: number;
  yellow?: number;
  green?: number;
  grey?: number;
  reagents?: Array<{ id: number; count: number }>;
  was?: Array<{ id: number; count: number }> | null;
  formula?: { id?: number; name?: string; quality?: number; bound?: boolean } | null;
  source?: string | null;
  bis?: unknown[];
};

// 提取 `{\\"name\\":` 起、花括号配平的对象（按 JS 转义处理字符串）
function extractObjects(html: string): string[] {
  const out: string[] = [];
  const re = /\{\\"name\\":/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const start = m.index;
    let depth = 0;
    let i = start;
    let inStr = false;
    for (; i < html.length; i++) {
      const c = html[i];
      if (c === "\\") { i++; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (!inStr) {
        if (c === "{") depth++;
        else if (c === "}") { depth--; if (depth === 0) break; }
      }
    }
    out.push(html.slice(start, i + 1));
  }
  return out;
}

// 页面数据为 JS 字符串内的 JSON：先按 JS 转义规则解码，再 JSON.parse
function jsDecode(s: string): string {
  return s.replace(/\\(.)/g, (_m, c) => (c === "n" ? "\n" : c === "t" ? "\t" : c === "r" ? "\r" : c));
}
function decodeEntry(raw: string): RawEntry | null {
  try {
    return JSON.parse(jsDecode(raw)) as RawEntry;
  } catch {
    return null;
  }
}

async function fetchPage(): Promise<string> {
  const res = await fetch("https://foreverchanges.pro/zh-cn/professions/enchanting", {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function main() {
  const html = await fetchPage();
  // 材料名反查：收集全部材料 id
  const allEntries = extractObjects(html)
    .map(decodeEntry)
    .filter((e): e is RawEntry => !!e && !!e.name);
  const enchants = allEntries.filter((e) => e.group);
  console.log("页面附魔条目:", enchants.length, "(网站统计卡: 165)");

  const matIds = new Set<number>();
  for (const e of enchants) for (const r of e.reagents ?? []) matIds.add(r.id);
  const items = await p.item.findMany({
    where: { itemId: { in: Array.from(matIds) } },
    select: { itemId: true, name: true },
  });
  const nameById = new Map(items.map((i) => [i.itemId, i.name]));
  const missingNames = Array.from(matIds).filter((id) => !nameById.has(id));
  console.log("材料 id 数:", matIds.size, "反查到名称:", nameById.size, "未查到:", missingNames.length);
  if (missingNames.length) console.log("未查到材料示例:", missingNames.slice(0, 10).join(","));

  let upserted = 0;
  for (const e of enchants) {
    const name = e.local || e.short || e.name!;
    const groupZh = GROUP_ZH[e.group!] ?? e.group;
    const reagents = (e.reagents ?? []).map((r) => ({
      itemId: r.id,
      name: nameById.get(r.id) ?? `#${r.id}`,
      quantity: Math.max(1, r.count || 1),
    }));
    await p.recipe.upsert({
      where: { name_profession_category: { name, profession: "Enchanting", category: "craft" } },
      create: {
        name,
        profession: "Enchanting",
        category: "craft",
        skillLevel: e.learn ?? 0,
        difficulty: [e.learn ?? 0, e.yellow ?? 0, e.green ?? 0, e.grey ?? 0],
        categoryName: groupZh,
        reagents: reagents as object,
        outputs: [] as object,
      },
      update: {
        skillLevel: e.learn ?? 0,
        difficulty: [e.learn ?? 0, e.yellow ?? 0, e.green ?? 0, e.grey ?? 0],
        categoryName: groupZh,
        reagents: reagents as object,
        outputs: [] as object,
      },
    });
    upserted++;
  }
  console.log("已导入/更新附魔:", upserted);

  // 核对：DB Enchanting 总数与真附魔（outputs=[]）数
  const all = await p.recipe.findMany({ where: { profession: "Enchanting" }, select: { id: true, name: true, outputs: true, categoryName: true } });
  const noOutput = all.filter((r) => Array.isArray(r.outputs) && (r.outputs as unknown[]).length === 0);
  console.log("DB Enchanting 总数:", all.length, "| 无产出(真附魔):", noOutput.length);
  const byCat: Record<string, number> = {};
  for (const r of noOutput) byCat[r.categoryName ?? "?"] = (byCat[r.categoryName ?? "?"] ?? 0) + 1;
  console.log("真附魔栏位分布:", JSON.stringify(byCat));
  await p.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await p.$disconnect().catch(() => {});
  process.exit(1);
});
