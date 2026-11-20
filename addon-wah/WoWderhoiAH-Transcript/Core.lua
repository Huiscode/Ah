-- WoWderhoiAH 旁挂插件核心（2026-11-20）
--
-- 设计：Auctionator 本体保持原版（可随 CurseForge/WowUp 自由更新），本插件
-- 通过 Dependencies 在它之后加载，运行时挂钩：
--   * 扫描按钮 → 按市场路由（Market.lua）
--   * 价格库写入 → 中立市场写 PvP_N 槽（DatabaseNeutral.lua）
--   * 连续扫描 / 物品信息未缓存保护 / 扫描完成补档（Hooks.lua）
-- 自有 SavedVariables 落盘到 WoWderhoiAH-Transcript.lua，不再寄存在 Auctionator.lua。
--
-- 后续文件统一以 `if WAH.disabled then return end` 开头：自检失败时整体不挂钩。

local addonName = ...

WAH = WAH or {}
WAH.ADDON = addonName

local function chat(prefix, msg)
  if DEFAULT_CHAT_FRAME then
    DEFAULT_CHAT_FRAME:AddMessage("|cff33ffcc" .. prefix .. "|r: " .. msg)
  end
end
WAH.chat = chat

-- SavedVariables 在本插件全部文件执行完之后才载入（ADDON_LOADED）。文件顶层的
-- `X = X or {}` 会被存档值整体替换，所以初始化/迁移必须挂到这里。
local svCallbacks = {}
function WAH.OnSavedVariablesLoaded(fn)
  table.insert(svCallbacks, fn)
end
local svFrame = CreateFrame("Frame")
svFrame:RegisterEvent("ADDON_LOADED")
svFrame:SetScript("OnEvent", function(self, _, name)
  if name ~= addonName then return end
  self:UnregisterEvent("ADDON_LOADED")
  for _, fn in ipairs(svCallbacks) do fn() end
end)

function WAH.AuctionatorVersion()
  local getMeta = (C_AddOns and C_AddOns.GetAddOnMetadata) or GetAddOnMetadata
  return getMeta and getMeta("Auctionator", "Version") or "?"
end

local function disable(reason)
  WAH.disabled = true
  local frame = CreateFrame("Frame")
  frame:RegisterEvent("PLAYER_LOGIN")
  frame:SetScript("OnEvent", function()
    chat("WAH", "|cffff5555已停用|r：" .. reason)
  end)
end

if type(Auctionator) ~= "table" then
  disable("未检测到 Auctionator，请先安装 Auctionator。")
elseif type(Auctionator.Forever) == "table" and Auctionator.Forever.ScanButtonOnClick then
  -- 旧版"改造 Auctionator"自带 Source_Forever：两者同时运行会重复注册
  -- /wahscan、事件帧与扫描钩子，导致重复补档/重复落盘。
  disable("检测到旧版改造 Auctionator（内含 Source_Forever）。请把 Auctionator 恢复原版"
    .. "（CurseForge/WowUp 重新安装，或运行 scripts\\deploy-addon.ps1 -WithAuctionator）后 /reload。")
end
