-- WoWderhoiAH Scanner: grabs the auction house list and aggregates
-- per-item min/weighted prices into the WoWderhoiAH_ScanData SavedVariable.
-- WoW: Forever / retail 12.x port: the classic QueryAuctionItems/getAll
-- path does not exist on this client. The equivalent full-house scan is
-- C_AuctionHouse.ReplicateItems() — a server-side replication of the whole
-- auction house with a ~15-minute cooldown, streamed in over several frames
-- and delivered via REPLICATE_ITEM_LIST_UPDATE. SavedVariables output keeps
-- the exact shape of the TBC build (see finishScan) so the desktop terminal
-- importer is unchanged.

local ADDON_NAME, WAH = ...
local L = WAH.L
-- GetCoinTextureString does not exist on the Forever beta client (retail
-- MoneyFrame global is absent). Provide a plain gold/silver/copper text
-- fallback so tooltip, chart and purchase messages keep rendering.
if type(GetCoinTextureString) ~= "function" then
  function GetCoinTextureString(amount)
    amount = math.max(0, math.floor(amount or 0))
    local g = math.floor(amount / 10000)
    local s = math.floor((amount % 10000) / 100)
    local c = amount % 100
    if g > 0 then
      return string.format("%dg %ds %dc", g, s, c)
    elseif s > 0 then
      return string.format("%ds %dc", s, c)
    end
    return string.format("%dc", c)
  end
end

-- Cooldown of a full replication scan, in seconds. Matches the classic
-- getAll cooldown cadence; the server does not expose a public query for
-- "is replicate ready", so the addon tracks its own ready-at timestamp.
local REPLICATE_COOLDOWN = 15 * 60
-- Hard ceiling on listings processed per OnUpdate frame. The real gate is
-- the time budget below; this only caps a single catastrophically slow
-- recordAuction from spinning one frame indefinitely.
local PROCESS_PER_FRAME = 200
-- Per-frame time budget for replicate processing, in milliseconds. We yield
-- back to the renderer at ~8ms so a full-AH scan stays under one frame at
-- 60fps instead of hitching on a 500-row burst. Measured with
-- debugprofilestop (ms float, available on retail 12.x).
local FRAME_BUDGET_MS = 8

local scanState = nil -- { mode="replicate", itemsById, itemInfoCache, processing, cursor, pending, pendingOnly }
local pendingRounds = 0 -- revisit passes over incomplete entries, capped to avoid a stall

local function autoScanOn()
  return WAH.settings and WAH.settings.autoScan
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("REPLICATE_ITEM_LIST_UPDATE")
frame:RegisterEvent("AUCTION_HOUSE_CLOSED")

local function chatMessage(text)
  DEFAULT_CHAT_FRAME:AddMessage("|cff33ff99WoWderhoiAH|r " .. text)
end

-- C_AuctionHouse.GetReplicateItemInfo returns a table on the retail 12.x /
-- Forever client. Older builds returned 15+ positional values; accept both
-- so the addon also survives a client rollback or a data-only stub. Table
-- field naming differs across clients (camelCase vs snake_case), so read
-- both spellings.
local function readReplicateItem(index)
  -- Positional-return layout on the Forever Beta client (verified by probe):
  -- [0]=name [1]=texture [2]=count [3]=qualityID [4]=usable [5]=level
  -- [6]=levelType [7]=minBid [8]=minIncrement [9]=buyoutPrice [10]=bidAmount
  -- [11]=highBidder [12]=owner [13]=saleStatus [14..15]=extras [16]=itemID [17]=hasAllInfo
  -- (fall back to the older 15-slot layout if a future client drops the extras)
  local a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p, q, r = C_AuctionHouse.GetReplicateItemInfo(index)
  if type(a) == "table" then
    return {
      name = a.name or a.displayName or a.display_name,
      count = a.count or a.quantity,
      qualityID = a.qualityID or a.quality_id,
      buyoutPrice = a.buyoutPrice or a.buyout_price,
      itemID = a.itemID or a.itemId or a.item_id,
      hasAllInfo = a.hasAllInfo or a.has_all_info
    }
  end
  return {
    name = a,
    count = c,
    qualityID = d,
    buyoutPrice = j,
    itemID = q or o,      -- [16], falling back to [14] on the old layout
    hasAllInfo = r or p   -- [17], falling back to [15] on the old layout
  }
end

-- Diagnostic: print the raw shape of the first two replicate entries once
-- per scan, so a client quirk (different return type, field names, or an
-- off-by-one index) shows up in chat instead of a silent 0-item scan.
local function printReplicateProbe()
  local probe0 = { C_AuctionHouse.GetReplicateItemInfo(0) }
  local parts = {}
  for i = 1, math.min(#probe0, 20) do
    local v = tostring(probe0[i])
    if #v > 28 then v = string.sub(v, 1, 28) .. "..." end
    parts[#parts + 1] = "[" .. (i - 1) .. "]=" .. v
  end
  chatMessage(string.format(L.SCAN_PROBE, #probe0, table.concat(parts, " | ")))
end

-- Class/subclass + vendor price for one itemId, cached for the scan's
-- lifetime. Retail returns numeric classIDs; translate to localized names
-- (the terminal stores category strings) with a safe fallback when the
-- item is not cached yet or the legacy name API is gone.
local function itemCategoryAndVendor(itemId)
  local classID, subclassID, vendorPrice
  local ok = pcall(function()
    local _, _, _, _, _, c, s = C_Item.GetItemInfoByID(itemId)
    classID, subclassID = c, s
    vendorPrice = select(11, C_Item.GetItemInfoByID(itemId))
  end)
  if not ok then return "unknown", "unknown", 0 end
  local className, subclassName = "unknown", "unknown"
  if classID then
    if GetItemClassInfo then
      local cName = GetItemClassInfo(classID)
      if cName and cName ~= "" then className = cName end
    end
    if classID and subclassID and GetItemSubClassInfo then
      local sName = GetItemSubClassInfo(classID, subclassID)
      if sName and sName ~= "" then subclassName = sName end
    end
  end
  return className, subclassName, vendorPrice or 0
end

-- Item info arrives asynchronously: when a category came back unknown during
-- the scan (the client had no cache entry yet), GET_ITEM_INFO_RECEIVED calls
-- this to backfill the class/subclass once the info lands. The running scan's
-- entry is patched in place so the export that ends this scan — and every
-- later scan — carries the real category instead of "unknown".
WAH.refreshPendingCategories = function(itemId)
  if not scanState or not scanState.pendingCategory or not scanState.pendingCategory[itemId] then return end
  local entry = scanState.itemsById and scanState.itemsById[itemId]
  if not entry then
    scanState.pendingCategory[itemId] = nil
    return
  end
  local itemClass, itemSubClass = itemCategoryAndVendor(itemId)
  if itemClass ~= "unknown" and itemSubClass ~= "unknown" then
    entry.itemClass, entry.itemSubClass = itemClass, itemSubClass
    local cache = scanState.itemInfoCache[itemId]
    if cache then cache.class, cache.subClass = itemClass, itemSubClass end
    scanState.pendingCategory[itemId] = nil
  end
end

local function recordAuction(info)
  local itemId = info.itemID
  local name = info.name
  local buyoutPrice = info.buyoutPrice
  local count = info.count
  local quality = info.qualityID
  if not (itemId and name and name ~= "" and buyoutPrice and buyoutPrice > 0 and count and count > 0) then return end
  local unitPrice = buyoutPrice / count
  local entry = scanState.itemsById[itemId]
  if not entry then
    local cached = scanState.itemInfoCache[itemId]
    if cached == nil then
      local itemClass, itemSubClass, vendorPrice = itemCategoryAndVendor(itemId)
      cached = { class = itemClass, subClass = itemSubClass, vendorP = vendorPrice }
      scanState.itemInfoCache[itemId] = cached
    end
    -- The client may not have this item's info cached yet; flag it so
    -- GET_ITEM_INFO_RECEIVED can backfill the category in place.
    if cached.class == "unknown" or cached.subClass == "unknown" then
      scanState.pendingCategory[itemId] = true
    end
    entry = {
      name = name,
      quality = quality,
      itemClass = cached.class,
      itemSubClass = cached.subClass,
      vendorP = cached.vendorP,
      minPrice = unitPrice,
      listings = {}, -- { price = unit price, count } for the weighted median
      quantity = 0,
      numAuctions = 0
    }
    scanState.itemsById[itemId] = entry
  end
  if unitPrice < entry.minPrice then entry.minPrice = unitPrice end
  entry.listings[#entry.listings + 1] = { price = unitPrice, count = count }
  entry.quantity = entry.quantity + count
  entry.numAuctions = entry.numAuctions + 1
end

-- Quantity-weighted percentile: the unit price at which `fraction` of
-- the listed quantity sits at or below. This realm's upper book is noise
-- — thin, stale listings nobody transacts against — so only the bottom
-- decile reflects real trade: P10 is the market price, and the min/P5
-- rungs show where the cheap tail starts. Percentiles shrug off bait
-- stacks that wreck any mean.
local function weightedPercentile(sortedListings, totalQuantity, fraction)
  local threshold = totalQuantity * fraction
  local cumulative = 0
  for _, listing in ipairs(sortedListings) do
    cumulative = cumulative + listing.count
    if cumulative >= threshold then return listing.price end
  end
  return sortedListings[#sortedListings].price
end

-- Depth-aware sell front: the cheapest price with real quantity behind
-- it. Lone dump listings ahead of it sell out in minutes; undercutting
-- them gives gold away. Threshold: 3% of listed supply, at least 3 units.
local function sellFrontPrice(sortedListings, totalQuantity)
  local threshold = math.max(totalQuantity * 0.03, 3)
  local cumulative = 0
  for _, listing in ipairs(sortedListings) do
    cumulative = cumulative + listing.count
    if cumulative >= threshold then return listing.price end
  end
  return sortedListings[#sortedListings].price
end

local function finishScan(totalAuctions)
  local items = {}
  local itemCount = 0
  for itemId, entry in pairs(scanState.itemsById) do
    table.sort(entry.listings, function(left, right) return left.price < right.price end)
    items[itemId] = {
      name = entry.name,
      quality = entry.quality,
      itemClass = entry.itemClass,
      itemSubClass = entry.itemSubClass,
      minPrice = math.floor(entry.minPrice + 0.5),
      vendorP = entry.vendorP,
      sellP = math.floor(sellFrontPrice(entry.listings, entry.quantity) + 0.5),
      p5 = math.floor(weightedPercentile(entry.listings, entry.quantity, 0.05) + 0.5),
      marketPrice = math.floor(weightedPercentile(entry.listings, entry.quantity, 0.10) + 0.5),
      quantity = entry.quantity,
      numAuctions = entry.numAuctions
    }
    itemCount = itemCount + 1
  end
  -- Every stored point carries the pipeline's close price, so a pipeline
  -- bump redefines what the whole series means. Blending v2's P50 closes
  -- into the new P10 series would poison med7 and the deal radar until
  -- the last old point aged out; drop them on the first scan after a bump.
  local previousVersion = WoWderhoiAH_ScanData and WoWderhoiAH_ScanData.dataVersion
  if previousVersion and previousVersion ~= WAH.PIPELINE_VERSION then
    WoWderhoiAH_Points = nil
  end
  WoWderhoiAH_ScanData = {
    dataVersion = WAH.PIPELINE_VERSION, -- consumers reject anything else
    scannedAt = time(),
    server = GetRealmName(),
    faction = UnitFactionGroup("player"),
    items = items
  }
  WoWderhoiAHDB.scanData = WoWderhoiAH_ScanData -- persist under the single WoWderhoiAHDB variable
  -- Accumulate per-item price points in game: c is the P10 close — the
  -- price a buyer actually pays on this realm — and feeds the chart, the
  -- 7d P10 median and the deal radar alike. 7-day window, newest 192 points
  -- per item (~48 h at the 15-minute auto-scan cadence).
  WoWderhoiAH_Points = WoWderhoiAH_Points or {}
  WoWderhoiAHDB.points = WoWderhoiAH_Points -- keep the alias in sync for persistence
  local nowTs = time()
  local cutoff = nowTs - 7 * 24 * 3600
  for itemId, item in pairs(items) do
    local pts = WoWderhoiAH_Points[itemId] or {}
    -- Each point carries the scan's close price (c) and the listed
    -- quantity (q); q feeds the optional supply-shrink liquidity gate of
    -- the deal radar. c remains the only field any chart or median reads.
    pts[#pts + 1] = { t = nowTs, c = item.marketPrice, q = item.quantity }
    WoWderhoiAH_Points[itemId] = pts
  end
  for itemId, pts in pairs(WoWderhoiAH_Points) do
    local pruned = {}
    for _, point in ipairs(pts) do
      if point.t >= cutoff then pruned[#pruned + 1] = point end
    end
    while #pruned > 192 do table.remove(pruned, 1) end
    if #pruned == 0 then
      WoWderhoiAH_Points[itemId] = nil
    else
      WoWderhoiAH_Points[itemId] = pruned
    end
  end
  -- Record when the next full replication scan is allowed.
  if WAH.settings then
    WAH.settings.replicateReadyAt = time() + REPLICATE_COOLDOWN
  end
  scanState = nil
  WAH.scanRunning = false
  chatMessage(string.format(
    L.SCAN_COMPLETE .. "%s",
    totalAuctions or 0, itemCount, autoScanOn() and L.SCAN_AUTO_ARMED or ""))
end

local function processReplicateChunk()
  local total = C_AuctionHouse.GetNumReplicateItems()
  local frameStart = debugprofilestop()
  local yielded = false
  if not scanState.pendingOnly then
    -- First pass: walk every index once. Entries still streaming in
    -- (hasAllInfo=false) are queued for a revisit; the rest are recorded.
    local index = scanState.cursor
    local target = math.min(index + PROCESS_PER_FRAME - 1, total - 1)
    while index <= target do
      local info = readReplicateItem(index)
      if info then
        if info.hasAllInfo == false then
          scanState.pending[index] = true
        else
          recordAuction(info)
        end
      end
      if debugprofilestop() - frameStart >= FRAME_BUDGET_MS then yielded = true break end
      index = index + 1
    end
    scanState.cursor = index + 1
    if not yielded and target >= total - 1 then
      scanState.pendingOnly = true -- whole list walked; revisit incomplete entries
    end
  else
    -- Revisit pass: re-read only the entries that were incomplete, until
    -- none remain; a few capped rounds keep a stalled stream from hanging.
    local keys = {}
    for key in pairs(scanState.pending) do keys[#keys + 1] = key end
    table.sort(keys)
    local processed = 0
    for _, index in ipairs(keys) do
      if processed >= PROCESS_PER_FRAME then yielded = true break end
      local info = readReplicateItem(index)
      if info and info.hasAllInfo ~= false then
        recordAuction(info)
        scanState.pending[index] = nil
      elseif not info then
        scanState.pending[index] = nil -- index no longer valid; move on
      end
      processed = processed + 1
      if debugprofilestop() - frameStart >= FRAME_BUDGET_MS then yielded = true break end
    end
    if not yielded then
      if next(scanState.pending) then
        pendingRounds = pendingRounds + 1
        if pendingRounds >= 4 then
          -- Streaming stalled; ship what completed rather than hanging.
          chatMessage(string.format(L.SCAN_INCOMPLETE, #keys))
          frame:SetScript("OnUpdate", nil)
          finishScan(total)
          return
        end
      else
        frame:SetScript("OnUpdate", nil)
        finishScan(total)
      end
    end
  end
end

local function replicateSecondsLeft()
  local readyAt = WAH.settings and WAH.settings.replicateReadyAt
  if not readyAt then return 0 end
  return math.max(readyAt - time(), 0)
end

local function startScan()
  if not AuctionHouseFrame or not AuctionHouseFrame:IsShown() then
    chatMessage(L.SCAN_OPEN_AH_FIRST)
    return
  end
  if scanState then
    chatMessage(L.SCAN_ALREADY_RUNNING)
    return
  end
  if C_AuctionHouse.IsThrottled and C_AuctionHouse.IsThrottled() then
    chatMessage(L.SCAN_THROTTLED)
    return
  end
  local cooldownLeft = replicateSecondsLeft()
  if cooldownLeft > 0 then
    chatMessage(string.format(L.SCAN_REPLICATE_COOLDOWN, math.ceil(cooldownLeft / 60)))
    return
  end
  WAH.scanRunning = true
  pendingRounds = 0
  scanState = { mode = "replicate", itemsById = {}, itemInfoCache = {}, pending = {}, pendingOnly = false, probeDone = false, pendingCategory = {} }
  chatMessage(L.SCAN_REPLICATE_START)
  local throttled = false
  if C_AuctionHouse.IsThrottled then throttled = C_AuctionHouse.IsThrottled() end
  chatMessage(string.format(L.SCAN_DIAG_THROTTLE, throttled and "yes" or "no"))
  C_AuctionHouse.ReplicateItems()
  -- Watchdog: if REPLICATE_ITEM_LIST_UPDATE never fires (replication
  -- rejected, or the event differs on this client), scanState would sit
  -- here forever and block every later scan. Reset after 12s and say so.
  C_Timer.After(12, function()
    if not scanState then return end
    if scanState.processing then return end -- data is flowing; normal path owns it
    chatMessage(L.SCAN_NO_REPLICATE)
    scanState = nil
    WAH.scanRunning = false
  end)
end

frame:SetScript("OnEvent", function(_, event)
  if event == "AUCTION_HOUSE_CLOSED" then
    if scanState then
      frame:SetScript("OnUpdate", nil)
      scanState = nil
      WAH.scanRunning = false
      chatMessage(L.SCAN_ABORTED)
    end
    return
  end
  -- REPLICATE_ITEM_LIST_UPDATE fires once per streamed chunk (and once at
  -- the end); the OnUpdate pass drains whatever is ready, resuming on the
  -- next chunk event until the replication is fully consumed.
  if not scanState then return end
  if scanState.processing then return end
  scanState.processing = true
  scanState.cursor = 0 -- replicate indices are 0-based on this client
  chatMessage(string.format(L.SCAN_RECEIVED, C_AuctionHouse.GetNumReplicateItems() or 0))
  if not scanState.probeDone then
    scanState.probeDone = true
    printReplicateProbe()
  end
  frame:SetScript("OnUpdate", processReplicateChunk)
end)

-- Auto-rescan: while the AH stays open, restart a replicate scan whenever
-- the ~15-minute cooldown elapses. Ticker is cheap; all real gating is
-- inside the check.
C_Timer.NewTicker(20, function()
  if not autoScanOn() or scanState then return end
  if not (AuctionHouseFrame and AuctionHouseFrame:IsShown()) then return end
  if replicateSecondsLeft() > 0 then return end
  chatMessage(L.AUTO_TRIGGER)
  startScan()
end)

-- Single history authority: points accumulated across scans plus the
-- 7d P10 median derived from them. GUI chart, tooltip history, and the
-- deal radar all read through here. Points carry {t, c, q}: c is the
-- close price every chart/median reads; q is the listed quantity, used
-- only by the optional supply-shrink liquidity gate.
function WAH.history(itemId)
  local pts = WoWderhoiAH_Points and WoWderhoiAH_Points[itemId]
  if not pts or #pts == 0 then return nil end
  local prices = {}
  for index, point in ipairs(pts) do prices[index] = point.c end
  table.sort(prices)
  local med7 = prices[math.ceil(#prices / 2)]
  -- Distinct closes in the window. A flat series means one camper's ask
  -- recorded over and over, so med7 is a price nothing traded against;
  -- the deal radar refuses to discount from it.
  local distinct = 1
  for index = 2, #prices do
    if prices[index] ~= prices[index - 1] then distinct = distinct + 1 end
  end
  return { pts = pts, med7 = med7, latest = pts[#pts].c, distinct = distinct }
end

SLASH_WOWDERHOIAH1 = "/wahscan"
SlashCmdList["WOWDERHOIAH"] = startScan
WAH.startScan = startScan

SLASH_WOWDERHOIAHAUTO1 = "/wahauto"
SlashCmdList["WOWDERHOIAHAUTO"] = function()
  WAH.settings.autoScan = not WAH.settings.autoScan
  chatMessage(WAH.settings.autoScan
    and L.AUTO_ON
    or L.AUTO_OFF)
end
-- Diagnostic: does this Forever beta allow file I/O at all? The client
-- fails to inject SavedVariables on login (write works, read never lands),
-- so the fallback plan is to read the file ourselves when io/loadfile
-- are available.
SLASH_WOWDERHOIAHTESTIO1 = "/wahtestio"
SlashCmdList["WOWDERHOIAHTESTIO"] = function()
  local out = {}
  out[#out + 1] = "io=" .. tostring(io)
  out[#out + 1] = "loadfile=" .. tostring(loadfile)
  local p = "WTF/Account/1120133458#1/SavedVariables/WoWderhoiAH.lua"
  if io and io.open then
    local ok, f = pcall(io.open, p, "r")
    out[#out + 1] = "ioopen=" .. tostring(ok)
    if ok and f then
      local chunk = f:read("*a")
      f:close()
      out[#out + 1] = "len=" .. tostring(chunk and #chunk or 0)
    end
  end
  local ok2, res2 = pcall(loadfile, "Interface/AddOns/WoWderhoiAH/data.lua")
  out[#out + 1] = "loadself=" .. tostring(ok2) .. "/" .. tostring(res2)
  DEFAULT_CHAT_FRAME:AddMessage("WAH io-test: " .. table.concat(out, " | "))
end