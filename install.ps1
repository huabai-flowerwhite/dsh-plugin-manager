# dsh-plugin-manager — Windows 安装脚本
#
# 作用：把本插件挂载到当前 dsh 部署，启动 dsh 后自动加载（设置页「第三方插件」）。
#   1. 在 $DSH_HOME/profiles/node_modules 下建立 junction 指向本插件目录
#   2. 在 $DSH_HOME/profiles/web/cordis.patch.yml 追加 insert row（幂等，不重复）
#   3. 提示重启 dsh
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File install.ps1
#   （可用 -DshHome <路径> 覆盖 DSH_HOME，默认取 $env:DSH_HOME 或 $env:USERPROFILE\.dsh）

param(
  [string]$DshHome = ''
)

$ErrorActionPreference = 'Stop'

# ---- resolve DSH_HOME ----
if ($DshHome -eq '') { $DshHome = $env:DSH_HOME }
if ($DshHome -eq '') { $DshHome = Join-Path $env:USERPROFILE '.dsh' }
if (-not (Test-Path $DshHome)) {
  Write-Host "ERROR: DSH home not found: $DshHome (set -DshHome or DSH_HOME)" -ForegroundColor Red
  exit 1
}

$pluginName = 'dsh-plugin-manager'
$pluginSource = $PSScriptRoot
$profilesNodeModules = Join-Path $DshHome 'profiles\node_modules'
$target = Join-Path $profilesNodeModules $pluginName
$profileWeb = Join-Path $DshHome 'profiles\web'
$patchFile = Join-Path $profileWeb 'cordis.patch.yml'

Write-Host "DSH home       : $DshHome"
Write-Host "Plugin source  : $pluginSource"

# ---- 1. junction into profiles/node_modules ----
if (-not (Test-Path $profilesNodeModules)) {
  New-Item -ItemType Directory -Path $profilesNodeModules -Force | Out-Null
}
if (Test-Path $target) {
  $item = Get-Item $target -Force
  if ($item.LinkType -eq 'Junction' -and $item.Target -eq $pluginSource) {
    Write-Host "[ok] junction already points at this source: $target" -ForegroundColor Green
  } else {
    Write-Host "WARN: $target exists but is not a junction to this source; leaving it in place." -ForegroundColor Yellow
    Write-Host "      Remove it first if you want this install to manage the link." -ForegroundColor Yellow
  }
} else {
  New-Item -ItemType Junction -Path $target -Target $pluginSource | Out-Null
  Write-Host "[ok] junction created: $target" -ForegroundColor Green
}

# ---- 2. patch insert row (idempotent) ----
$block = @"

# dsh plugin manager — 第三方插件管理器（设置页「第三方插件」）
# 前置：`$DshHome`/profiles/node_modules/$pluginName -> $pluginSource
- insert:
    - id: $pluginName
      name: '$pluginName'
"@

if (-not (Test-Path $patchFile)) {
  New-Item -ItemType Directory -Path $profileWeb -Force | Out-Null
  Set-Content -Path $patchFile -Value $block -Encoding UTF8
  Write-Host "[ok] created $patchFile with insert row" -ForegroundColor Green
} else {
  $text = Get-Content $patchFile -Raw
  if ($text -match "name: '$pluginName'") {
    Write-Host "[ok] insert row already present in $patchFile" -ForegroundColor Green
  } else {
    $sep = if ($text.EndsWith("`n")) { '' } else { "`n" }
    Add-Content -Path $patchFile -Value ($sep + $block) -Encoding UTF8
    Write-Host "[ok] appended insert row to $patchFile" -ForegroundColor Green
  }
}

Write-Host ""
Write-Host "Install complete. Restart dsh, then open Settings -> 第三方插件." -ForegroundColor Cyan
Write-Host "Host half (webServer routes) loads on boot; the settings page loads after restart + browser refresh." -ForegroundColor Cyan
