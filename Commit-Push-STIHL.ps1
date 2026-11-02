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
        foreach ($operation in @('MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD')) {
            $operationPath = & git rev-parse --git-path $operation
            if ($LASTEXITCODE -ne 0) { throw "Cannot check Git operation state: $Path" }
            if (Test-Path -LiteralPath $operationPath) { throw "Finish or abort the existing Git merge/rebase/cherry-pick first: $Path" }
        }
    } finally { Pop-Location }
}
function Commit-LocalChanges([string]$Label) {
    & git add -A
    if ($LASTEXITCODE -ne 0) { throw "$Label git add failed." }
    $staged = @(& git diff --cached --name-only)
    if ($LASTEXITCODE -ne 0) { throw "$Label staged-change check failed." }
    if ($staged.Count -gt 0) {
        & git commit -m ("Update $Label " + (Get-Date -Format 'yyyy-MM-dd HH:mm'))
        if ($LASTEXITCODE -ne 0) { throw "$Label git commit failed." }
    } else { Write-Host 'No new changes to commit. Checking upstream updates.' }
}
function Merge-Upstream([string]$Label, [switch]$Marketplace) {
    $upstream = & git rev-parse --abbrev-ref --symbolic-full-name '@{u}'
    if ($LASTEXITCODE -ne 0 -or $upstream -notlike 'origin/*') { throw "$Label must track an origin branch." }
    & git fetch origin
    if ($LASTEXITCODE -ne 0) { throw "$Label fetch failed. Your local commits are saved; check your connection and GitHub sign-in." }
    $before = & git rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw "$Label HEAD check failed." }
    Write-Host "Bringing in $upstream updates before publishing..."
    & git merge --no-edit $upstream
    if ($LASTEXITCODE -ne 0) {
        $conflicts = @(& git diff --name-only --diff-filter=U)
        if ($LASTEXITCODE -ne 0) { throw "$Label conflict check failed." }
        $unsupported = @($conflicts | Where-Object { $_ -ne 'data/marketplace-catalog.json' -and $_ -notmatch '^brands/stihl/data/[^/]+\.csv$' })
        if (-not $Marketplace -or $conflicts.Count -eq 0 -or $unsupported.Count -gt 0) {
            $mergePath = & git rev-parse --git-path MERGE_HEAD
            if (Test-Path -LiteralPath $mergePath) {
                & git merge --abort
                if ($LASTEXITCODE -ne 0) { throw "$Label merge needs manual attention. Your pre-merge changes were committed. Do not reset the repository." }
            }
            throw "$Label upstream merge stopped. Local changes are committed and retained. Conflicting files: $($conflicts -join ', ')."
        }
        try {
            foreach ($file in $conflicts) {
                # Our workbook exports are authoritative; the combined catalog is rebuilt below.
                $localEntry = @(& git ls-tree --name-only HEAD -- $file)
                if ($LASTEXITCODE -ne 0) { throw "Could not inspect workbook export: $file" }
                if ($localEntry.Count -eq 0) {
                    & git rm --force -- $file
                    if ($LASTEXITCODE -ne 0) { throw "Could not preserve removed workbook export: $file" }
                } else {
                    & git checkout --ours -- $file
                    if ($LASTEXITCODE -ne 0) { throw "Could not preserve workbook export: $file" }
                    & git add -- $file
                    if ($LASTEXITCODE -ne 0) { throw "Could not stage preserved export: $file" }
                }
            }
            & node.exe 'scripts/build-marketplace-catalog.cjs'
            if ($LASTEXITCODE -ne 0) { throw 'Merged Marketplace catalog build failed.' }
            & git add -- 'data/marketplace-catalog.json'
            if ($LASTEXITCODE -ne 0) { throw 'Could not stage rebuilt Marketplace catalog.' }
            & git commit -m 'Merge website updates while preserving STIHL workbook exports'
            if ($LASTEXITCODE -ne 0) { throw 'Marketplace merge commit failed.' }
        } catch {
            $failure = $_
            & git merge --abort
            if ($LASTEXITCODE -ne 0) { throw 'Marketplace merge needs manual attention. Your original changes are committed; do not reset the repository.' }
            throw $failure
        }
    }
    $after = & git rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw "$Label updated HEAD check failed." }
    if ($Marketplace -and $before -ne $after) {
        & node.exe 'scripts/build-marketplace-catalog.cjs'
        if ($LASTEXITCODE -ne 0) { throw 'Marketplace catalog rebuild failed after upstream updates. No push was attempted.' }
        Commit-LocalChanges $Label
    }
}
function Prepare-Repository([string]$Path, [string]$Label, [switch]$Marketplace) {
    Push-Location -LiteralPath $Path
    try {
        Commit-LocalChanges $Label
        Merge-Upstream $Label -Marketplace:$Marketplace
    } finally { Pop-Location }
}
function Commit-And-Push([string]$Path, [string]$Label) {
    Push-Location -LiteralPath $Path
    try {
        Write-Host "`n$Label" -ForegroundColor Cyan
        & git status --short
        if ($LASTEXITCODE -ne 0) { throw "$Label git status failed." }
        Commit-LocalChanges $Label
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            Merge-Upstream $Label -Marketplace:($Label -eq 'West End Marketplace')
            $remoteBefore = & git rev-parse '@{u}'
            if ($LASTEXITCODE -ne 0) { throw "$Label upstream check failed." }
            & git push
            if ($LASTEXITCODE -eq 0) { return }
            & git fetch origin
            if ($LASTEXITCODE -ne 0) { throw "$Label push and follow-up fetch failed. Local commits are saved." }
            $remoteAfter = & git rev-parse '@{u}'
            if ($LASTEXITCODE -ne 0) { throw "$Label upstream recheck failed." }
            if ($remoteBefore -eq $remoteAfter) { throw "$Label push failed. Local commits are saved; check GitHub sign-in and repository permissions." }
            Write-Host 'GitHub changed during publishing. Bringing in the newer updates and retrying.' -ForegroundColor Yellow
        }
        throw "$Label kept changing on GitHub. Local commits are saved. Run this button again."
    } finally { Pop-Location }
}
try {
    Assert-GitRepository $Repository
    Assert-GitRepository $MarketplaceRepository
    Assert-MarketplaceReady $MarketplaceRepository
    Prepare-Repository $Repository 'STIHL configurator'
    Prepare-Repository $MarketplaceRepository 'West End Marketplace' -Marketplace
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

