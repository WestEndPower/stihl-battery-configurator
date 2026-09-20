$ErrorActionPreference = "Stop"

$privateRoot = Join-Path $env:LOCALAPPDATA "WestEndPower\ConfiguratorPrivate"
$source = Join-Path $privateRoot "products.csv"
$brandFolder = Join-Path $privateRoot "STIHL"
$target = Join-Path $brandFolder "products.csv"
$core = Join-Path $PSScriptRoot "Sync-Private-Configurator.Core.ps1"

if (-not (Test-Path $core)) {
    throw "Original STIHL private-sync script was not found."
}

if (-not (Test-Path $source)) {
    throw "Root private products.csv was not found."
}

$rows = @(Import-Csv $source)

if ($rows.Count -eq 0) {
    throw "Root private products.csv contains no products."
}

$headers = @($rows[0].PSObject.Properties.Name)

foreach ($requiredHeader in @(
    "SKU",
    "BrandID",
    "DealerCost",
    "RebateToCustomer",
    "RebateToDealer"
)) {
    if ($requiredHeader -notin $headers) {
        throw "Root private products.csv is missing $requiredHeader."
    }
}

$brands = @(
    $rows |
    ForEach-Object { ([string]$_.BrandID).Trim().ToUpperInvariant() } |
    Where-Object { $_ } |
    Sort-Object -Unique
)

if ($brands.Count -ne 1 -or $brands[0] -ne "STIHL") {
    throw "Private products export was not verified as STIHL. Sync stopped."
}

New-Item -ItemType Directory -Path $brandFolder -Force | Out-Null

$copyRequired =
    -not (Test-Path $target) -or
    (Get-FileHash $source).Hash -ne (Get-FileHash $target).Hash

if ($copyRequired) {
    if (Test-Path $target) {
        Copy-Item $target "$target.before-auto-sync.csv" -Force
    }

    Copy-Item $source $target -Force
    Write-Host "PASS  STIHL private products refreshed  $($rows.Count) rows" `
        -ForegroundColor Green
}
else {
    Write-Host "PASS  STIHL private products already current  $($rows.Count) rows" `
        -ForegroundColor Green
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $core

if ($LASTEXITCODE -ne 0) {
    throw "Private D1 synchronization failed with exit code $LASTEXITCODE."
}