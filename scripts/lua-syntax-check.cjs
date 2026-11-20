// fengari 语法检查：只 load 不执行（等价 luaparse 的语法验证）
const { lua, lauxlib, to_luastring } = require("fengari");
const fs = require("fs");
const file = process.argv[2];
const src = fs.readFileSync(file, "utf8");
// 去 BOM
const clean = src.replace(/^\uFEFF/, "");
const L = lauxlib.luaL_newstate();
const status = lauxlib.luaL_loadbuffer(L, to_luastring(clean), null, to_luastring(file));
if (status === lua.LUA_OK) {
  console.log("SYNTAX OK:", file);
  process.exit(0);
} else {
  const err = lua.lua_tojsstring(L, -1);
  console.error("SYNTAX ERROR in", file, ":", err);
  process.exit(1);
}
