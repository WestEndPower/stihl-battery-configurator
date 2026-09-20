[CmdletBinding()]
param(
    [string]$Repository = "C:\NMWEPE\GitHub\stihl configurator\stihl-battery-configurator"
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $Repository

if (-not (Test-Path ".git")) { throw "Not a Git repository: $Repository" }

Write-Host "STIHL COMMIT & PUSH" -ForegroundColor Cyan
git status --short

git add -A
$staged = git diff --cached --name-only
if (-not $staged) {
    Write-Host "`nNo changes to commit." -ForegroundColor Yellow
    Read-Host "Press Enter to close"
    exit 0
}

$message = "Update STIHL configurator " + (Get-Date -Format "yyyy-MM-dd HH:mm")
git commit -m $message
if ($LASTEXITCODE -ne 0) { throw "git commit failed." }

git push
if ($LASTEXITCODE -ne 0) { throw "git push failed." }

Write-Host "`nPASS: STIHL changes committed and pushed." -ForegroundColor Green
Read-Host "Press Enter to close"
