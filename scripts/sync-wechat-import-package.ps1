$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$distRoot = Join-Path $projectRoot 'dist'
$cloudFunctionsDistRoot = Join-Path $projectRoot 'cloudfunctions-dist'
$importProject = Get-ChildItem -LiteralPath $projectRoot -Directory | Where-Object {
  $configPath = Join-Path $_.FullName 'project.config.json'
  if (-not (Test-Path -LiteralPath $configPath)) { return $false }
  try {
    $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    return $config.miniprogramRoot -eq 'miniprogram/'
  } catch {
    return $false
  }
} | Select-Object -First 1

if (-not $importProject) {
  throw 'WeChat DevTools import project was not found.'
}

if (-not (Test-Path -LiteralPath (Join-Path $distRoot 'app.json'))) {
  throw 'WeChat Mini Program build output is missing. Run pnpm build:weapp first.'
}

if (-not (Test-Path -LiteralPath $cloudFunctionsDistRoot)) {
  throw 'Cloud function build output is missing. Run pnpm build:cloudfunctions first.'
}

function Sync-ExactMirror {
  param(
    [Parameter(Mandatory = $true)][string]$SourceRoot,
    [Parameter(Mandatory = $true)][string]$TargetRoot,
    [Parameter(Mandatory = $true)][string]$Label
  )

  if (-not (Test-Path -LiteralPath $TargetRoot)) {
    New-Item -ItemType Directory -Path $TargetRoot -Force | Out-Null
  }

  Copy-Item -Path (Join-Path $SourceRoot '*') -Destination $TargetRoot -Recurse -Force

  $sourceFiles = Get-ChildItem -LiteralPath $SourceRoot -Recurse -File
  $expectedFiles = @{}
  foreach ($file in $sourceFiles) {
    $relativePath = $file.FullName.Substring($SourceRoot.Length).TrimStart('\')
    $expectedFiles[$relativePath.ToLowerInvariant()] = $file.FullName
  }

  $targetFiles = Get-ChildItem -LiteralPath $TargetRoot -Recurse -File
  foreach ($file in $targetFiles) {
    $relativePath = $file.FullName.Substring($TargetRoot.Length).TrimStart('\')
    if (-not $expectedFiles.ContainsKey($relativePath.ToLowerInvariant())) {
      $resolvedTargetRoot = [System.IO.Path]::GetFullPath($TargetRoot).TrimEnd('\') + '\'
      $resolvedFile = [System.IO.Path]::GetFullPath($file.FullName)
      if (-not $resolvedFile.StartsWith($resolvedTargetRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a file outside the import package: $resolvedFile"
      }
      Remove-Item -LiteralPath $resolvedFile -Force
    }
  }

  foreach ($entry in $expectedFiles.GetEnumerator()) {
    $relativePath = $entry.Key
    $sourceFile = $entry.Value
    $targetFile = Join-Path $TargetRoot $relativePath
    if (-not (Test-Path -LiteralPath $targetFile)) {
      throw "$Label verification failed. Missing file: $relativePath"
    }
    $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $sourceFile).Hash
    $targetHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $targetFile).Hash
    if ($sourceHash -ne $targetHash) {
      throw "$Label verification failed. Hash mismatch: $relativePath"
    }
  }

  return $expectedFiles.Count
}

$miniProgramCount = Sync-ExactMirror -SourceRoot $distRoot -TargetRoot (Join-Path $importProject.FullName 'miniprogram') -Label 'Mini Program'
$cloudFunctionCount = Sync-ExactMirror -SourceRoot $cloudFunctionsDistRoot -TargetRoot (Join-Path $importProject.FullName 'cloudfunctions') -Label 'Cloud functions'

Write-Host "WeChat DevTools import package is current: $miniProgramCount Mini Program files, $cloudFunctionCount Cloud Function files." -ForegroundColor Green
