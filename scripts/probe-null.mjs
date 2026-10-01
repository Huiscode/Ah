// List all favor entries where recipe is null or recipe.makes is null.
// Usage: node scripts/probe-null.mjs <slug>
import fs from "node:fs";
import path from "node:path";

const slug = process.argv[2];
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
console.log(`===== ${slug}: favor ${favor.length} =====`);
const nullRecipe = [];
const nullMakes = [];
for (const f of favor) {
  if (f.recipe == null) nullRecipe.push(f);
  else if (f.recipe.makes == null) nullMakes.push(f);
}
console.log(`recipe:null: ${nullRecipe.length}`);
for (const f of nullRecipe) console.log("  NR", JSON.stringify(f));
console.log(`recipe.makes==null: ${nullMakes.length}`);
for (const f of nullMakes) console.log("  NM", JSON.stringify(f));
