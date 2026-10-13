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
--
-- Forever quirk: its GetInboxHeaderInfo prepends an extra value to the classic
-- return list, shifting every field by one. headerInfo() therefore locates the
-- fields by content (the sender name is the anchor) instead of by position.

local ADDON_NAME, WAH = ...
local L = WAH.L

WAH.ledger = WAH.ledger or {}

local LEDGER_CAP = 20000 -- hard ceiling; oldest records trimmed to bound SavedVariables
-- Dedup key -> records made for it. When the client exposes a per-mail id we
-- key on that (exact identity); otherwise we key on subject+money+itemCount
-- and store how many identical mails were recorded, so twin sales at the same
-- price still all count.
local seenMails = {}

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

-- A mailbox-scan bug on Forever once misparsed the shifted GetInboxHeaderInfo
-- layout and wrote expired records with absurd quantities (133890 instead of
-- 0) and the sender name as the subject. Drop those on load so they stop
-- re-uploading to the terminal.
local function pruneGarbage()
  local list = WoWderhoiAHDB and WoWderhoiAHDB.ledger
  if not list or #list == 0 then return end
  local kept = {}
  for i = 1, #list do
    local r = list[i]
    if not (r and r.kind == "expired" and (tonumber(r.qty) or 0) > 10000) then
      kept[#kept + 1] = r
    end
  end
  if #kept ~= #list then WoWderhoiAHDB.ledger = kept end
end
-- NB: pruneGarbage() also runs at the top of every scanInbox() call. The
-- ADDON_LOADED handler alone proved unreliable on Forever (event timing / Saved
-- Variables restore order), so clearing is tied to the mailbox-open path where
-- the DB is definitely populated.

-- --------------------------------------------------------------------------
-- Mailbox scan
-- --------------------------------------------------------------------------
-- Normalize a header for either the C_Inbox table API or the legacy
-- GetInboxHeaderInfo multi-return form. Returns
-- { itemCount, subject, money, cod, mailId }.
local function headerInfo(index)
  if C_Inbox and C_Inbox.GetInboxHeaderInfo then
    local ok, info = pcall(C_Inbox.GetInboxHeaderInfo, index)
    if ok and type(info) == "table" then
      return {
        itemCount = tonumber(info.itemCount) or 0,
        subject = info.subject,
        money = tonumber(info.money) or 0,
        cod = tonumber(info.cod) or 0
      }
    end
  end
  if type(GetInboxHeaderInfo) == "function" then
    local vals = { pcall(GetInboxHeaderInfo, index) }
    if vals[1] then
      -- Forever prepends an extra value to the classic return list, shifting
      -- every field by one. The sender name ("联盟拍卖行" / "Auction House")
      -- is the anchor: it always sits one slot before the subject in both
      -- layouts, so locate it by content and derive the rest from there.
      local senderIdx
      for i = 2, #vals do
        local v = vals[i]
        if type(v) == "string" and (v:find("拍卖行") or v:find("Auction House")) then
          senderIdx = i
          break
        end
      end
      if senderIdx then
        local subject, money
        for i = senderIdx + 1, #vals do
          local v = vals[i]
          local n = tonumber(v)
          if n ~= nil then
            money = n
            break
          elseif not subject and type(v) == "string" then
            subject = v
          end
        end
        -- The slot immediately before the sender is NOT reliably the item count
        -- on Forever (it reads as a large message/invoice number ~134xxx). When
        -- the parsed count is implausibly large, pull the real stack size from
        -- the "(N)" suffix in the auction subject ("拍卖已到期：石鳞鳕鱼 (2)").
        local rawCount = tonumber(vals[senderIdx - 1]) or 0
        if rawCount > 1000 and subject then
          local n = subject:match("%((%d+)%)")
          rawCount = n and tonumber(n) or 0
        end
        -- The shifted layout carries a per-mail id right before itemCount;
        -- use it as the dedup key when present.
        local id = vals[senderIdx - 2]
        return {
          itemCount = rawCount,
          subject = subject,
          money = tonumber(money) or 0,
          cod = 0,
          mailId = type(id) == "number" and id or nil
        }
      end
      -- No recognizable sender: classic positional order, but only when the
      -- subject looks like an auction-mail subject -- otherwise the shifted
      -- layout would fabricate records from a player's mail.
      local fallbackSubject = vals[4]
      if type(fallbackSubject) == "string"
        and (fallbackSubject:find("拍卖") or fallbackSubject:find("Auction")
          or fallbackSubject:find("sold") or fallbackSubject:find("won")
          or fallbackSubject:find("expired") or fallbackSubject:find("bought")) then
        return {
          itemCount = tonumber(vals[2]) or 0,
          subject = fallbackSubject,
          money = tonumber(vals[5]) or 0,
          cod = tonumber(vals[6]) or 0
        }
      end
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
-- subject usually names the item; match it against the addon's scan cache,
-- then against our own buy records.
local function itemIdFromSubject(subject)
  if not subject then return nil end
  if WAH.itemIdByName then
    for name, id in pairs(WAH.itemIdByName) do
      if name and subject:find(name, 1, true) then return id end
    end
  end
  local scan = WoWderhoiAH_ScanData and WoWderhoiAH_ScanData.items
  if scan then
    for id, info in pairs(scan) do
      local name = type(info) == "table" and info.name
      if name and subject:find(name, 1, true) then return tonumber(id) end
    end
  end
  local list = WoWderhoiAHDB and WoWderhoiAHDB.ledger
  if list then
    for i = #list, 1, -1 do
      local r = list[i]
      if r and r.kind == "buy" and r.note and r.itemId and subject:find(r.note, 1, true) then
        return r.itemId
      end
    end
  end
  return nil
end

local function scanInbox()
  -- Clear legacy qty>10000 expired garbage before scanning; the ADDON_LOADED
  -- call alone proved unreliable on Forever's event timing.
  pruneGarbage()
  local count = inboxCount()
  local keyCounts = {}
  for index = 1, count do
    local info = headerInfo(index)
    if not info then break end
    local money = tonumber(info.money) or 0
    local itemCount = tonumber(info.itemCount) or 0
    local subject = info.subject or ""
    -- "竞拍获胜" / "物品购入" = a bought item arriving in mail. Buys are
    -- already recorded at purchase-success time; skip these to avoid double
    -- counting.
    if not (subject:find("竞拍获胜") or subject:find("物品购入")) then
      local kind
      if money > 0 and itemCount == 0 then
        kind = "sell"
      elseif itemCount > 0 then
        kind = "expired"
      end
      if kind then
        local want = false
        if info.mailId then
          -- Per-mail id from the shifted layout: exact dedup. Twin mails for
          -- the same item at the same price carry different ids, so they are
          -- all recorded.
          local key = "mail:" .. tostring(info.mailId)
          if not seenMails[key] then
            seenMails[key] = true
            want = true
          end
        else
          -- No per-mail id (classic layout): count identical mails so twin
          -- sales still all get recorded, while re-opens stay deduped.
          local key = string.format("content:%s|%d|%d", tostring(subject), money, itemCount)
          local n = (keyCounts[key] or 0) + 1
          keyCounts[key] = n
          if n > (seenMails[key] or 0) then
            seenMails[key] = n
            want = true
          end
        end
        if want then
          if kind == "sell" then
            -- total is gross (copper); the AH cut is applied at the terminal
            -- when computing net.
            record("sell", itemIdFromSubject(subject), 1, money, money, subject)
          else
            record("expired", itemIdFromSubject(subject), itemCount, 0, 0, subject)
          end
        end
      end
    end
  end
end

local mailFrame = CreateFrame("Frame")
mailFrame:RegisterEvent("ADDON_LOADED")
mailFrame:RegisterEvent("MAIL_INBOX_UPDATE")
mailFrame:RegisterEvent("MAIL_SHOW")
mailFrame:SetScript("OnEvent", function(_, event, arg1)
  if event == "ADDON_LOADED" then
    -- SavedVariables exist only now; drop any legacy qty>10000 expired garbage
    -- that an older build left in the ledger before it gets re-uploaded.
    if arg1 == ADDON_NAME then pruneGarbage() end
    return
  end
  -- Defer a tick so header data is populated. seenMails is deliberately NOT
  -- reset here: reopening the mailbox must not re-record mails that are
  -- already recorded (per-mail ids / per-key counts handle new and twin mail).
  C_Timer.After(0.2, scanInbox)
end)
