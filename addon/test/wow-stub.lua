-- Test-only WoW client stub. Loaded before addon/WoWderhoiAH/*.lua so the
-- real addon files can run unmodified inside a bare Lua VM.
--
-- Every frame is one permissive mock: the handful of calls a test can
-- observe (SetText, SetScript, SetAllPoints, Show/Hide) are implemented,
-- and every layout or appearance setter falls through to a no-op, because
-- anchors and colors have no observable behavior outside a real client.
-- Mock state is stored under _-prefixed keys so it can never collide with
-- the fields the addon hangs on its own frames (trade.rows, row.name, ...).
--
-- Ceiling: fengari is Lua 5.3 while the 2.5.6 client is 5.1. For this
-- addon's arithmetic that difference is conservative -- 5.3 is the stricter
-- of the two about string.format("%d", <float>) and integer division -- so
-- code passing here passes there. Upgrade path if integer-sensitive code
-- ever lands: run the same stub under a real 5.1 binary.

local bed = { chat = {}, frames = {}, timers = {}, hooks = {}, listings = {}, itemInfo = {}, searchResults = {}, ns = {} }
WowTest = bed

local NOW = 1700000000 -- fixed clock; a real time() would make med7 windows flaky

local function noop() end

local frameMeta = {}
frameMeta.__index = frameMeta
-- Any frame method this stub does not implement is layout, so it no-ops.
-- The fallback is restricted to PascalCase keys because WoW frame methods
-- are all PascalCase while frame *fields* are not: returning a function for
-- an unset field would turn every `frame.thing or default` into a function.
setmetatable(frameMeta, { __index = function(_, key)
  if type(key) == "string" and key:match("^%u") then return noop end
  return nil
end })

local function newFrame(frameName, parent)
  local frame = setmetatable({ _scripts = {}, _events = {}, _shown = false, _name = frameName, _parent = parent }, frameMeta)
  bed.frames[#bed.frames + 1] = frame
  if frameName then _G[frameName] = frame end
  return frame
end

function frameMeta:Show() self._shown = true end
function frameMeta:Hide() self._shown = false end
function frameMeta:IsShown() return self._shown end
function frameMeta:SetScript(script, handler) self._scripts[script] = handler end
function frameMeta:GetScript(script) return self._scripts[script] end
function frameMeta:HasScript() return true end
function frameMeta:HookScript(script, handler)
  local existing = self._scripts[script]
  self._scripts[script] = function(...)
    if existing then existing(...) end
    handler(...)
  end
end
function frameMeta:RegisterEvent(event) self._events[event] = true end
function frameMeta:SetText(text) self._text = text end
function frameMeta:GetText() return self._text or "" end
function frameMeta:SetAllPoints(target) self._allPoints = target end
function frameMeta:SetSize(width, height) self._width, self._height = width, height end
function frameMeta:SetWidth(width) self._width = width end
function frameMeta:SetHeight(height) self._height = height end
function frameMeta:GetWidth() return self._width end
function frameMeta:GetHeight() return self._height end
function frameMeta:SetWordWrap(wrap) self._wordWrap = wrap end
function frameMeta:EnableMouse(enabled) self._mouse = enabled end
function frameMeta:SetBackdrop(backdrop) self._backdrop = backdrop end

-- SetPoint has three shapes in the real API. Normalizing them here is what
-- lets a test resolve where a frame actually lands, which is the only way
-- to assert that the panel's content stays off its own border art.
function frameMeta:SetPoint(point, first, second, third, fourth)
  local relativeTo, relativePoint, xOffset, yOffset
  if type(first) == "table" then
    relativeTo, relativePoint, xOffset, yOffset = first, second, third, fourth
  else
    relativeTo, relativePoint, xOffset, yOffset = self._parent, point, first, second
  end
  self._points = self._points or {}
  self._points[point] = {
    to = relativeTo, toPoint = relativePoint or point, x = xOffset or 0, y = yOffset or 0
  }
end
function frameMeta:CreateFontString() return newFrame(nil, self) end
function frameMeta:CreateTexture() return newFrame(nil, self) end
function frameMeta:CreateLine() return newFrame(nil, self) end
function frameMeta:SetID(id) self._id = id end
function frameMeta:GetID() return self._id end
function frameMeta:SetFrameLevel(level) self._level = level end
function frameMeta:GetFrameLevel() return self._level or 0 end
function frameMeta:SetChecked(checked) self._checked = checked end
function frameMeta:GetChecked() return self._checked end

-- ============================== WoW globals ===========================

function CreateFrame(kind, frameName, parent, template)
  local frame = newFrame(frameName, parent)
  frame._kind, frame._template = kind, template
  return frame
end

AuctionFrame = newFrame("AuctionFrame")
AuctionFrame.numTabs = 3
AuctionFrame:SetSize(800, 447)
AuctionFrame:Show()
-- The retail/Forever AH is a single AuctionHouseFrame; the WAH page anchors
-- itself to this. It is also the SellFrame host, so it must exist before any
-- AUCTION_HOUSE_SHOW fires.
AuctionHouseFrame = newFrame("AuctionHouseFrame")
AuctionHouseFrame:SetSize(800, 447)
AuctionHouseFrame:Show()
AuctionFrameBrowse = newFrame("AuctionFrameBrowse")
AuctionFrameBid = newFrame("AuctionFrameBid")
AuctionFrameAuctions = newFrame("AuctionFrameAuctions")
BuyoutPrice = newFrame("BuyoutPrice")
StartPrice = newFrame("StartPrice")
UIParent = newFrame("UIParent")
GameTooltip = newFrame("GameTooltip")
ItemRefTooltip = newFrame("ItemRefTooltip")

-- GameTooltip records what it was pointed at and what got written into it.
-- A trade row's whole job is to aim the client's own item tooltip, so the
-- observable result is the source it was given plus the lines GUI.lua's
-- hooks append on top.
GameTooltip._lines = {}
function GameTooltip:SetOwner(owner, anchor) self._owner, self._anchor = owner, anchor end
function GameTooltip:GetItem() return self._itemName, self._link end
function GameTooltip:AddLine(text) self._lines[#self._lines + 1] = bed.plain(text) end
function GameTooltip:AddDoubleLine(left, right)
  self._lines[#self._lines + 1] = bed.plain(left) .. "\t" .. bed.plain(right)
end
function GameTooltip:ClearLines()
  self._lines, self._source, self._link, self._itemName = {}, nil, nil, nil
  if self._scripts.OnTooltipCleared then self._scripts.OnTooltipCleared(self) end
end

local function tooltipShowItem(tooltip, source, itemId, itemName)
  tooltip:ClearLines()
  tooltip._source, tooltip._itemName = source, itemName
  tooltip._link = "|Hitem:" .. tostring(itemId) .. ":0:0:0|h[" .. tostring(itemName) .. "]|h"
  tooltip:Show()
end

function GameTooltip:SetAuctionItem(_, index)
  local listing = bed.listings[index]
  tooltipShowItem(self, "auction:" .. tostring(index),
    listing and listing.itemId or 0, listing and listing.name)
end

function GameTooltip:SetHyperlink(link)
  tooltipShowItem(self, "hyperlink:" .. tostring(link), tonumber(tostring(link):match("item:(%d+)")) or 0, link)
end

DEFAULT_CHAT_FRAME = { AddMessage = function(_, text) bed.chat[#bed.chat + 1] = text end }
SlashCmdList = {}

function AuctionFrameTab_OnClick() end
-- Two shapes: hooksecurefunc(globalName, handler) and the method form
-- hooksecurefunc(table, method, handler). GUI.lua uses the method form to
-- attach its price block to the tooltip setters, so wrapping it for real is
-- what lets a test see the block ride along with a row's tooltip.
function hooksecurefunc(target, name, handler)
  if type(target) == "string" then
    bed.hooks[target] = bed.hooks[target] or {}
    table.insert(bed.hooks[target], name)
    return
  end
  local original = target[name]
  target[name] = function(...)
    local result = original(...)
    handler(...)
    return result
  end
end

C_Timer = {
  After = function(_, callback) bed.timers[#bed.timers + 1] = callback end,
  NewTicker = function(_, callback)
    bed.tickers = bed.tickers or {}
    table.insert(bed.tickers, callback)
    return { Cancel = noop }
  end
}

function wipe(target)
  for key in pairs(target) do target[key] = nil end
  return target
end

function GetLocale() return bed.locale or "zhCN" end
function time() return NOW end
-- WoW exposes os.date as a bare global. Defaulting to the fixed clock keeps
-- anything formatted from "now" as reproducible as everything else here.
function date(format, when) return os.date(format, when or NOW) end
function debugprofilestop() return 0 end -- never trip the per-frame yield budget
function GetRealmName() return "TestRealm" end
function UnitFactionGroup() return "Alliance" end
function GetCoinTextureString(copper) return tostring(copper) .. "c" end
function GetItemIcon(itemId) return "icon:" .. tostring(itemId) end

function FauxScrollFrame_GetOffset(frame) return frame._offset or 0 end
function FauxScrollFrame_SetOffset(frame, offset) frame._offset = offset end
function FauxScrollFrame_Update(frame, total) frame._total = total end
function FauxScrollFrame_OnVerticalScroll() end
function PanelTemplates_SetNumTabs(frame, count) frame.numTabs = count end
function PanelTemplates_EnableTab() end
function MoneyInputFrame_SetCopper(frame, copper) frame._copper = copper end
function InterfaceOptions_AddCategory() end
function InterfaceOptionsFrame_OpenToCategory() end

-- ============ Retail/Forever auction house API ============
-- The addon port talks to C_AuctionHouse exclusively. The pieces a test
-- drives: MakeItemKey (buy flow), QueryForItem + search result reads (the
-- async verification a buy performs), PlaceBuyout (the purchase itself),
-- ReplicateItems (the full-house scan, exercised through WoWderhoiAH_ScanData
-- injected by bed.setScan rather than a live replication).
C_AuctionHouse = {
  IsThrottled = function() return false end,
  MakeItemKey = function(itemID, itemLevel, itemSuffix, battlePetSpeciesID)
    return { itemID = itemID, itemLevel = itemLevel, itemSuffix = itemSuffix or 0, battlePetSpeciesID = battlePetSpeciesID }
  end,
  -- The real query answers asynchronously; queue the results-updated event
  -- on the C_Timer queue so a test can control the moment it lands.
  QueryForItem = function(itemKey)
    bed.lastQueryKey = itemKey
    bed.timers[#bed.timers + 1] = function()
      bed.fireEvent("ITEM_SEARCH_RESULTS_UPDATED", itemKey)
    end
  end,
  GetNumItemSearchResults = function(itemKey)
    local rows = bed.searchResults[itemKey.itemID]
    return rows and #rows or 0
  end,
  GetItemSearchResultInfo = function(itemKey, index)
    local rows = bed.searchResults[itemKey.itemID]
    return rows and rows[index] or nil
  end,
  PlaceBuyout = function(auctionID, buyout)
    bed.bought = { auctionID = auctionID, buyout = buyout }
  end,
  ReplicateItems = function() bed.replicated = true end,
  GetNumReplicateItems = function() return 0 end,
  GetReplicateItemInfo = function() return nil end,
  GetReplicateItemLink = function() return nil end
}

-- Bed control for the async buy verification: the test sets what the
-- server answers for an itemId, buys a row, then flushes the C_Timer queue
-- to land ITEM_SEARCH_RESULTS_UPDATED. Rows mirror the retail shape of
-- GetItemSearchResultInfo.
function bed.setSearchResults(itemId, rows) bed.searchResults[itemId] = rows end

-- Retail item info: C_Item.GetItemInfoByID returns class/subclass as IDs
-- and vendor price in the same slot the addon reads (11). The addon
-- translates the IDs through GetItemClassInfo/GetItemSubClassInfo.
C_Item = {
  GetItemInfoByID = function(itemId)
    local info = bed.itemInfo[itemId] or {}
    return info.name, nil, nil, nil, nil, info.classID or 6, info.subClassID or 0,
      nil, nil, nil, info.vendorP or 0
  end
}
local ITEM_CLASS_NAMES = { [6] = "Trade Goods", [7] = "Item Enhancement", [15] = "Battle Pets" }
local ITEM_SUBCLASS_NAMES = { [6] = { [0] = "Other" }, [7] = { [0] = "Other" } }
function GetItemClassInfo(classID) return ITEM_CLASS_NAMES[classID] or "Miscellaneous" end
function GetItemSubClassInfo(classID, subClassID)
  local map = ITEM_SUBCLASS_NAMES[classID]
  return map and map[subClassID] or "Other"
end
-- Legacy global retail keeps for compatibility (deprecated but present);
-- the addon's chart-title fallback calls it, so it must exist here too.
function GetItemInfo(itemId) return C_Item.GetItemInfoByID(itemId) end

-- ============================== WoW globals ===========================

function GetAuctionSellItemInfo() return bed.sellItem and bed.sellItem.name, nil, bed.sellItem and bed.sellItem.count end
function GetAuctionSellItemLink()
  return bed.sellItem and ("|Hitem:" .. bed.sellItem.itemId .. ":0:0:0|h[" .. bed.sellItem.name .. "]|h")
end

-- ============================== Test bed ==============================

-- Strip WoW color escapes so assertions read as what the player sees.
function bed.plain(text)
  return (tostring(text or ""):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""))
end

local function tradeFrame()
  return _G.WoWderhoiAHTrade or error("trade frame not built -- call WowTest.openTab() first")
end

function bed.fireEvent(event, ...)
  for _, frame in ipairs(bed.frames) do
    if frame._events[event] and frame._scripts.OnEvent then
      frame._scripts.OnEvent(frame, event, ...)
    end
  end
end

function bed.runTimers()
  local pending = bed.timers
  bed.timers = {}
  for _, callback in ipairs(pending) do callback() end
end

function bed.clickButton(text)
  for _, frame in ipairs(bed.frames) do
    if frame._text == text and frame._scripts.OnClick then
      frame._scripts.OnClick(frame)
      return true
    end
  end
  error("no button labelled '" .. tostring(text) .. "'")
end

-- Header labels are FontStrings, which take no clicks; the button that does
-- is the one anchored over the label with SetAllPoints. Resolving it that
-- way lets a test say "click 利润" instead of naming a frame index.
function bed.clickHeader(text)
  local trade = tradeFrame()
  local labels = { trade.headItem }
  for _, label in ipairs(trade.headers) do labels[#labels + 1] = label end
  for _, label in ipairs(labels) do
    if bed.plain(label._text):find(text, 1, true) == 1 then
      for _, frame in ipairs(bed.frames) do
        if frame._allPoints == label and frame._scripts.OnClick then
          frame._scripts.OnClick(frame)
          return true
        end
      end
      error("header '" .. text .. "' is not clickable")
    end
  end
  error("no header labelled '" .. text .. "'")
end

function bed.hoverHeader(text, enter)
  local trade = tradeFrame()
  local labels = { trade.headItem }
  for _, label in ipairs(trade.headers) do labels[#labels + 1] = label end
  for _, label in ipairs(labels) do
    if bed.plain(label._text):find(text, 1, true) == 1 then
      for _, frame in ipairs(bed.frames) do
        if frame._allPoints == label then
          frame._scripts[enter and "OnEnter" or "OnLeave"](frame)
          return true
        end
      end
    end
  end
  error("no header labelled '" .. text .. "'")
end

-- The client shows the auction house; the addon builds its floating panel
-- and shows it directly (the retail AH has no WAH tab to click).
function bed.openTab()
  bed.fireEvent("AUCTION_HOUSE_SHOW")
end

function bed.setScan(items)
  local byId = {}
  for _, item in ipairs(items) do
    byId[item.itemId] = {
      name = item.name,
      quality = item.quality or 2,
      minPrice = item.minPrice,
      vendorP = item.vendorP or 0,
      sellP = item.sellP or item.minPrice,
      marketPrice = item.marketPrice or item.minPrice,
      quantity = item.quantity or 0,
      numAuctions = item.numAuctions or 0
    }
  end
  WoWderhoiAH_ScanData = {
    dataVersion = bed.ns.PIPELINE_VERSION,
    scannedAt = NOW,
    server = "TestRealm",
    faction = "Alliance",
    items = byId
  }
end

-- closes are P10 values oldest-first, one per scan, all inside the 7d window.
function bed.setPoints(entries)
  WoWderhoiAH_Points = {}
  for _, entry in ipairs(entries) do
    local points = {}
    for index, close in ipairs(entry.closes) do
      points[index] = { t = NOW - (#entry.closes - index) * 900, c = close }
    end
    WoWderhoiAH_Points[entry.itemId] = points
  end
end

function bed.setListings(listings) bed.listings = listings end

-- Move a listing's price without re-running the search, so a test can make
-- the book change under a row the way another buyer would.
function bed.repriceListing(index, buyout) bed.listings[index].buyout = buyout end

-- Search now runs against the session scan (the replication already holds the
-- whole book), so old-style listing arrays are folded into the scan first:
-- same itemId -> one aggregated row, minPrice = cheapest unit price,
-- quantity = total listed, marketPrice follows the cheapest.
function bed.mergeScanFromListings(listings)
  local scan = WoWderhoiAH_ScanData and WoWderhoiAH_ScanData.dataVersion == bed.ns.PIPELINE_VERSION
    and WoWderhoiAH_ScanData.items
  if not scan then return end
  for _, listing in ipairs(listings) do
    local unit = listing.buyout / listing.count
    local entry = scan[listing.itemId]
    if not entry then
      entry = {
        name = listing.name, quality = listing.quality or 2,
        itemClass = "unknown", itemSubClass = "unknown", vendorP = 0,
        minPrice = unit, marketPrice = unit, sellP = unit,
        quantity = listing.count, numAuctions = 1
      }
      scan[listing.itemId] = entry
    else
      if unit < entry.minPrice then entry.minPrice = unit end
      entry.marketPrice = entry.marketPrice or entry.minPrice
      entry.quantity = (entry.quantity or 0) + listing.count
      entry.numAuctions = (entry.numAuctions or 0) + 1
    end
  end
end

function bed.search(query, listings)
  if listings then bed.mergeScanFromListings(listings) end
  tradeFrame().searchBox:SetText(query)
  bed.clickButton(bed.ns.L.SEARCH)
end

function bed.rowCount()
  local count = 0
  for _, row in ipairs(tradeFrame().rows) do
    if row._shown then count = count + 1 end
  end
  return count
end

-- A row's hover handler is the whole tooltip feature; fire it the way the
-- client would when the cursor crosses the row.
function bed.hoverRow(index, leave)
  local row = tradeFrame().rows[index]
  -- A plain Frame gets no cursor events until it asks for them, so a
  -- handler on a mouse-disabled row is one the player can never trigger.
  if not row._mouse then error("row " .. index .. " does not take mouse input") end
  local script = row._scripts[leave and "OnLeave" or "OnEnter"]
  if not script then error("row " .. index .. " has no hover handler") end
  script(row)
end

function bed.tooltipSource() return GameTooltip._source or "" end
function bed.tooltipText() return table.concat(GameTooltip._lines, "\n") end
function bed.tooltipShown() return GameTooltip:IsShown() end

function bed.buyRow(index)
  local row = tradeFrame().rows[index]
  row.buy._scripts.OnClick(row.buy)
end

local function scanEntry(itemId)
  local items = WoWderhoiAH_ScanData and WoWderhoiAH_ScanData.items
  return items and items[itemId]
end

function bed.scanned(itemId) return scanEntry(itemId) ~= nil end
function bed.scanMin(itemId)
  local entry = scanEntry(itemId)
  return entry and entry.minPrice
end
function bed.scanAuctions(itemId)
  local entry = scanEntry(itemId)
  return entry and entry.numAuctions
end

function bed.rowName(index) return bed.plain(tradeFrame().rows[index].name._text) end
function bed.cellText(index, slot) return bed.plain(tradeFrame().rows[index].cells[slot]._text) end
function bed.cellRaw(index, slot) return tradeFrame().rows[index].cells[slot]._text end
function bed.buyText(index) return tradeFrame().rows[index].buy._text end
function bed.headerText(slot)
  local trade = tradeFrame()
  return bed.plain(slot == 0 and trade.headItem._text or trade.headers[slot]._text)
end
function bed.headerColor(text)
  local trade = tradeFrame()
  local labels = { trade.headItem }
  for _, label in ipairs(trade.headers) do labels[#labels + 1] = label end
  for _, label in ipairs(labels) do
    if bed.plain(label._text):find(text, 1, true) == 1 then
      return table.concat(label._color or {}, ",")
    end
  end
  error("no header labelled '" .. text .. "'")
end
function frameMeta:SetTextColor(red, green, blue) self._color = { red, green, blue } end

-- ============================== Geometry ==============================

-- The panel is a fixed-size floating frame now, so its height is its own.
function bed.panelHeight()
  local panel = tradeFrame()
  if panel._height then return panel._height end
  return AuctionHouseFrame:GetHeight() + panel._points.TOPLEFT.y - panel._points.BOTTOMRIGHT.y
end

-- Smallest gap between the panel's edge and anything anchored to it, per
-- side. The backdrop draws its border inside these same bounds, so this is
-- exactly the room the border art has to occupy without content on top.
function bed.panelClearance(side)
  local panel = tradeFrame()
  local least = nil
  local function keep(value)
    if not least or value < least then least = value end
  end
  for _, frame in ipairs(bed.frames) do
    if frame._parent == panel and frame._points then
      for point, anchor in pairs(frame._points) do
        if anchor.to == panel and point:find(side) then
          if side == "LEFT" then keep(anchor.x)
          elseif side == "RIGHT" then keep(-anchor.x)
          elseif side == "TOP" then keep(-anchor.y)
          else keep(anchor.y) end
        end
      end
    end
  end
  -- Rows hang off the top edge, so their lower edge -- not their anchor --
  -- is what the bottom border has to clear.
  if side == "BOTTOM" then
    local last = panel.rows[#panel.rows]
    keep(bed.panelHeight() + last._points.TOPLEFT.y - last._height)
  end
  return least
end

function bed.backdropInset(side) return tradeFrame()._backdrop.insets[side] end
function bed.visibleRows() return #tradeFrame().rows end

-- A FontString pinned to a fixed width inside a fixed-height row must not
-- be allowed to wrap: a second line grows past the row and lands on the
-- next one. Counts the ones still able to.
function bed.wrappingCells()
  local panel = tradeFrame()
  local wrapping = 0
  local function check(fontString)
    if fontString._width and fontString._wordWrap ~= false then wrapping = wrapping + 1 end
  end
  for _, label in ipairs(panel.headers) do check(label) end
  for _, row in ipairs(panel.rows) do
    for _, cell in ipairs(row.cells) do check(cell) end
  end
  return wrapping
end

function bed.chatCount() return #bed.chat end
function bed.lastChat() return bed.plain(bed.chat[#bed.chat] or "") end
function bed.anyChat(text)
  for _, line in ipairs(bed.chat) do
    if bed.plain(line):find(text, 1, true) then return true end
  end
  return false
end
