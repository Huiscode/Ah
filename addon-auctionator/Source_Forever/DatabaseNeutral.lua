-- WoWderhoiAH Forever 模块：中立市场独立价格库（2026-10-15）
--
-- 联盟与中立是两个独立市场，价格数据严禁混入同一槽（用户拍板）。
-- 中立全量扫描写入 AUCTIONATOR_PRICE_DATABASE["PvP_N"]（与联盟槽 "PvP" 并列），
-- 由 FullScan EndProcessing 按 Auctionator.Forever.CurrentScanMarket 路由。
-- 懒创建：首次需要时才建 mixin 实例（AUCTIONATOR_PRICE_DATABASE 由 SavedVariables 提供）。

Auctionator.Forever = Auctionator.Forever or {}

local NEUTRAL_SLOT = "PvP_N"

local function GetDatabaseNeutral()
  if Auctionator.Forever.DatabaseNeutral == nil then
    local raw = AUCTIONATOR_PRICE_DATABASE[NEUTRAL_SLOT]
    if type(raw) == "string" then
      -- Auctionator 启动后会把非当前服务器的 table 槽编码成 CBOR 字符串
      -- （Source/Variables/Main.lua 的 C_Timer.After(0) 串行化循环），重载后
      -- PvP_N 在存档里就是字符串；这里解码回表再用。
      local success, data
      if C_EncodingUtil and C_EncodingUtil.DeserializeCBOR then
        success, data = pcall(C_EncodingUtil.DeserializeCBOR, raw)
      else
        local LibCBOR = LibStub and LibStub("LibCBOR-1.0")
        if LibCBOR then
          success, data = pcall(LibCBOR.Deserialize, LibCBOR, raw)
        else
          success, data = false, nil
        end
      end
      raw = (success and type(data) == "table") and data or {}
      AUCTIONATOR_PRICE_DATABASE[NEUTRAL_SLOT] = raw
    elseif raw == nil then
      raw = {}
      AUCTIONATOR_PRICE_DATABASE[NEUTRAL_SLOT] = raw
    end
    Auctionator.Forever.DatabaseNeutral = CreateAndInitFromMixin(
      Auctionator.DatabaseMixin,
      raw
    )
  end
  return Auctionator.Forever.DatabaseNeutral
end
Auctionator.Forever.GetDatabaseNeutral = GetDatabaseNeutral
Auctionator.Forever.NEUTRAL_SLOT = NEUTRAL_SLOT

-- 按当前市场选目标价格库（faction → 主库；neutral → 中立库；未知 → 主库）
function Auctionator.Forever.DatabaseForCurrentScan()
  local market = Auctionator.Forever.CurrentScanMarket
  if market == nil then
    market = Auctionator.Forever.DetectMarket()
  end
  if market == "neutral" then
    return GetDatabaseNeutral()
  end
  return Auctionator.Database
end
