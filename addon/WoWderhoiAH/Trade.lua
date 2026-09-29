-- WAH panel (WoW: Forever / retail 12.x port): deal radar plus buy list.
-- The radar crosses this session's scan against the in-game 7d P10 median
-- to surface listings 15%+ below their usual price.
--
-- Retail architecture changes vs the TBC build:
--  * There is no AuctionFrameTabN tab mechanism on this client (the AH is a
--    single AuctionHouseFrame with built-in Buy/Sell views), so the WAH page
--    is now a draggable floating panel shown while the AH is open.
--  * The stock UI's QueryAuctionItems name search is replaced by a search
--    over the local scan data (the full-house replication already covers the
--    whole book). Buying re-verifies live: it queries the exact itemKey,
--    picks the cheapest valid listing, and PlaceBuyout's it.
--  * Sell prefill is downgraded to a suggested-price whisper: the classic
--    sell-slot events/fields do not exist on the retail AH frame.
--
-- Buy safety: the live row is re-queried and only a listing whose buyout
-- still exists is purchased; anything stale aborts with a message.

local ADDON_NAME, WAH = ...
local L = WAH.L

local ROWS_VISIBLE = 12 -- replaced in createTradeFrame by what the panel actually fits
local ROW_HEIGHT = 22
local PAD = 8
-- The panel exactly matches the auction house frame's height (set in
-- createTradeFrame): top edge aligned to the AH's, and every pixel below
-- the header is a row, so nothing at the bottom is left empty.
-- The panel matches AuctionHouseFrame's height (set in createTradeFrame),
-- so it sits exactly beside the AH with every pixel below the header
-- filled by a row; only the scroll arrows and bottom padding stay empty.
-- Deal-radar thresholds live in WAH.RADAR (GeneratedRules.lua, compiled from
-- src/lib/market-rules.ts) so the in-game radar and the desktop terminal
-- classify every scan identically.

local trade = nil
local results = {} -- rows: { itemId, name, minPrice, marketPrice, quantity }
local deals = {} -- radar rows: { itemId, name, minPrice, med7, discountPercent }
local mode = "deals" -- which list the scroll frame renders

local lastSellName = nil
local pendingBuyItemId = nil
-- Commodity buy-dialog state.
local buyDialog = nil
local commodityRungs = {} -- cached cheapest-first rungs { unitPrice, quantity }
local commodityTotalAvailable = 0
local commodityDialogState = "idle" -- idle | ready | quote
local expectedTotal = 0 -- client estimate the server quote must match
local expectedCommodityUnitPrice = 0
local pendingBuyCommodity = false

local function chatMessage(text)
  DEFAULT_CHAT_FRAME:AddMessage("|cff33ff99WAH|r " .. text)
end

-- The Forever beta client dropped the global GetItemIcon; resolve the item
-- icon texture through the retail API when present, with a safe fallback so
-- the trade rows still render on either client. Icons for items the client
-- has never cached return nil — request the item info (async load) and fall
-- back to a question-mark texture so the row never renders blank; the
-- GET_ITEM_INFO_RECEIVED handler re-renders the list once the icon lands.
local function itemIcon(itemId)
  if C_Item and C_Item.GetItemIconByID then
    local texture = C_Item.GetItemIconByID(itemId)
    if texture then return texture end
    if C_Item.GetItemInfoByID then C_Item.GetItemInfoByID(itemId) end
  end
  if GetItemIcon then
    local texture = GetItemIcon(itemId)
    if texture then return texture end
    if GetItemInfo then GetItemInfo(itemId) end
  end
  return "Interface\\ICONS\\INV_Misc_QuestionMark"
end

-- "查找" also fills the AH's own search box, so the buy quantity can be
-- typed where the client wants it. Probe the retail SearchBar first, then
-- the classic AuctionFrameBrowse search box; whichever exists gets the name.
local function fillAhSearch(name)
  if not name or name == "" then return end
  local ah = AuctionHouseFrame
  if ah and ah.SearchBar then
    local box = ah.SearchBar.SearchBox or ah.SearchBar.name or ah.SearchBar.editBox
    if box and box.SetText then
      box:SetText(name)
      return
    end
  end
  local browse = AuctionFrameBrowse
  if browse then
    local box = browse.searchBox or _G.AuctionFrameBrowseSearchBox
    if box and box.SetText then
      box:SetText(name)
    end
  end
end

-- ============================ Table model =============================

local function money(copper)
  local total = math.floor((copper or 0) + 0.5)
  local gold = math.floor(total / 10000)
  local silver = math.floor(total % 10000 / 100)
  if gold > 0 then
    return string.format("|cffffd700%d%s|r |cffc7c7cf%02d%s|r", gold, L.MONEY_G, silver, L.MONEY_S)
  elseif silver > 0 then
    return string.format("|cffc7c7cf%d%s|r |cffeda55f%02d%s|r", silver, L.MONEY_S, total % 100, L.MONEY_C)
  end
  return string.format("|cffeda55f%d%s|r", total % 100, L.MONEY_C)
end

local function moneyCell(value) return money(value) end
local function discountCell(value) return string.format("|cff55ff55-%.0f%%|r", value) end
local function countCell(value) return tostring(value) end

local COL_COUNT = 4
local DEAL_COLUMNS = {
  { key = "discountPercent", label = "COL_DISC", cell = discountCell },
  { key = "profit", label = "COL_PROFIT", cell = moneyCell },
  { key = "minPrice", label = "TT_MIN", cell = moneyCell, asc = true },
  { key = "med7", label = "COL_REF", cell = moneyCell }
}
local RESULT_COLUMNS = {
  { key = "quantity", label = "COL_QTY", cell = countCell },
  { key = "minPrice", label = "TT_MIN", cell = moneyCell, asc = true },
  { key = "marketPrice", label = "COL_P10", cell = moneyCell, asc = true }
}

local sortKey = nil
local sortAsc = false

local function columnAt(slot)
  local columns = mode == "deals" and DEAL_COLUMNS or RESULT_COLUMNS
  return columns[slot - (COL_COUNT - #columns)]
end

local function applySort()
  local rows = mode == "deals" and deals or results
  if not sortKey then
    if mode == "deals" then
      table.sort(rows, function(left, right)
        if left.vendor ~= right.vendor then return left.vendor end
        return left.profit > right.profit
      end)
    else
      table.sort(rows, function(left, right) return left.minPrice < right.minPrice end)
    end
    return
  end
  table.sort(rows, function(left, right)
    if left[sortKey] == right[sortKey] then return left.name < right.name end
    if sortAsc then return left[sortKey] < right[sortKey] end
    return left[sortKey] > right[sortKey]
  end)
end

local renderRows -- forward declaration

local function sortMark(key)
  if sortKey ~= key then return "" end
  return " " .. (sortAsc and L.SORT_ASC or L.SORT_DESC)
end

local function sortByKey(key, defaultAsc)
  if sortKey == key then
    sortAsc = not sortAsc
  else
    sortKey, sortAsc = key, defaultAsc or false
  end
  applySort()
  FauxScrollFrame_SetOffset(trade.scroll, 0)
  renderRows()
end

-- ============================== Deal radar ============================

local function refreshDeals()
  wipe(deals)
  sortKey = nil
  local scan = WoWderhoiAH_ScanData and WoWderhoiAH_ScanData.dataVersion == WAH.PIPELINE_VERSION and WoWderhoiAH_ScanData.items
  if not scan or not next(scan) then
    chatMessage(L.DEALS_NEED_SCAN)
    return
  end
  -- Class 2 requires a live market of at least minAuctions listings.
  local anyHistory = false
  for itemId, entry in pairs(scan) do
    local history = WAH.history(itemId)
    if history then anyHistory = true end
    -- Class 1: vendor arbitrage. Listed below the NPC sell price is a
    -- guaranteed profit with zero market risk — no history needed, and no
    -- profit floor either: the NPC always buys, so even a 1c spread is
    -- free money the moment you're already at the AH.
    if entry.vendorP and entry.vendorP > 0 and entry.minPrice and entry.minPrice > 0
      and entry.minPrice < entry.vendorP then
      deals[#deals + 1] = {
        itemId = itemId,
        name = entry.name,
        minPrice = entry.minPrice,
        med7 = entry.vendorP,
        profit = entry.vendorP - entry.minPrice,
        vendor = true,
        discountPercent = (1 - entry.minPrice / entry.vendorP) * 100
      }
    -- Class 2: P10 median discount. Requires history depth (3+ scans), a
    -- live market (3+ auctions), and a discount deep enough relative to
    -- med7 that the trip is worth taking. Profit is measured NET of the
    -- 5% AH cut (the vendor class above is exempt, since the NPC pays
    -- full price). The optional supply cap only ever filters, never
    -- reorders.
    elseif history and #history.pts >= WAH.RADAR.minHistory and history.med7 and history.med7 > 0
      and entry.minPrice and entry.minPrice > 0
      and (entry.numAuctions or 0) >= WAH.RADAR.minAuctions then
      local netRef = history.med7 * (1 - WAH.AH_CUT)
      local netProfit = netRef - entry.minPrice
      if netProfit >= WAH.RADAR.minProfit
        and netProfit >= netRef * WAH.RADAR.minProfitRatio
        and entry.minPrice <= history.med7 * WAH.RADAR.discount
        and (history.distinct or 0) >= WAH.RADAR.minMed7Distinct
        and entry.minPrice >= history.med7 * (1 - WAH.RADAR.maxDiscount)
        and ((WAH.RADAR.supplyCap or 0) <= 0 or (entry.quantity or 0) <= WAH.RADAR.supplyCap) then
        deals[#deals + 1] = {
          itemId = itemId,
          name = entry.name,
          minPrice = entry.minPrice,
          med7 = history.med7,
          profit = math.floor(netProfit),
          vendor = false,
          discountPercent = (1 - entry.minPrice / history.med7) * 100
        }
      end
    end
  end
  if #deals == 0 and not anyHistory then
    chatMessage(L.DEALS_NEED_HISTORY)
    return
  end
  applySort()
  chatMessage(#deals == 0 and L.DEALS_NONE or string.format(L.DEALS_FOUND, #deals))
end

-- ============================== Search ================================

-- Local search over the session scan: the replication already holds the
-- whole book, so a name filter here is exact without another server query.
local function refreshResults(query)
  wipe(results)
  local scan = WoWderhoiAH_ScanData and WoWderhoiAH_ScanData.dataVersion == WAH.PIPELINE_VERSION
    and WoWderhoiAH_ScanData.items
  if not scan or not next(scan) then
    chatMessage(L.DEALS_NEED_SCAN)
    return
  end
  local needle = string.lower(query or "")
  needle = needle:gsub("^%s+", ""):gsub("%s+$", "")
  if needle == "" then
    chatMessage(L.SEARCH_NEED_TEXT)
    return
  end
  for itemId, entry in pairs(scan) do
    local name = entry.name or ""
    if string.find(string.lower(name), needle, 1, true) then
      results[#results + 1] = {
        itemId = itemId,
        name = name,
        minPrice = entry.minPrice,
        marketPrice = entry.marketPrice,
        quantity = entry.quantity
      }
    end
  end
  if #results == 0 then
    chatMessage(string.format(L.SEARCH_NONE, query))
  end
  sortKey = nil
  applySort()
end

-- ============================== Buy side ==============================

-- Retail has no "buy out the whole listing by list index" call. Buying is:
-- 1) QueryForItem the exact itemKey (server round-trip, throttled),
-- 2) read the live item search results, pick the cheapest buyout listing
--    that is not our own,
-- 3) PlaceBuyout it.
-- The listing is therefore verified at click time, never trusted from the
-- scan snapshot.
-- ============================ Buy side ============================

-- Retail sells two distinct kinds of auction:
--   * Items (gear, bags, recipes...) use an itemKey and PlaceBuyout;
--   * Commodities (herbs, ore, cloth, potions, enchanting mats) use a
--     quantity/price order: StartCommoditiesPurchase -> COMMODITY_PRICE_UPDATED
--     -> ConfirmCommoditiesPurchase. The two share QueryForItem but return
--     through different events, so the path is chosen by which event fires.
--
-- Every purchase is confirmed by an event before the radar entry is updated;
-- a failed buy never hides the deal and never reports success.

local pendingBuyName = nil
local pendingBuyCommodity = false
local pendingBuyRunnerUnit = nil
local expectedCommodityUnitPrice = 0

local repriceAfterPurchase -- forward declaration; defined below

local function clearPendingBuy()
  pendingBuyItemId = nil
  pendingBuyName = nil
  pendingBuyCommodity = false
  expectedCommodityUnitPrice = 0
  commodityDialogState = "idle"
  commodityRungs = {}
  commodityTotalAvailable = 0
  expectedTotal = 0
  if buyDialog then buyDialog:Hide() end
end

local function startBuy(itemId, name)
  if pendingBuyItemId then
    chatMessage(L.BUY_PENDING)
    return
  end
  if not (AuctionHouseFrame and AuctionHouseFrame:IsShown()) then
    chatMessage(L.SCAN_OPEN_AH_FIRST)
    return
  end
  -- Build the item's base key. Modern clients expect numeric (0) rather
  -- than nil for the unused itemLevel/suffix/battlePet slots.
  local itemKey
  local ok, keyErr = pcall(function()
    itemKey = C_AuctionHouse.MakeItemKey(itemId, 0, 0, 0)
  end)
  if not ok or not itemKey then
    chatMessage(L.BUY_FAILED .. " [" .. tostring(keyErr) .. "]")
    return
  end
  pendingBuyItemId = itemId
  pendingBuyName = name
  -- Query the live item. API generations differ:
  --   newest (Forever): SearchForKeys({ itemKey })  -- plural-only
  --   modern retail:     SearchForItem(itemKey)
  --   older retail:      QueryForItem(itemKey)
  local function runQuery()
    -- SendSearchQuery loads one item's full commodity/item results and
    -- fires the matching *_SEARCH_RESULTS_UPDATED event. The SearchFor*
    -- functions are batch/browse helpers that do not always return those
    -- results, so they are used only as fallbacks.
    if C_AuctionHouse.SendSearchQuery then
      return C_AuctionHouse.SendSearchQuery(itemKey, nil)
    elseif C_AuctionHouse.SearchForItem then
      return C_AuctionHouse.SearchForItem(itemKey)
    elseif C_AuctionHouse.QueryForItem then
      return C_AuctionHouse.QueryForItem(itemKey)
    elseif C_AuctionHouse.SearchForKeys then
      return C_AuctionHouse.SearchForKeys({ itemKey })
    end
    return nil
  end
  chatMessage(string.format(L.BUY_QUERYING, name))
  local queried = pcall(runQuery)
  if not queried then
    clearPendingBuy()
    chatMessage(L.BUY_FAILED)
  end
end

-- Item path: read the live item search results, pick the cheapest valid
-- (non-own) buyout, then PlaceBuyout. The listing is verified at click time.
local function finalizeItemBuy(itemKey)
  local targetId = pendingBuyItemId
  if not targetId or not itemKey or itemKey.itemID ~= targetId then return end
  local numResults = C_AuctionHouse.GetNumItemSearchResults(itemKey)
  if not numResults or numResults == 0 then
    clearPendingBuy()
    chatMessage(L.NO_BUYABLE)
    return
  end
  local best, runnerUp = nil, nil
  for index = 1, numResults do
    local info = C_AuctionHouse.GetItemSearchResultInfo(itemKey, index)
    if info then
      local auctionID = info.auctionID or info.auction_id
      local buyout = info.buyoutAmount or info.buyout_amount
      local quantity = info.quantity
      local containsOwn = info.containsOwnerItem or info.contains_owner_item
      if auctionID and buyout and buyout > 0 and quantity and quantity > 0 and not containsOwn then
        local unit = buyout / quantity
        local candidate = { auctionID = auctionID, buyout = buyout, quantity = quantity, unit = unit,
          name = info.itemLink or info.displayName or info.item_name or targetId }
        if not best or unit < best.unit then
          runnerUp = best
          best = candidate
        elseif not runnerUp or unit < runnerUp.unit then
          runnerUp = candidate
        end
      end
    end
  end
  if not best then
    clearPendingBuy()
    chatMessage(L.NO_BUYABLE)
    return
  end
  -- PlaceBuyout is async; success is confirmed by AUCTION_HOUSE_PURCHASE_COMPLETED.
  -- Stash the runner-up so the radar entry can be corrected only on success.
  pendingBuyRunnerUnit = runnerUp and runnerUp.unit
  local placed = pcall(C_AuctionHouse.PlaceBuyout, best.auctionID, best.buyout)
  if not placed then
    clearPendingBuy()
    chatMessage(L.BUY_FAILED_EVENT)
  end
end

-- Walk the cached rungs cheapest-first and return the total cost to buy
-- `quantity` units, plus the unmet remainder (0 = fully covered).
local function quoteCommodity(rungs, quantity)
  local remaining, total = quantity, 0
  for _, rung in ipairs(rungs) do
    local take = math.min(remaining, rung.quantity)
    total = total + take * rung.unitPrice
    remaining = remaining - take
    if remaining <= 0 then break end
  end
  return total, remaining
end

-- Recompute the dialog's total line from the quantity box.
local function refreshBuyDialog()
  if not buyDialog then return end
  local qty = tonumber(buyDialog.quantity:GetNumber()) or 0
  if qty < 1 then qty = 0 end
  local total, remainder = quoteCommodity(commodityRungs, qty)
  if remainder > 0 then
    buyDialog.totalValue:SetText("|cffff5555-|r")
    buyDialog.confirm:Disable()
  else
    buyDialog.totalValue:SetText(GetCoinTextureString(total))
    buyDialog.confirm:Enable()
  end
  expectedTotal = total
end

-- Commodity results are ready: cache the rungs and present the quantity dialog.
local function finalizeCommodityBuy(itemID)
  local targetId = pendingBuyItemId
  if not targetId or itemID ~= targetId then return end
  local numResults = C_AuctionHouse.GetNumCommoditySearchResults(itemID)
  if not numResults or numResults == 0 then
    clearPendingBuy()
    chatMessage(L.NO_BUYABLE)
    return
  end
  commodityRungs = {}
  commodityTotalAvailable = 0
  local firstUnit = nil
  for index = 1, numResults do
    local info = C_AuctionHouse.GetCommoditySearchResultInfo(itemID, index)
    if info and info.unitPrice then
      local qty = info.quantity or 1
      commodityRungs[#commodityRungs + 1] = { unitPrice = info.unitPrice, quantity = qty }
      commodityTotalAvailable = commodityTotalAvailable + qty
      if not firstUnit then firstUnit = info.unitPrice end
    end
  end
  if #commodityRungs == 0 then
    clearPendingBuy()
    chatMessage(L.NO_BUYABLE)
    return
  end
  pendingBuyCommodity = true
  expectedCommodityUnitPrice = firstUnit
  -- Populate the dialog and default to the cheapest rung's full quantity.
  buyDialog.title:SetText(string.format(L.BUY_DIALOG_TITLE, pendingBuyName or itemID))
  buyDialog.unitValue:SetText(GetCoinTextureString(firstUnit))
  buyDialog.availValue:SetText(tostring(commodityTotalAvailable))
  buyDialog.quantity:SetNumber(commodityRungs[1].quantity)
  buyDialog.note:SetText("")
  commodityDialogState = "ready"
  refreshBuyDialog()
  buyDialog:Show()
end

-- User confirmed the quantity: place the order. The server answers with a
-- quote (COMMODITY_PRICE_UPDATED) before anything is bought.
local function confirmCommodityOrder()
  local itemID = pendingBuyItemId
  if not itemID or commodityDialogState ~= "ready" then return end
  local qty = buyDialog.quantity:GetNumber() or 0
  if qty < 1 then return end
  local started = pcall(C_AuctionHouse.StartCommoditiesPurchase, itemID,
    expectedCommodityUnitPrice, qty)
  if not started then
    clearPendingBuy()
    chatMessage(L.BUY_FAILED_EVENT)
    return
  end
  commodityDialogState = "quote"
  buyDialog.confirm:Disable()
  buyDialog.note:SetText(L.BUY_QUOTE_WAIT)
end

-- Server quote. If the total matches the client estimate, confirm; if it
-- differs, surface the real total and require another confirm (the order is
-- not confirmed yet, so nothing is bought).
local function onCommodityPriceUpdated(itemID, unitPrice, totalPrice)
  if not pendingBuyItemId or itemID ~= pendingBuyItemId then return end
  if commodityDialogState == "quote" and totalPrice and totalPrice == expectedTotal then
    pcall(C_AuctionHouse.ConfirmCommoditiesPurchase)
  else
    commodityDialogState = "ready"
    buyDialog.note:SetText(L.BUY_QUOTE_MISMATCH)
    if totalPrice then
      buyDialog.totalValue:SetText(GetCoinTextureString(totalPrice))
      expectedTotal = totalPrice
    end
    buyDialog.confirm:Enable()
  end
end

local function onCommodityPurchaseSucceeded(itemID)
  if not pendingBuyItemId or itemID ~= pendingBuyItemId then return end
  local targetId, name = pendingBuyItemId, pendingBuyName
  local total = expectedTotal
  local qty = buyDialog and (buyDialog.quantity:GetNumber() or 0) or 0
  -- Subtract the bought quantity from the cached rungs to find the cheapest
  -- surviving unit, so the radar keeps the item at its real remaining price.
  local remaining, newMin = qty, nil
  for _, rung in ipairs(commodityRungs) do
    local take = math.min(remaining, rung.quantity)
    local left = rung.quantity - take
    remaining = remaining - take
    if left > 0 and not newMin then newMin = rung.unitPrice end
  end
  clearPendingBuy()
  chatMessage(string.format(L.BOUGHT, name or targetId, qty, GetCoinTextureString(total)))
  repriceAfterPurchase(targetId, newMin)
end

local function onCommodityPurchaseFailed(itemID)
  if not pendingBuyItemId or itemID ~= pendingBuyItemId then return end
  clearPendingBuy()
  chatMessage(L.BUY_FAILED_EVENT)
end

-- Item purchase confirmation (PlaceBuyout result).
local function onItemPurchaseCompleted(auctionID)
  local targetId = pendingBuyItemId
  if not targetId then return end
  local runnerUnit = pendingBuyRunnerUnit
  clearPendingBuy()
  chatMessage(L.BOUGHT)
  repriceAfterPurchase(targetId, runnerUnit)
  C_Timer.After(0.6, function()
    if trade and trade:IsShown() and trade.lastQuery then refreshResults(trade.lastQuery) end
  end)
end

-- A bought listing is knowledge about the book; write it back into the scan
-- the radar reads. It can hide a real deal until the next scan; it can never
-- invent one. When no price is supplied (commodity rung fully consumed), drop
-- the entry: the next scan re-lists the item.
repriceAfterPurchase = function(itemId, remainingUnitPrice, boughtQuantity)
  local scan = WoWderhoiAH_ScanData and WoWderhoiAH_ScanData.dataVersion == WAH.PIPELINE_VERSION
    and WoWderhoiAH_ScanData.items
  local scanned = scan and scan[itemId]
  if not scanned then return end
  if not remainingUnitPrice then
    scan[itemId] = nil
    return
  end
  scanned.minPrice = math.floor(remainingUnitPrice + 0.5)
  scanned.numAuctions = math.max((scanned.numAuctions or 1) - 1, 0)
end

-- ============================== Sell side =============================

-- Sell anchor: the depth-aware front (sellP) beats the raw minimum.
local function sessionUnitPrice(itemId)
  local scanned = WoWderhoiAH_ScanData and WoWderhoiAH_ScanData.dataVersion == WAH.PIPELINE_VERSION
    and WoWderhoiAH_ScanData.items and WoWderhoiAH_ScanData.items[itemId]
  if scanned and (scanned.sellP or scanned.minPrice) then
    return scanned.sellP or scanned.minPrice, "scan"
  end
  local history = WAH.history(itemId)
  if history and history.latest then return history.latest, "history" end
  return nil
end

-- The classic sell-slot API (GetAuctionSellItemInfo + NEW_AUCTION_UPDATE)
-- does not exist on the retail AH frame; instead of poking unknown internals
-- we whisper a suggested price when a sell slot appears to hold an item we
-- have data for. Cheap poll, runs only while the AH is open.
local sellPoll = CreateFrame("Frame")
local function pollSellSlot()
  if not (AuctionHouseFrame and AuctionHouseFrame:IsShown()) then
    sellPoll:Hide()
    return
  end
  local name, count, link
  local ok = pcall(function()
    if GetAuctionSellItemInfo then
      name, _, count = GetAuctionSellItemInfo()
    end
    if GetAuctionSellItemLink then
      link = GetAuctionSellItemLink()
    end
  end)
  if not ok or not name or not count or count == 0 then
    lastSellName = nil
    return
  end
  if name == lastSellName then return end
  lastSellName = name
  local itemId = link and tonumber(link:match("item:(%d+)"))
  if not itemId then return end
  local unitPrice, source = sessionUnitPrice(itemId)
  if not unitPrice then
    chatMessage(string.format(L.SELL_NO_DATA, name))
    return
  end
  local buyoutTotal = math.max((unitPrice - 1) * count, count)
  chatMessage(string.format(L.SELL_SUGGEST, name, count, GetCoinTextureString(buyoutTotal), source))
end
sellPoll:SetScript("OnUpdate", function(self, elapsed)
  self.accum = (self.accum or 0) + elapsed
  if self.accum < 2 then return end
  self.accum = 0
  pollSellSlot()
end)
sellPoll:Hide()

-- ============================== Frame =================================

local function createTradeFrame()
  trade = CreateFrame("Frame", "WoWderhoiAHTrade", UIParent, "BackdropTemplate")
  -- Match the auction house frame's height so the panel and the AH are
  -- exactly side by side; fall back to a fixed height if it cannot be read.
  -- GetTop/GetBottom/GetRight are screen coordinates (origin bottom-left of
  -- the screen), so the anchor offset must be expressed relative to the
  -- UIParent's top edge: yOffset = ahTop - UIParent:GetTop().
  local ahFrame = AuctionHouseFrame
  local ahTop = ahFrame and ahFrame:GetTop()
  local ahBottom = ahFrame and ahFrame:GetBottom()
  local ahRight = ahFrame and ahFrame:GetRight()
  local uiTop = UIParent and UIParent:GetTop()
  local PANEL_HEIGHT
  if ahTop and ahBottom and ahRight and uiTop then
    -- The panel is exactly as tall as the AH frame itself, so its top and
    -- bottom edges line up with the AH's.
    PANEL_HEIGHT = math.max(math.floor(ahTop - ahBottom), 320)
    trade:SetPoint("TOPLEFT", UIParent, "TOPLEFT", ahRight + 4, ahTop - uiTop)
  else
    PANEL_HEIGHT = math.max(math.floor(ahFrame and ahFrame:GetHeight() or 520), 320)
    trade:SetPoint("TOPLEFT", ahFrame, "TOPRIGHT", 4, -12)
  end
  trade:SetSize(480, PANEL_HEIGHT)
  -- Keep the panel on screen even if the AH anchors move.
  trade:SetClampedToScreen(true)
  trade:SetMovable(true)
  trade:EnableMouse(true)
  trade:RegisterForDrag("LeftButton")
  trade:SetScript("OnDragStart", function(self) self:StartMoving() end)
  trade:SetScript("OnDragStop", function(self) self:StopMovingOrSizing() end)
  trade:SetFrameStrata("DIALOG")
  trade:SetFrameLevel(AuctionHouseFrame:GetFrameLevel() + 10)
  trade:SetBackdrop({
    bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
    edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
    tile = true, tileSize = 32, edgeSize = 20,
    insets = { left = 5, right = 5, top = 5, bottom = 5 }
  })

  trade.title = trade:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  trade.title:SetPoint("TOPLEFT", PAD, -PAD)
  trade.title:SetText(L.TRADE_TITLE)

  local close = CreateFrame("Button", nil, trade)
  close:SetSize(20, 20)
  close:SetPoint("TOPRIGHT", -PAD, -PAD)
  close:SetText("|cffff5555X|r")
  close:SetScript("OnClick", function() trade:Hide() end)

  trade.searchBox = CreateFrame("EditBox", "WoWderhoiAHTradeSearch", trade, "SearchBoxTemplate")
  trade.searchBox:SetSize(120, 20)
  trade.searchBox:SetPoint("TOPLEFT", PAD, -26)
  trade.searchBox:SetAutoFocus(false)
  trade.searchBox:SetScript("OnEnterPressed", function()
    mode = "results"
    trade.lastQuery = trade.searchBox:GetText()
    refreshResults(trade.lastQuery)
    FauxScrollFrame_SetOffset(trade.scroll, 0)
    renderRows()
  end)

  local function headerButton(label, anchor, width, onClick)
    local button = CreateFrame("Button", nil, trade, "UIPanelButtonTemplate")
    button:SetSize(width, 20)
    button:SetPoint("LEFT", anchor, "RIGHT", 6, 0)
    button:SetText(label)
    button:SetScript("OnClick", onClick)
    return button
  end

  local searchButton = headerButton(L.SEARCH, trade.searchBox, 70, function()
    mode = "results"
    trade.lastQuery = trade.searchBox:GetText()
    refreshResults(trade.lastQuery)
    FauxScrollFrame_SetOffset(trade.scroll, 0)
    renderRows()
  end)
  local dealsButton = headerButton(L.FIND_DEALS, searchButton, 70, function()
    mode = "deals"
    refreshDeals()
    FauxScrollFrame_SetOffset(trade.scroll, 0)
    renderRows()
  end)
  local scanButton = headerButton(L.FULL_SCAN, dealsButton, 80, function()
    if WAH.startScan then WAH.startScan() end
  end)
  headerButton(L.OPTIONS, scanButton, 80, function() WAH.openSettings() end)

  -- Table header row.
  local HEADER_Y = -54
  local COL_BUY_W, COL_W, COL_GAP = 60, 84, 8
  local SCROLL_W = 24
  local ICON_X, ICON_W, NAME_GAP = 4, 18, 6
  local function makeSortable(label, onClick)
    local hit = CreateFrame("Button", nil, trade)
    hit:SetAllPoints(label)
    hit:SetScript("OnClick", onClick)
    hit:SetScript("OnEnter", function() label:SetTextColor(1, 1, 1) end)
    hit:SetScript("OnLeave", function() label:SetTextColor(1, 0.82, 0) end)
  end

  trade.headItem = trade:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  trade.headItem:SetPoint("TOPLEFT", PAD + ICON_X + ICON_W + NAME_GAP, HEADER_Y)
  trade.headItem:SetText(L.COL_ITEM)
  makeSortable(trade.headItem, function() sortByKey("name", true) end)

  trade.headers = {}
  for slot = 1, COL_COUNT do
    local label = trade:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
    label:SetPoint("TOPRIGHT", trade, "TOPRIGHT",
      -(SCROLL_W + COL_BUY_W + COL_GAP + (COL_COUNT - slot) * (COL_W + COL_GAP)), HEADER_Y)
    label:SetWidth(COL_W)
    label:SetJustifyH("RIGHT")
    label:SetWordWrap(false)
    makeSortable(label, function()
      local column = columnAt(slot)
      if column then sortByKey(column.key, column.asc) end
    end)
    trade.headers[slot] = label
  end
  local headerLine = trade:CreateTexture(nil, "ARTWORK")
  headerLine:SetColorTexture(0.6, 0.5, 0.3, 0.6)
  headerLine:SetPoint("TOPLEFT", PAD, HEADER_Y - 14)
  headerLine:SetPoint("TOPRIGHT", -SCROLL_W, HEADER_Y - 14)
  headerLine:SetHeight(1)

  local ROWS_TOP = -72
  -- Row budget: rows run all the way down to the bottom padding. The
  -- scroll arrows only occupy the 24px scroll-bar strip to the RIGHT of
  -- the rows, so the last row can sit flush with the bottom edge without
  -- colliding with them -- that frees a whole row of space.
  ROWS_VISIBLE = math.max(math.floor((PANEL_HEIGHT + ROWS_TOP - PAD) / ROW_HEIGHT), 1)

  trade.scroll = CreateFrame("ScrollFrame", "WoWderhoiAHTradeScroll", trade, "FauxScrollFrameTemplate")
  trade.scroll:SetPoint("TOPLEFT", PAD, ROWS_TOP)
  trade.scroll:SetPoint("BOTTOMRIGHT", -SCROLL_W, PAD)
  trade.scroll:SetScript("OnVerticalScroll", function(self, delta)
    FauxScrollFrame_OnVerticalScroll(self, delta, ROW_HEIGHT, renderRows)
  end)

  trade.rows = {}
  for rowIndex = 1, ROWS_VISIBLE do
    local rowFrame = CreateFrame("Frame", nil, trade)
    rowFrame:SetHeight(ROW_HEIGHT)
    rowFrame:SetPoint("TOPLEFT", PAD, ROWS_TOP - (rowIndex - 1) * ROW_HEIGHT)
    rowFrame:SetPoint("TOPRIGHT", trade, "TOPRIGHT", -SCROLL_W, ROWS_TOP - (rowIndex - 1) * ROW_HEIGHT)
    if rowIndex % 2 == 0 then
      local shade = rowFrame:CreateTexture(nil, "BACKGROUND")
      shade:SetAllPoints()
      shade:SetColorTexture(1, 1, 1, 0.04)
    end
    local separator = rowFrame:CreateTexture(nil, "BORDER")
    separator:SetColorTexture(0, 0, 0, 0.35)
    separator:SetPoint("BOTTOMLEFT", 0, 0)
    separator:SetPoint("BOTTOMRIGHT", 0, 0)
    separator:SetHeight(1)
    rowFrame.icon = rowFrame:CreateTexture(nil, "ARTWORK")
    rowFrame.icon:SetSize(ICON_W, ICON_W)
    rowFrame.icon:SetPoint("LEFT", ICON_X, 0)
    rowFrame.buy = CreateFrame("Button", nil, rowFrame, "UIPanelButtonTemplate")
    rowFrame.buy:SetSize(COL_BUY_W, 18)
    rowFrame.buy:SetPoint("RIGHT", 0, 0)
    rowFrame.cells = {}
    local anchor = rowFrame.buy
    for slot = COL_COUNT, 1, -1 do
      local cell = rowFrame:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
      cell:SetPoint("RIGHT", anchor, "LEFT", -COL_GAP, 0)
      cell:SetWidth(COL_W)
      cell:SetJustifyH("RIGHT")
      cell:SetWordWrap(false)
      rowFrame.cells[slot] = cell
      anchor = cell
    end
    rowFrame.name = rowFrame:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    rowFrame.name:SetPoint("LEFT", rowFrame.icon, "RIGHT", NAME_GAP, 0)
    rowFrame.name:SetPoint("RIGHT", rowFrame.cells[1], "LEFT", -COL_GAP, 0)
    rowFrame.name:SetJustifyH("LEFT")
    rowFrame.name:SetWordWrap(false)
    rowFrame:EnableMouse(true)
    rowFrame:SetScript("OnEnter", function(self)
      if not self.showTooltip then return end
      GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
      self.showTooltip()
    end)
    rowFrame:SetScript("OnLeave", function() GameTooltip:Hide() end)
    rowFrame:Hide()
    trade.rows[rowIndex] = rowFrame
  end

  -- ===================== Commodity quantity dialog =====================
  -- Shown only for commodities; lets the user pick how many to buy. The
  -- total is pre-computed from the cached rungs and re-confirmed by the
  -- server quote before anything is bought.
  buyDialog = CreateFrame("Frame", nil, trade, "BackdropTemplate")
  buyDialog:SetSize(300, 200)
  buyDialog:SetPoint("CENTER", trade, "CENTER")
  buyDialog:SetFrameStrata("DIALOG")
  buyDialog:SetFrameLevel(trade:GetFrameLevel() + 20)
  buyDialog:SetBackdrop({
    bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
    edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
    tile = true, tileSize = 32, edgeSize = 20,
    insets = { left = 5, right = 5, top = 5, bottom = 5 }
  })
  buyDialog:EnableMouse(true) -- block clicks from reaching the rows behind
  buyDialog:SetMouseClickEnabled(true)

  buyDialog.title = buyDialog:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  buyDialog.title:SetPoint("TOPLEFT", 12, -12)

  local dlgClose = CreateFrame("Button", nil, buyDialog)
  dlgClose:SetSize(20, 20)
  dlgClose:SetPoint("TOPRIGHT", -10, -10)
  dlgClose:SetText("|cffff5555X|r")
  dlgClose:SetScript("OnClick", function() clearPendingBuy() end)

  local function infoLine(y, label)
    local l = buyDialog:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    l:SetPoint("TOPLEFT", 14, y)
    l:SetText(label)
    local v = buyDialog:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    v:SetPoint("TOPLEFT", 104, y)
    return v
  end
  buyDialog.unitValue = infoLine(-40, L.BUY_UNIT)
  buyDialog.availValue = infoLine(-62, L.BUY_AVAILABLE)

  local qtyLabel = buyDialog:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  qtyLabel:SetPoint("TOPLEFT", 14, -86)
  qtyLabel:SetText(L.BUY_QUANTITY)
  buyDialog.quantity = CreateFrame("EditBox", nil, buyDialog, "InputBoxTemplate")
  buyDialog.quantity:SetSize(110, 24)
  buyDialog.quantity:SetPoint("TOPLEFT", 104, -92)
  buyDialog.quantity:SetAutoFocus(false)
  buyDialog.quantity:SetNumeric(true)
  buyDialog.quantity:SetNumber(1)
  buyDialog.quantity:SetScript("OnTextChanged", function() refreshBuyDialog() end)
  buyDialog.quantity:SetScript("OnEnterPressed", function() buyDialog.quantity:ClearFocus() end)

  buyDialog.totalValue = infoLine(-122, L.BUY_TOTAL)

  buyDialog.note = buyDialog:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  buyDialog.note:SetPoint("BOTTOM", 0, 38)
  buyDialog.note:SetTextColor(1, 0.85, 0.1)

  buyDialog.cancel = CreateFrame("Button", nil, buyDialog, "UIPanelButtonTemplate")
  buyDialog.cancel:SetSize(100, 24)
  buyDialog.cancel:SetPoint("BOTTOMLEFT", 18, 10)
  buyDialog.cancel:SetText(L.CANCEL)
  buyDialog.cancel:SetScript("OnClick", function() clearPendingBuy() end)

  buyDialog.confirm = CreateFrame("Button", nil, buyDialog, "UIPanelButtonTemplate")
  buyDialog.confirm:SetSize(100, 24)
  buyDialog.confirm:SetPoint("BOTTOMRIGHT", -18, 10)
  buyDialog.confirm:SetText(L.CONFIRM)
  buyDialog.confirm:SetScript("OnClick", function() confirmCommodityOrder() end)
  buyDialog:Hide()
  -- Exposed for the headless test harness; harmless in the real client.
  WAH._buyDialog = buyDialog

  trade:Hide()
end

renderRows = function()
  if not trade then return end
  local rows = mode == "deals" and deals or results
  trade.headItem:SetText(L.COL_ITEM .. sortMark("name"))
  for slot = 1, COL_COUNT do
    local column = columnAt(slot)
    trade.headers[slot]:SetText(column and (L[column.label] .. sortMark(column.key)) or "")
  end
  local offset = FauxScrollFrame_GetOffset(trade.scroll)
  FauxScrollFrame_Update(trade.scroll, #rows, ROWS_VISIBLE, ROW_HEIGHT)
  for rowIndex = 1, ROWS_VISIBLE do
    local rowFrame = trade.rows[rowIndex]
    local row = rows[rowIndex + offset]
    if row then
      for slot = 1, COL_COUNT do
        local column = columnAt(slot)
        rowFrame.cells[slot]:SetText(column and column.cell(row[column.key]) or "")
      end
      if mode == "deals" then
        rowFrame.icon:SetTexture(itemIcon(row.itemId))
        rowFrame.showTooltip = function() GameTooltip:SetHyperlink("item:" .. row.itemId) end
        rowFrame.name:SetText(row.vendor
          and string.format("%s |cffffd100[%s]|r", row.name, L.VENDOR_TAG)
          or row.name)
        rowFrame.buy:SetText(L.FIND)
        rowFrame.buy:SetScript("OnClick", function()
          trade.searchBox:SetText(row.name)
          fillAhSearch(row.name)
          mode = "results"
          trade.lastQuery = row.name
          refreshResults(row.name)
          FauxScrollFrame_SetOffset(trade.scroll, 0)
          renderRows()
        end)
      else
        rowFrame.icon:SetTexture(itemIcon(row.itemId))
        rowFrame.showTooltip = function() GameTooltip:SetHyperlink("item:" .. row.itemId) end
        rowFrame.name:SetText(row.name)
        rowFrame.buy:SetText(L.BUY)
        rowFrame.buy:SetScript("OnClick", function() startBuy(row.itemId, row.name) end)
      end
      rowFrame:Show()
    else
      rowFrame:Hide()
    end
  end
end

-- ============================== Events ================================

local tradeEvents = CreateFrame("Frame")
tradeEvents:RegisterEvent("AUCTION_HOUSE_SHOW")
tradeEvents:RegisterEvent("AUCTION_HOUSE_CLOSED")
tradeEvents:RegisterEvent("GET_ITEM_INFO_RECEIVED")
if C_AuctionHouse and C_AuctionHouse.GetNumItemSearchResults then
  tradeEvents:RegisterEvent("ITEM_SEARCH_RESULTS_UPDATED")
end
-- Commodity channel (herbs/ore/cloth/potions/mats) and purchase confirms.
if C_AuctionHouse and C_AuctionHouse.GetNumCommoditySearchResults then
  tradeEvents:RegisterEvent("COMMODITY_SEARCH_RESULTS_UPDATED")
  tradeEvents:RegisterEvent("COMMODITY_PRICE_UPDATED")
  tradeEvents:RegisterEvent("COMMODITY_PURCHASE_SUCCEEDED")
  tradeEvents:RegisterEvent("COMMODITY_PURCHASE_FAILED")
end
tradeEvents:RegisterEvent("AUCTION_HOUSE_PURCHASE_COMPLETED")
tradeEvents:SetScript("OnEvent", function(_, event, arg1, arg2, arg3)
  if event == "AUCTION_HOUSE_SHOW" then
    if not trade then createTradeFrame() end
    mode = "deals"
    refreshDeals()
    FauxScrollFrame_SetOffset(trade.scroll, 0)
    renderRows()
    trade:Show()
    sellPoll:Show()
  elseif event == "AUCTION_HOUSE_CLOSED" then
    if trade then trade:Hide() end
    sellPoll:Hide()
  elseif event == "GET_ITEM_INFO_RECEIVED" then
    -- Item info landed (itemIcon or the scanner asked for it): backfill a
    -- category that came back unknown during the scan, then repaint.
    if WAH.refreshPendingCategories then WAH.refreshPendingCategories(arg1) end
    if trade and trade:IsShown() then renderRows() end
  elseif event == "ITEM_SEARCH_RESULTS_UPDATED" then
    finalizeItemBuy(arg1)
  elseif event == "COMMODITY_SEARCH_RESULTS_UPDATED" then
    finalizeCommodityBuy(arg1)
  elseif event == "COMMODITY_PRICE_UPDATED" then
    -- payload: itemID, unitPrice, totalPrice
    onCommodityPriceUpdated(arg1, arg2, arg3)
  elseif event == "COMMODITY_PURCHASE_SUCCEEDED" then
    onCommodityPurchaseSucceeded(arg1)
  elseif event == "COMMODITY_PURCHASE_FAILED" then
    onCommodityPurchaseFailed(arg1)
  elseif event == "AUCTION_HOUSE_PURCHASE_COMPLETED" then
    onItemPurchaseCompleted(arg1)
  end
end)

-- Settings.lua calls this after applying radar tunables: if the trade panel
-- is open on the deal radar, re-run it immediately with the new rules.
-- Guarded so Settings can be loaded in any TOC order.
WAH.radarChanged = function()
  if trade and trade:IsShown() and mode == "deals" then
    refreshDeals()
    FauxScrollFrame_SetOffset(trade.scroll, 0)
    renderRows()
  end
end
