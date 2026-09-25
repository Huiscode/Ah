// Lua 5.1 syntax gate for the addon files. Run with the temp luaparse install:
//   node scripts/lua-syntax-check.js
const luaparse = require("C:/Users/Hz/Documents/Workspace/Ah/.tmp-luacheck/node_modules/luaparse");
const fs = require("fs");
const path = require("path");

const dir = "C:/Users/Hz/Documents/Workspace/Ah/addon/WoWderhoiAH";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".lua")).sort();
let failed = 0;

for (const file of files) {
  const src = fs.readFileSync(path.join(dir, file), "utf8");
  try {
    luaparse.parse(src, { luaVersion: "5.1", wait: false });
    console.log("OK   " + file);
  } catch (err) {
    failed += 1;
    console.log("FAIL " + file + " -> line " + (err.line ?? "?") + ": " + err.message);
  }
}
console.log(failed === 0 ? "All Lua files parse clean." : failed + " file(s) failed.");
process.exit(failed ? 1 : 0);
