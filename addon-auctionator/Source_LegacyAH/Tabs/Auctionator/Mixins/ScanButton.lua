AuctionatorScanButtonMixin = {}

function AuctionatorScanButtonMixin:OnClick()
  if Auctionator.Forever and Auctionator.Forever.ScanButtonOnClick then
    Auctionator.Forever.ScanButtonOnClick(self, "faction")
    return
  end
  Auctionator.State.FullScanFrameRef:InitiateScan()
end

AuctionatorNeutralScanButtonMixin = {}

function AuctionatorNeutralScanButtonMixin:OnClick()
  if Auctionator.Forever and Auctionator.Forever.ScanButtonOnClick then
    Auctionator.Forever.ScanButtonOnClick(self, "neutral")
    return
  end
  Auctionator.State.FullScanFrameRef:InitiateScan()
end
