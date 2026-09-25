-- Settings: SavedVariable-backed options shared across addon files via
-- the private addon namespace (WAH). WoWderhoiAH_Settings is the single
-- authority; every toggle reads/writes it, including /wahauto.
--
-- Route 2: the in-game panel is the AUTHORITY for deal-radar thresholds.
-- Changes land in WAH.settings.radar (persisted in SavedVariables), are
-- applied to WAH.RADAR immediately, and travel to the desktop terminal
-- with the next scan import (watch-savedvars reads settings.radar back).

local ADDON_NAME, WAH = ...
local L = WAH.L

local DEFAULTS = {
  autoScan = false, -- rescan whenever the full-scan (ReplicateItems) cooldown elapses at the AH
  tooltip = true, -- trader section on item tooltips
  chart = true, -- price chart panel beside the auction frame
  verboseScan = false -- per-page progress messages during paged scans
}

WAH.settings = nil -- assigned at ADDON_LOADED once SavedVariables exist

-- Copy the tuned values from settings.radar into the live rule table and
-- tell the trade panel to re-run its radar if it is open.
local function applyRadarSettings()
  local radar = WAH.settings and WAH.settings.radar
  if not radar then return end
  for key, value in pairs(radar) do
    WAH.RADAR[key] = value
  end
  if WAH.radarChanged then WAH.radarChanged() end
end

local loader = CreateFrame("Frame")
loader:RegisterEvent("ADDON_LOADED")
loader:SetScript("OnEvent", function(_, _, name)
  if name ~= ADDON_NAME then return end
  -- Single-variable persistence (WoWderhoiAHDB): the Forever client ignores
  -- multi-variable TOC declarations, so everything lives in one table
  -- and the old global names stay as in-memory aliases.
  WoWderhoiAHDB = WoWderhoiAHDB or {}
  WoWderhoiAH_ScanData = WoWderhoiAHDB.scanData
  WoWderhoiAH_Points = WoWderhoiAHDB.points
  WoWderhoiAH_Settings = WoWderhoiAHDB.settings or {}
  for key, value in pairs(DEFAULTS) do
    if WoWderhoiAH_Settings[key] == nil then WoWderhoiAH_Settings[key] = value end
  end
  -- Radar tunables default to the compiled rules (GeneratedRules.lua) and
  -- persist under settings.radar, so in-game changes survive reloads and
  -- ride along with the next scan import to the desktop terminal.
  if WoWderhoiAH_Settings.radar == nil then
    WoWderhoiAH_Settings.radar = {}
    for key, value in pairs(WAH.RADAR) do
      WoWderhoiAH_Settings.radar[key] = value
    end
  end
  WoWderhoiAHDB.settings = WoWderhoiAH_Settings
  WAH.settings = WoWderhoiAH_Settings
  applyRadarSettings()
end)

-- Exposed for the options panel controls and for the test bed: applies the
-- persisted radar tunables to the live rule table and tells the trade panel
-- to re-run its radar if it is open.
WAH.applyRadarSettings = applyRadarSettings

-- Options panel, Auctionator-style: checkboxes and the radar parameter
-- block live under the standard game Options > AddOns list.
local panel = CreateFrame("Frame", "WoWderhoiAHSettingsPanel")
panel.name = "WoWderhoi AHelper"

-- The AH frame closes whenever the game options open (client behavior),
-- which aborts any running scan and hides the WAH panel. Remember that the
-- AH was up before the settings opened, and when they close, re-open the AH
-- frame and remind the user to scan again.
local ahClosedBySettings = false

local function rememberAhBeforeSettings()
  if AuctionHouseFrame and AuctionHouseFrame:IsShown() then
    ahClosedBySettings = true
  end
end

local function restoreAhAfterSettings()
  if not ahClosedBySettings then return end
  ahClosedBySettings = false
  if AuctionHouseFrame and not AuctionHouseFrame:IsShown() then
    local ok = pcall(function() AuctionHouseFrame:Show() end)
    if ok then
      DEFAULT_CHAT_FRAME:AddMessage("|cff33ff99WAH|r " .. L.SETTINGS_AH_RESTORED)
    end
  end
end

local OPTIONS = {
  { key = "autoScan", label = L.OPT_AUTOSCAN, tip = L.OPT_AUTOSCAN_TIP },
  { key = "tooltip", label = L.OPT_TOOLTIP, tip = L.OPT_TOOLTIP_TIP },
  { key = "chart", label = L.OPT_CHART, tip = L.OPT_CHART_TIP },
  { key = "verboseScan", label = L.OPT_VERBOSE, tip = L.OPT_VERBOSE_TIP }
}

-- Radar tunables. Numeric fields are committed on Enter; checkbox toggles
-- apply immediately. All of them write WAH.settings.radar then re-apply.
local RADAR_NUMERIC = {
  { key = "minProfit", label = L.OPT_R_MINPROFIT, tip = L.OPT_R_MINPROFIT_TIP },
  { key = "minProfitRatio", label = L.OPT_R_RATIO, tip = L.OPT_R_RATIO_TIP },
  { key = "maxDiscount", label = L.OPT_R_MAXDISC, tip = L.OPT_R_MAXDISC_TIP },
  { key = "minAuctions", label = L.OPT_R_MINAUC, tip = L.OPT_R_MINAUC_TIP },
  { key = "minMed7Distinct", label = L.OPT_R_DISTINCT, tip = L.OPT_R_DISTINCT_TIP },
  { key = "minHistory", label = L.OPT_R_HISTORY, tip = L.OPT_R_HISTORY_TIP },
  { key = "supplyShrinkMax", label = L.OPT_R_SHRINK, tip = L.OPT_R_SHRINK_TIP },
  { key = "supplyCap", label = L.OPT_R_CAP, tip = L.OPT_R_CAP_TIP }
}
local RADAR_CHECKS = {
  { key = "supplyShrink", label = L.OPT_R_SUPPLYSHRINK, tip = L.OPT_R_SUPPLYSHRINK_TIP },
  { key = "minAuctionsBoost", label = L.OPT_R_AUCBOOST, tip = L.OPT_R_AUCBOOST_TIP }
}

local function formatRadarValue(value)
  -- Integers stay integers; ratios keep enough precision to be meaningful.
  if math.floor(value) == value then return tostring(value) end
  return string.format("%.2f", value)
end

local function commitRadarField(box, key, tipText)
  local parsed = tonumber(box:GetText())
  if parsed == nil or parsed ~= parsed then -- not a number
    DEFAULT_CHAT_FRAME:AddMessage("|cffff5555WAH|r " .. (tipText or "Radar value must be a number."))
    box:SetText(formatRadarValue(WAH.settings.radar[key]))
    return
  end
  if key == "supplyShrinkMax" and parsed > 0 then parsed = -parsed end -- keep it a shrink
  WAH.settings.radar[key] = parsed
  applyRadarSettings()
  box:SetText(formatRadarValue(parsed))
end

local function syncRadarControls(self)
  local radar = WAH.settings and WAH.settings.radar
  if not radar then return end
  for _, box in ipairs(self.radarBoxes) do
    box:SetText(formatRadarValue(radar[box.radarKey]))
  end
  for _, checkbox in ipairs(self.radarChecks) do
    checkbox:SetChecked(radar[checkbox.radarKey] and true or false)
  end
end

panel:SetScript("OnShow", function(self)
  if self.built then
    for _, checkbox in ipairs(self.checkboxes) do
      checkbox:SetChecked(WAH.settings and WAH.settings[checkbox.settingKey])
    end
    syncRadarControls(self)
    return
  end
  self.built = true
  self.checkboxes = {}
  self.radarBoxes = {}
  self.radarChecks = {}

  local title = self:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
  title:SetPoint("TOPLEFT", 16, -16)
  title:SetText("WoWderhoi AHelper")

  local subtitle = self:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  subtitle:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -6)
  subtitle:SetText(L.OPT_SUBTITLE)

  local anchor = subtitle
  for index, option in ipairs(OPTIONS) do
    local checkbox = CreateFrame("CheckButton", "WoWderhoiAHOption" .. index, self, "InterfaceOptionsCheckButtonTemplate")
    checkbox:SetPoint("TOPLEFT", anchor, "BOTTOMLEFT", 0, index == 1 and -16 or -8)
    checkbox.Text:SetText(option.label)
    checkbox.tooltipText = option.tip
    checkbox.settingKey = option.key
    checkbox:SetChecked(WAH.settings and WAH.settings[option.key])
    checkbox:SetScript("OnClick", function(button)
      WAH.settings[button.settingKey] = button:GetChecked() and true or false
    end)
    self.checkboxes[index] = checkbox
    anchor = checkbox
  end

  local header = self:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
  header:SetPoint("TOPLEFT", anchor, "BOTTOMLEFT", 0, -18)
  header:SetText(L.OPT_RADAR_HEADER)

  local note = self:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  note:SetPoint("TOPLEFT", header, "BOTTOMLEFT", 0, -4)
  note:SetText(L.OPT_RADAR_NOTE)

  anchor = note
  for _, item in ipairs(RADAR_CHECKS) do
    local checkbox = CreateFrame("CheckButton", "WoWderhoiAHRadarCheck" .. item.key, self, "InterfaceOptionsCheckButtonTemplate")
    checkbox:SetPoint("TOPLEFT", anchor, "BOTTOMLEFT", 0, -14)
    checkbox.Text:SetText(item.label)
    checkbox.tooltipText = item.tip
    checkbox.radarKey = item.key
    checkbox:SetChecked(WAH.settings and WAH.settings.radar and WAH.settings.radar[item.key] and true or false)
    checkbox:SetScript("OnClick", function(button)
      WAH.settings.radar[button.radarKey] = button:GetChecked() and true or false
      applyRadarSettings()
    end)
    self.radarChecks[#self.radarChecks + 1] = checkbox
    anchor = checkbox
  end

  for _, item in ipairs(RADAR_NUMERIC) do
    local label = self:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
    label:SetPoint("TOPLEFT", anchor, "BOTTOMLEFT", 0, -16)
    -- Fixed label width: every input box anchors to the label's right edge,
    -- so a fixed width keeps all boxes in one column (anchoring to the box
    -- instead made each row drift right like a staircase).
    label:SetWidth(200)
    label:SetJustifyH("LEFT")
    label:SetWordWrap(false)
    label.tooltipText = item.tip
    label:SetText(item.label)
    local box = CreateFrame("EditBox", "WoWderhoiAHRadarBox" .. item.key, self, "InputBoxTemplate")
    box:SetSize(110, 20)
    box:SetPoint("LEFT", label, "RIGHT", 10, 0)
    box:SetAutoFocus(false)
    box.radarKey = item.key
    box:SetText(WAH.settings and WAH.settings.radar and formatRadarValue(WAH.settings.radar[item.key]) or "")
    box:SetScript("OnEnterPressed", function(self2)
      commitRadarField(self2, self2.radarKey, item.tip)
    end)
    box:SetScript("OnEscapePressed", function(self2)
      self2:SetText(formatRadarValue(WAH.settings.radar[self2.radarKey]))
    end)
    self.radarBoxes[#self.radarBoxes + 1] = box
    anchor = label
  end
end)

if Settings and Settings.RegisterCanvasLayoutCategory then
  local category = Settings.RegisterCanvasLayoutCategory(panel, panel.name)
  Settings.RegisterAddOnCategory(category)
  WAH.openSettings = function()
    rememberAhBeforeSettings()
    Settings.OpenToCategory(category:GetID())
  end
else
  InterfaceOptions_AddCategory(panel)
  WAH.openSettings = function()
    -- Long-standing Blizzard bug: the first call only opens the window
    -- without navigating; calling twice lands on the category.
    rememberAhBeforeSettings()
    InterfaceOptionsFrame_OpenToCategory(panel)
    InterfaceOptionsFrame_OpenToCategory(panel)
  end
end

SLASH_WOWDERHOIAHOPTS1 = "/wahopt"
SlashCmdList["WOWDERHOIAHOPTS"] = function() WAH.openSettings() end

-- The retail Settings framework fires SETTINGS_OPENED/CLOSED; the classic
-- InterfaceOptions panel has no event of its own, so hook its frame as a
-- fallback. Both paths also work when the user opens Options via ESC.
local settingsWatch = CreateFrame("Frame")
pcall(settingsWatch.RegisterEvent, settingsWatch, "SETTINGS_OPENED")
pcall(settingsWatch.RegisterEvent, settingsWatch, "SETTINGS_CLOSED")
settingsWatch:SetScript("OnEvent", function(_, event)
  if event == "SETTINGS_OPENED" then
    rememberAhBeforeSettings()
  elseif event == "SETTINGS_CLOSED" then
    restoreAhAfterSettings()
  end
end)
if InterfaceOptionsFrame then
  InterfaceOptionsFrame:HookScript("OnShow", rememberAhBeforeSettings)
  InterfaceOptionsFrame:HookScript("OnHide", restoreAhAfterSettings)
end
