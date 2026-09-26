[CmdletBinding()]
param(
    [string]$Repository = "C:\NMWEPE\GitHub\stihl configurator\stihl-battery-configurator"
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $Repository

function Clean([object]$Value) {
    if ($null -eq $Value) { return "" }
    return ([string]$Value).Trim()
}

function Is-True([object]$Value) {
    $v = (Clean $Value).ToUpperInvariant()
    return $v -in @("T","TRUE","Y","YES","1","X")
}

function Money([object]$Value) {
    $raw = (Clean $Value) -replace '[$,]', ''
    $n = 0.0
    if ([double]::TryParse($raw, [ref]$n)) { return $n }
    return 0.0
}

function Key([object]$Value) {
    return ((Clean $Value).ToUpperInvariant() -replace '[^A-Z0-9]', '')
}

function First-Value {
    param([object]$Row, [string[]]$Names)
    foreach ($name in $Names) {
        if ($Row.PSObject.Properties.Name -contains $name) {
            $value = Clean $Row.$name
            if ($value) { return $value }
        }
    }
    return ""
}

$mappingPath = Join-Path $Repository "data\webstore-products.csv"
if (-not (Test-Path -LiteralPath $mappingPath)) {
    throw "Missing mapping file: $mappingPath"
}

$mappingRows = @(Import-Csv -LiteralPath $mappingPath)
$mappingByKey = @{}

foreach ($row in $mappingRows) {
    if ((Clean $row.Active) -and -not (Is-True $row.Active)) { continue }
    foreach ($candidate in @($row.SKU, $row.AlternateID)) {
        $k = Key $candidate
        if ($k) { $mappingByKey[$k] = $row }
    }
}

$sources = @(
    @{ Path = "data\products.csv";    Type = "Product";    Alt = @("Model") },
    @{ Path = "data\batteries.csv";   Type = "Battery";    Alt = @("BatteryID","Model") },
    @{ Path = "data\chargers.csv";    Type = "Charger";    Alt = @("ChargerID","Model") },
    @{ Path = "data\accessories.csv"; Type = "Accessory";  Alt = @("Model") },
    @{ Path = "data\attachments.csv"; Type = "Attachment"; Alt = @("Model") },
    @{ Path = "data\parts.csv";       Type = "Part";       Alt = @("Model") }
)

$out = New-Object System.Collections.Generic.List[object]

foreach ($source in $sources) {
    $path = Join-Path $Repository $source.Path
    if (-not (Test-Path -LiteralPath $path)) { continue }

    foreach ($row in @(Import-Csv -LiteralPath $path)) {
        if ((Clean $row.Active) -and -not (Is-True $row.Active)) { continue }

        $sku = Clean $row.SKU
        if (-not $sku) { continue }

        $sale = Money $row.SalePrice
        $msrp = Money $row.MSRP
        $price = if ($sale -gt 0) { $sale } else { $msrp }
        if ($price -le 0) { continue }

        $alternate = First-Value -Row $row -Names $source.Alt
        $description = First-Value -Row $row -Names @("Description","ChargerName","Model","BatteryID")

        $match = $null
        foreach ($candidate in @($sku, $alternate)) {
            $k = Key $candidate
            if ($k -and $mappingByKey.ContainsKey($k)) {
                $match = $mappingByKey[$k]
                break
            }
        }

        $out.Add([pscustomobject]@{
            Status              = if ($match) { "MAPPED" } else { "NEEDS_PSS" }
            ItemType            = $source.Type
            SKU                 = $sku
            AlternateID         = $alternate
            Description         = $description
            Price               = "{0:0.00}" -f $price
            PrivateProductID    = if ($match) { Clean $match.PrivateProductID } else { "" }
            WebstoreProductID   = if ($match) { Clean $match.WebstoreProductID } else { "" }
            CheckoutQuantity    = if ($match -and (Clean $match.CheckoutQuantity)) { Clean $match.CheckoutQuantity } else { "25" }
        })
    }
}

$reportDir = Join-Path $Repository "catalog-link-reports"
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
$reportPath = Join-Path $reportDir "Webstore-Sync-Queue.csv"

$out |
    Sort-Object Status, ItemType, Description, SKU |
    Export-Csv -LiteralPath $reportPath -NoTypeInformation -Encoding UTF8

$mapped = @($out | Where-Object Status -eq "MAPPED").Count
$needed = @($out | Where-Object Status -eq "NEEDS_PSS").Count

Write-Host ""
Write-Host "STIHL WEBSTORE SYNC QUEUE" -ForegroundColor Cyan
Write-Host ("Eligible items : {0}" -f $out.Count)
Write-Host ("Mapped         : {0}" -f $mapped) -ForegroundColor Green
Write-Host ("Needs PSS      : {0}" -f $needed) -ForegroundColor $(if ($needed) { "Yellow" } else { "Green" })
Write-Host ("Report         : {0}" -f $reportPath)

[pscustomobject]@{
    Eligible = $out.Count
    Mapped = $mapped
    NeedsPSS = $needed
    Report = $reportPath
}
