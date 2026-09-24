[CmdletBinding()]
param(
    [string]$Repository = "C:\NMWEPE\GitHub\stihl configurator\stihl-battery-configurator",
    [string]$Workbook = "C:\Users\NM-Office\Desktop\STIHL Configurator\STIHL-Master.xlsm",
    [switch]$Apply,
    [switch]$UseSavedResults,
    [int]$DebugPort = 9335
)

$ErrorActionPreference = 'Stop'
$csvPath = Join-Path $Repository 'data\products.csv'
$mapPath = Join-Path $Repository 'WestEnd-STIHL-Catalog.json'
$nodePath = Join-Path $Repository 'Collect-WestEndSTIHLImages.js'
$reportPath = Join-Path $Repository 'WestEnd-STIHL-Image-Report.csv'
$resultPath = Join-Path $Repository 'WestEnd-STIHL-Image-Results.json'

function Get-EdgePath {
    foreach ($path in @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
    )) {
        if ($path -and (Test-Path -LiteralPath $path)) { return $path }
    }
    throw 'Microsoft Edge was not found.'
}

function Write-CsvNoBom($Rows, [string]$Path) {
    $text = (@($Rows | ConvertTo-Csv -NoTypeInformation) -join "`r`n") + "`r`n"
    [IO.File]::WriteAllText($Path, $text, [Text.UTF8Encoding]::new($false))
}

function Update-WorkbookImages($ImageByModel) {
    if (-not (Test-Path -LiteralPath $Workbook)) { throw "Workbook not found: $Workbook" }
    $excel = $null
    $book = $null
    try {
        $excel = New-Object -ComObject Excel.Application
        $excel.Visible = $false
        $excel.DisplayAlerts = $false
        $book = $excel.Workbooks.Open($Workbook, 0, $false)
        if ($book.ReadOnly) { throw 'Close the STIHL Master workbook in Excel, then run again with -Apply.' }

        $sheet = $null
        $headerRow = 0
        $skuColumn = 0
        $imageColumn = 0
        foreach ($candidate in $book.Worksheets) {
            $limit = [Math]::Min(160, [Math]::Max(100, $candidate.UsedRange.Columns.Count))
            for ($r = 1; $r -le 10; $r++) {
                $sku = 0
                $image = 0
                for ($c = 1; $c -le $limit; $c++) {
                    $heading = ([string]$candidate.Cells.Item($r, $c).Text).Trim()
                    if ($heading -eq 'SKU') { $sku = $c }
                    if ($heading -eq 'ImageURL') { $image = $c }
                }
                if ($sku -and $image) {
                    $sheet = $candidate
                    $headerRow = $r
                    $skuColumn = $sku
                    $imageColumn = $image
                    break
                }
            }
            if ($sheet) { break }
        }
        if (-not $sheet) { throw 'Could not find SKU and ImageURL headers in the STIHL Master workbook.' }

        $updates = 0
        $lastRow = $sheet.UsedRange.Row + $sheet.UsedRange.Rows.Count - 1
        for ($r = $headerRow + 1; $r -le $lastRow; $r++) {
            $sku = ([string]$sheet.Cells.Item($r, $skuColumn).Text).Trim()
            if (-not $sku -or -not $ImageByModel.ContainsKey($sku)) { continue }
            $cell = $sheet.Cells.Item($r, $imageColumn)
            if (([string]$cell.Value2).Trim()) { continue }
            $cell.Value2 = [string]$ImageByModel[$sku]
            $updates++
        }
        $book.Save()
        Write-Host "Workbook ImageURL cells added: $updates"
    }
    finally {
        if ($book) { $book.Close($false) | Out-Null }
        if ($excel) { $excel.Quit() | Out-Null }
        if ($book) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($book) }
        if ($excel) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }
    }
}

foreach ($path in @($csvPath, $mapPath, $nodePath)) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Missing: $path" }
}
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Node.js was not found.' }
$products = @(Import-Csv -LiteralPath $csvPath)
if (-not $products.Count -or -not ($products[0].PSObject.Properties.Name -contains 'ImageURL')) {
    throw 'products.csv is empty or lacks ImageURL.'
}
$map = Get-Content -LiteralPath $mapPath -Raw | ConvertFrom-Json
$selected = @($products | Where-Object {
    ([string]$_.Active).Trim().ToUpperInvariant() -ne 'F' -and
    (([string]$_.Series).Trim().ToUpperInvariant() -eq 'AP' -or
     ([string]$_.System).Trim().ToUpperInvariant() -eq 'AP')
})
$models = @($selected | ForEach-Object { ([string]$_.Model).Trim() } | Where-Object { $_ } | Sort-Object -Unique)
Write-Host "Products read: $($products.Count); AP rows: $($selected.Count); AP models: $($models.Count)"
if (-not $models.Count) {
    throw 'No AP models found in products.csv. Check the Series and System columns; no data was changed.'
}
$tasks = @(foreach ($model in $models) {
    $property = $map.products.PSObject.Properties[$model]
    $urls = if ($property) { @($property.Value | Where-Object { $_ }) } else { @() }
    # Prefer tool-only photography to a picture of a package or battery kit.
    $urls = @($urls | Sort-Object -Property @{Expression={ if ($_ -match 'unit-only|tool-only') { 0 } else { 1 } }}, @{Expression={ $_ }})
    [pscustomobject]@{ model=$model; urls=$urls }
})

if ($UseSavedResults) {
    if (-not (Test-Path -LiteralPath $resultPath)) { throw "Saved image results not found: $resultPath" }
    Write-Host "Using tested image results: $resultPath"
}
else {
    $temp = Join-Path $env:TEMP ('STIHL-Images-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $temp -Force | Out-Null
    $inputPath = Join-Path $temp 'models.json'
    $json = ConvertTo-Json -InputObject $tasks -Depth 8
    if ([string]::IsNullOrWhiteSpace($json)) { throw 'Could not serialize AP model list; no data was changed.' }
    [IO.File]::WriteAllText($inputPath, $json, [Text.UTF8Encoding]::new($false))
    $check = Get-Content -LiteralPath $inputPath -Raw | ConvertFrom-Json
    if (@($check).Count -ne $tasks.Count) { throw 'AP model list verification failed; no data was changed.' }
    $edge = $null
    try {
        $profile = Join-Path $env:LOCALAPPDATA 'WestEndPower\DealerSpikeImageBrowser'
        New-Item -ItemType Directory -Path $profile -Force | Out-Null
        $seed = 'https://www.westendpower.com/new-models/stihl-165'
        $edge = Start-Process -FilePath (Get-EdgePath) -ArgumentList @(
            "--remote-debugging-port=$DebugPort", "--user-data-dir=`"$profile`"",
            '--no-first-run', '--no-default-browser-check', $seed
        ) -PassThru
        & node.exe $nodePath $DebugPort $inputPath $resultPath
        if ($LASTEXITCODE -ne 0) { throw 'Image scan failed; no data was changed.' }
    }
    finally {
        if ($edge -and -not $edge.HasExited) { Stop-Process -Id $edge.Id -Force -ErrorAction SilentlyContinue }
        Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$results = @( (Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json).results )
$byModel = @{}
foreach ($item in $results) { $byModel[[string]$item.model] = $item }
if ($UseSavedResults -and $Apply) {
    $missing = @($models | Where-Object { -not $byModel.ContainsKey($_) })
    if ($missing.Count) { throw "Saved scan is missing current AP models: $($missing -join ', '). No data was changed." }
}
$report = foreach ($product in $selected) {
    $model = ([string]$product.Model).Trim()
    $found = $byModel[$model]
    $existing = ([string]$product.ImageURL).Trim()
    $suggested = if ($found.status -eq 'Matched') { [string]$found.image } else { '' }
    [pscustomobject]@{
        SKU = $product.SKU
        Model = $model
        Status = if ($existing) { 'Existing image retained' } else { [string]$found.status }
        CurrentImageURL = $existing
        ProposedImageURL = if ($existing) { '' } else { $suggested }
        ImageSource = [string]$found.source
        ProductPage = [string]$found.page
    }
}
Write-CsvNoBom $report $reportPath
$proposed = @($report | Where-Object { $_.ProposedImageURL })
Write-Host "AP product families: $($models.Count)"
Write-Host "New image links found: $($proposed.Count) SKUs"
Write-Host "Report: $reportPath"
Write-Host "Results: $resultPath"

if (-not $Apply) {
    Write-Host 'REPORT ONLY. Review the image URLs, then run with -Apply to fill blank ImageURL cells.' -ForegroundColor Yellow
    return
}
if (-not $proposed.Count) { Write-Host 'No new images to apply.'; return }

$proposedBySku = @{}
foreach ($row in $proposed) { $proposedBySku[([string]$row.SKU).Trim()] = [string]$row.ProposedImageURL }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item -LiteralPath $csvPath -Destination "$csvPath.before-images-$stamp" -Force
if (-not (Test-Path -LiteralPath $Workbook)) { throw "Workbook not found: $Workbook" }
Copy-Item -LiteralPath $Workbook -Destination "$Workbook.before-images-$stamp" -Force
Update-WorkbookImages $proposedBySku
foreach ($product in $products) {
    $sku = ([string]$product.SKU).Trim()
    if ($proposedBySku.ContainsKey($sku) -and -not ([string]$product.ImageURL).Trim()) {
        $product.ImageURL = $proposedBySku[$sku]
    }
}
Write-CsvNoBom $products $csvPath
Write-Host 'ImageURL entries saved to the workbook and products.csv. Rebuild the AP page after publishing the data.'
