param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$projectConfig = Join-Path $projectRoot 'project.config.json'
$distApp = Join-Path $projectRoot 'dist\app.json'
$downloadUrl = 'https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html'

if (-not (Test-Path -LiteralPath $projectConfig)) {
  Write-Host 'Project configuration was not found.' -ForegroundColor Red
  exit 1
}

if (-not (Test-Path -LiteralPath $distApp)) {
  Write-Host 'The WeChat Mini Program build is missing. Run the production build first.' -ForegroundColor Yellow
  exit 1
}

$candidates = @()

$uninstallRoots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)

$installEntries = Get-ItemProperty $uninstallRoots -ErrorAction SilentlyContinue |
  Where-Object { $_.InstallLocation }

foreach ($entry in $installEntries) {
  if ($entry.InstallLocation) {
    $location = [Environment]::ExpandEnvironmentVariables([string]$entry.InstallLocation).Trim().Trim('"')
    if ($location -and (Test-Path -LiteralPath $location)) {
      $candidates += Join-Path $location 'cli.bat'
    }
  }
}

$searchRoots = @(
  (Join-Path ${env:ProgramFiles} 'Tencent'),
  (Join-Path ${env:ProgramFiles(x86)} 'Tencent'),
  $env:LOCALAPPDATA
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

foreach ($root in $searchRoots) {
  $candidates += Get-ChildItem -LiteralPath $root -Filter 'cli.bat' -File -Recurse -Depth 3 -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty FullName
}

$cli = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1

if (-not $cli) {
  if ($CheckOnly) {
    Write-Host 'WeChat DevTools was not found.'
    exit 2
  }
  Write-Host 'WeChat DevTools was not found. Opening the official download page.' -ForegroundColor Yellow
  Write-Host 'Install it, then run this launcher again.'
  Start-Process $downloadUrl
  exit 0
}

if ($CheckOnly) {
  Write-Host $cli
  exit 0
}

Write-Host 'Opening GBA RANGERS in WeChat DevTools...' -ForegroundColor Cyan
& $cli open --project $projectRoot

if ($LASTEXITCODE -ne 0) {
  Write-Host 'Automatic import failed. Import this directory manually in WeChat DevTools:' -ForegroundColor Yellow
  Write-Host $projectRoot
  exit 1
}

Write-Host 'The project was sent to WeChat DevTools.' -ForegroundColor Green
