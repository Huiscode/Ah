// STRONGEST CHECK: every material of every favor recipe (all professions) must be
// present in the union of ALL local Recipe reagent itemIds + forever-enchants.json
// reagent ids (i.e. the exact sources compute-turnover.ts counts).
// Language-independent: matches by material id only.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const pages = [
  ["alchemy", "Alchemy", "rows"],
  ["blacksmithing", "Blacksmithing", "rows"],
  ["engineering", "Engineering", "rows"],
  ["leatherworking", "Leatherworking", "rows"],
  ["tailoring", "Tailoring", "rows"],
  ["cooking", "Cooking", "rows"],
  ["first-aid", "First Aid", "rows"],
  ["enchanting", "Enchanting", "crafted"],
];

function bracketMatch(s, startIdx) {
  const open = s[startIdx], close = open === "[" ? "]" : "}";
  let depth = 0, inStr = false;
  for (let i = startIdx; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === "\\") { i++; continue; } if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return s.slice(startIdx, i + 1); }
  }
  return null;
}
function getKey(decoded, key) {
  const needle = `"${key}"`, idx = decoded.indexOf(needle);
  if (idx < 0) return undefined;
  const colon = decoded.indexOf(":", idx + needle.length);
  const ch = decoded[colon + 1];
  if (ch !== "[" && ch !== "{") return undefined;
  const raw = bracketMatch(decoded, colon + 1);
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}

// ---- counted sources ----
const db = new DatabaseSync(path.join(process.cwd(), "prisma", "dev.db"), { readOnly: true });
const counted = new Map(); // itemId -> [recipe names]
const parseR = (x) => { try { return JSON.parse(x); } catch { return []; } };
const allRecipes = db.prepare("SELECT name, profession, category, reagents FROM Recipe").all();
for (const r of allRecipes) {
  for (const m of parseR(r.reagents)) {
    const id = m.itemId ?? m.id;
    if (!counted.has(id)) counted.set(id, []);
    counted.get(id).push(`${r.profession}/${r.category}/${r.name}`);
  }
}
db.close();

const fe = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts", "data", "forever-enchants.json"), "utf8"));
const feCounted = new Map();
for (const arr of [fe.enchants ?? [], fe.craftedMissing ?? []]) {
  for (const e of arr) {
    for (const m of e.reagents ?? []) {
      const id = m.id ?? m.itemId;
      if (!feCounted.has(id)) feCounted.set(id, []);
      feCounted.get(id).push(e.name);
    }
  }
}
console.log(`counted sources: ${counted.size} material ids from local Recipe, +${feCounted.size} from forever-enchants.json (some overlap)`);

// ---- every favor material must be in the union ----
let totalFavor = 0;
let totalMaterials = 0;
const missing = new Map(); // itemId -> [{prof, favorId, name, makes}]
const missingMaterialsByProf = new Map();
let recipesWithMissing = 0;

for (const [slug, prof, listKey] of pages) {
  const decPath = path.join(process.cwd(), `.tmp-probe-${slug}-decoded.txt`);
  if (!fs.existsSync(decPath)) { console.log(`SKIP ${slug}: no decoded file`); continue; }
  const decoded = fs.readFileSync(decPath, "utf8");
  const favor = getKey(decoded, "favor") || [];
  const items = getKey(decoded, "items") || {};
  const rows = getKey(decoded, listKey) || [];
  const enchants = getKey(decoded, "enchants") || [];

  totalFavor += favor.length;
  for (const f of favor) {
    // resolve materials
    let mats = null;
    if (f.recipe == null) continue; // item-purchase/cert: no craft materials on the page side
    const makes = f.recipe.makes ?? null;
    if (makes != null) {
      const row = rows.find((r) => r.id === makes);
      if (row?.reagents) mats = row.reagents;
    } else {
      const ench = (Array.isArray(enchants) ? enchants : []).find((e) => e.name === f.recipe.name);
      if (ench?.reagents) mats = ench.reagents;
    }
    if (!mats) continue;
    const localName = f.recipe.local ?? f.recipe.name;
    const recipeMissing = [];
    for (const m of mats) {
      const id = m.id ?? m.itemId;
      totalMaterials++;
      if (!counted.has(id) && !feCounted.has(id)) {
        recipeMissing.push(id);
        if (!missing.has(id)) missing.set(id, []);
        missing.get(id).push(`${prof}/${localName}(favor ${f.id})`);
        if (!missingMaterialsByProf.has(prof)) missingMaterialsByProf.set(prof, []);
        missingMaterialsByProf.get(prof).push({ id, recipe: localName });
      }
    }
    if (recipeMissing.length) {
      recipesWithMissing++;
      console.log(`  MISSING ${prof}: "${localName}" makes=${makes} missing ids=[${recipeMissing.join(",")}]`);
    }
  }
}

console.log(`\nfavor recipes with materials checked: ${totalFavor} entries; total material-uses: ${totalMaterials}`);
console.log(`recipes with any missing material: ${recipesWithMissing}`);
console.log(`distinct missing material ids: ${missing.size}`);
if (missing.size) {
  for (const [id, uses] of missing) console.log(`  ${id} used by: ${[...new Set(uses)].join("; ")}`);
}
const noFavorPages = ["fishing", "camping"].filter((s) => !fs.existsSync(path.join(process.cwd(), `.tmp-probe-${s}-decoded.txt`)) || !(getKey(fs.readFileSync(path.join(process.cwd(), `.tmp-probe-${s}-decoded.txt`), "utf8"), "favor") || []).length);
console.log(`pages with empty/missing favor array: ${noFavorPages.join(", ") || "(none besides fishing/camping)"}`);
