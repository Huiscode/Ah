AuctionatorScanButtonMixin = {}

-- 单按钮设计（2026-11-16 用户拍板）：一个"扫描拍卖行"按钮，点击时由
-- Market.lua 按地点自动判定市场（联盟主城→faction/PvP；中立营地→neutral/PvP_N），
-- 数据按判定结果分槽。不再区分联盟/中立两个按钮。
function AuctionatorScanButtonMixin:OnClick()
  if Auctionator.Forever and Auctionator.Forever.ScanButtonOnClick then
    Auctionator.Forever.ScanButtonOnClick(self)
    return
  end
  if Auctionator.Config.Get(Auctionator.Config.Options.REPLICATE_SCAN) then
    Auctionator.State.FullScanFrameRef:InitiateScan()
  else
    Auctionator.State.IncrementalScanFrameRef:InitiateScan()
  end
end
