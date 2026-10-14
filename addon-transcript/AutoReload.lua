-- WoWderhoiAH-Transcript v0.2.0：全量扫描后自动重载模块
--
-- 目标：SavedVariables 只在登出/重载时写盘。Auctionator 全量扫描只有
--   几十秒，扫完立刻自动 /reload，让 WAHVendorDB / WAHTranscribeDB /
--   Auctionator 存档一次落盘，网页端即可导入最新数据。
--
-- 触发（双保险，任一命中即生效）：
--   路径一：Auctionator.EventBus:Register 监听 FullScan.ScanComplete 事件；
--   路径二：hook Auctionator.EventBus:Fire，事件名匹配 "get_all_scan_complete"
--           （不依赖我们自己的 listener 是否注册成功，最稳）。
--   schedule() 内做 10 秒防重，双路径同时命中也只重载一次。
--   同时导出 WAHReload.schedule() 供 Transcript.lua 自己的 /wahscan 扫描
--   完成时调用（两套扫描源共用同一落盘机制）。
--
-- 命令：/wahvendor reload on|off|now|delay N|status

local addonName, ns = ...

-- 默认延迟 2 秒（用户拍板）。version 对齐：旧存档可能存过 delaySec=5，
-- 版本不匹配时强制采用新默认，之后用户手动改会保留在存档里。
local DEFAULT_OPTS = { version = 1, autoReload = true, delaySec = 2 }
if type(WAHReloadOpts) ~= "table" or WAHReloadOpts.version ~= DEFAULT_OPTS.version then
  WAHReloadOpts = {
    version = DEFAULT_OPTS.version,
    autoReload = DEFAULT_OPTS.autoReload,
    delaySec = DEFAULT_OPTS.delaySec
  }
end

local function chat(msg)
  if DEFAULT_CHAT_FRAME then
    DEFAULT_CHAT_FRAME:AddMessage("|cff33ffccWAH重载|r: " .. msg)
  end
end

local lastScheduledAt = 0
local function schedule()
  if WAHReloadOpts.autoReload == false then return end
  if InCombatLockdown() then
    chat("扫描完成，但处于战斗状态无法自动重载——脱战后请手动 /reload 保存数据。")
    return
  end
  -- 防重：双路径（listener + hook）同一次扫描会各触发一次，10 秒窗口只放行一次。
  local now = GetTime()
  if lastScheduledAt > 0 and now - lastScheduledAt < 10 then return end
  lastScheduledAt = now
  local delay = tonumber(WAHReloadOpts.delaySec) or 2
  chat(string.format(
    "扫描完成，%d 秒后自动重载界面以保存数据（重载后需重新打开拍卖行；/wahvendor reload off 可关闭）。",
    delay
  ))
  C_Timer.After(delay, function()
    if InCombatLockdown() then
      chat("重载被战斗打断，请手动 /reload 保存数据。")
      return
    end
    ReloadUI()
  end)
end

-- 安装双保险触发。OnUpdate 轮询直到 Auctionator 就绪（插件加载时它可能未完成初始化）。
local initFrame = CreateFrame("Frame")
local function tryInstall()
  if not (Auctionator and Auctionator.EventBus) then return false end
  local bus = Auctionator.EventBus
  -- 路径二（兜底）：hook Fire，捕获全量扫描完成事件名。
  if not bus.__wahHooked then
    local originalFire = bus.Fire
    bus.Fire = function(self, source, eventName, ...)
      if eventName == "get_all_scan_complete" then
        schedule()
      end
      return originalFire(self, source, eventName, ...)
    end
    bus.__wahHooked = true
  end
  -- 路径一（正规）：listener 注册 FullScan.ScanComplete。
  if not bus.__wahListener and Auctionator.FullScan and Auctionator.FullScan.Events then
    bus:Register(
      { ReceiveEvent = function() schedule() end },
      { Auctionator.FullScan.Events.ScanComplete }
    )
    bus.__wahListener = true
  end
  return true
end
initFrame:SetScript("OnUpdate", function(self, elapsed)
  if tryInstall() then
    self:SetScript("OnUpdate", nil)
    chat("自动重载已就绪（延迟 " .. tostring(tonumber(WAHReloadOpts.delaySec) or 2) .. " 秒，扫描完成自动落盘）。")
  end
end)

-- 供 Transcript.lua 调用：/wahscan 扫描完成时也走自动落盘。
WAHReload = { schedule = schedule }

-- 命令：/wahvendor reload on|off|now|delay N|status
local function doCommand(msg)
  local arg = (msg or ""):lower()
  if arg == "reload on" then
    WAHReloadOpts.autoReload = true
    chat("自动重载已开启。")
  elseif arg == "reload off" then
    WAHReloadOpts.autoReload = false
    chat("自动重载已关闭（扫描后需手动 /reload 才能落盘）。")
  elseif arg == "reload now" then
    schedule()
  elseif arg == "reload delay" then
    chat("用法：/wahvendor reload delay N（N = 秒数，如 2）。")
  elseif string.match(arg or "", "^reload delay %d+$") then
    local n = tonumber(string.match(arg, "%d+"))
    WAHReloadOpts.delaySec = n
    chat(string.format("自动重载延迟已设为 %d 秒。", n))
  elseif arg == "reload status" or arg == "status" or arg == "" then
    chat(string.format(
      "自动重载：%s，延迟 %d 秒。",
      WAHReloadOpts.autoReload and "开" or "关",
      tonumber(WAHReloadOpts.delaySec) or 2
    ))
  else
    chat("用法：/wahvendor reload on|off|now|delay N|status")
  end
end

SLASH_WAHVENDOR1 = "/wahvendor"
SlashCmdList.WAHVENDOR = doCommand
