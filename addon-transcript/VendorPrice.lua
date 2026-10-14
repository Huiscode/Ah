-- WoWderhoiAH-Transcript v0.2.1：商人价转录模块
--
-- 目标：把 NPC 商人的实时收购价（玩家卖给 NPC 的价格）落盘到
--   WAHVendorDB，供网页端 vendor 价核对/更新。游戏内实时读到的是
--   服务器直接下发的最准值，用于补充或覆盖网站核对（foreverchanges.pro）
--   与旧 Auctionator 缓存。
--
-- 口径（重要）：
--   NPC 收购价 = C_Item.GetItemInfo(itemId) 的第 11 个返回值（sellPrice）。
--   NPC 卖出单价 = GetMerchantItemInfo(i) 的 price（整组价）÷ quantity（组内数）。
--   **不是**把 price÷组数当"卖价"——那是"商人卖出价"（玩家购买单价），
--   Auctionator 当年误用它当收购价缓存，导致系统性失真（墨水 20 金根因）。
--   收购价（p）与卖出单价（sp）分开记录，各司其职：
--   p = 必赚/成品收入兜底；sp = 材料成本兜底（无 AH 价时按 NPC 卖价算成本）。
--
-- 结构：WAHVendorDB.scans[itemId] = { p = 收购价（铜）, sp = 卖出单价（铜，0=未读到）, t = 服务器时间戳 }

local addonName, ns = ...

WAHVendorDB = WAHVendorDB or { version = 1, scans = {} }

local chatFrame = CreateFrame("Frame")
local function chat(msg)
  if DEFAULT_CHAT_FRAME then
    DEFAULT_CHAT_FRAME:AddMessage("|cff33ffccWAH商人价|r: " .. msg)
  end
end

-- 从物品链接解析 itemId（"item:1234:0:0:..." → 1234）
local function itemIdFromLink(link)
  if not link then return nil end
  local id = string.match(link, "item:(%d+)")
  if id then return tonumber(id) end
  return nil
end

-- 同步读取 NPC 收购价（第 11 个返回值）。物品信息未缓存时返回 nil。
local function readSellPriceSync(itemId)
  local ok, info = pcall(function()
    if C_Item and C_Item.GetItemInfo then
      return { C_Item.GetItemInfo(itemId) }
    end
    return nil
  end)
  if ok and info and tonumber(info[11]) and info[11] > 0 then
    return info[11]
  end
  return nil
end

-- 读该格商人卖出单价：price（整组价）÷ quantity（组内数）；读不到返回 0。
-- GetMerchantItemInfo(i) 返回：name, texture, price(整组), quantity(组内数), ...
local function readMerchantSellUnitPrice(i)
  local ok, _, _, price, quantity = pcall(GetMerchantItemInfo, i)
  if not ok then return 0 end
  if price and quantity and tonumber(price) and tonumber(quantity) and quantity > 0 then
    return math.max(1, math.floor(price / quantity))
  end
  return 0
end

-- 异步等待物品信息加载后再记录（兜底：翻页/下次打开商人时通常已缓存）
local function requestAsync(itemId)
  if not (Item and Item.CreateFromItemID) then return end
  local item = Item:CreateFromItemID(itemId)
  if item:IsItemEmpty() then return end
  item:ContinueOnItemLoad(function()
    local price = readSellPriceSync(itemId)
    if price and price > 0 then
      local key = tostring(itemId)
      local old = WAHVendorDB.scans[key]
      if not old or old.p ~= price then
        WAHVendorDB.scans[key] = { p = price, sp = old and old.sp or 0, t = GetServerTime() }
      end
    end
  end)
end

-- 遍历商人当前页商品，写入有变化的条目；返回新增/变更数。
local function scanMerchant()
  if not GetMerchantNumItems then return 0 end
  local numItems = GetMerchantNumItems()
  if not numItems or numItems == 0 then return 0 end
  local updated = 0
  for i = 1, numItems do
    local itemId = itemIdFromLink(GetMerchantItemLink(i))
    if itemId then
      local key = tostring(itemId)
      local old = WAHVendorDB.scans[key]
      local price = readSellPriceSync(itemId)
      local sellUnit = readMerchantSellUnitPrice(i)
      if price and price > 0 then
        if not old or old.p ~= price or (old.sp or 0) ~= sellUnit then
          WAHVendorDB.scans[key] = { p = price, sp = sellUnit, t = GetServerTime() }
          updated = updated + 1
        end
      else
        requestAsync(itemId)
      end
    end
  end
  return updated
end

-- 事件：打开商人窗口 / 商人货物更新（翻页、购买后刷新）都重扫当前页。
chatFrame:RegisterEvent("MERCHANT_SHOW")
chatFrame:RegisterEvent("MERCHANT_UPDATE")
local function totalRecorded()
  local n = 0
  for _ in pairs(WAHVendorDB.scans) do n = n + 1 end
  return n
end

chatFrame:SetScript("OnEvent", function(self, event)
  local updated = scanMerchant()
  if updated > 0 then
    chat(string.format("录入 %d 条 NPC 价格（收购价+卖出价，累计 %d 条）。", updated, totalRecorded()))
  end
end)
