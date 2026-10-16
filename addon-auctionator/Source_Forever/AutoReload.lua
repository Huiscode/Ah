-- WoWderhoiAH-Transcript AutoReload 并入版（v0.3.0）：扫描完成提示手动 /reload 落盘
--
-- 重要结论（2026-10-16 实证）：无限版客户端（camelot）禁止插件在任何上下文调用
-- ReloadUI——拍卖行开/关都触发黄字"插件导致界面行为失效"，且 ReloadUI 不执行、
-- 数据不落盘（存档文件时间戳验证：扫描后无写盘）。taint.log 为空（非污染问题），
-- 属客户端对插件的受保护操作限制。因此自动 ReloadUI 方案废弃。
--
-- 替代方案：扫描完成 → 提示用户手动输入 /reload 保存数据。
-- 原生命令由游戏执行，不经过插件保护检测：必落盘、无黄字、无 taint。
--
-- 命令：/wahvendor reload on|off|status（on/off 控制"扫描完成提示"开关，默认开）

local addonName, ns = ...

local DEFAULT_OPTS = { version = 2, autoReload = false }
if type(WAHReloadOpts) ~= "table" or WAHReloadOpts.version ~= DEFAULT_OPTS.version then
  WAHReloadOpts = {
    version = DEFAULT_OPTS.version,
    autoReload = DEFAULT_OPTS.autoReload
  }
end

-- 每市场最近扫描完成时间（market → 秒时间戳）：供网页按市场显示真实数据新鲜度。
-- 背景：存档的 TimeOfLastBrowseScan 是全局唯一字段，扫任一市场都会刷新它，
-- 导入时联盟/中立快照共用同一时间戳 → "扫中立后联盟也显示刚刚"的误报。
-- 扫描完成事件触发时记录 CurrentScanMarket 对应市场的时间；Transcript 手动
-- /wahscan 不经过此监听，不会误记。
if type(WAHScanTimes) ~= "table" then WAHScanTimes = {} end

local function chat(msg)
  if DEFAULT_CHAT_FRAME then
    DEFAULT_CHAT_FRAME:AddMessage("|cff33ffccWAH重载|r: " .. msg)
  end
end

local lastScheduledAt = 0
local announced = false

-- 在 EventBus 回调链（可能是受保护链）中被调用——严禁在此 chat()/ReloadUI()！
-- 只做纯状态赋值（GetTime/赋值均为安全操作），提示在下方独立 OnUpdate 帧打印。
local function schedule()
  if WAHReloadOpts.autoReload == false then return end
  if InCombatLockdown() then return end
  -- 防重：同一次扫描多个事件名都会触发 listener，10 秒窗口只放行一次。
  local now = GetTime()
  if lastScheduledAt > 0 and now - lastScheduledAt < 10 then return end
  lastScheduledAt = now
  announced = false
end

-- 独立帧：在安全上下文（普通帧 OnUpdate）打印提示。不做 ReloadUI（无限版禁止）。
local reloadFrame = CreateFrame("Frame")
reloadFrame:SetScript("OnUpdate", function()
  if announced == false and lastScheduledAt > 0 then
    announced = true
    chat("扫描完成。数据已在游戏内记录，请手动输入 /reload 保存到存档（否则网页端不会更新；/wahvendor reload off 可关闭提示）。")
  end
end)

-- 并入 Auctionator：直接安装触发。事件名：LegacyAH = "get_all_scan_complete"，
-- ModernAH = "replicate_scan_complete"，增量扫描 = "full_incremental_scan_complete"。
-- 只用 Auctionator 原生 listener 注册（不 hook EventBus.Fire）。
local function install()
  if not (Auctionator and Auctionator.EventBus) then return end
  local bus = Auctionator.EventBus
  if not bus.__wahListener then
    local names = {}
    if Auctionator.FullScan and Auctionator.FullScan.Events and Auctionator.FullScan.Events.ScanComplete then
      table.insert(names, Auctionator.FullScan.Events.ScanComplete)
    end
    if Auctionator.IncrementalScan and Auctionator.IncrementalScan.Events and Auctionator.IncrementalScan.Events.ScanComplete then
      table.insert(names, Auctionator.IncrementalScan.Events.ScanComplete)
    end
    table.insert(names, "get_all_scan_complete")
    table.insert(names, "replicate_scan_complete")
    table.insert(names, "full_incremental_scan_complete")
    bus:Register(
      { ReceiveEvent = function()
          -- 纯状态赋值（time()/表写），受保护链内安全；与 autoReload 开关无关，始终记录。
          -- 注意：必须用 time()（Unix 秒，与 TimeOfLastBrowseScan 同基准），不能用 GetTime()
          -- （GetTime 是游戏启动以来相对秒，写入会被网页解析成"20741 天前"）。
          if Auctionator.Forever and Auctionator.Forever.CurrentScanMarket then
            WAHScanTimes[Auctionator.Forever.CurrentScanMarket] = time()
          end
          schedule()
        end },
      names
    )
    bus.__wahListener = true
  end
end
install()

-- 供 Transcript.lua 调用：/wahscan 扫描完成时也走同一提示机制。
WAHReload = { schedule = schedule }

-- 命令：/wahvendor reload on|off|status
local function doCommand(msg)
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

SLASH_WAHVENDOR1 = "/wahvendor"
SlashCmdList.WAHVENDOR = doCommand
