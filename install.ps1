# install.ps1 — install dsh-plugin-manager into DeepSeek Harness (Windows)
#
# Usage (inside the cloned directory):
#   powershell -ExecutionPolicy Bypass -File install.ps1
#   # or override DSH home / profile:
#   powershell -ExecutionPolicy Bypass -File install.ps1 -DshHome C:\Users\you\.dsh
#   $env:DSH_PROFILE='headless'; powershell -ExecutionPolicy Bypass -File install.ps1
#
# It does two things, idempotently:
#   1. links the package into node_modules:
#        $DSH_HOME/profiles/node_modules/dsh-plugin-manager  ->  this directory
#   2. appends an insert row to $DSH_HOME/profiles/<profile>/cordis.patch.yml
#
# $DSH_HOME defaults to $env:DSH_HOME, else $HOME\.dsh.
# $DSH_PROFILE defaults to 'web'; set it to install into another profile.

param(
  [string]$DshHome = ''
)

$ErrorActionPreference = 'Stop'

# ---- resolve DSH home ----
if ($DshHome -eq '') { $DshHome = $env:DSH_HOME }
if ($DshHome -eq '') { $DshHome = Join-Path $HOME '.dsh' }

$Profile = if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'web' }
$ProfileDir = Join-Path $DshHome "profiles\$Profile"

if (-not (Test-Path $ProfileDir)) {
  Write-Host "[dsh-plugin-manager] profile dir not found: $ProfileDir" -ForegroundColor Yellow
  Write-Host "  Run dsh at least once first (npx dsh web), then re-run this script." -ForegroundColor Yellow
  exit 1
}

# ---- 1) node_modules junction -> plugin directory ----
$PluginDir = $PSScriptRoot
$NodeModules = Join-Path $DshHome 'profiles\node_modules'
if (-not (Test-Path $NodeModules)) { New-Item -ItemType Directory -Path $NodeModules -Force | Out-Null }
$Link = Join-Path $NodeModules 'dsh-plugin-manager'

if (Test-Path $Link) {
  $item = Get-Item $Link -Force
  if ($item.LinkType -eq 'Junction') {
    if ($item.Target -eq $PluginDir) {
      Write-Host "[dsh-plugin-manager] already linked to this directory." -ForegroundColor Green
    } else {
      cmd /c rmdir "$Link" | Out-Null
      New-Item -ItemType Junction -Path $Link -Target $PluginDir | Out-Null
      Write-Host "[dsh-plugin-manager] junction updated -> $PluginDir" -ForegroundColor Green
    }
  } elseif ($item.PSIsContainer) {
    Write-Host "[dsh-plugin-manager] $Link is a real directory (not a junction); remove it manually, then re-run." -ForegroundColor Red
    exit 1
  }
} else {
  New-Item -ItemType Junction -Path $Link -Target $PluginDir | Out-Null
  Write-Host "[dsh-plugin-manager] junction created: $Link -> $PluginDir" -ForegroundColor Green
}

# ---- 2) append insert row to cordis.patch.yml ----
$Patch = Join-Path $ProfileDir 'cordis.patch.yml'
$content = if (Test-Path $Patch) { Get-Content $Patch -Raw } else { '' }

if ($content -match 'id:\s*dsh-plugin-manager') {
  Write-Host "[dsh-plugin-manager] cordis.patch.yml already contains this plugin row; skipped." -ForegroundColor Green
} else {
  $block = "`n# dsh plugin manager - host composition (settings page: third-party plugins)`n- insert:`n    - id: dsh-plugin-manager`n      name: 'dsh-plugin-manager'`n"
  Add-Content -Path $Patch -Value $block
  Write-Host "[dsh-plugin-manager] wrote: $Patch" -ForegroundColor Green
}

Write-Host ""
Write-Host "[dsh-plugin-manager] Install complete." -ForegroundColor Green
Write-Host "  Restart dsh: press Ctrl+C on the running dsh, then run: npx dsh web"
Write-Host "  After restart: Settings -> 第三方插件 page appears (pick a plugin library folder, scan, enable/disable)."
