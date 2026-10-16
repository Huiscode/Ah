-- WoWderhoiAH Forever 模块：拍卖行市场识别 + 扫描按钮路由（2026-10-15）
--
-- 职责：
--   1) DetectMarket()         纯地点判定：当前打开的拍卖行属于哪个市场。
--       联盟（主城）：暴风城 / 铁炉堡 / 达纳苏斯
--       中立（艾尔文森林/赤脊山交界贸易营地）：艾尔文森林 / 赤脊山
--       未知区域 → nil（不依赖挂单量回退，宁可不扫也不误判，用户拍板）
--   2) ScanButtonOnClick()    两个扫描按钮的共用入口：校验市场一致后启动全量扫描
--   3) UpdateScanButtons()    按检测结果 Enable/Disable 两个扫描按钮
--   4) CurrentScanMarket      本次扫描归属市场（供 FullScan EndProcessing 分槽路由）

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

-- 扫描按钮点击入口（AuctionatorScanButtonMixin / AuctionatorNeutralScanButtonMixin 共用）
function Auctionator.Forever.ScanButtonOnClick(_, market)
  local detected = Auctionator.Forever.DetectMarket()
  if detected ~= market then
    Auctionator.Utilities.Message(AUCTIONATOR_L_SCAN_BUTTON_WRONG_AH)
    return
  end
  Auctionator.Forever.CurrentScanMarket = market
  -- 优先用增量扫描（SendBrowseQuery 逐页浏览：无 15 分钟冷却、进度平滑、
  -- 中立拍卖行同样可用）；增量帧不可用时回退全量复制扫描。
  local inc = Auctionator.State and Auctionator.State.IncrementalScanFrameRef
  if inc and inc.InitiateScan then
    inc:InitiateScan()
  elseif Auctionator.State and Auctionator.State.FullScanFrameRef then
    Auctionator.State.FullScanFrameRef:InitiateScan()
  end
end

-- 打开拍卖行后刷新两个扫描按钮的可用状态。
-- AuctionatorConfigFrame 由 AuctionatorAHFrame:OnShow 创建（AUCTION_HOUSE_SHOW 广播顺序在
-- Auctionator 内部帧之后），按钮尚未创建时重试（上限 50 次 × 0.1s ≈ 5s）。
local updateAttempts = 0
local function UpdateScanButtons()
  local configFrame = _G["AuctionatorConfigFrame"]
  if configFrame == nil or configFrame.ScanButton == nil or configFrame.NeutralScanButton == nil then
    updateAttempts = updateAttempts + 1
    if updateAttempts < 50 then
      C_Timer.After(0.1, UpdateScanButtons)
    end
    return
  end
  updateAttempts = 0

  local market = Auctionator.Forever.DetectMarket()
  if market == "faction" then
    configFrame.ScanButton:Enable()
    configFrame.NeutralScanButton:Disable()
  elseif market == "neutral" then
    configFrame.ScanButton:Disable()
    configFrame.NeutralScanButton:Enable()
  else
    configFrame.ScanButton:Disable()
    configFrame.NeutralScanButton:Disable()
    Auctionator.Utilities.Message(AUCTIONATOR_L_SCAN_BUTTON_UNKNOWN_AH)
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
