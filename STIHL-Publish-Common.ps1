function Assert-MarketplaceReady {
    param([string]$MarketplaceRepository)
    foreach ($relative in @('scripts\marketplace-sync.cjs', 'scripts\build-marketplace-catalog.cjs')) {
        $path = Join-Path $MarketplaceRepository $relative
        if (-not (Test-Path -LiteralPath $path)) { throw "Required Marketplace script not found: $path" }
    }
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Node.js was not found.' }
}
function Sync-STIHLMarketplace {
    param([string]$Repository, [string]$MarketplaceRepository)
    Assert-MarketplaceReady $MarketplaceRepository
    $csv = Join-Path $Repository 'data\products.csv'
    if (-not (Test-Path -LiteralPath $csv)) { throw "Export products.csv first: $csv" }
    Push-Location -LiteralPath $MarketplaceRepository
    try {
        & node.exe (Join-Path $MarketplaceRepository 'scripts\marketplace-sync.cjs') stihl $csv
        if ($LASTEXITCODE -ne 0) { throw 'STIHL Marketplace sync failed.' }
        $sourceImages = Join-Path $Repository 'images'
        $destinationImages = Join-Path $MarketplaceRepository 'brands\stihl\images'
        if (Test-Path -LiteralPath $sourceImages) {
            New-Item -ItemType Directory -Path $destinationImages -Force | Out-Null
            Get-ChildItem -LiteralPath $sourceImages -Force | ForEach-Object {
                Copy-Item -LiteralPath $_.FullName -Destination $destinationImages -Recurse -Force
            }
        }
        & node.exe (Join-Path $MarketplaceRepository 'scripts\build-marketplace-catalog.cjs')
        if ($LASTEXITCODE -ne 0) { throw 'Marketplace catalog build failed.' }
    } finally { Pop-Location }
}
