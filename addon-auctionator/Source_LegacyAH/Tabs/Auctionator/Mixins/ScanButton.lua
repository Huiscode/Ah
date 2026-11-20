AuctionatorScanButtonMixin = {}

-- 单按钮设计（2026-11-16 用户拍板）：一个"扫描拍卖行"按钮，点击时由
-- Market.lua 按地点自动判定市场（联盟主城→faction/PvP；中立营地→neutral/PvP_N）。
function AuctionatorScanButtonMixin:OnClick()
  if Auctionator.Forever and Auctionator.Forever.ScanButtonOnClick then
    Auctionator.Forever.ScanButtonOnClick(self)
    return
  end
  Auctionator.State.FullScanFrameRef:InitiateScan()
end
