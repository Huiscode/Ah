// =============================================================================
// 修正两条「同名异 ID」经典配方为插件真实版本（2026-10-03）
//
// 背景：DungeonsForever 插件（无限副本手册）中收录的两条经典配方——
//   黑皮战靴（产出 2315，spell 2167）与 阵营旗帜（产出 279973，spell 1263425），
// 在项目 Recipe 表里已有同名行，但产出的是改版前的错版 ID：
//   黑皮战靴 → 252425（rare，0 条拍卖快照）、阵营旗帜 → 279972（0 条快照）。
// 实测拍卖行快照：2315 与 279973 各 193 条持续交易，252425/279972 为 0 条，
// 即游戏内真实流通的是插件版本，项目现有两行产出的是「幽灵物品」。
// 本脚本按方案 A 将两行更新为插件版本（保留唯一键，不新增行）。
//
// 幂等：若现有行 outputs 已含正确 itemId（2315/279973）则跳过，可重跑。
// 运行：npx tsx scripts/fix-classic-recipe-versions.ts
// =============================================================================
import { prisma } from "../src/lib/prisma";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const luaparse = require("luaparse") as { parse: (src: string, opts?: any) => any };

const LUA = "C:/Program Files (x86)/World of Warcraft/_classic_beta_/Interface/AddOns/DungeonsForever/Core/Data/Data_ProfRecipes.lua";

const PROF_MAP: Record<string, string> = {
  alchemy: "Alchemy",
  blacksmithing: "Blacksmithing",
  engineering: "Engineering",
  leatherworking: "Leatherworking",
  tailoring: "Tailoring",
  cooking: "Cooking",
  "first-aid": "First Aid",
};

// 目标：插件专业 slug + 产出物品 ID
const TARGETS: Array<{ prof: string; out: number; name: string }> = [
  { prof: "leatherworking", out: 2315, name: "黑皮战靴" },
  { prof: "tailoring", out: 279973, name: "阵营旗帜" },
];

// ---------- 插件 lua 求值（与 backfill-df-recipes.ts 相同实现） ----------
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

function parseAddon(): { rows: Array<Record<string, unknown>>; catZh: Record<string, Record<string, string>> } {
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

  const rows: Array<Record<string, unknown>> = [];
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

  // 项目 Item 表（材料名/保底价）
  const itemRows = await prisma.item.findMany({ select: { itemId: true, name: true, vendorPrice: true } });
  const itemMap = new Map(itemRows.map((i) => [i.itemId, i]));

  let updated = 0, skipped = 0, missing = 0;
  for (const t of TARGETS) {
    const pluginRow = rows.find((r) => r.prof === t.prof && r.out === t.out);
    if (!pluginRow) { console.error(`插件中未找到 ${t.name}（${t.prof}/${t.out}）`); missing++; continue; }

    const profession = PROF_MAP[t.prof]!;
    const key = { name: t.name, profession, category: "craft" };
    const existing = await prisma.recipe.findUnique({ where: { name_profession_category: key } });
    if (!existing) { console.error(`项目 Recipe 中未找到 ${t.name}（${profession}），跳过`); missing++; continue; }

    // 幂等：已是正确版本则跳过
    const outArr = (existing.outputs as Array<{ itemId?: number }>) ?? [];
    const alreadyCorrect = outArr.some((o) => Number(o.itemId) === t.out);
    if (alreadyCorrect) { console.log(`skip: ${t.name} 已是正确版本（产出 ${t.out}）`); skipped++; continue; }

    const oldOut = outArr.map((o) => o.itemId).join(",");
    console.log(`\n更新前：${t.name} (${profession}) outputs=[${oldOut}] spell=${existing.spellId}`);

    const reagents = (pluginRow.reagents as Array<[number, number]>).map(([itemId, qty]) => {
      const it = itemMap.get(itemId);
      return { itemId, name: it?.name ?? `item:${itemId}`, quantity: qty, vendorP: it?.vendorPrice ?? 0 };
    });
    const learn = pluginRow.learn as number, yellow = pluginRow.yellow as number,
          green = pluginRow.green as number, grey = pluginRow.grey as number;
    const cat = pluginRow.cat as string;
    const categoryName = catZh[t.prof]?.[cat] ?? (existing.categoryName ?? (cat || undefined));
    const spell = pluginRow.spell as number | null;
    const count = pluginRow.count as number;

    await prisma.recipe.update({
      where: { id: existing.id },
      data: {
        skillLevel: learn,
        difficulty: [learn, yellow, green, grey],
        categoryName,
        spellId: spell,
        reagents,
        outputs: [{ itemId: t.out, name: t.name, quantity: count }],
      },
    });
    updated++;
    console.log(`更新后：${t.name} (${profession}) outputs=[${t.out}] spell=${spell} 难度=[${learn},${yellow},${green},${grey}] 分类=${categoryName}`);
    console.log(`  材料：${reagents.map((r) => `${r.name}x${r.quantity}`).join("、")}`);
  }

  console.log(`\n完成：更新 ${updated} 条，跳过 ${skipped} 条，未找到 ${missing} 条`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
