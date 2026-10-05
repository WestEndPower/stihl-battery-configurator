[CmdletBinding()]
param(
    [string]$Repository = 'C:\NMWEPE\GitHub\stihl configurator\stihl-battery-configurator',
    [string]$MarketplaceRepository = 'C:\NMWEPE\GitHub\westendpower-marketplace-public',
    [switch]$NoPause
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'STIHL-Publish-Common.ps1')
function Assert-GitRepository([string]$Path) {
    Push-Location -LiteralPath $Path
    try {
        $null = & git rev-parse --show-toplevel
        if ($LASTEXITCODE -ne 0) { throw "Not a Git repository: $Path" }
        $null = & git symbolic-ref --quiet --short HEAD
        if ($LASTEXITCODE -ne 0) { throw "Repository has a detached HEAD: $Path" }
        $null = & git rev-parse --abbrev-ref --symbolic-full-name '@{u}'
        if ($LASTEXITCODE -ne 0) { throw "Repository has no upstream branch: $Path" }
        $null = & git remote get-url origin
        if ($LASTEXITCODE -ne 0) { throw "Repository has no origin remote: $Path" }
    } finally { Pop-Location }
}
function Commit-And-Push([string]$Path, [string]$Label) {
    Push-Location -LiteralPath $Path
    try {
        Write-Host "`n$Label" -ForegroundColor Cyan
        & git status --short
        if ($LASTEXITCODE -ne 0) { throw "$Label git status failed." }
        & git add -A
        if ($LASTEXITCODE -ne 0) { throw "$Label git add failed." }
        $staged = @(& git diff --cached --name-only)
        if ($LASTEXITCODE -ne 0) { throw "$Label staged-change check failed." }
        if ($staged.Count -gt 0) {
            & git commit -m ("Update $Label " + (Get-Date -Format 'yyyy-MM-dd HH:mm'))
            if ($LASTEXITCODE -ne 0) { throw "$Label git commit failed." }
        } else { Write-Host 'No new changes to commit. Checking push anyway.' }
        & git push
        if ($LASTEXITCODE -ne 0) { throw "$Label git push failed. Run this button again to retry." }
    } finally { Pop-Location }
}
try {
    Assert-GitRepository $Repository
    Assert-GitRepository $MarketplaceRepository
    Assert-MarketplaceReady $MarketplaceRepository
    Sync-STIHLMarketplace -Repository $Repository -MarketplaceRepository $MarketplaceRepository
    $queueScript = Join-Path $Repository 'Build-STIHL-Webstore-Sync-Queue.ps1'
    if (Test-Path -LiteralPath $queueScript) {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $queueScript -Repository $Repository
        if ($LASTEXITCODE -ne 0) { throw 'Webstore sync queue build failed.' }
    }
    Commit-And-Push $Repository 'STIHL configurator'
    Commit-And-Push $MarketplaceRepository 'West End Marketplace'
    Write-Host "`nPASS: Both repositories committed and pushed." -ForegroundColor Green
    if (-not $NoPause) { Read-Host 'Press Enter to close' | Out-Null }
    exit 0
} catch {
    Write-Host "`nFAILED: $($_.Exception.Message)" -ForegroundColor Red
    if (-not $NoPause) { Read-Host 'Press Enter to close' | Out-Null }
    exit 1
}
