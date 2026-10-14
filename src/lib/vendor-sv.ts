// 游戏内商人价（WAHVendorDB）解析。与 WAHTranscribeDB 同存于
// WoWderhoiAH-Transcript.lua 存档；由插件 VendorPrice.lua 在打开商人
// 窗口时实时记录 NPC 收购价（C_Item.GetItemInfo 第 11 返回 sellPrice）。
//
// 权威顺序（用户 2026-10-14 拍板）：游戏内实时商人价 > foreverchanges 网站
// 核对 > Auctionator 旧缓存（已弃用）。audit（网站核对）启动时应跳过已有
// 游戏内值的物品，避免把更准的值覆盖回网站值。
import { readFileSync } from "node:fs";
import { lua, lauxlib, lualib, to_luastring, to_jsstring, type LuaState } from "fengari";

export type VendorGameEntry = { p: number; sp: number; t: number };

export const DEFAULT_TRANSCRIPT_SV_PATH =
  "C:\\Program Files (x86)\\World of Warcraft\\_classic_beta_\\WTF\\Account\\1120133458#1\\SavedVariables\\WoWderhoiAH-Transcript.lua";

export function transcriptSvPath(): string {
  return process.env.AQ_TRANSCRIPT_SV_PATH ?? DEFAULT_TRANSCRIPT_SV_PATH;
}

/** Lua 值 → JS（只处理数字/字符串/布尔/表；表自动区分数组与记录）。 */
function luaToJs(L: LuaState, idx: number): unknown {
  idx = lua.lua_absindex(L, idx);
  const t = lua.lua_type(L, idx);
  if (t === lua.LUA_TNUMBER) return lua.lua_tonumber(L, idx);
  if (t === lua.LUA_TSTRING) return to_jsstring(lua.lua_tostring(L, idx));
  if (t === lua.LUA_TBOOLEAN) return lua.lua_toboolean(L, idx);
  if (t === lua.LUA_TNIL) return null;
  if (t === lua.LUA_TTABLE) {
    const keys: Array<{ name: string; numeric: boolean }> = [];
    let isArray = true;
    let maxIdx = -1;
    lua.lua_pushnil(L);
    while (lua.lua_next(L, idx) !== 0) {
      const keyType = lua.lua_type(L, -2);
      const numeric = keyType === lua.LUA_TNUMBER;
      const name = numeric ? String(lua.lua_tonumber(L, -2)) : to_jsstring(lua.lua_tostring(L, -2));
      keys.push({ name, numeric });
      if (!numeric) isArray = false;
      else maxIdx = Math.max(maxIdx, parseInt(name, 10));
      lua.lua_pop(L, 1);
    }
    const arr: unknown[] = [];
    const obj: Record<string, unknown> = {};
    for (const { name, numeric } of keys) {
      if (numeric) lua.lua_rawgeti(L, idx, parseInt(name, 10));
      else lua.lua_getfield(L, idx, to_luastring(name));
      const val = luaToJs(L, -1);
      lua.lua_pop(L, 1);
      if (numeric) arr[parseInt(name, 10)] = val;
      else obj[name] = val;
    }
    if (isArray) {
      arr.length = maxIdx + 1;
      return arr.slice(1);
    }
    return obj;
  }
  return null;
}

/**
 * 解析 WAHVendorDB。返回 itemId → { p: 收购价(铜), sp: 商人卖出单价(铜), t: 服务器时间戳 }。
 * 存档缺失 / 无 WAHVendorDB / 无有效条目 → null（调用方按"无游戏内值"处理）。
 */
export function loadVendorGamePrices(svPath?: string): Map<number, VendorGameEntry> | null {
  let source: string;
  try {
    source = readFileSync(svPath ?? transcriptSvPath(), "utf8");
  } catch {
    return null;
  }
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const buffer = to_luastring(source);
  if (lauxlib.luaL_loadbuffer(L, buffer, buffer.length, to_luastring("WoWderhoiAH-Transcript.lua")) !== lua.LUA_OK) {
    lua.lua_close(L);
    return null;
  }
  if (lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
    lua.lua_close(L);
    return null;
  }
  lua.lua_getglobal(L, to_luastring("WAHVendorDB"));
  const db = luaToJs(L, -1) as { scans?: Record<string, { p?: number; sp?: number; t?: number }> } | null;
  lua.lua_close(L);
  if (!db || typeof db !== "object" || !db.scans) return null;
  const out = new Map<number, VendorGameEntry>();
  for (const [key, v] of Object.entries(db.scans)) {
    const id = Number(key);
    if (Number.isInteger(id) && v && typeof v.p === "number" && v.p > 0) {
      out.set(id, {
        p: Math.round(v.p),
        sp: typeof v.sp === "number" && v.sp > 0 ? Math.round(v.sp) : 0,
        t: typeof v.t === "number" ? v.t : 0
      });
    }
  }
  return out.size > 0 ? out : null;
}
