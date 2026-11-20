if WAH.disabled then return end

-- 前五档价格档位转录（2026-11-20 重写）
--
-- 拍卖行浏览扫描只给每个物品"最低价 + 总量"，前五档必须逐物品 SendSearchQuery。
-- （replicate 全量扫描能拿到每条挂单，但无限版有 15 分钟硬冷却，见 docs/AI.md §6.1。）
--
-- 旧版慢的根因与本版修复：
--   1. StartTierBackfill 调用了文件后面才定义的 local advance → 调用 nil 报错，
--      自动补档从未成功；且报错前已把 running=true 写入存档 → 之后每次都"已有队列在
--      运行"而跳过，只能手动 /wahscan start 全量逐个搜（数千个物品）。→ 前置声明 + 载入时复位。
--   2. 被拍卖行限流的查询会被静默丢弃，只能干等 8 秒超时。→ 发送前检查
--      IsThrottledMessageSystemReady，超时降到 4 秒并重试一次。
--   3. 任何搜索结果事件（含 Auctionator 自己的搜索）都会推进队列。→ 只认当前物品的结果。
--   4. 未按价格排序，物品类结果可能不是最便宜的 5 档。→ 按单价升序搜索。
--   5. 联盟/中立档位按 itemId 互相覆盖，新鲜度门槛也不分市场。→ 按市场分开存。
--
-- 落盘结构（version 2）：
--   WAHTranscribeDB.markets[market][itemId] = { t = 服务器时间戳, tiers = { {p=单价, q=数量}, ... } }
--   每市场每物品只保留最新一轮、最便宜的 5 档（网页导入时按轮次累积历史）。
--
-- 用法：/wahscan start [fresh] | stop | resume | status | backfill

local MIN_QUERY_GAP = 0.2     -- 两次查询之间的最小间隔（秒）
local QUERY_TIMEOUT = 4       -- 单物品查询超时（秒）
local MAX_RETRIES = 1         -- 超时后重发次数
local PROGRESS_EVERY = 25     -- 每完成 N 个物品报一次进度
local TIER_TTL = 4 * 3600     -- 4 小时内采过的物品不重复补档
local MAX_TIERS = 5

local state  -- WAHTranscribeState（载入存档后才赋值）

local function chat(msg)
  WAH.chat("WAH转录", msg)
end

local function now()
  if GetServerTime then return GetServerTime() end
  return time()
end

local function emptyMarkets()
  return { faction = {}, neutral = {} }
end

WAH.OnSavedVariablesLoaded(function()
  if type(WAHTranscribeDB) ~= "table" then
    WAHTranscribeDB = { version = 2, markets = emptyMarkets() }
  end
  -- v1（scans[itemId] = { t, market, tiers }）→ v2 按市场分组
  if type(WAHTranscribeDB.markets) ~= "table" then
    local markets = emptyMarkets()
    for key, scan in pairs(WAHTranscribeDB.scans or {}) do
      if type(scan) == "table" then
        local market = scan.market == "neutral" and "neutral" or "faction"
        markets[market][tostring(key)] = { t = scan.t, tiers = scan.tiers }
      end
    end
    WAHTranscribeDB = { version = 2, markets = markets }
  end
  WAHTranscribeDB.markets.faction = WAHTranscribeDB.markets.faction or {}
  WAHTranscribeDB.markets.neutral = WAHTranscribeDB.markets.neutral or {}

  if type(WAHTranscribeState) ~= "table" then
    WAHTranscribeState = {}
  end
  state = WAHTranscribeState
  state.queue = state.queue or {}
  state.pos = state.pos or 1
  state.done = state.done or 0
  -- 上次会话中断（/reload、断线）时存档里可能残留 running=true：不复位就会永远
  -- "已有队列在运行"。队列本身保留，可 /wahscan resume 续扫。
  state.running = false
end)

local function marketStore(market)
  return WAHTranscribeDB.markets[market == "neutral" and "neutral" or "faction"]
end

-- ---------- 档位读写 ----------

local function flattenTiers(tierMap)
  local arr = {}
  for price, qty in pairs(tierMap) do arr[#arr + 1] = { p = price, q = qty } end
  table.sort(arr, function(a, b) return a.p < b.p end)
  while #arr > MAX_TIERS do table.remove(arr) end
  return arr
end

local function saveItemTiers(market, itemId, tierMap)
  marketStore(market)[tostring(itemId)] = { t = now(), tiers = flattenTiers(tierMap) }
end

local function readCommodityTiers(itemId)
  local getNum = C_AuctionHouse.GetNumCommoditySearchResults
  if not getNum then return nil end
  local ok, num = pcall(getNum, itemId)
  if not ok or not num or num == 0 then return nil end
  local tiers = {}
  local getInfo = C_AuctionHouse.GetCommoditySearchResultInfo
  for i = 1, num do
    local okInfo, info = pcall(getInfo, itemId, i)
    if okInfo and info then
      local price = info.unitPrice or info.minPrice or 0
      local qty = info.quantity or info.totalQuantity or 0
      if price > 0 and qty > 0 then tiers[price] = (tiers[price] or 0) + qty end
    end
  end
  if not next(tiers) then return nil end
  return tiers
end

local function readItemTiers(itemKey)
  local getNum = C_AuctionHouse.GetNumItemSearchResults
  if not getNum then return nil end
  local ok, num = pcall(getNum, itemKey)
  if not ok or not num or num == 0 then return nil end
  local tiers = {}
  local getInfo = C_AuctionHouse.GetItemSearchResultInfo
  for i = 1, num do
    local okInfo, info = pcall(getInfo, itemKey, i)
    if okInfo and info then
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

local PRICE_SORTS = {}
if Enum and Enum.AuctionHouseSortOrder and Enum.AuctionHouseSortOrder.Price then
  PRICE_SORTS = { { sortOrder = Enum.AuctionHouseSortOrder.Price, reverseSort = false } }
end

-- ---------- 队列（OnUpdate 驱动） ----------

local pending = nil     -- { id, sentAt, retries } 已发送、等待结果
local nextSendAt = 0

local function finish(message)
  state.running = false
  state.queue = {}
  state.pos = 1
  pending = nil
  chat(message)
  if WAHReload and WAHReload.schedule then WAHReload.schedule() end
end

local function advance()
  pending = nil
  state.pos = state.pos + 1
  nextSendAt = GetTime() + MIN_QUERY_GAP
  if state.pos > #state.queue then
    finish(string.format("档位采集完成：%s %d 个物品。请输入 /reload 保存到存档。", WAH.MarketLabel(state.market), state.done))
  end
end

local function trySend(retries)
  if C_AuctionHouse.IsThrottledMessageSystemReady and not C_AuctionHouse.IsThrottledMessageSystemReady() then
    return
  end
  local id = state.queue[state.pos]
  local ok, err = pcall(C_AuctionHouse.SendSearchQuery, makeItemKey(id), PRICE_SORTS, false)
  if ok then
    pending = { id = id, sentAt = GetTime(), retries = retries or 0 }
  else
    chat("查询失败 itemId=" .. tostring(id) .. " (" .. tostring(err) .. ")，跳过。")
    advance()
  end
end

local function onResults(kind, arg)
  if not (state and state.running and pending) then return end
  local itemId = pending.id
  local tiers
  if kind == "commodity" then
    if arg ~= itemId then return end
    tiers = readCommodityTiers(itemId)
  else
    if type(arg) ~= "table" or arg.itemID ~= itemId then return end
    tiers = readItemTiers(arg)
  end
  if tiers then
    saveItemTiers(state.market, itemId, tiers)
    state.done = state.done + 1
    if state.done % PROGRESS_EVERY == 0 then
      chat(string.format("进度 %d/%d（已采集 %d）", state.pos, #state.queue, state.done))
    end
  end
  advance()
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("COMMODITY_SEARCH_RESULTS_UPDATED")
frame:RegisterEvent("ITEM_SEARCH_RESULTS_UPDATED")
frame:RegisterEvent("AUCTION_HOUSE_CLOSED")
frame:SetScript("OnEvent", function(_, event, arg)
  if event == "COMMODITY_SEARCH_RESULTS_UPDATED" then
    onResults("commodity", arg)
  elseif event == "ITEM_SEARCH_RESULTS_UPDATED" then
    onResults("item", arg)
  elseif event == "AUCTION_HOUSE_CLOSED" and state and state.running then
    state.running = false
    pending = nil
    chat(string.format("拍卖行已关闭，采集暂停（%d/%d）。重新打开后 /wahscan resume 续扫。", state.pos, #state.queue))
  end
end)

frame:SetScript("OnUpdate", function()
  if not (state and state.running) then return end
  local t = GetTime()
  if pending then
    if t - pending.sentAt > QUERY_TIMEOUT then
      if pending.retries < MAX_RETRIES then
        trySend(pending.retries + 1)
      else
        advance()
      end
    end
  elseif t >= nextSendAt then
    trySend(0)
  end
end)

local function startQueue(market, ids, label)
  state.market = market
  state.queue = ids
  state.pos = 1
  state.done = 0
  state.running = true
  pending = nil
  nextSendAt = 0
  chat(string.format("%s：%s %d 个物品（约 %.0f 秒）。请保持拍卖行打开。",
    label, WAH.MarketLabel(market), #ids, #ids * (MIN_QUERY_GAP + 0.1)))
end

-- ---------- 候选清单 ----------

local function isFresh(market, id, cutoff)
  local last = marketStore(market)[tostring(id)]
  return last and last.t and last.t >= cutoff
end

local function onSale(block)
  return type(block) == "table" and block.m and block.m > 0
end

-- 7 日最低价中位数（Auctionator 天数键是字符串 "2511"，数字/字符串都收——勿改回，见 AI.md §6.1）
local function median7(block)
  local dayList = {}
  for day, low in pairs(block.l or {}) do
    local d = tonumber(day)
    if d and low and low > 0 then dayList[#dayList + 1] = { d = d, v = low } end
  end
  table.sort(dayList, function(a, b) return a.d < b.d end)
  local lows = {}
  for i = math.max(1, #dayList - 6), #dayList do lows[#lows + 1] = dayList[i].v end
  if #lows == 0 then return nil end
  table.sort(lows)
  return lows[math.ceil(#lows / 2)]
end

-- 补档候选：优先网页下发的精确清单 WAH_TIER_LIST（TierList.lua：中间材料 + 雷达池
-- 利润前 N）；清单缺失时按价格历史粗略近似（必赚：最低价 < NPC 收购价；潜在捡漏：
-- 7 日中位 × 0.95 − 最低价 ≥ 50c）。都与"当前在售 + 4 小时新鲜度"取交集。
local function collectCandidates(market)
  local candidates = {}
  local slotData = WAH.PriceSlotFor(market)
  if type(slotData) ~= "table" then return candidates end
  local cutoff = now() - TIER_TTL

  if type(WAH_TIER_LIST) == "table" then
    for id in pairs(WAH_TIER_LIST) do
      if onSale(slotData[tostring(id)]) and not isFresh(market, id, cutoff) then
        candidates[#candidates + 1] = id
      end
    end
  else
    local vendorScans = WAHVendorDB and WAHVendorDB.scans or {}
    for k, block in pairs(slotData) do
      local id = tonumber(k)
      if id and onSale(block) and not isFresh(market, id, cutoff) then
        local vendor = vendorScans[tostring(id)]
        if vendor and vendor.p and vendor.p > block.m then
          candidates[#candidates + 1] = id
        else
          local med = median7(block)
          if med and med * 0.95 - block.m >= 50 then candidates[#candidates + 1] = id end
        end
      end
    end
  end
  table.sort(candidates)
  return candidates
end

-- 当前市场全部在售普通物品 + WAH_TRANSCRIPT_EXTRA 白名单（/wahscan start 全量用）。
local function collectAllItemIds(market)
  local ids, seen = {}, {}
  local slotData = WAH.PriceSlotFor(market)
  if type(slotData) == "table" then
    for k, block in pairs(slotData) do
      local id = tonumber(k)
      if id and not seen[id] and onSale(block) then
        seen[id] = true
        ids[#ids + 1] = id
      end
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

local function resolveMarket(market)
  return market or WAH.CurrentMarket or WAH.DetectMarket()
end

-- 扫描完成后由 Hooks.lua 在安全帧里调用。
function WAH.StartTierBackfill(market)
  if not state then return end
  if state.running then
    chat("补档跳过：已有采集队列在运行。")
    return
  end
  market = resolveMarket(market)
  if market == nil then
    chat("补档跳过：无法识别当前市场。")
    return
  end
  local candidates = collectCandidates(market)
  if #candidates == 0 then
    chat("补档跳过：没有需要更新档位的候选物品（4 小时内已采过或不在售）。")
    return
  end
  startQueue(market, candidates, "正在补档")
end

-- ---------- 聊天命令 ----------

SLASH_WAHSCAN1 = "/wahscan"
SlashCmdList.WAHSCAN = function(msg)
  if not state then return end
  local cmd = strtrim((msg or ""):lower())
  if cmd == "start" or cmd == "start fresh" or cmd == "fresh" then
    if state.running then
      chat("采集已在运行中（/wahscan status 查看进度）。")
      return
    end
    local market = resolveMarket()
    if market == nil then
      chat("无法识别当前市场，已取消（/wahmarket 查看或手动指定）。")
      return
    end
    local ids = collectAllItemIds(market)
    if #ids == 0 then
      chat("未找到物品清单：请先点「扫描拍卖行」扫一遍。")
      return
    end
    startQueue(market, ids, "开始全量采集")
  elseif cmd == "backfill" then
    WAH.StartTierBackfill()
  elseif cmd == "resume" then
    if #state.queue == 0 or state.pos > #state.queue then
      chat("没有可续扫的队列，请 /wahscan backfill 或 /wahscan start。")
    elseif state.market and resolveMarket() ~= state.market then
      chat("队列属于" .. WAH.MarketLabel(state.market) .. "，当前不在该市场的拍卖行，已取消（防止混槽）。")
    else
      state.running = true
      pending = nil
      nextSendAt = 0
      chat(string.format("续扫 %d/%d。", state.pos, #state.queue))
    end
  elseif cmd == "stop" then
    if state.running then
      state.running = false
      pending = nil
      chat(string.format("已暂停（%d/%d）。/wahscan resume 续扫。", state.pos, #state.queue))
    else
      chat("当前没有在运行的采集。")
    end
  elseif cmd == "status" or cmd == "" then
    if state.running then
      chat(string.format("运行中：%s %d/%d，已采集 %d 个。", WAH.MarketLabel(state.market), state.pos, #state.queue, state.done))
    else
      chat(string.format("未运行。队列 %d/%d。", state.pos, #state.queue))
    end
  else
    chat("用法：/wahscan backfill（补候选档位）| start（当前市场全部在售物品）| stop | resume | status")
  end
end
