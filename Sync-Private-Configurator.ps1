$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'Sync-STIHL-Workbook-Private.ps1'
if (-not (Test-Path -LiteralPath $script)) { throw 'Pull the updated STIHL repository before private sync.' }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script
if ($LASTEXITCODE -ne 0) { throw "STIHL private sync stopped with exit code $LASTEXITCODE." }
