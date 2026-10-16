AuctionatorScanButtonMixin = {}

function AuctionatorScanButtonMixin:OnClick()
  if Auctionator.Forever and Auctionator.Forever.ScanButtonOnClick then
    Auctionator.Forever.ScanButtonOnClick(self, "faction")
    return
  end
  if Auctionator.Config.Get(Auctionator.Config.Options.REPLICATE_SCAN) then
    Auctionator.State.FullScanFrameRef:InitiateScan()
  else
    Auctionator.State.IncrementalScanFrameRef:InitiateScan()
  end
end

AuctionatorNeutralScanButtonMixin = {}

function AuctionatorNeutralScanButtonMixin:OnClick()
  if Auctionator.Forever and Auctionator.Forever.ScanButtonOnClick then
    Auctionator.Forever.ScanButtonOnClick(self, "neutral")
    return
  end
  if Auctionator.Config.Get(Auctionator.Config.Options.REPLICATE_SCAN) then
    Auctionator.State.FullScanFrameRef:InitiateScan()
  else
    Auctionator.State.IncrementalScanFrameRef:InitiateScan()
  end
end
