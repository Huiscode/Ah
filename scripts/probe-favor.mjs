// Probe part 3: for a profession page, dump favor entries and cross-check
// against the local Recipe table (merchant + craft) to see which favor recipes
// are already covered locally.
// Usage: node scripts/probe-favor.mjs <slug> <ProfessionName>
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const slug = process.argv[2];
const profName = process.argv[3];

const decPath = path.join(process.cwd(), `.tmp-probe-${slug}-decoded.txt`);
const decoded = fs.readFileSync(decPath, "utf8");

function bracketMatch(s, startIdx) {
  const open = s[startIdx];
  const close = open === "[" ? "]" : "}";
  let depth = 0, inStr = false;
  for (let i = startIdx; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") { i++; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return s.slice(startIdx, i + 1); }
  }
  return null;
}

function getKey(key) {
  const needle = `"${key}"`;
  const idx = decoded.indexOf(needle);
  if (idx < 0) return undefined;
  const colon = decoded.indexOf(":", idx + needle.length);
  const ch = decoded[colon + 1];
  if (ch !== "[" && ch !== "{") return undefined;
  const raw = bracketMatch(decoded, colon + 1);
  if (!raw) return undefined;
  return JSON.parse(raw);
}

const favor = getKey("favor");
const items = getKey("items") || {};
const recipes = getKey("recipes") || {};
const enchants = getKey("enchants") || [];

console.log(`\n===== ${profName} (${slug}) =====`);
console.log(`favor: ${favor.length}, recipes map: ${Object.keys(recipes).length}, enchants array: ${enchants.length}, items map: ${Object.keys(items).length}`);

const db = new DatabaseSync(path.join(process.cwd(), "prisma", "dev.db"), { readOnly: true });
const stmt = db.prepare(`SELECT name, category FROM Recipe WHERE profession = ?`);
const localRows = stmt.all(profName);
const localMerchant = localRows.filter((r) => r.category === "merchant").map((r) => r.name);
const localCraft = localRows.filter((r) => r.category === "craft").map((r) => r.name);
console.log(`local ${profName}: total ${localRows.length}, merchant ${localMerchant.length}, craft ${localCraft.length}`);

let covered = 0, uncovered = 0;
for (const f of favor) {
  const makesId = f.recipe?.makes ?? null;
  const makesName = makesId != null ? (items[String(makesId)]?.n ?? `?${makesId}`) : "(无产出/附魔)";
  const localName = f.recipe?.local ?? f.recipe?.name ?? "";
  // does local merchant or craft contain this recipe by name?
  const inMerchant = localMerchant.includes(localName);
  const inCraft = localCraft.includes(localName);
  const inRecipesMap = recipes[String(f.id)] != null;
  const coveredFlag = inMerchant || inCraft || inRecipesMap ? "COVERED" : "UNCOVERED";
  if (coveredFlag === "COVERED") covered++; else uncovered++;
  console.log(
    `  [${coveredFlag}] favorId=${f.id} skill=${f.skill} favor=${f.favor} kind=${f.kind} local="${localName}" makes=${makesId} (${makesName})` +
      ` | local: ${inMerchant ? "merchant" : inCraft ? "craft" : "NO"} | pageRecipesMap: ${inRecipesMap ? "yes" : "no"}`
  );
}
console.log(`\ncovered: ${covered}, uncovered: ${uncovered}`);
