-- WoWderhoiAH-Transcript v0.2.0
-- 把拍卖行搜索结果的完整价格档位转录到 SavedVariables，供 WoWderhoiAH 网页版读取。
--
-- 设计（M4，2026-10-13）：
--   * 扫描范围 = Auctionator 存档（AUCTIONATOR_PRICE_DATABASE）里出现过的普通物品
--     itemId（只读其存档数据作清单，不依赖 Auctionator 代码）+ 白名单配置。
--   * 扫描方式 = 打开拍卖行后逐个物品 SendSearchQuery，等搜索结果事件返回后
--     读取该物品全部拍卖条目，按单价聚合为档位 {p,q}（同价合并数量），落盘。
--     事件驱动天然串行，避免拍卖行查询限速。
--   * 落盘 = WAHTranscribeDB.scans[itemId] = { t = 服务器时间戳, market, tiers = {...} }，
--     只保留最新一轮（网页端导入时按轮次累积历史，DB 保留全部轮次）。
--   * 断点续扫 = WAHTranscribeState 存队列/进度（SavedVariables 登出时写盘）。
--
-- v0.2.0（2026-10-16）：
--   * 自动补档：Auctionator 增量扫描完成后（IncrementalScan ScanComplete）自动调用
--     Auctionator.Forever.StartTierBackfill()，只对"候选物品"（必赚：最低买入价 < NPC
--     收购价；或潜在捡漏：7 日最低价中位数 × 0.95 − 最低买入价 ≥ 50c）逐个搜索补档，
--     覆盖网页雷达池的真前 5 档价位需求。候选读 AUCTIONATOR_PRICE_DATABASE（m/l 历史）
--     与 WAHVendorDB（NPC 收购价），不重复网页侧完整雷达逻辑。
--   * 条目增加 market 字段（faction/neutral），网页导入按市场分流。
--
-- 用法：/wahscan start [fresh] | stop | resume | status

local frame = CreateFrame("Frame")
local MIN_QUERY_GAP = 0.6     -- 两次查询之间的最小间隔（秒）
local QUERY_TIMEOUT = 8       -- 单物品查询超时（秒），超时跳过重发
local PROGRESS_EVERY = 25     -- 每完成 N 个物品报一次进度

WAHTranscribeDB = WAHTranscribeDB or { version = 1, scans = {} }
WAHTranscribeState = WAHTranscribeState or { queue = {}, pos = 1, done = 0, running = false }

local state = WAHTranscribeState
local pendingItemId = nil
local pendingAt = 0
local timer = 0

-- ---------- 工具 ----------

local function chat(msg)
  if DEFAULT_CHAT_FRAME then
    DEFAULT_CHAT_FRAME:AddMessage("|cff33ffccWAH转录|r: " .. msg)
  end
end

local function now()
  if GetServerTime then return GetServerTime() end
  return time()
end

-- 读取 Auctionator 已扫过的普通物品清单（数据互操作：只读其存档全局变量）。
-- 价格库按服务器槽位嵌套：AUCTIONATOR_PRICE_DATABASE = { ["PvP"] = { [itemId] = {...} }, ... }，
-- 先取 "PvP" 槽（本服），其余槽位合并（多扫无害）。
local function collectItemIds()
  local ids, seen = {}, {}
  local db = AUCTIONATOR_PRICE_DATABASE
  if type(db) == "table" then
    local function addSlot(slot)
      if type(slot) ~= "table" then return end
      for k in pairs(slot) do
        local id = tonumber(k)
        if id and not seen[id] then
          seen[id] = true
          ids[#ids + 1] = id
        end
      end
    end
    addSlot(db.PvP)
    for k, v in pairs(db) do
      if k ~= "PvP" then addSlot(v) end
    end
  end
  if type(WAH_TRANSCRIPT_EXTRA) == "table" then
    for _, id in ipairs(WAH_TRANSCRIPT_EXTRA) do
      local n = tonumber(id)
      if n and not seen[n] then
        seen[n] = true
        ids[#ids + 1] = n
      end
    end
  end
  table.sort(ids)
  return ids
end

-- 把 {price=qty} 映射排序成档位数组 { {p=..,q=..}, ... }（升序）
local function flattenTiers(tierMap)
  local arr = {}
  for price, qty in pairs(tierMap) do arr[#arr + 1] = { p = price, q = qty } end
  table.sort(arr, function(a, b) return a.p < b.p end)
  return arr
end

local function saveItemTiers(itemId, tierMap)
  WAHTranscribeDB.scans[tostring(itemId)] = {
    t = now(),
    market = Auctionator.Forever and Auctionator.Forever.CurrentScanMarket or "faction",
    tiers = flattenTiers(tierMap),
  }
end

-- ---------- 读取搜索结果档位 ----------

-- commodity：GetCommoditySearchResultInfo 的 unitPrice 已是单价。
local function readCommodityTiers(itemId)
  if not C_AuctionHouse then return nil end
  local getNum = C_AuctionHouse.GetNumCommoditySearchResults
  if not getNum then return nil end
  local ok, num = pcall(getNum, itemId)
  if not ok or not num or num == 0 then return nil end
  local tiers = {}
  local getInfo = C_AuctionHouse.GetCommoditySearchResultInfo
  for i = 1, num do
    local info
    if getInfo then ok, info = pcall(getInfo, itemId, i) end
    if ok and info then
      local price = info.unitPrice or info.minPrice or 0
      local qty = info.quantity or info.totalQuantity or 0
      if price > 0 and qty > 0 then tiers[price] = (tiers[price] or 0) + qty end
    end
  end
  if not next(tiers) then return nil end
  return tiers
end

-- item：buyout 是整单价，除以数量得单价。
local function readItemTiers(itemKey)
  if not C_AuctionHouse then return nil end
  local getNum = C_AuctionHouse.GetNumItemSearchResults
  if not getNum then return nil end
  local ok, num = pcall(getNum, itemKey)
  if not ok or not num or num == 0 then return nil end
  local tiers = {}
  local getInfo = C_AuctionHouse.GetItemSearchResultInfo
  for i = 1, num do
    local info
    if getInfo then ok, info = pcall(getInfo, itemKey, i) end
    if ok and info then
      local buyout = info.buyoutAmount or info.buyoutPrice or 0
      local qty = info.quantity or info.totalQuantity or 1
      if buyout > 0 and qty > 0 then
        local unit = math.floor(buyout / qty + 0.5)
        if unit > 0 then tiers[unit] = (tiers[unit] or 0) + qty end
      end
    end
  end
  if not next(tiers) then return nil end
  return tiers
end

local function makeItemKey(itemId)
  if C_AuctionHouse.MakeItemKey then
    local ok, ik = pcall(C_AuctionHouse.MakeItemKey, itemId)
    if ok and ik then return ik end
  end
  return { itemID = itemId }
end

-- ---------- 自动补档（v0.2.0） ----------

-- 候选：当日有在售（m > 0）且满足
--   * 必赚：最低买入价 m < NPC 收购价（WAHVendorDB.scans[itemId].p）；或
--   * 潜在捡漏：7 日最低价（block.l 最近 7 天）中位数 × 0.95 − m ≥ 50c。
-- 口径与网页雷达一致（AH 税 5%、绝对净利 50c 地板），但不重复 med7 的
-- 稀薄日过滤等细节——候选只是"值得补档位"的近似，宽进严出。
local function collectCandidates()
  local candidates = {}
  if not Auctionator.Forever then return candidates end
  local slot = (Auctionator.Forever.CurrentScanMarket == "neutral") and "PvP_N" or "PvP"
  local db = AUCTIONATOR_PRICE_DATABASE
  local slotData = (type(db) == "table") and db[slot]
  if type(slotData) ~= "table" then return candidates end
  for k, block in pairs(slotData) do
    local id = tonumber(k)
    if id and type(block) == "table" and block.m and block.m > 0 then
      local vendor = WAHVendorDB and WAHVendorDB.scans and WAHVendorDB.scans[tostring(id)]
      if vendor and vendor.p and vendor.p > block.m then
        candidates[#candidates + 1] = id
      else
        local days = {}
        for day, l in pairs(block.l or {}) do
          if type(day) == "number" and l and l > 0 then days[#days + 1] = day end
        end
        table.sort(days)
        local n = #days
        local lows = {}
        for i = math.max(1, n - 6), n do lows[#lows + 1] = block.l[days[i]] end
        if #lows > 0 then
          table.sort(lows)
          local med = lows[math.ceil(#lows / 2)]
          if med and med * 0.95 - block.m >= 50 then candidates[#candidates + 1] = id end
        end
      end
    end
  end
  table.sort(candidates)
  return candidates
end

-- 扫描完成后自动补档：对候选物品逐搜索采集真实档位（事件驱动，复用 advance/onResults）。
-- 拍卖行必须开着；扫描中（state.running）时跳过；候选为空提示无需补档。
function Auctionator.Forever.StartTierBackfill()
  if state.running then
    chat("补档跳过：已有扫描队列在运行。")
    return
  end
  if not C_AuctionHouse then
    chat("补档失败：拍卖行 API 不可用（请保持拍卖行打开）。")
    return
  end
  local candidates = collectCandidates()
  if #candidates == 0 then
    chat("补档跳过：无候选物品（必赚或潜在捡漏）。")
    return
  end
  state.queue = candidates
  state.pos = 1
  state.done = 0
  state.running = true
  chat(string.format("正在补档 %d 个候选物品的真实档位（约 %.0f 秒）…", #candidates, #candidates * MIN_QUERY_GAP))
  advance()
end

-- ---------- 扫描控制 ----------

local function advance()
  pendingItemId = nil
  pendingAt = 0
  state.pos = state.pos + 1
  if state.pos > #state.queue then
    state.running = false
    state.queue = {}
    state.pos = 1
    chat(string.format("扫描完成，共 %d 个物品。请正常登出/重载以保存存档。", state.done))
    -- 自动落盘：若有 AutoReload 模块（v0.2.0），延迟重载保存全部存档。
    if WAHReload and WAHReload.schedule then WAHReload.schedule() end
    return
  end
  local id = state.queue[state.pos]
  if not C_AuctionHouse then
    chat("未检测到拍卖行 API，请打开拍卖行后重试。")
    state.running = false
    return
  end
  pendingItemId = id
  pendingAt = now()
  local ok, err = pcall(C_AuctionHouse.SendSearchQuery, makeItemKey(id), {}, false)
  if not ok then
    chat("查询失败 itemId=" .. tostring(id) .. " (" .. tostring(err) .. ")，跳过。")
    advance()
  end
end

local function onResults()
  if not state.running or not pendingItemId then return end
  local itemId = pendingItemId
  local tiers = readCommodityTiers(itemId) or readItemTiers(makeItemKey(itemId))
  if tiers then
    saveItemTiers(itemId, tiers)
    state.done = state.done + 1
    if state.done % PROGRESS_EVERY == 0 then
      chat(string.format("进度 %d/%d（已完成 %d）", state.pos, #state.queue, state.done))
    end
  end
  advance()
end

local function startScan(fresh)
  if state.running then
    chat("扫描已在运行中（/wahscan status 查看进度）。")
    return
  end
  local ids = collectItemIds()
  if #ids == 0 then
    chat("未找到物品清单：请先让 Auctionator 扫过拍卖行（或配置 WAH_TRANSCRIPT_EXTRA 白名单）。")
    return
  end
  if fresh or #state.queue == 0 or state.pos > #state.queue then
    state.queue = ids
    state.pos = 1
    state.done = 0
  else
    chat(string.format("检测到未完成的队列（%d/%d），继续扫描；如需重扫请 /wahscan start fresh。", state.pos, #state.queue))
  end
  state.running = true
  chat(string.format("开始扫描 %d 个物品（约 %.0f 分钟）。请保持拍卖行打开，扫完请正常登出。", #state.queue, #state.queue * MIN_QUERY_GAP / 60))
  advance()
end

-- ---------- 事件与计时 ----------

frame:RegisterEvent("COMMODITY_SEARCH_RESULTS_UPDATED")
frame:RegisterEvent("ITEM_SEARCH_RESULTS_UPDATED")

frame:SetScript("OnEvent", function()
  onResults()
end)

frame:SetScript("OnUpdate", function(self, elapsed)
  if not state.running then return end
  timer = timer + elapsed
  -- 查询超时保护：结果事件丢失时跳过该物品继续。
  if pendingItemId and now() - pendingAt > QUERY_TIMEOUT then
    chat("查询超时 itemId=" .. tostring(pendingItemId) .. "，跳过。")
    advance()
  end
end)

-- ---------- 聊天命令 ----------

local function doCommand(msg)
  local cmd = (msg or ""):lower()
  if cmd == "start" or cmd == "start fresh" or cmd == "fresh" then
    startScan(cmd ~= "start")
  elseif cmd == "resume" then
    if #state.queue == 0 or state.pos > #state.queue then
      chat("没有可续扫的队列，请 /wahscan start。")
    else
      state.running = true
      chat(string.format("续扫 %d/%d。", state.pos, #state.queue))
      advance()
    end
  elseif cmd == "stop" then
    if state.running then
      state.running = false
      chat(string.format("已暂停（%d/%d）。数据将在登出时保存；可 /wahscan resume 续扫。", state.pos, #state.queue))
    else
      chat("当前没有在运行的扫描。")
    end
  elseif cmd == "status" or cmd == "" then
    if state.running then
      chat(string.format("运行中：%d/%d，已完成 %d 个。", state.pos, #state.queue, state.done))
    else
      chat(string.format("未运行。队列 %d/%d（%d 个已转录）。", state.pos, #state.queue, state.done))
    end
  else
    chat("用法：/wahscan start [fresh] | stop | resume | status")
  end
end

SLASH_WAHSCAN1 = "/wahscan"
SlashCmdList.WAHSCAN = doCommand

chat("已加载。打开拍卖行后输入 /wahscan start 开始转录价格档位。")
