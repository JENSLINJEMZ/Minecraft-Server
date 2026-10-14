#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Builds the MinePulseAgent Paper plugin.

.DESCRIPTION
  Paper 26.3 ships Java 25 bytecode, so the plugin must be compiled with a
  JDK 25 toolchain. This script locates a suitable JDK (env JAVA_HOME, a
  -JavaHome argument, or common install locations) and drives the bundled
  Maven.

.PARAMETER JavaHome
  Explicit path to a JDK 25 installation.

.PARAMETER SkipTests
  Skip the JUnit test run.

.EXAMPLE
  pwsh -File apps/plugin/scripts/build.ps1
#>
[CmdletBinding()]
param(
  [string]$JavaHome,
  [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'

$pluginDir = Split-Path -Parent $PSScriptRoot
$repoRoot = Resolve-Path (Join-Path $pluginDir '..\..')
$mvn = Join-Path $repoRoot 'tools\apache-maven-3.9.9\bin\mvn.cmd'

function Resolve-Jdk25 {
  param([string]$Preferred)

  $candidates = New-Object System.Collections.Generic.List[string]
  if ($Preferred) { $candidates.Add($Preferred) }
  if ($env:JAVA_HOME) { $candidates.Add($env:JAVA_HOME) }
  $globs = @(
    (Join-Path $env:USERPROFILE '.jdks\*'),
    'C:\Program Files\Java\*',
    'C:\Program Files\Eclipse Adoptium\*',
    'C:\Program Files\Microsoft\*',
    'C:\Program Files\Amazon Corretto\*',
    'C:\Program Files\Zulu\*'
  )
  foreach ($glob in $globs) {
    Get-ChildItem $glob -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '(^|[^0-9])25([^0-9]|$)' } |
      ForEach-Object { $candidates.Add($_.FullName) }
  }

  foreach ($candidate in $candidates) {
    $javac = Join-Path $candidate 'bin\javac.exe'
    if (-not (Test-Path $javac)) { continue }
    $version = (& $javac -version 2>&1) -join ' '
    if ($version -match 'javac 25') {
      return (Resolve-Path $candidate).Path
    }
  }
  return $null
}

if (-not (Test-Path $mvn)) {
  throw "Bundled Maven not found at: $mvn"
}

$jdk = Resolve-Jdk25 -Preferred $JavaHome
if (-not $jdk) {
  throw "Could not find a JDK 25. Paper 26.3 requires Java 25 bytecode. Install one or pass -JavaHome <path>."
}

Write-Host "Using JDK : $jdk"
Write-Host "Using Maven: $mvn"
$env:JAVA_HOME = $jdk

$mvnArgs = @('-B', '-ntp', '-f', (Join-Path $pluginDir 'pom.xml'), 'clean', 'package')
if ($SkipTests) { $mvnArgs += '-DskipTests' }

& $mvn @mvnArgs
if ($LASTEXITCODE -ne 0) {
  throw "Maven build failed (exit $LASTEXITCODE)."
}

$jar = Join-Path $pluginDir 'target\MinePulseAgent-0.1.0.jar'
if (-not (Test-Path $jar)) {
  throw "Build reported success but the jar is missing: $jar"
}
Write-Host ""
Write-Host "Built: $jar"
