/**
 * Definitive audit of a profession page's merchant-favor recipes (v2).
 *
 * Favor entry types:
 *   - recipe != null && makes != null  -> manufacturing recipe; local name = recipe.local
 *   - recipe != null && makes == null  -> enchant formula; materials live in the
 *     page's "enchants" array (matched by English recipe name)
 *   - recipe == null                   -> formula-item purchase (favor id IS the
 *     formula item id, e.g. 设计图：X) or a profession certification (name ends 认证)
 *
 * Coverage (user's standing criterion):
 *   - a local Recipe row (merchant or craft) with the SAME NAME and non-empty
 *     reagents => materials already counted => COVERED-LOCAL
 *   - an enchant already present in scripts/data/forever-enchants.json =>
 *     ALREADY-RECORDED
 *   - otherwise the page data (rows/crafted by makes, enchants by name) carries the
 *     materials => RECORD-NEEDED (materials listed)
 *   - certifications have no materials => CERT-NO-MATERIALS
 *
 * Verification: for covered entries with makes, compare local reagents itemId set
 * with the page row reagents itemId set; print a warning when they differ.
 *
 * Usage: node scripts/audit-favor.mjs <slug> <ProfessionName> [--crafted] [--json]
 *        --crafted : the page uses a "crafted" array instead of "rows"
 *        --json    : also write .tmp-audit-<slug>.json with the records list
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const slug = process.argv[2];
const profName = process.argv[3];
const listKey = process.argv.includes("--crafted") ? "crafted" : "rows";
const wantJson = process.argv.includes("--json");

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
const rows = getKey(listKey) || [];
const enchants = getKey("enchants") || [];

// already-recorded entries in forever-enchants.json, indexed by reagent-id signature
let feBySig = new Map();
const sigOf = (reagents) =>
  [...new Set((reagents ?? []).map((m) => m.id ?? m.itemId))].sort((a, b) => a - b).join(",");
try {
  const fe = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts", "data", "forever-enchants.json"), "utf8"));
  for (const e of [...(fe.enchants ?? []), ...(fe.craftedMissing ?? [])]) {
    const s = sigOf(e.reagents);
    if (!feBySig.has(s)) feBySig.set(s, []);
    feBySig.get(s).push(e.name);
  }
} catch { }

const db = new DatabaseSync(path.join(process.cwd(), "prisma", "dev.db"), { readOnly: true });
const localRows = db.prepare(`SELECT name, category, reagents, outputs FROM Recipe WHERE profession = ?`).all(profName);
const localByName = new Map();
const localByOutput = new Map(); // output itemId -> rows (language-independent matching)
for (const r of localRows) {
  if (!localByName.has(r.name)) localByName.set(r.name, []);
  localByName.get(r.name).push(r);
  let outs = [];
  try { const o = JSON.parse(r.outputs); outs = Array.isArray(o) ? o : []; } catch { }
  for (const o of outs) {
    const id = o.itemId ?? o.id;
    if (id == null) continue;
    if (!localByOutput.has(id)) localByOutput.set(id, []);
    localByOutput.get(id).push(r);
  }
}
const parseReagents = (x) => {
  if (typeof x === "string") { try { return JSON.parse(x); } catch { return []; } }
  return Array.isArray(x) ? x : [];
};
const localItems = new Map();
for (const it of db.prepare(`SELECT item_id AS itemId, name FROM Item`).all()) localItems.set(it.itemId, it.name);
db.close();

function itemName(id) {
  if (localItems.has(id)) return localItems.get(id);
  const p = items[String(id)];
  return p?.n ?? `?${id}`;
}

const records = [];
let covered = 0, alreadyRecorded = 0, toRecord = 0, certs = 0, noSource = 0, warnings = 0;

for (const f of favor) {
  const favId = f.id;
  const favorCost = f.favor ?? 0;
  const kind = f.kind ?? "";
  let localName, makes, type;
  if (f.recipe == null) {
    localName = items[String(favId)]?.n ?? null;
    makes = null;
    type = localName && localName.endsWith("认证") ? "cert" : "item-purchase";
  } else {
    localName = f.recipe.local ?? f.recipe.name;
    makes = f.recipe.makes ?? null;
    type = makes == null ? "enchant" : "recipe";
  }

  let status, source = "", materials = null;

  if (type === "cert") {
    status = "CERT-NO-MATERIALS";
    certs++;
  } else {
    const localHit = localName ? (localByName.get(localName) ?? []) : [];
    const localOutputHit = makes != null ? (localByOutput.get(makes) ?? []) : [];
    const localCandidates = [...localHit, ...localOutputHit];
    const localCovered = localCandidates.some((r) => parseReagents(r.reagents).length > 0);

    // page-side materials for verification / recording
    let pageMats = null;
    if (makes != null) {
      const row = rows.find((r) => r.id === makes);
      if (row?.reagents) {
        pageMats = row.reagents.map((m) => ({ id: m.id, count: m.count, name: itemName(m.id) ?? "?" }));
      }
    } else if (type === "enchant") {
      const ench = (Array.isArray(enchants) ? enchants : []).find((e) => e.name === f.recipe?.name);
      if (ench?.reagents) {
        pageMats = ench.reagents.map((m) => ({ id: m.id, count: m.count, name: itemName(m.id) ?? "?" }));
      }
    }

    if (localCovered) {
      status = "COVERED-LOCAL";
      covered++;
      // verification: compare itemId sets
      const localSets = localCandidates.filter((r) => parseReagents(r.reagents).length > 0).map((r) => parseReagents(r.reagents));
      if (makes != null && pageMats) {
        const pageIds = new Set(pageMats.map((m) => m.id));
        for (const lr of localSets) {
          const localIds = new Set(lr.map((m) => m.itemId ?? m.id));
          const diffPage = [...pageIds].filter((x) => !localIds.has(x));
          const diffLocal = [...localIds].filter((x) => !pageIds.has(x));
          if (diffPage.length || diffLocal.length) {
            warnings++;
            source = `WARN material-diff page→local: ${diffPage.join(",")} local→page: ${diffLocal.join(",")}`;
          } else {
            source = "materials-match";
          }
          break;
        }
      } else {
        source = localCandidates.map((r) => `${r.category}(${parseReagents(r.reagents).length}种)`).join("+");
      }
    } else if (type === "enchant" && pageMats && feBySig.has(sigOf(pageMats))) {
      status = "ALREADY-RECORDED";
      alreadyRecorded++;
      source = `forever-enchants.json (${feBySig.get(sigOf(pageMats)).join(" / ")})`;
    } else if (pageMats && pageMats.length > 0) {
      status = "RECORD-NEEDED";
      toRecord++;
      source = `${listKey}/${makes != null ? "id=" + makes : "enchant-by-name"}`;
      records.push({ favorId: favId, name: localName, makes, favorCost, kind, materials: pageMats });
      materials = pageMats;
    } else {
      status = "NO-SOURCE-FOUND";
      noSource++;
    }
  }

  console.log(
    `[${status.padEnd(18)}] ${String(favId).padEnd(7)} ${type.padEnd(13)} favor=${String(favorCost).padStart(4)} ${kind.padEnd(4)} "${localName ?? ""}" makes=${makes ?? "-"} ${source}`
  );
}

console.log(`\n===== ${profName} (${slug}) summary =====`);
console.log(`favor total: ${favor.length} | covered-local: ${covered} | already-recorded: ${alreadyRecorded} | record-needed: ${toRecord} | certs: ${certs} | no-source: ${noSource} | material warnings: ${warnings}`);
for (const r of records) {
  console.log(`  RECORD ${r.favorId} "${r.name}" makes=${r.makes} mats=[${r.materials.map((m) => `${m.id}x${m.count}(${m.name})`).join(", ")}]`);
}

if (wantJson) {
  fs.writeFileSync(path.join(process.cwd(), `.tmp-audit-${slug}.json`), JSON.stringify({
    profession: profName,
    slug,
    favorTotal: favor.length,
    coveredLocal: covered,
    alreadyRecorded,
    recordNeeded: toRecord,
    certs,
    noSource,
    records,
  }, null, 2));
  console.log(`wrote .tmp-audit-${slug}.json`);
}
