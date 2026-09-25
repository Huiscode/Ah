// Cross-check: every L.<KEY> referenced by the addon Lua files must be
// defined in the Locale.lua English base table. Run: node scripts/locale-key-check.cjs
const fs = require("fs");
const path = require("path");

const dir = "C:/Users/Hz/Documents/Workspace/Ah/addon/WoWderhoiAH";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".lua"));

const localeSrc = fs.readFileSync(path.join(dir, "Locale.lua"), "utf8");
const defined = new Set();
for (const m of localeSrc.matchAll(/^\s{2}([A-Z_0-9]+)\s*=\s*"/gm)) defined.add(m[1]);

const referenced = new Set();
for (const file of files) {
  if (file === "Locale.lua" || file === "GeneratedRules.lua") continue;
  const src = fs.readFileSync(path.join(dir, file), "utf8");
  for (const m of src.matchAll(/L\.([A-Z_0-9]+)/g)) referenced.add(m[1]);
}

const missing = [...referenced].filter((k) => !defined.has(k)).sort();
console.log("Defined: " + defined.size + " keys | Referenced: " + referenced.size + " keys");
if (missing.length) {
  console.log("MISSING (referenced but not defined): " + missing.join(", "));
  process.exit(1);
}
console.log("All referenced locale keys are defined.");
