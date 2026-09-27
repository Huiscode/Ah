-- P0-B: /wahrecipes dumps the player's learned crafting recipes from the
-- trade-skill window into SavedVariables (WoWderhoiAHDB.recipes) so the
-- desktop terminal can price every craft against the live AH snapshot.
--
-- Classic API surface (GetTradeSkillList / GetTradeSkillInfo /
-- GetTradeSkillReagentInfo / GetTradeSkillResultInfo) is read through pcall
-- so a client without the window reports a clear message instead of erroring;
-- the Forever client is a retail 12.x fork, so availability is verified in
-- game (planned risk: "经典 API 可用性需实测").
--
-- Side quest: every recipe entry also dumps the vendor SellPrice (vendorP)
-- of each reagent and product it touches. That is what completes the floor-
-- price dictionary for Forever-only items (重瑟银锭 / Azerothium 锭 / ...):
-- the terminal backfills its vendor-prices data with these once the IDs land.

local ADDON_NAME, WAH = ...
local L = WAH.L

-- Keyed by profession .. "|" .. name so re-running /wahrecipes for the
-- second profession merges instead of replacing the first one's recipes.
local function keyOf(profession, name)
  return tostring(profession) .. "|" .. tostring(name)
end

local function chatMessage(text)
  DEFAULT_CHAT_FRAME:AddMessage("|cff33ff99WAH|r " .. text)
end

-- "|Hitem:123:0:0:0|h[name]|h" -> 123; nil when the link is missing so a
-- reagent without an id (rare client quirk) degrades to itemId 0 instead of
-- dropping the whole recipe.
local function itemIdFromLink(link)
  if type(link) ~= "string" then return nil end
  return tonumber(link:match("item:(%d+)"))
end

-- Vendor SellPrice of one item via the retail item-info API; nil when the
-- client has no cache entry yet or the item is not vendorable (price 0) —
-- either way the floor carries no value and does not ride along.
local function vendorPriceOf(itemId)
  if not itemId or itemId <= 0 then return nil end
  local ok, price = pcall(function()
    return select(11, C_Item.GetItemInfoByID(itemId))
  end)
  if ok and type(price) == "number" and price > 0 then return price end
  return nil
end

-- Reagent or result list of one recipe slot: walks index 1..n until the API
-- returns nil, capturing name / quantity / itemId and the vendor floor.
local function readList(index, infoFn)
  local out = {}
  local slot = 1
  while true do
    local name, texture, count, link = infoFn(index, slot)
    if not name then break end
    local itemId = itemIdFromLink(link)
    local entry = {
      itemId = itemId or 0,
      name = name,
      quantity = count or 1
    }
    if itemId then
      local vendorP = vendorPriceOf(itemId)
      if vendorP then entry.vendorP = vendorP end
    end
    out[#out + 1] = entry
    slot = slot + 1
  end
  return out
end

-- One pass over the currently open profession window: the first header row
-- names the profession (nested headers are sub-groups and must not overwrite
-- it), every non-header row is a recipe with its skill-level requirement.
local function collectOpenWindow()
  local recipes = WoWderhoiAHDB.recipes or {}
  local professionName = nil
  local collected = 0
  local total = GetNumTradeSkills()
  for index = 1, total do
    local ok, skillName, isHeader, isExpanded, skillRank = pcall(GetTradeSkillInfo, index)
    if ok and type(skillName) == "string" then
      if isHeader then
        if not professionName and skillName ~= "" then professionName = skillName end
      elseif skillName ~= "" then
        local profession = professionName or ""
        local key = keyOf(profession, skillName)
        recipes[key] = {
          name = skillName,
          profession = profession,
          skillLevel = skillRank or 0, -- the level required to learn/use this recipe
          reagents = readList(index, GetTradeSkillReagentInfo),
          outputs = readList(index, GetTradeSkillResultInfo)
        }
        collected = collected + 1
      end
    end
  end
  WoWderhoiAHDB.recipes = recipes
  return collected, professionName
end

local function dumpRecipes()
  if WoWderhoiAHDB == nil then WoWderhoiAHDB = {} end
  if type(GetNumTradeSkills) ~= "function" or type(GetTradeSkillInfo) ~= "function" then
    chatMessage(L.RECIPES_API_MISSING)
    return
  end
  local before = 0
  for _ in pairs(WoWderhoiAHDB.recipes or {}) do before = before + 1 end
  local collected, profession = collectOpenWindow()
  if collected == 0 and before == 0 then
    chatMessage(L.RECIPES_EMPTY)
    return
  end
  chatMessage(string.format(
    L.RECIPES_DONE, collected, before + collected,
    profession or L.RECIPES_NO_PROFESSION))
end

SLASH_WOWDERHOIAHRECIPES1 = "/wahrecipes"
SlashCmdList["WOWDERHOIAHRECIPES"] = dumpRecipes
WAH.dumpRecipes = dumpRecipes
