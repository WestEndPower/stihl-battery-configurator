[CmdletBinding()]
param(
    [string]$Repository = 'C:\NMWEPE\GitHub\stihl configurator\stihl-battery-configurator',
    [string]$Workbook = 'C:\Users\NM-Office\Desktop\STIHL Configurator\STIHL-Master.xlsm',
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$csvPath = Join-Path $Repository 'data\products.csv'
$mapPath = Join-Path $Repository 'WestEnd-STIHL-Catalog.json'
$reportPath = Join-Path $Repository 'STIHL-AP-Product-Links-Review.csv'
foreach ($path in @($csvPath, $mapPath)) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Missing file: $path" }
}
$products = @(Import-Csv -LiteralPath $csvPath)
if (-not $products.Count) { throw 'No products in products.csv.' }
foreach ($column in @('SKU', 'Model', 'System', 'ProductType', 'ProductURL')) {
    if (-not ($products[0].PSObject.Properties.Name -contains $column)) { throw "Missing CSV column: $column" }
}
$catalog = (Get-Content -LiteralPath $mapPath -Raw | ConvertFrom-Json).products

function Select-ProductLink($product, $urls) {
    $urls = @($urls | Where-Object { $_ -match '^https://www\.westendpower\.com/new-models/' } | Select-Object -Unique)
    if ($urls.Count -eq 1) {
        $only = [string]$urls[0]
        $type = ([string]$product.ProductType).Trim()
        if ($type -eq 'Kit' -and $only -match 'unit-only|unit-batt|wo-batt|wout-batt') { return '' }
        if ($type -eq 'Tool' -and $only -match 'set-w|set-battery|w-ap-|wap-|kit-') { return '' }
        return $only
    }
    if ($urls.Count -eq 0) { return '' }
    $type = ([string]$product.ProductType).Trim()
    if ($type -eq 'Tool') {
        $choice = @($urls | Where-Object { $_ -match 'unit-only|unit-batt|wo-batt|wout-batt' })
        if ($choice.Count -eq 1) { return [string]$choice[0] }
    }
    elseif ($type -eq 'Kit') {
        $choice = @($urls | Where-Object { $_ -match 'set-w|set-battery|w-ap-|wap-|kit-' })
        if ($choice.Count -eq 1) { return [string]$choice[0] }
    }
    return ''
}

$proposed = @{}
$report = foreach ($product in $products) {
    if (([string]$product.System).Trim() -ne 'AP') { continue }
    $sku = ([string]$product.SKU).Trim()
    $model = ([string]$product.Model).Trim()
    $existing = ([string]$product.ProductURL).Trim()
    $urls = @()
    if ($model -and $catalog.PSObject.Properties.Name -contains $model) { $urls = @($catalog.$model) }
    $link = if ($existing) { '' } else { Select-ProductLink $product $urls }
    if ($link -and $sku) { $proposed[$sku] = $link }
    [pscustomobject]@{
        SKU = $sku
        Model = $model
        ProductType = $product.ProductType
        Status = if ($existing) { 'Existing link kept' } elseif ($link) { 'Ready to add' } elseif ($urls.Count) { 'Review variant' } else { 'No catalog page' }
        ExistingURL = $existing
        ProposedURL = $link
        CandidateURLs = $urls -join ' | '
    }
}
$report | Export-Csv -LiteralPath $reportPath -NoTypeInformation -Encoding UTF8
Write-Host "AP product links ready: $($proposed.Count)"
Write-Host "Review report: $reportPath"
$report | Group-Object Status | Sort-Object Name | ForEach-Object { Write-Host ("{0}: {1}" -f $_.Name, $_.Count) }
if (-not $Apply) { Write-Host 'PREVIEW ONLY. Run again with -Apply after reviewing the report.'; return }
if (-not $proposed.Count) { Write-Host 'Nothing to add.'; return }
if (-not (Test-Path -LiteralPath $Workbook)) { throw "Workbook not found: $Workbook" }

$excel = $null
$book = $null
try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $book = $excel.Workbooks.Open($Workbook, 0, $false)
    if ($book.ReadOnly) { throw 'Close the STIHL Master workbook in Excel, then try again.' }
    $sheet = $null
    foreach ($candidate in $book.Worksheets) {
        $limit = [Math]::Min(160, [Math]::Max(100, $candidate.UsedRange.Columns.Count))
        for ($r = 1; $r -le 10 -and -not $sheet; $r++) {
            $skuCol = 0; $urlCol = 0
            for ($c = 1; $c -le $limit; $c++) {
                $heading = ([string]$candidate.Cells.Item($r, $c).Text).Trim()
                if ($heading -eq 'SKU') { $skuCol = $c }
                if ($heading -eq 'ProductURL') { $urlCol = $c }
            }
            if ($skuCol -and $urlCol) { $sheet = $candidate; $headerRow = $r; $skuColumn = $skuCol; $urlColumn = $urlCol }
        }
        if ($sheet) { break }
    }
    if (-not $sheet) { throw 'Could not find SKU and ProductURL headings in the workbook.' }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $book.SaveCopyAs("$Workbook.before-ap-links-$stamp")
    Copy-Item -LiteralPath $csvPath -Destination "$csvPath.before-ap-links-$stamp" -ErrorAction Stop
    $workbookCount = 0
    $lastRow = $sheet.UsedRange.Row + $sheet.UsedRange.Rows.Count - 1
    for ($r = $headerRow + 1; $r -le $lastRow; $r++) {
        $sku = ([string]$sheet.Cells.Item($r, $skuColumn).Text).Trim()
        if (-not $sku -or -not $proposed.ContainsKey($sku)) { continue }
        $cell = $sheet.Cells.Item($r, $urlColumn)
        if (([string]$cell.Value2).Trim()) { continue }
        $cell.Value2 = [string]$proposed[$sku]
        $workbookCount++
    }
    $book.Save()
    $csvCount = 0
    foreach ($product in $products) {
        $sku = ([string]$product.SKU).Trim()
        if ($proposed.ContainsKey($sku) -and -not ([string]$product.ProductURL).Trim()) {
            $product.ProductURL = [string]$proposed[$sku]
            $csvCount++
        }
    }
    $content = (@($products | ConvertTo-Csv -NoTypeInformation) -join "`r`n") + "`r`n"
    [IO.File]::WriteAllText($csvPath, $content, [Text.UTF8Encoding]::new($false))
    Write-Host "PASS: Workbook ProductURL cells added: $workbookCount; products.csv ProductURL cells added: $csvCount"
    Write-Host "Backups: $Workbook.before-ap-links-$stamp and $csvPath.before-ap-links-$stamp"
    Write-Host 'ImageURL cells and image files were not changed.'
}
finally {
    if ($book) { $book.Close($false) | Out-Null }
    if ($excel) { $excel.Quit() | Out-Null }
    if ($book) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($book) }
    if ($excel) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }
}
