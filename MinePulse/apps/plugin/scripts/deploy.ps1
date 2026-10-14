#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Deploys the MinePulseAgent plugin into the Paper server's plugins folder.

.DESCRIPTION
  Builds the plugin (unless -SkipBuild), copies the jar to
  <ServerDir>/plugins/MinePulseAgent/, and creates config.yml on first deploy.
  A token can be injected with -Token.

  The plugin is only loaded on server start: restart the server afterwards.

.PARAMETER ServerDir
  Root of the Paper server (contains plugins/, logs/, etc.).

.PARAMETER ApiUrl
  Base URL of the MinePulse API written to config.yml.

.PARAMETER Token
  Agent token to write into config.yml. Omit to leave the existing value.

.PARAMETER SkipBuild
  Deploy the existing jar without rebuilding.

.EXAMPLE
  pwsh -File apps/plugin/scripts/deploy.ps1 -Token mp_xxx
#>
[CmdletBinding()]
param(
  [string]$ServerDir = 'D:\JEMZ\Minecraft_Server',
  [string]$ApiUrl = 'http://127.0.0.1:4000',
  [string]$Token,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

$pluginDir = Split-Path -Parent $PSScriptRoot

if (-not $SkipBuild) {
  & (Join-Path $PSScriptRoot 'build.ps1')
  if ($LASTEXITCODE -ne 0) { throw "Build step failed." }
}

$jar = Join-Path $pluginDir 'target\MinePulseAgent-0.1.0.jar'
if (-not (Test-Path $jar)) {
  throw "Plugin jar not found: $jar (run build.ps1 first)."
}

if (-not (Test-Path $ServerDir)) {
  throw "Server directory not found: $ServerDir"
}

# Bukkit/Paper loads plugin jars from plugins/ directly. The folder named after
# the plugin (plugins/MinePulseAgent) is the plugin's *data* folder (config.yml).
$pluginsDir = Join-Path $ServerDir 'plugins'
$dataDir = Join-Path $pluginsDir 'MinePulseAgent'
New-Item -ItemType Directory -Force -Path $pluginsDir | Out-Null
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

$staleJar = Join-Path $dataDir (Split-Path $jar -Leaf)
if (Test-Path $staleJar) {
  Remove-Item $staleJar -Force
  Write-Host "Removed stale jar from data folder"
}

$jarDest = Join-Path $pluginsDir (Split-Path $jar -Leaf)
Copy-Item $jar -Destination $jarDest -Force
Write-Host "Deployed jar -> $jarDest"

$configPath = Join-Path $dataDir 'config.yml'
$template = Join-Path $pluginDir 'src\main\resources\config.yml'

if (-not (Test-Path $configPath)) {
  Copy-Item $template $configPath
  Write-Host "Created config    -> $configPath"
}

$lines = Get-Content $configPath
$rewritten = foreach ($line in $lines) {
  if ($line -match '^api-url:') {
    "api-url: `"$ApiUrl`""
  }
  elseif ($line -match '^agent-token:' -and $Token) {
    "agent-token: `"$Token`""
  }
  else {
    $line
  }
}
# Write UTF-8 without BOM so Minecraft's YAML parser is happy.
[System.IO.File]::WriteAllLines($configPath, $rewritten, (New-Object System.Text.UTF8Encoding($false)))

$hasToken = $Token -or (Select-String -Path $configPath -Pattern '^agent-token:\s*".+"' -Quiet)
Write-Host ""
if (-not $hasToken) {
  Write-Host "NOTE: agent-token is not set yet. Create one with:" -ForegroundColor Yellow
  Write-Host "      npm run create-agent-credential -w @minepulse/api" -ForegroundColor Yellow
  Write-Host "      then re-run this script with -Token <token>." -ForegroundColor Yellow
}
Write-Host "Restart the Paper server to load MinePulseAgent." -ForegroundColor Cyan
