$ErrorActionPreference = 'Stop'

$installer = Join-Path $env:TEMP 'wechat_devtools_2.01.2510290_win32_x64.exe'

if (-not (Test-Path -LiteralPath $installer)) {
  Write-Host 'The verified WeChat DevTools installer was not found.' -ForegroundColor Red
  exit 1
}

$file = Get-Item -LiteralPath $installer
if ($file.Length -ne 243209112) {
  Write-Host 'Installer size verification failed.' -ForegroundColor Red
  exit 1
}

$signature = Get-AuthenticodeSignature -LiteralPath $installer
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Tencent Technology') {
  Write-Host 'Tencent digital signature verification failed.' -ForegroundColor Red
  exit 1
}

Write-Host 'Windows will ask for permission. Choose Yes to continue.' -ForegroundColor Cyan
$process = Start-Process -FilePath $installer -ArgumentList '/S' -Verb RunAs -Wait -PassThru
if ($process.ExitCode -ne 0) {
  Write-Host "Installation failed with exit code $($process.ExitCode)." -ForegroundColor Red
  exit 1
}

Write-Host 'WeChat DevTools installation completed.' -ForegroundColor Green
