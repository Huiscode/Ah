-- Trading ledger (Stage D): records our own fills so the desktop terminal can
-- show positions, FIFO cost basis and realized P&L.
--
-- Buys are recorded precisely in-plugin the moment COMMODITY_PURCHASE_SUCCEEDED
-- / AUCTION_HOUSE_PURCHASE_COMPLETED fires (we already know itemID, qty, total).
--
-- Sells and expired listings have no real-time in-game event; the only reliable
-- channel is the mailbox. On MAIL_INBOX_UPDATE we scan the inbox:
--   * money-only header (money > 0, itemCount == 0)  -> a completed sale
--   * header with returned items                    -> an expired / unsold lot
-- Each record gets a stable uid so the importer can dedup on the web side.

local ADDON_NAME, WAH = ...
local L = WAH.L

WAH.ledger = WAH.ledger or {}

local LEDGER_CAP = 20000 -- hard ceiling; oldest records trimmed to bound SavedVariables
local seenMails = {}    -- inbox uid -> true, so we don't re-record the same mail

-- Append a record. kind: "buy" | "sell" | "expired".
local function record(kind, itemId, qty, unitPrice, total, note)
  WoWderhoiAHDB = WoWderhoiAHDB or {}
  WoWderhoiAHDB.ledger = WoWderhoiAHDB.ledger or {}
  local list = WoWderhoiAHDB.ledger
  list[#list + 1] = {
    uid = string.format("%d-%d", time() or 0, #list + 1),
    kind = kind,
    itemId = itemId or 0,
    qty = qty or 0,
    unitPrice = unitPrice or 0,
    total = total or 0,
    ts = time() or 0,
    note = note,
  }
  while #list > LEDGER_CAP do table.remove(list, 1) end
  return list[#list]
end
WAH.LedgerRecord = record

-- --------------------------------------------------------------------------
-- Mailbox scan
-- --------------------------------------------------------------------------
-- Normalize a header for either the C_Inbox table API or the legacy
-- GetInboxHeaderInfo multi-return form. Returns { itemCount, subject, money }.
local function headerInfo(index)
  if C_Inbox and C_Inbox.GetInboxHeaderInfo then
    local ok, info = pcall(C_Inbox.GetInboxHeaderInfo, index)
    if ok and type(info) == "table" then
      return {
        itemCount = info.itemCount or 0,
        subject = info.subject,
        money = info.money or 0,
        cod = info.cod or 0
      }
    end
  end
  if type(GetInboxHeaderInfo) == "function" then
    -- Legacy returns: itemCount, sender, subject, money, cod, ...
    local ok, itemCount, sender, subject, money, cod = pcall(GetInboxHeaderInfo, index)
    if ok then
      return {
        itemCount = type(itemCount) == "number" and itemCount or 0,
        subject = subject,
        money = money or 0,
        cod = cod or 0
      }
    end
  end
  return nil
end

local function inboxCount()
  if C_Inbox and C_Inbox.GetInboxNumItems then
    local ok, n = pcall(C_Inbox.GetInboxNumItems)
    if ok and type(n) == "number" then return n end
  end
  if type(GetInboxNumItems) == "function" then
    local ok, n = pcall(GetInboxNumItems)
    if ok and type(n) == "number" then return n end
  end
  return 0
end

-- Try to recover an itemID from a mail subject (best-effort). The AH sale
-- subject usually names the item; match it against the addon's scan cache.
local function itemIdFromSubject(subject)
  if not subject or WAH.itemIdByName == nil then return nil end
  for name, id in pairs(WAH.itemIdByName) do
    if name and subject:find(name, 1, true) then return id end
  end
  return nil
end

local function scanInbox()
  local count = inboxCount()
  for index = 1, count do
    local info = headerInfo(index)
    if not info then break end
    local money = tonumber(info.money) or 0
    local itemCount = tonumber(info.itemCount) or 0
    local subject = info.subject or ""
    -- Stable per-mail key: subject + money + itemCount + index is enough for a
    -- single-character inbox; re-scans of the same mail are deduped.
    local key = string.format("%s|%d|%d|%d", tostring(subject), money, itemCount, index)
    if not seenMails[key] then
      -- "竞拍获胜" / "物品购入" = a bought item arriving in mail. Buys are
      -- already recorded at purchase-success time; skip these to avoid double
      -- counting.
      local isWin = subject:find("竞拍获胜") or subject:find("物品购入")
      if not isWin then
        if money > 0 and itemCount == 0 then
          -- Money-only mail: treat as a sale. total is gross (copper); the AH
          -- cut is applied at the terminal when computing net.
          record("sell", itemIdFromSubject(subject), 1, money, money, subject)
          seenMails[key] = true
        elseif itemCount > 0 then
          -- Returned items: an expired / unsold lot.
          record("expired", itemIdFromSubject(subject), itemCount, 0, 0, subject)
          seenMails[key] = true
        end
      end
    end
  end
end

local mailFrame = CreateFrame("Frame")
mailFrame:RegisterEvent("MAIL_INBOX_UPDATE")
mailFrame:RegisterEvent("MAIL_SHOW")
mailFrame:SetScript("OnEvent", function(_, event)
  if event == "MAIL_SHOW" then seenMails = {} end
  -- Defer a tick so header data is populated.
  C_Timer.After(0.2, scanInbox)
end)
