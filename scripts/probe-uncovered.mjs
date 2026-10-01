// Dump uncovered favor entries in detail for a profession.
// Usage: node scripts/probe-uncovered.mjs <slug> <ProfessionName>
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
  try { return JSON.parse(raw); } catch { return undefined; }
}

const favor = getKey("favor") || [];
const items = getKey("items") || {};
const recipes = getKey("recipes") || {};
const enchants = getKey("enchants") || [];

const db = new DatabaseSync(path.join(process.cwd(), "prisma", "dev.db"), { readOnly: true });
const localRows = db.prepare(`SELECT name, category FROM Recipe WHERE profession = ?`).all(profName);
const localNames = new Set(localRows.map((r) => r.name));

console.log(`===== ${profName} (${slug}) =====`);
console.log(`favor: ${favor.length}, recipes: ${Object.keys(recipes).length} keys, enchants: ${Array.isArray(enchants) ? enchants.length : typeof enchants}`);

// show first favor entry raw for structure
console.log("favor[0] raw:", JSON.stringify(favor[0]));

for (const f of favor) {
  const localName = f.recipe?.local ?? "";
  const makesId = f.recipe?.makes ?? null;
  if (!localNames.has(localName)) {
    console.log("\nUNCOVERED favor entry:");
    console.log("  raw:", JSON.stringify(f));
    console.log("  local name:", JSON.stringify(localName), "| makes:", makesId, "| inRecipesMap:", recipes[String(f.id)] ? "yes" : "no");
    // does the recipes map contain a recipe with the same output item?
    if (makesId != null) {
      const found = Object.entries(recipes).find(([, v]) => v.makes?.id === makesId);
      console.log("  recipes map entry with same makes:", found ? `${found[0]}: ${JSON.stringify(found[1]).slice(0, 400)}` : "none");
    }
  }
}
db.close();
