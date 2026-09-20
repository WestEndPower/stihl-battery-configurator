[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$WorkbookPath
)

$ErrorActionPreference = 'Stop'

function Normalize-Sku {
    param([object]$Value)
    if ($null -eq $Value) { return '' }
    return ([string]$Value).Trim().ToUpperInvariant() -replace '\s+', ' '
}

function Find-HeaderColumn {
    param(
        [Parameter(Mandatory)]$Sheet,
        [Parameter(Mandatory)][string]$Header
    )

    $lastColumn = $Sheet.Cells.Item(1, $Sheet.Columns.Count).End(-4159).Column
    for ($column = 1; $column -le $lastColumn; $column++) {
        if (([string]$Sheet.Cells.Item(1, $column).Value2).Trim() -eq $Header) {
            return $column
        }
    }
    throw "Header '$Header' was not found on worksheet '$($Sheet.Name)'."
}

function Resolve-WorkbookPath {
    param([string]$RequestedPath)

    if ($RequestedPath) {
        $resolved = Resolve-Path -LiteralPath $RequestedPath -ErrorAction Stop
        return $resolved.Path
    }

    $searchRoots = @(
        $PSScriptRoot,
        (Join-Path $env:USERPROFILE 'Desktop'),
        (Join-Path $env:USERPROFILE 'Downloads')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique

    $matches = foreach ($root in $searchRoots) {
        Get-ChildItem -LiteralPath $root -File -Filter 'STIHL-Master*.xlsm' -ErrorAction SilentlyContinue
        Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like '*STIHL*' } |
            ForEach-Object {
                Get-ChildItem -LiteralPath $_.FullName -File -Filter 'STIHL-Master*.xlsm' -ErrorAction SilentlyContinue
            }
    }

    $selected = $matches |
        Where-Object { $_.Name -notlike '*.before-*' } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $selected) {
        throw 'STIHL-Master.xlsm was not found. Run the script again and pass the full workbook path.'
    }

    return $selected.FullName
}

$resolvedWorkbook = Resolve-WorkbookPath $WorkbookPath
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = Join-Path `
    (Split-Path -Parent $resolvedWorkbook) `
    (([IO.Path]::GetFileNameWithoutExtension($resolvedWorkbook)) + ".before-rebate-sync-$timestamp.xlsm")

Copy-Item -LiteralPath $resolvedWorkbook -Destination $backupPath -Force

$excel = $null
$book = $null
$sourceSheet = $null
$targetSheet = $null
$previousCalculation = $null

try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false

    $book = $excel.Workbooks.Open($resolvedWorkbook)
    $previousCalculation = $excel.Calculation
    $excel.Calculation = -4105

    $sourceSheet = $book.Worksheets.Item('products-compatibility')
    $targetSheet = $book.Worksheets.Item('products')

    $book.RefreshAll()
    $excel.CalculateFullRebuild()

    $fields = @(
        'RebateEligible',
        'RebateStartDate',
        'RebateEndDate',
        'RebateToCustomer',
        'RebateToDealer'
    )

    $sourceSkuColumn = Find-HeaderColumn $sourceSheet 'SKU'
    $targetSkuColumn = Find-HeaderColumn $targetSheet 'SKU'

    $sourceColumns = @{}
    $targetColumns = @{}
    foreach ($field in $fields) {
        $sourceColumns[$field] = Find-HeaderColumn $sourceSheet $field
        $targetColumns[$field] = Find-HeaderColumn $targetSheet $field
    }

    $sourceLastRow = $sourceSheet.Cells.Item($sourceSheet.Rows.Count, $sourceSkuColumn).End(-4162).Row
    $targetLastRow = $targetSheet.Cells.Item($targetSheet.Rows.Count, $targetSkuColumn).End(-4162).Row

    $sourceBySku = @{}
    for ($row = 2; $row -le $sourceLastRow; $row++) {
        $sku = Normalize-Sku $sourceSheet.Cells.Item($row, $sourceSkuColumn).Value2
        if (-not $sku) { continue }

        if ($sourceBySku.ContainsKey($sku)) {
            throw "Duplicate SKU '$sku' found on products-compatibility. No changes were saved."
        }

        $values = @{}
        foreach ($field in $fields) {
            $values[$field] = $sourceSheet.Cells.Item($row, $sourceColumns[$field]).Value2
        }
        $sourceBySku[$sku] = $values
    }

    $matchedRows = 0
    $changedCells = 0
    $missingSkus = New-Object System.Collections.Generic.List[string]

    for ($row = 2; $row -le $targetLastRow; $row++) {
        $sku = Normalize-Sku $targetSheet.Cells.Item($row, $targetSkuColumn).Value2
        if (-not $sku) { continue }

        if (-not $sourceBySku.ContainsKey($sku)) {
            $missingSkus.Add($sku)
            continue
        }

        $matchedRows++
        foreach ($field in $fields) {
            $targetCell = $targetSheet.Cells.Item($row, $targetColumns[$field])
            $newValue = $sourceBySku[$sku][$field]
            $oldValue = $targetCell.Value2

            if ([string]$oldValue -ne [string]$newValue) {
                $targetCell.Value2 = $newValue
                $changedCells++
            }
        }
    }

    $book.Save()

    $testSku = 'WB03 011 3611 US'
    $testRow = $null
    for ($row = 2; $row -le $targetLastRow; $row++) {
        if ((Normalize-Sku $targetSheet.Cells.Item($row, $targetSkuColumn).Value2) -eq $testSku) {
            $testRow = $row
            break
        }
    }

    Write-Host ''
    Write-Host 'PASS: STIHL product rebate fields synchronized.' -ForegroundColor Green
    Write-Host "Workbook: $resolvedWorkbook"
    Write-Host "Backup:   $backupPath"
    Write-Host "Matched product rows: $matchedRows"
    Write-Host "Changed rebate cells: $changedCells"
    Write-Host "Products without a compatibility match: $($missingSkus.Count)"

    if ($testRow) {
        $customerRebate = $targetSheet.Cells.Item($testRow, $targetColumns['RebateToCustomer']).Value2
        $dealerRebate = $targetSheet.Cells.Item($testRow, $targetColumns['RebateToDealer']).Value2
        Write-Host "RZ 560 K customer rebate: $customerRebate"
        Write-Host "RZ 560 K dealer reimbursement: $dealerRebate"

        if ([decimal]$customerRebate -ne 500 -or [decimal]$dealerRebate -ne 500) {
            throw 'RZ 560 K rebate validation failed after saving.'
        }
    }
}
finally {
    if ($excel -and $null -ne $previousCalculation) {
        try { $excel.Calculation = $previousCalculation } catch {}
    }

    if ($book) {
        try { $book.Close($false) } catch {}
    }
    if ($excel) {
        try { $excel.Quit() } catch {}
    }

    foreach ($object in @($targetSheet, $sourceSheet, $book, $excel)) {
        if ($null -ne $object) {
            [void][Runtime.InteropServices.Marshal]::ReleaseComObject($object)
        }
    }

    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
