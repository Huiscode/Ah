# ============================================================================
# launch-services.ps1 - reliable, hidden, self-logging launcher for the
# WoWderhoiAH terminal.
#
# Starts (if not already running), each fully detached with NO console and
# output redirected to a log file:
#   web           Next.js dev server  (http://localhost:3000)
#   addon-watch   SavedVariables watcher (game scan -> web)
#
# The companion .bat just invokes this script. Logs are in <root>\logs so a
# failed start is diagnosable instead of a silent hidden window.
# ============================================================================

$ErrorActionPreference = 'Stop'

# Resolve the repo root (this script lives in <root>\scripts).
$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# Use the node on PATH (the .bat launches this from a normal user shell).
$node = (Get-Command node -ErrorAction Stop).Source

# A node process is "running" if a node.exe with a matching token exists.
function Test-NodeRunning($token) {
  $found = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$token*" }
  return [bool]$found
}

# Port 3000 is listening (web server health).
function Test-WebPort {
  $line = netstat -ano | Select-String ':3000 .*LISTENING'
  return [bool]$line
}

# Start one service hidden, detached, with captured output.
function Start-ServiceNode($id, $argList, $token) {
  $outLog = Join-Path $logDir "$id.out.log"
  $errLog = Join-Path $logDir "$id.err.log"
  # Remove stale logs from a previous run (handles are free when not running).
  Remove-Item $outLog, $errLog -Force -ErrorAction SilentlyContinue
  Start-Process -FilePath $node -ArgumentList $argList -WorkingDirectory $root `
    -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog
}

Write-Host '================================================'
Write-Host '  WoWderhoiAH - silent one-click launcher'
Write-Host '================================================'

# --- Web server ---
if (Test-WebPort) {
  Write-Host '[ok] Web server already running - skip.'
} else {
  Write-Host '[..] Starting web server (hidden)...'
  Start-ServiceNode 'web' @(
    (Join-Path (Join-Path (Join-Path (Join-Path 'node_modules' 'next') 'dist') 'bin') 'next'),
    'dev', '--webpack'
  ) 'next'
}

# --- Addon watcher ---
if (Test-NodeRunning 'watch-savedvars') {
  Write-Host '[ok] Addon watcher already running - skip.'
} else {
  Write-Host '[..] Starting addon watcher (hidden)...'
  Start-ServiceNode 'addon-watch' @(
    (Join-Path (Join-Path (Join-Path 'node_modules' 'tsx') 'dist') 'cli.mjs'),
    (Join-Path 'scripts' 'watch-savedvars.ts')
  ) 'watch-savedvars'
}

# --- Wait for the web server (port + HTTP) ---
Write-Host ''
Write-Host '[..] Waiting for the web server (max 90s)...'
$deadline = (Get-Date).AddSeconds(90)
$ready = $false
while ((Get-Date) -lt $deadline) {
  if (Test-WebPort) {
    try {
      $resp = Invoke-WebRequest -Uri 'http://localhost:3000' -UseBasicParsing -TimeoutSec 10
      if ($resp.StatusCode -eq 200) { $ready = $true; break }
    } catch {
      # Port open but not serving yet; keep polling.
    }
  }
  Start-Sleep -Seconds 1
}

if ($ready) {
  Write-Host '[ok] Web server is serving.'
  Start-Process 'http://localhost:3000'
} else {
  Write-Host '[!!] Web server did not become ready in 90s.'
  Write-Host "     Check logs under: $logDir"
}

Write-Host ''
Write-Host 'Done. Services run silently in the background.'
Write-Host 'Logs  : <repo>\logs\*.log'
Write-Host 'Stop  : run the stop .bat in this folder'
