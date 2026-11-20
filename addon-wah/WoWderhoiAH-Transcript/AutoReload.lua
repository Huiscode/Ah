if WAH.disabled then return end

-- 扫描完成提示手动 /reload 落盘 + 记录每市场扫描时间
--
-- 重要结论（2026-10-16 实证）：无限版客户端（camelot）禁止插件在任何上下文调用
-- ReloadUI——黄字"插件导致界面行为失效"，且 ReloadUI 不执行、数据不落盘。
-- 因此只提示用户手动输入 /reload（原生命令不经过插件保护检测）。
--
-- 命令：/wahvendor reload on|off|status（控制"扫描完成提示"开关）

local DEFAULT_OPTS = { version = 2, autoReload = false }
WAH.OnSavedVariablesLoaded(function()
  if type(WAHReloadOpts) ~= "table" or WAHReloadOpts.version ~= DEFAULT_OPTS.version then
    WAHReloadOpts = {
      version = DEFAULT_OPTS.version,
      autoReload = DEFAULT_OPTS.autoReload
    }
  end
  -- 每市场最近扫描完成时间（market → Unix 秒）：供网页按市场显示真实数据新鲜度。
  -- 必须用 time()（Unix 秒），不能用 GetTime()（游戏启动以来相对秒，曾被网页解析成"20741 天前"）。
  if type(WAHScanTimes) ~= "table" then WAHScanTimes = {} end
end)

local function chat(msg)
  WAH.chat("WAH重载", msg)
end

local lastScheduledAt = 0
local announced = false

-- 可能在 EventBus 回调链（受保护链）中被调用——严禁在此 chat()/ReloadUI()！
-- 只做纯状态赋值，提示在下方独立 OnUpdate 帧打印。
local function schedule()
  if WAHReloadOpts.autoReload == false then return end
  if InCombatLockdown() then return end
  local now = GetTime()
  if lastScheduledAt > 0 and now - lastScheduledAt < 10 then return end
  lastScheduledAt = now
  announced = false
end

local reloadFrame = CreateFrame("Frame")
reloadFrame:SetScript("OnUpdate", function()
  if announced == false and lastScheduledAt > 0 then
    announced = true
    chat("扫描完成。数据已在游戏内记录，请手动输入 /reload 保存到存档（否则网页端不会更新；/wahvendor reload off 可关闭提示）。")
  end
end)

local bus = Auctionator.EventBus
if bus and not bus.__wahScanTimes then
  bus:Register(
    { ReceiveEvent = function()
        if WAH.CurrentScanMarket then
          WAHScanTimes[WAH.CurrentScanMarket] = time()
        end
        schedule()
      end },
    WAH.ScanCompleteEventNames()
  )
  bus.__wahScanTimes = true
end

-- 供 Transcript.lua 调用：补档完成时也走同一提示机制。
WAHReload = { schedule = schedule }

SLASH_WAHVENDOR1 = "/wahvendor"
SlashCmdList.WAHVENDOR = function(msg)
  local arg = (msg or ""):lower()
  if arg == "reload on" then
    WAHReloadOpts.autoReload = true
    chat("扫描完成提示已开启。")
  elseif arg == "reload off" then
    WAHReloadOpts.autoReload = false
    chat("扫描完成提示已关闭（数据仍会记录，/reload 后保存到存档）。")
  elseif arg == "reload status" or arg == "status" or arg == "" then
    chat(string.format("扫描完成提示：%s。", WAHReloadOpts.autoReload and "开" or "关"))
  else
    chat("用法：/wahvendor reload on|off|status")
  end
end
