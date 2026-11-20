if WAH.disabled then return end

-- 中立市场独立价格库 + 写入路由（2026-11-20 从改造 Auctionator 迁出）
--
-- 联盟与中立是两个独立市场，价格数据严禁混入同一槽（用户拍板）。
-- 中立数据写入 AUCTIONATOR_PRICE_DATABASE["PvP_N"]（与联盟槽并列），网页导入按槽分流。
--
-- 原版 Auctionator 所有价格写入都走 Auctionator.Database 的 ProcessScan/SetPrice
-- （全量/增量扫描、出售页搜索、购买页刷新）。这里在实例上包一层：当前拍卖行是
-- 中立市场时改写中立库。好处：不改 Auctionator 文件；出售页在中立拍卖行顺手
-- 写入的价格也不再漏进联盟槽（旧版只路由了扫描）。

local NEUTRAL_SLOT = "PvP_N"
WAH.NEUTRAL_SLOT = NEUTRAL_SLOT

local LibCBOR = LibStub and LibStub("LibCBOR-1.0", true)

local function decode(raw)
  local success, data
  if C_EncodingUtil and C_EncodingUtil.DeserializeCBOR then
    success, data = pcall(C_EncodingUtil.DeserializeCBOR, raw)
  elseif LibCBOR then
    success, data = pcall(LibCBOR.Deserialize, LibCBOR, raw)
  end
  if success and type(data) == "table" then return data end
  return {}
end

local neutralInstance = nil

-- 懒创建。原版登录后 C_Timer.After(0) 会把"非当前服务器"的表槽编码成 CBOR 字符串
-- （每次登录一个槽），所以槽里可能是字符串：先解码回表。若槽被替换（实例持有的
-- 表已不是当前槽），重建实例，避免写进一个已脱离存档的旧表。
function WAH.GetDatabaseNeutral()
  local raw = AUCTIONATOR_PRICE_DATABASE[NEUTRAL_SLOT]
  if neutralInstance and raw == neutralInstance.db then
    return neutralInstance
  end
  if type(raw) == "string" then
    raw = decode(raw)
  elseif type(raw) ~= "table" then
    raw = {}
  end
  AUCTIONATOR_PRICE_DATABASE[NEUTRAL_SLOT] = raw
  neutralInstance = CreateAndInitFromMixin(Auctionator.DatabaseMixin, raw)
  return neutralInstance
end

-- 当前是否应写中立库：以"当前打开的拍卖行"为准（AH 打开时识别，关闭时清空）。
local function writingNeutral()
  return WAH.CurrentMarket == "neutral"
end

function WAH.InstallDatabaseRouting()
  local db = Auctionator.Database
  if type(db) ~= "table" or type(db.ProcessScan) ~= "function" then
    return false
  end
  if db.__wahRouted then return true end

  local origProcessScan = db.ProcessScan
  local origSetPrice = db.SetPrice

  -- 中立实例用的是原版 mixin 方法（未包装），不会递归回来。
  db.ProcessScan = function(self, ...)
    if self == db and writingNeutral() then
      local neutral = WAH.GetDatabaseNeutral()
      return neutral:ProcessScan(...)
    end
    return origProcessScan(self, ...)
  end
  db.SetPrice = function(self, ...)
    if self == db and writingNeutral() then
      local neutral = WAH.GetDatabaseNeutral()
      return neutral:SetPrice(...)
    end
    return origSetPrice(self, ...)
  end
  db.__wahRouted = true
  return true
end

-- 当前市场的价格槽数据（补档候选、/wahscan 清单用）。
function WAH.PriceSlotFor(market)
  if market == "neutral" then
    return WAH.GetDatabaseNeutral().db
  end
  local db = Auctionator.Database
  return db and db.db or nil
end
