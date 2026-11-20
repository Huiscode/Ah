if WAH.disabled then return end

-- 市场识别 + 扫描按钮路由（2026-11-20 重写）
--
-- 旧版只按 GetRealZoneText() 白名单判定：中立拍卖行所在区域名不在名单里时
-- 返回 nil → 按钮被 Disable（变灰），这正是"中立拍卖行无法扫描"的根因。
--
-- 判定顺序（数据严禁混槽：宁可不扫也不误判）：
--   1. /wahmarket faction|neutral 手动指定（仅本次登录有效）
--   2. 联盟主城（区域名 / uiMapID）                → faction（槽 PvP）
--   3. 拍卖师本身是中立阵营（地精等，UnitFactionGroup("npc") 为空/Neutral）→ neutral（槽 PvP_N）
--   4. 中立区域白名单（区域名 / 子区域名 / uiMapID）→ neutral
--   5. 其余 → 未知：按钮禁用，并在聊天框打印诊断信息和手动指定命令

local FACTION_ZONES = {
  ["暴风城"] = true, ["铁炉堡"] = true, ["达纳苏斯"] = true,
  ["Stormwind City"] = true, ["Ironforge"] = true, ["Darnassus"] = true,
}
local FACTION_MAPS = { [1453] = true, [1455] = true, [1457] = true }

local NEUTRAL_ZONES = {
  -- 贸易营地（用户实测：艾尔文森林/赤脊山交界）
  ["艾尔文森林"] = true, ["赤脊山"] = true,
  ["Elwynn Forest"] = true, ["Redridge Mountains"] = true,
  -- 经典地精中立拍卖行
  ["加基森"] = true, ["藏宝海湾"] = true, ["永望镇"] = true,
  ["Gadgetzan"] = true, ["Booty Bay"] = true, ["Everlook"] = true,
  ["塔纳利斯"] = true, ["荆棘谷"] = true, ["冬泉谷"] = true,
  ["Tanaris"] = true, ["Stranglethorn Vale"] = true, ["Winterspring"] = true,
}
local NEUTRAL_MAPS = { [1429] = true, [1433] = true, [1446] = true, [1434] = true, [1452] = true }

WAH.CurrentMarket = nil       -- 当前打开的拍卖行所属市场（AH 打开时识别，关闭时清空）
WAH.CurrentScanMarket = nil   -- 最近一次扫描归属的市场（补档/落盘时间戳用）
WAH.ForcedMarket = nil        -- /wahmarket 手动指定（不落盘）

local function npcFaction()
  if not UnitExists("npc") then return nil, false end
  return UnitFactionGroup("npc"), true
end

local function currentMapId()
  if C_Map and C_Map.GetBestMapForUnit then
    return C_Map.GetBestMapForUnit("player")
  end
  return nil
end

-- 返回 market（"faction"/"neutral"/nil）与判定依据（诊断用）。
function WAH.DetectMarket()
  if WAH.ForcedMarket then
    return WAH.ForcedMarket, "手动指定"
  end
  local zone = GetRealZoneText() or ""
  local subZone = (GetSubZoneText and GetSubZoneText()) or ""
  local mapId = currentMapId()

  if FACTION_ZONES[zone] or (mapId and FACTION_MAPS[mapId]) then
    return "faction", "联盟主城 " .. zone
  end
  local faction, hasNpc = npcFaction()
  if hasNpc and (faction == nil or faction == "Neutral") then
    return "neutral", "中立阵营拍卖师"
  end
  if NEUTRAL_ZONES[zone] or NEUTRAL_ZONES[subZone] or (mapId and NEUTRAL_MAPS[mapId]) then
    return "neutral", "中立区域 " .. zone
  end
  return nil, nil
end

local function marketLabel(market)
  if market == "neutral" then return "中立市场" end
  if market == "faction" then return "联盟市场" end
  return "未知"
end
WAH.MarketLabel = marketLabel

local function diagnose()
  local faction, hasNpc = npcFaction()
  return string.format("区域=%s / 子区域=%s / 拍卖师阵营=%s / mapID=%s",
    tostring(GetRealZoneText()), tostring(GetSubZoneText and GetSubZoneText()),
    hasNpc and tostring(faction or "中立") or "无", tostring(currentMapId()))
end

local function startScan()
  local inc = Auctionator.State and Auctionator.State.IncrementalScanFrameRef
  if inc and inc.InitiateScan then
    -- 增量扫描（SendBrowseQuery 逐页）：无 15 分钟冷却，是无限版的实际引擎
    inc:InitiateScan()
  elseif Auctionator.State and Auctionator.State.FullScanFrameRef then
    Auctionator.State.FullScanFrameRef:InitiateScan()
  end
end

function WAH.ScanButtonOnClick()
  local market = WAH.DetectMarket()
  if market == nil then
    WAH.chat("WAH", "无法识别当前拍卖行属于哪个市场，已取消扫描（防止数据混槽）。" .. diagnose()
      .. "。确认后可输入 /wahmarket neutral 或 /wahmarket faction 手动指定。")
    return
  end
  WAH.CurrentMarket = market
  WAH.CurrentScanMarket = market
  startScan()
end

-- 原版 mixin 的 OnClick 换成市场路由；XML 里是 <OnClick method="OnClick"/>，
-- 运行时按实例字段查找，所以已创建的按钮实例也要单独替换（见 RefreshScanButton）。
if AuctionatorScanButtonMixin then
  AuctionatorScanButtonMixin.OnClick = function() WAH.ScanButtonOnClick() end
end

local refreshAttempts = 0
local function RefreshScanButton(announce)
  local configFrame = _G["AuctionatorConfigFrame"]
  if configFrame == nil or configFrame.ScanButton == nil then
    refreshAttempts = refreshAttempts + 1
    if refreshAttempts < 50 then
      C_Timer.After(0.1, function() RefreshScanButton(announce) end)
    end
    return
  end
  refreshAttempts = 0
  local button = configFrame.ScanButton
  button.OnClick = function() WAH.ScanButtonOnClick() end

  local market, reason = WAH.DetectMarket()
  WAH.CurrentMarket = market
  if market == nil then
    button:Disable()
    if announce then
      WAH.chat("WAH", "无法识别当前拍卖行的市场，扫描按钮已禁用。" .. diagnose()
        .. "。如确认是中立拍卖行：/wahmarket neutral；联盟：/wahmarket faction；恢复自动：/wahmarket auto")
    end
  else
    button:Enable()
    if announce then
      WAH.chat("WAH", string.format("当前拍卖行 → %s（依据：%s）", marketLabel(market), reason))
    end
  end
end
WAH.RefreshScanButton = RefreshScanButton

local eventFrame = CreateFrame("Frame")
eventFrame:RegisterEvent("AUCTION_HOUSE_SHOW")
eventFrame:RegisterEvent("AUCTION_HOUSE_CLOSED")
eventFrame:SetScript("OnEvent", function(_, event)
  if event == "AUCTION_HOUSE_SHOW" then
    if WAH.InstallDatabaseRouting then WAH.InstallDatabaseRouting() end
    C_Timer.After(0, function() RefreshScanButton(true) end)
  else
    WAH.CurrentMarket = nil
  end
end)

SLASH_WAHMARKET1 = "/wahmarket"
SlashCmdList.WAHMARKET = function(msg)
  local arg = strtrim((msg or ""):lower())
  if arg == "neutral" or arg == "faction" then
    WAH.ForcedMarket = arg
    WAH.chat("WAH", "已手动指定为" .. marketLabel(arg) .. "（本次登录有效；/wahmarket auto 恢复自动识别）。")
  elseif arg == "auto" then
    WAH.ForcedMarket = nil
    WAH.chat("WAH", "已恢复自动识别。")
  else
    local market, reason = WAH.DetectMarket()
    WAH.chat("WAH", string.format("当前识别：%s%s。%s。用法：/wahmarket neutral|faction|auto",
      marketLabel(market), reason and ("（" .. reason .. "）") or "", diagnose()))
    return
  end
  if (AuctionHouseFrame and AuctionHouseFrame:IsShown()) or (AuctionFrame and AuctionFrame:IsShown()) then
    RefreshScanButton(true)
  end
end
