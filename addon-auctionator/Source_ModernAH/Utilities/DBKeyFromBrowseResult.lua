local function IsGear(itemID)
  local classType = select(6, C_Item.GetItemInfoInstant(itemID))
  if classType == nil then
    -- 物品信息未缓存（如中立拍卖行首次扫到的物品）→ 保守按非装备处理，
    -- 避免 IsEquipment(nil) 报错风暴（原版无此保护）。
    return false
  end
  return Auctionator.Utilities.IsEquipment(classType)
end

function Auctionator.Utilities.DBKeyFromBrowseResult(result)
  if result.itemKey.battlePetSpeciesID ~= 0 then
    return {"p:" .. tostring(result.itemKey.battlePetSpeciesID)}
  elseif IsGear(result.itemKey.itemID) and result.itemKey.itemLevel >= Auctionator.Constants.ITEM_LEVEL_THRESHOLD then
    return {
      "g:" .. result.itemKey.itemID .. ":" .. result.itemKey.itemLevel,
      tostring(result.itemKey.itemID)
    }
  else
    return {tostring(result.itemKey.itemID)}
  end
end
