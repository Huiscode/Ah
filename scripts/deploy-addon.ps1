# ============================================================================
# deploy-addon.ps1 - 把仓库里的插件同步到游戏目录（2026-11-20）
#
#   addon-wah\WoWderhoiAH-Transcript  ->  AddOns\WoWderhoiAH-Transcript   （每次都同步）
#   addon-auctionator                 ->  AddOns\Auctionator               （仅 -WithAuctionator，
#                                         或检测到游戏里还是旧版"改造 Auctionator"时自动）
#
# 平时 Auctionator 直接用 CurseForge/WowUp 更新即可，本脚本默认不碰它，避免把新版降级。
# 首次切换到旁挂插件时会自动把 WAH* 存档从 Auctionator.lua 迁出（需要关闭游戏）。
#
# 用法：
#   npm run addon:deploy
#   powershell -File scripts\deploy-addon.ps1 [-GameDir <_forever_ 目录>] [-WithAuctionator] [-SkipMigrate]
# ============================================================================
param(
  [string]$GameDir,
  [switch]$WithAuctionator,
  [switch]$SkipMigrate
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Get-DotEnvValue($name) {
  $envFile = Join-Path $root '.env'
  if (-not (Test-Path $envFile)) { return $null }
  foreach ($line in [IO.File]::ReadAllLines($envFile, [Text.Encoding]::UTF8)) {
    if ($line -match "^\s*$name\s*=\s*(.*)$") {
      $value = $Matches[1].Trim().Trim('"').Trim("'")
      return $value -replace '\\\\', '\'
    }
  }
  return $null
}

function Invoke-Robocopy($from, $to, $extra) {
  $rcArgs = @($from, $to, '/MIR', '/NJH', '/NJS', '/NDL', '/NFL', '/NP') + $extra
  & robocopy @rcArgs | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy 失败（$LASTEXITCODE）：$from -> $to" }
}

$svPath = Get-DotEnvValue 'AQ_AUCTIONATOR_SV_PATH'
if (-not $GameDir) {
  if ($svPath -and ($svPath -match '^(.*)\\WTF\\Account\\')) {
    $GameDir = $Matches[1]
  } else {
    throw '无法确定游戏目录：请在 .env 配置 AQ_AUCTIONATOR_SV_PATH，或传 -GameDir "C:\...\_forever_"'
  }
}
$addons = Join-Path $GameDir 'Interface\AddOns'
if (-not (Test-Path $addons)) { throw "找不到插件目录：$addons" }

$gameAuctionator = Join-Path $addons 'Auctionator'
$gameToc = Join-Path $gameAuctionator 'Auctionator.toc'
$isPatched = (Test-Path (Join-Path $gameAuctionator 'Source_Forever\Market.lua')) -or
  ((Test-Path $gameToc) -and (Select-String -Path $gameToc -Pattern 'WAHTranscribeDB' -Quiet))
$wowRunning = [bool](Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^Wow' })

Write-Host '================================================'
Write-Host '  WoWderhoiAH 插件部署'
Write-Host "  游戏目录：$GameDir"
Write-Host '================================================'

if ($isPatched) {
  Write-Host '[!!] 游戏里的 Auctionator 还是旧版改造版（内含 Source_Forever），将同时换成原版。'
  $WithAuctionator = $true
}

# --- 存档迁移：必须在游戏关闭时进行，且要在换掉旧版 Auctionator 之前 ---
if (-not $SkipMigrate) {
  if ($wowRunning) {
    if ($isPatched) {
      throw '游戏正在运行：首次切换需要迁移存档，请先完全退出游戏再运行本脚本。'
    }
    Write-Host '[..] 游戏正在运行，跳过存档迁移检查。'
  } else {
    $node = try { (Get-Command node -ErrorAction Stop).Source } catch { 'C:\Program Files\nodejs\node.exe' }
    $tsx = Join-Path $root 'node_modules\tsx\dist\cli.mjs'
    Push-Location $root
    try {
      & $node $tsx (Join-Path 'scripts' 'migrate-wah-sv.ts')
      if ($LASTEXITCODE -ne 0) { throw '存档迁移失败，已中止部署（游戏目录未改动）。' }
    } finally {
      Pop-Location
    }
  }
}

# --- 旁挂插件 ---
$sidecarSrc = Join-Path $root 'addon-wah\WoWderhoiAH-Transcript'
$sidecarDst = Join-Path $addons 'WoWderhoiAH-Transcript'
# TierList.lua 由 watch 每轮导入生成并直接写进游戏目录，镜像时不能删掉它
Invoke-Robocopy $sidecarSrc $sidecarDst @('/XF', 'TierList.lua')
$tierList = Join-Path $sidecarSrc 'TierList.lua'
if (Test-Path $tierList) { Copy-Item $tierList $sidecarDst -Force }
Write-Host "[ok] 旁挂插件 -> $sidecarDst"

# --- Auctionator（原版） ---
if ($WithAuctionator) {
  Invoke-Robocopy (Join-Path $root 'addon-auctionator') $gameAuctionator @()
  Write-Host "[ok] Auctionator（原版）-> $gameAuctionator"
} else {
  Write-Host '[--] Auctionator 未改动（用 CurseForge/WowUp 正常更新即可）。'
}

Write-Host ''
if ($wowRunning) {
  Write-Host '下一步：新插件需要完全重启游戏客户端才会被识别（/reload 不够）。'
} else {
  Write-Host '下一步：启动游戏，在角色选择界面的「插件」里确认 WoWderhoiAH Transcript 已勾选。'
}
