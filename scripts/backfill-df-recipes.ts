// =============================================================================
// 从 DungeonsForever 插件补录项目缺失的配方（2026-10-03）
//
// 来源：<魔兽世界>/Interface/AddOns/DungeonsForever/Core/Data/Data_ProfRecipes.lua
//       （插件 build 1.60.1.69913，数据更新日 2026-09-19，作者 圆圆）
// 口径：插件 rows 中「产出物品 ID 不在项目 Recipe.outputs 集合」的配方（75 条）
//       —— 73 条 Forever 新配方 + 2 条经典旧世配方（黑皮战靴 2315 / 12628）
// 占位：产出物品在项目 Item 表查不到名字时，name 用 `item:{id}` 占位，
//       等游戏内扫描回填（回填脚本见 TODO：按 outputs.itemId 匹配补名）。
//       材料名/保底价全部取自项目 Item 表（29 种材料全部已收录）。
// 幂等：按 Recipe 唯一键 (name, profession, category) 已存在则跳过，可重跑。
// 运行：npx tsx scripts/backfill-df-recipes.ts
// =============================================================================
import { prisma } from "../src/lib/prisma";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const luaparse = require("luaparse") as { parse: (src: string, opts?: any) => any };

const LUA = "C:/Program Files (x86)/World of Warcraft/_classic_beta_/Interface/AddOns/DungeonsForever/Core/Data/Data_ProfRecipes.lua";

// 插件专业 slug → 项目 Recipe.profession 命名
const PROF_MAP: Record<string, string> = {
  alchemy: "Alchemy",
  blacksmithing: "Blacksmithing",
  engineering: "Engineering",
  leatherworking: "Leatherworking",
  tailoring: "Tailoring",
  cooking: "Cooking",
  "first-aid": "First Aid",
};

// ---------- 插件 lua 求值（luaparse AST） ----------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function evalExpr(n: any): any {
  switch (n.type) {
    case "StringLiteral": {
      try { return JSON.parse(n.raw); } catch { return n.raw.slice(1, -1); }
    }
    case "NumericLiteral": return n.value;
    case "BooleanLiteral": return n.value;
    case "NilLiteral": return null;
    case "TableConstructorExpression": return evalTable(n);
    case "UnaryExpression":
      if (n.operator === "-") return -evalExpr(n.argument);
      throw new Error("不支持的运算符: " + n.operator);
    default:
      throw new Error("不支持的表达式类型: " + n.type);
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function evalTable(n: any): any {
  const fields = n.fields;
  if (fields.every((f: any) => f.type === "TableValue")) {
    return fields.map((f: any) => evalExpr(f.value));
  }
  const obj: Record<string, unknown> = {};
  let idx = 1;
  for (const f of fields) {
    if (f.type === "TableValue") obj[idx++] = evalExpr(f.value);
    else if (f.type === "TableKeyString") obj[f.key.name] = evalExpr(f.value);
    else if (f.type === "TableKey") obj[String(evalExpr(f.key))] = evalExpr(f.value);
    else throw new Error("未知字段类型: " + f.type);
  }
  return obj;
}

// 插件行字段序：spell/id/count/cat/kind/effect/learn/yellow/green/grey/is_new/
//               reagents/formula/source/was/set/armor
type AddonRow = {
  prof: string;
  spell: number | null;
  out: number | null;
  count: number;
  cat: string;
  learn: number;
  yellow: number;
  green: number;
  grey: number;
  isNew: boolean;
  reagents: Array<[number, number]>;
  formula: [number, number] | null;
};

function parseAddon(): { rows: AddonRow[]; catZh: Record<string, Record<string, string>> } {
  const src = readFileSync(LUA, "utf8");
  const ast = luaparse.parse(src, { luaVersion: "5.1", wait: false, comments: false });
  let PR: Record<string, any> | null = null;
  for (const st of ast.body) {
    if (st.type === "AssignmentStatement") {
      const v = st.variables[0];
      if (v.type === "MemberExpression" && v.base.type === "Identifier" && v.base.name === "ns"
          && v.identifier.type === "Identifier" && v.identifier.name === "ProfRecipes") {
        PR = evalExpr(st.init[0]);
        break;
      }
    }
  }
  if (!PR) throw new Error("解析失败：未找到 ns.ProfRecipes");

  const rows: AddonRow[] = [];
  const catZh: Record<string, Record<string, string>> = {};
  for (const [prof, block] of Object.entries(PR)) {
    if (!block || typeof block !== "object") continue;
    if (Array.isArray(block.groups)) {
      catZh[prof] = {};
      for (const g of block.groups) if (Array.isArray(g) && g.length >= 2) catZh[prof][g[0]] = g[1];
    }
    if (Array.isArray(block.rows)) {
      for (const r of block.rows) {
        rows.push({
          prof,
          spell: r[0] ?? null,
          out: r[1] ?? null,
          count: r[2] ?? 1,
          cat: r[3] ?? "",
          learn: r[6] ?? 0,
          yellow: r[7] ?? 0,
          green: r[8] ?? 0,
          grey: r[9] ?? 0,
          isNew: r[10] ?? false,
          reagents: Array.isArray(r[11]) ? r[11] : [],
          formula: Array.isArray(r[12]) ? r[12] : null,
        });
      }
    }
  }
  return { rows, catZh };
}

async function main() {
  const { rows, catZh } = parseAddon();

  // ---------- 项目 Recipe 现有产出物 ID 集合 ----------
  const existing = await prisma.$queryRaw<{ item_id: number }[]>`
    WITH r AS (SELECT json_each.value reg FROM Recipe, json_each(outputs))
    SELECT json_extract(reg, '$.itemId') item_id FROM r
    WHERE json_extract(reg, '$.itemId') IS NOT NULL`;
  const projOutSet = new Set(existing.map((r) => Number(r.item_id)));
  console.log("项目 Recipe 现有产出物去重:", projOutSet.size);

  // ---------- 项目 Item 表（材料名 / 保底价） ----------
  const itemRows = await prisma.item.findMany({ select: { itemId: true, name: true, vendorPrice: true } });
  const itemMap = new Map(itemRows.map((i) => [i.itemId, i]));

  // ---------- 筛选插件独有配方 ----------
  const missing = rows.filter((r) => r.out != null && !projOutSet.has(r.out!));
  console.log("插件独有配方（项目缺失）:", missing.length);

  let inserted = 0, skipped = 0, named = 0, placeholder = 0;
  for (const r of missing) {
    const profession = PROF_MAP[r.prof];
    if (!profession) { console.error(`  跳过：未知专业 ${r.prof}`); continue; }

    const outItem = itemMap.get(r.out!);
    const outName = outItem?.name ?? `item:${r.out}`;
    if (outItem) named++; else placeholder++;

    // 材料：名字/保底价取自 Item 表
    const reagents = r.reagents.map(([itemId, qty]) => {
      const it = itemMap.get(itemId);
      return { itemId, name: it?.name ?? `item:${itemId}`, quantity: qty, vendorP: it?.vendorPrice ?? 0 };
    });

    const categoryName = catZh[r.prof]?.[r.cat] ?? r.cat;

    const key = { name: outName, profession, category: "craft" };
    const existingRecipe = await prisma.recipe.findUnique({
      where: { name_profession_category: key },
      select: { id: true },
    });
    if (existingRecipe) {
      console.log(`  skip: ${outName} (${profession}) 已存在`);
      skipped++;
      continue;
    }

    await prisma.recipe.create({
      data: {
        name: outName,
        profession,
        skillLevel: r.learn,
        category: "craft",
        difficulty: [r.learn, r.yellow, r.green, r.grey],
        categoryName,
        spellId: r.spell,
        reagents,
        outputs: [{ itemId: r.out, name: outName, quantity: r.count }],
      },
    });
    inserted++;
    console.log(`  + ${outName} [${r.prof}] spell=${r.spell} learn=${r.learn}${r.isNew ? " 新" : " 旧"} 材料${reagents.length}种 分类=${categoryName}`);
  }

  console.log(`\n完成：新增 ${inserted} 条，跳过 ${skipped} 条（产出物品有真实名 ${named} / 占位名 ${placeholder}）`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
