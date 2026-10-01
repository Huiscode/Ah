// Run audit for all favor-bearing pages; write .tmp-audit-<slug>.json for each.
import { spawnSync } from "node:child_process";

const pages = [
  ["alchemy", "Alchemy"],
  ["blacksmithing", "Blacksmithing"],
  ["engineering", "Engineering"],
  ["leatherworking", "Leatherworking"],
  ["tailoring", "Tailoring"],
  ["cooking", "Cooking"],
  ["first-aid", "First Aid"],
  ["enchanting", "Enchanting", "--crafted"],
];
for (const p of pages) {
  const args = ["scripts/audit-favor.mjs", p[0], p[1]];
  if (p[2]) args.push(p[2]);
  args.push("--json");
  const res = spawnSync("node", args, { encoding: "utf8" });
  // print only non-COVERED lines + summary + RECORD lines
  const lines = (res.stdout ?? "").split("\n");
  for (const l of lines) {
    if (!l.startsWith("[COVERED-LOCAL")) console.log(l);
  }
  console.log("---");
}
