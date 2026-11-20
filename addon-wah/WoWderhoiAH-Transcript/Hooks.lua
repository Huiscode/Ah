if WAH.disabled then return end

-- 对原版 Auctionator 的运行时挂钩（2026-11-20 从改造源码迁出）。
-- 全部挂在全局 mixin / 实例上，不改 Auctionator 文件；Auctionator 升级后若
-- 某个挂点消失，登录时自检会在聊天框报警（见文件末尾）。

-- 1) 私服允许连续全量扫描：跳过 replicate 的 15 分钟客户端冷却检查。
local function canInitiate(self)
  return not self.inProgress
end
if AuctionatorFullScanFrameMixin then
  AuctionatorFullScanFrameMixin.CanInitiate = canInitiate
end

-- 2) 物品信息未缓存（如中立拍卖行首次扫到的物品）时 GetItemInfoInstant 返回 nil，
--    原版 IsEquipment(nil) 会刷报错风暴。保守按非装备处理。
if Auctionator.Utilities and Auctionator.Utilities.DBKeyFromBrowseResult and Auctionator.Utilities.IsEquipment then
  local function isGear(itemID)
    local classType = select(6, C_Item.GetItemInfoInstant(itemID))
    if classType == nil then return false end
    return Auctionator.Utilities.IsEquipment(classType)
  end
  Auctionator.Utilities.DBKeyFromBrowseResult = function(result)
    if result.itemKey.battlePetSpeciesID ~= 0 then
      return {"p:" .. tostring(result.itemKey.battlePetSpeciesID)}
    elseif isGear(result.itemKey.itemID) and result.itemKey.itemLevel >= Auctionator.Constants.ITEM_LEVEL_THRESHOLD then
      return {
        "g:" .. result.itemKey.itemID .. ":" .. result.itemKey.itemLevel,
        tostring(result.itemKey.itemID)
      }
    else
      return {tostring(result.itemKey.itemID)}
    end
  end
end

-- 3) 扫描完成 → 自动补档（前五档价格）。EventBus 回调链里只做赋值（taint 坑，
--    见 docs/AI.md §6.3），真正的搜索在下面独立 OnUpdate 帧里启动。
local backfillPendingAt = nil

local function scanCompleteEventNames()
  local names = {}
  if Auctionator.FullScan and Auctionator.FullScan.Events and Auctionator.FullScan.Events.ScanComplete then
    table.insert(names, Auctionator.FullScan.Events.ScanComplete)
  end
  if Auctionator.IncrementalScan and Auctionator.IncrementalScan.Events and Auctionator.IncrementalScan.Events.ScanComplete then
    table.insert(names, Auctionator.IncrementalScan.Events.ScanComplete)
  end
  return names
end
WAH.ScanCompleteEventNames = scanCompleteEventNames

local function installBackfillTrigger()
  local bus = Auctionator.EventBus
  if not bus or bus.__wahBackfill then return end
  local names = scanCompleteEventNames()
  if #names == 0 then return end
  bus:Register({ ReceiveEvent = function()
    backfillPendingAt = GetTime() + 1
  end }, names)
  bus.__wahBackfill = true
end
installBackfillTrigger()

local backfillFrame = CreateFrame("Frame")
backfillFrame:SetScript("OnUpdate", function()
  if backfillPendingAt and GetTime() >= backfillPendingAt then
    backfillPendingAt = nil
    if WAH.StartTierBackfill then
      WAH.StartTierBackfill(WAH.CurrentScanMarket)
    end
  end
end)

-- 4) 登录自检：Auctionator 升级后挂点变了要第一时间知道，而不是默默失效。
local loginFrame = CreateFrame("Frame")
loginFrame:RegisterEvent("PLAYER_LOGIN")
loginFrame:SetScript("OnEvent", function()
  C_Timer.After(1, function()
    installBackfillTrigger()
    local missing = {}
    if not AuctionatorScanButtonMixin then table.insert(missing, "AuctionatorScanButtonMixin") end
    if not AuctionatorFullScanFrameMixin then table.insert(missing, "AuctionatorFullScanFrameMixin") end
    if not Auctionator.DatabaseMixin then table.insert(missing, "Auctionator.DatabaseMixin") end
    if not Auctionator.EventBus then table.insert(missing, "Auctionator.EventBus") end
    if #scanCompleteEventNames() == 0 then table.insert(missing, "ScanComplete 事件") end
    if not WAH.InstallDatabaseRouting() then table.insert(missing, "Auctionator.Database:ProcessScan") end
    if #missing > 0 then
      WAH.chat("WAH", string.format("|cffff5555自检失败|r（Auctionator v%s）：缺少 %s。可能是 Auctionator 更新改了内部结构，"
        .. "中立分槽/补档可能失效，请先别扫中立市场并更新 WoWderhoiAH。", WAH.AuctionatorVersion(), table.concat(missing, "、")))
    end
  end)
end)
