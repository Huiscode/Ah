-- WoWderhoiAH Forever 模块：拍卖行市场识别 + 扫描按钮路由（2026-10-15 建，2026-11-16 改单按钮）
--
-- 单按钮设计（2026-11-16 用户拍板）：只有一个「扫描拍卖行」按钮，点击时按地点
-- 自动判定本次扫描归属市场，数据按判定结果分槽——
--   * 联盟（主城）：暴风城 / 铁炉堡 / 达纳苏斯     → faction → 主库 "PvP"
--   * 中立（贸易营地）：艾尔文森林 / 赤脊山         → neutral → 中立库 "PvP_N"
--   * 未知区域 → nil（不依赖挂单量回退，宁可不扫也不误判，用户拍板）
-- 网页端双市场对比/差价功能不受影响（分槽口径不变，只是按钮合一）。

Auctionator.Forever = Auctionator.Forever or {}

Auctionator.Forever.MARKET_ZONES_FACTION = {
  ["暴风城"] = true, ["铁炉堡"] = true, ["达纳苏斯"] = true,
  ["Stormwind City"] = true, ["Ironforge"] = true, ["Darnassus"] = true,
}
Auctionator.Forever.MARKET_ZONES_NEUTRAL = {
  ["艾尔文森林"] = true, ["赤脊山"] = true,
  ["Elwynn Forest"] = true, ["Redridge Mountains"] = true,
}

-- 当前扫描归属市场：faction → 联盟槽（PvP），neutral → 中立槽（PvP_N）
Auctionator.Forever.CurrentScanMarket = nil

-- 私服允许连续全量扫描（2026-10-15 用户要求）：跳过客户端 15 分钟全量查询冷却。
-- 冷却中 replicate 请求服务器仍会受理（可能延迟数秒响应），数据照常落盘。
Auctionator.Forever.AllowContinuousScan = true

function Auctionator.Forever.DetectMarket()
  local zone = GetRealZoneText()
  if zone == nil or zone == "" then
    return nil
  end
  if Auctionator.Forever.MARKET_ZONES_FACTION[zone] then
    return "faction"
  end
  if Auctionator.Forever.MARKET_ZONES_NEUTRAL[zone] then
    return "neutral"
  end
  return nil
end

-- 扫描按钮点击入口：market 参数可省——省略时按当前地点自动判定（单按钮设计）。
function Auctionator.Forever.ScanButtonOnClick(_, market)
  local detected = market or Auctionator.Forever.DetectMarket()
  if detected == nil then
    Auctionator.Utilities.Message(AUCTIONATOR_L_SCAN_BUTTON_UNKNOWN_AH)
    return
  end
  Auctionator.Forever.CurrentScanMarket = detected
  -- 优先用增量扫描（SendBrowseQuery 逐页浏览：无 15 分钟冷却、进度平滑、
  -- 中立拍卖行同样可用）；增量帧不可用时回退全量复制扫描。
  local inc = Auctionator.State and Auctionator.State.IncrementalScanFrameRef
  if inc and inc.InitiateScan then
    inc:InitiateScan()
  elseif Auctionator.State and Auctionator.State.FullScanFrameRef then
    Auctionator.State.FullScanFrameRef:InitiateScan()
  end
end

-- 打开拍卖行后刷新扫描按钮可用状态：已知市场（联盟主城/中立营地）才可点，
-- 未知区域禁用（宁可不扫不误判）。旧版的第二个按钮若残留（部分同步时）直接隐藏。
local updateAttempts = 0
local function UpdateScanButtons()
  local configFrame = _G["AuctionatorConfigFrame"]
  if configFrame == nil or configFrame.ScanButton == nil then
    updateAttempts = updateAttempts + 1
    if updateAttempts < 50 then
      C_Timer.After(0.1, UpdateScanButtons)
    end
    return
  end
  updateAttempts = 0

  if configFrame.NeutralScanButton then
    configFrame.NeutralScanButton:Hide()
  end

  local market = Auctionator.Forever.DetectMarket()
  if market == nil then
    configFrame.ScanButton:Disable()
    Auctionator.Utilities.Message(AUCTIONATOR_L_SCAN_BUTTON_UNKNOWN_AH)
  else
    configFrame.ScanButton:Enable()
  end
end
Auctionator.Forever.UpdateScanButtons = UpdateScanButtons

-- 拍卖行打开 → 刷新按钮状态
local eventFrame = CreateFrame("Frame")
eventFrame:RegisterEvent("AUCTION_HOUSE_SHOW")
eventFrame:SetScript("OnEvent", function()
  C_Timer.After(0, function()
    Auctionator.Forever.UpdateScanButtons()
  end)
end)
