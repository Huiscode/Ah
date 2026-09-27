// Builds the WoW: Forever recipe seed from wx-wow.com database dumps
// (community client DB2 mining, build 1.60.1.69913, fetched 2026-09-18):
//   - WF_PROF  (data-prof.js): 12 professions / 2237 craft recipes
//   - WF_KOV   (data-kov.js) : 320 merchant-favor exchanges (8 professions)
//   - WF_ITEM  (data-item.js): 29347 items (zh/en names, quality)
// Recipes without a product item (enchanting auras etc.) are dropped — the
// profit engine prices materials → sellable products only. Merchant-favor
// rows become category "merchant"; the favor currency cost is not priced in
// copper (no exchange rate is published), which the UI notes.
// Profession mapping: WF_PROF.cats[catId][3] is the profession index into
// WF_PROF.profs; WF_KOV.rows[pi] indexes WF_KOV.profs.
// Output: scripts/data/wx-recipes.json (Recipe-table shape).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(dir, "data", "wx-src");
const OUT = path.join(dir, "data", "wx-recipes.json");

function loadGlobal(file, varName) {
  const source = readFileSync(file, "utf8");
  const m = source.match(new RegExp(`window\\.${varName}\\s*=\\s*`));
  let code = source.slice(m.index + m[0].length).trim();
  if (code.endsWith(";")) code = code.slice(0, -1);
  return Function(`"use strict"; return (${code});`)();
}

// Canonical English profession names — same mapping the import layer applies
// to in-game dumps (src/lib/addon-scan.ts PROFESSION_ZH_TO_EN).
const PROFESSION_ZH_TO_EN = {
  "锻造": "Blacksmithing", "制皮": "Leatherworking", "裁缝": "Tailoring",
  "炼金术": "Alchemy", "工程学": "Engineering", "烹饪": "Cooking",
  "急救": "First Aid", "采矿": "Mining", "附魔": "Enchanting",
  "钓鱼": "Fishing", "草药学": "Herbalism", "剥皮": "Skinning",
  "贸易通用": "General"
};

const items = loadGlobal(path.join(TMP, "data-item.js"), "WF_ITEM");
const prof = loadGlobal(path.join(TMP, "data-prof.js"), "WF_PROF");
const kov = loadGlobal(path.join(TMP, "data-kov.js"), "WF_KOV");

const itemById = new Map();
// WF_ITEM cols: id, zh, en, ilvl, req, q, grp, cls, sub, subZh, inv, bond, ...
for (const row of items.rows) {
  itemById.set(row[0], { zh: row[1], en: row[2], ilvl: row[3], req: row[4], q: row[5] });
}
const itemName = (id) => itemById.get(id)?.zh ?? `物品 ${id}`;
const itemMeta = (id) => {
  const it = itemById.get(id);
  if (!it) return {};
  return { quality: it.q, ilvl: it.ilvl, req: it.req };
};

// cat id -> profession zh name (cats: [catId, name, ?, profIdx, count])
const profZhByCat = new Map();
const catNameById = new Map();
for (const c of prof.cats) {
  const zh = prof.profs[c[3]]?.[2];
  if (zh) profZhByCat.set(c[0], zh);
  catNameById.set(c[0], c[1]);
}

const craftRecipes = [];
const skippedNoProduct = [];
for (const rec of prof.rows) {
  // rec: [sp, sk, cat, out, nm, mat, ico, tk]
  const [sp, sk, cat, out, nm, mat, , tk] = rec;
  if (!out || out <= 0) { skippedNoProduct.push(nm); continue; }
  const zhProf = profZhByCat.get(cat) ?? "Unknown";
  craftRecipes.push({
    name: nm,
    profession: PROFESSION_ZH_TO_EN[zhProf] ?? zhProf,
    skillLevel: sk ?? 0,
    // 技能四档难度 [学,黄,绿,灰]，0 = 客户端未记录；学==黄时学记 0。
    difficulty: Array.isArray(tk) ? tk : [0, sk ?? 0, 0, 0],
    categoryName: catNameById.get(cat) ?? "",
    spellId: sp ?? 0,
    reagents: (mat ?? []).map(([itemId, qty]) => ({
      itemId, name: itemName(itemId), quantity: qty, ...itemMeta(itemId)
    })),
    outputs: [{ itemId: out, name: itemName(out), quantity: 1, ...itemMeta(out) }],
    category: "craft"
  });
}

const merchantRecipes = [];
for (const row of kov.rows) {
  // row: [id, cost, pi, sk, t4, vi, sd, pd, mt, bd]
  // id = 图纸/配方物品 id（商人青睐兑换得到的是图纸，如"配方：次级奥法药剂"）；
  // pd = 该图纸做出的成品（仅信息用）；产出按图纸本身计。
  const [id, cost, pi, sk, t4, , , , mt] = row;
  if (!id || id <= 0) continue;
  const zhProf = kov.profs[pi]?.zh ?? "贸易通用";
  merchantRecipes.push({
    name: itemName(id),
    profession: PROFESSION_ZH_TO_EN[zhProf] ?? zhProf,
    skillLevel: sk ?? 0,
    // 技能四档难度 [学,黄,绿,灰]，0 = 客户端未记录；学==黄时学记 0。
    difficulty: Array.isArray(t4) ? t4 : [0, sk ?? 0, 0, 0],
    categoryName: "商人兑换",
    spellId: id, // 图纸物品 id（无对应法术 id 可查）
    reagents: (mt ?? []).map(([itemId, qty]) => ({
      itemId, name: itemName(itemId), quantity: qty, ...itemMeta(itemId)
    })),
    outputs: [{ itemId: id, name: itemName(id), quantity: 1, ...itemMeta(id) }],
    category: "merchant",
    favorCost: cost ?? 0 // 商人青睐 (currency id 3402); no copper exchange rate published
  });
}

// Dedupe within each category by (name, profession) — the Recipe table keys on
// that pair per category. A recipe may appear under several category trees in
// WF_PROF; keep the first entry. Merchant rows stay distinct from same-named
// craft rows (the key includes category).
function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const r of list) {
    const key = `${r.name}|${r.profession}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
const craftD = dedupe(craftRecipes);
const merchantD = dedupe(merchantRecipes);
const all = [...craftD, ...merchantD];
const byProf = {};
for (const r of all) byProf[r.profession] = (byProf[r.profession] ?? 0) + 1;
const byCat = {};
for (const r of all) byCat[r.category] = (byCat[r.category] ?? 0) + 1;

console.log("craft:", craftRecipes.length, "->", craftD.length, "| merchant:", merchantRecipes.length, "->", merchantD.length, "| total:", all.length);
console.log("skipped (no product, mostly enchanting):", skippedNoProduct.length);
console.log("by category:", JSON.stringify(byCat));
console.log("by profession:", JSON.stringify(byProf));
console.log("sample craft:", JSON.stringify(craftD[0]));
console.log("sample merchant:", JSON.stringify(merchantD[0]));

writeFileSync(OUT, JSON.stringify(all, null, 0), "utf8");
console.log("wrote", OUT);
