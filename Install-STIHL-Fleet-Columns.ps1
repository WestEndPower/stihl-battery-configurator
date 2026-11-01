[CmdletBinding()]
param([string]$Workbook = '')

$ErrorActionPreference = 'Stop'
$fields = @('FleetEligible', 'FleetRebateProgram', 'FleetTier1Discount', 'FleetTier1Rebate', 'FleetTier2Discount', 'FleetTier2Rebate', 'FleetPoints')
$targets = [ordered]@{ products = 'tblProducts'; attachments = 'tblAttachments'; accessories = 'tblAccessories'; parts = 'tblParts' }

function Get-Headers($Sheet) {
    $result = @{}
    $last = [int]$Sheet.Cells.Item(1, $Sheet.Columns.Count).End(-4159).Column
    for ($col = 1; $col -le $last; $col++) {
        $name = ([string]$Sheet.Cells.Item(1, $col).Value2).Trim()
        if ($name) {
            if ($result.ContainsKey($name)) { throw "Duplicate header '$name' in $($Sheet.Name)." }
            $result[$name] = $col
        }
    }
    return $result
}

function Column-Letter([int]$Number) {
    $result = ''
    while ($Number -gt 0) {
        $Number--
        $result = [char](65 + ($Number % 26)) + $result
        $Number = [int][Math]::Floor($Number / 26)
    }
    return $result
}

if (-not $Workbook) {
    Add-Type -AssemblyName System.Windows.Forms
    $picker = New-Object System.Windows.Forms.OpenFileDialog
    $picker.Title = 'Choose the STIHL master workbook (close it in Excel first)'
    $picker.Filter = 'Excel macro-enabled workbook (*.xlsm)|*.xlsm'
    if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw 'No workbook selected. Nothing changed.' }
    $Workbook = $picker.FileName
    $picker.Dispose()
}
$Workbook = (Resolve-Path -LiteralPath $Workbook).Path
if ([IO.Path]::GetExtension($Workbook) -ine '.xlsm') { throw 'Choose the existing .xlsm master workbook.' }

$excel = $null
$book = $null
try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.EnableEvents = $false
    $excel.ScreenUpdating = $false
    $excel.AutomationSecurity = 3 # Disable macros only in this installer Excel instance.
    $book = $excel.Workbooks.Open($Workbook, 0, $false)
    if ($book.ReadOnly) { throw 'Workbook is open or read-only. Close it in Excel and run this installer again.' }
    $master = $book.Worksheets.Item('STIHL Master')
    $headers = Get-Headers $master
    foreach ($name in $fields) {
        if (-not $headers.ContainsKey($name)) { throw "STIHL Master is missing '$name'. Nothing changed." }
    }
    # The established STIHL master uses column A for its raw SKU identifiers.
    $lastMasterRow = [int]$master.Cells.Item($master.Rows.Count, 1).End(-4162).Row
    $sourceIds = $master.Range("A2:A$lastMasterRow").Value2
    $skuRows = @{}
    $duplicateSkus = @{}
    for ($i = 1; $i -le $sourceIds.GetLength(0); $i++) {
        $sku = [string]$sourceIds[$i, 1]
        if ([string]::IsNullOrWhiteSpace($sku)) { continue }
        if ($skuRows.ContainsKey($sku)) { $duplicateSkus[$sku] = $true }
        else { $skuRows[$sku] = $i + 1 }
    }

    # Complete all matching and table checks before changing any cells.
    $plans = @()
    foreach ($name in $targets.Keys) {
        $sheet = $book.Worksheets.Item($name)
        if ($sheet.ProtectContents) { throw "Unprotect '$name' before installing the columns." }
        $table = $sheet.ListObjects.Item($targets[$name])
        if ($null -eq $table.DataBodyRange) { throw "The '$name' table has no data rows." }
        $skuColumn = $table.ListColumns.Item('SKU')
        $rowCount = [int]$table.ListRows.Count
        $rows = @()
        for ($i = 1; $i -le $rowCount; $i++) {
            $sku = [string]$skuColumn.DataBodyRange.Cells.Item($i, 1).Value2
            if ([string]::IsNullOrWhiteSpace($sku)) { continue }
            # Existing empty attachment template row has this reserved dummy SKU.
            if ($name -eq 'attachments' -and $sku -eq '0000 000 0000') {
                $active = [string]$table.ListColumns.Item('Active').DataBodyRange.Cells.Item($i, 1).Value2
                $description = [string]$table.ListColumns.Item('Description').DataBodyRange.Cells.Item($i, 1).Value2
                if ([string]::IsNullOrWhiteSpace($active) -and [string]::IsNullOrWhiteSpace($description)) { continue }
            }
            if (-not $skuRows.ContainsKey($sku)) { throw "SKU '$sku' in '$name' was not found in STIHL Master. Nothing changed." }
            if ($duplicateSkus.ContainsKey($sku)) { throw "SKU '$sku' occurs more than once in STIHL Master. Resolve it before installing." }
            $rows += [pscustomobject]@{ Index = $i; MasterRow = $skuRows[$sku] }
        }
        $plans += [pscustomobject]@{ Name = $name; Table = $table; Rows = $rows }
    }
    $backup = $Workbook + '.before-fleet-columns-' + (Get-Date -Format 'yyyyMMdd-HHmmssfff') + '.xlsm'
    $book.SaveCopyAs($backup)

    foreach ($plan in $plans) {
        foreach ($field in $fields) {
            $column = $null
            foreach ($candidate in $plan.Table.ListColumns) {
                if ($candidate.Name -ieq $field) { $column = $candidate; break }
            }
            if ($null -eq $column) {
                $column = $plan.Table.ListColumns.Add()
                $column.Name = $field
            }
            $letter = Column-Letter $headers[$field]
            $source = "'STIHL Master'!`$$letter`$2:`$$letter`$$lastMasterRow"
            $ids = "'STIHL Master'!`$A`$2:`$A`$$lastMasterRow"
            $lookup = "INDEX($source,MATCH([@SKU],$ids,0))"
            # Preserve true zero values and source blanks; fail visibly for an unknown SKU.
            $blankTest = '[@SKU]=""'
            if ($plan.Name -eq 'attachments') { $blankTest = 'OR([@SKU]="",[@SKU]="0000 000 0000")' }
            $column.DataBodyRange.Formula = '=IF(' + $blankTest + ',"",IF(' + $lookup + '="","",' + $lookup + '))'
            if ($field -in @('FleetEligible', 'FleetRebateProgram')) { $column.DataBodyRange.NumberFormat = 'General' }
            elseif ($field -eq 'FleetPoints') { $column.DataBodyRange.NumberFormat = '0.##' }
            else { $column.DataBodyRange.NumberFormat = '0.00' }
            $column.Range.ColumnWidth = [Math]::Max(18, $field.Length + 2)
        }
    }
    $excel.CalculateFull()
    foreach ($plan in $plans) {
        foreach ($field in $fields) {
            $column = $plan.Table.ListColumns.Item($field)
            foreach ($row in $plan.Rows) {
                $actualCell = $column.DataBodyRange.Cells.Item($row.Index, 1)
                $expectedCell = $master.Cells.Item($row.MasterRow, $headers[$field])
                if ([string]$actualCell.Text -match '^#(N/A|REF!|VALUE!|NAME\?|NUM!|DIV/0!|SPILL!|CALC!)' -or [string]$expectedCell.Text -match '^#(N/A|REF!|VALUE!|NAME\?|NUM!|DIV/0!|SPILL!|CALC!)') {
                    throw "Formula error: $($plan.Name), row $($row.Index), $field. Original workbook has not been saved."
                }
                $actual = $actualCell.Value2
                $expected = $expectedCell.Value2
                if ([string]$actual -cne [string]$expected) {
                    throw "Fleet value mismatch: $($plan.Name), row $($row.Index), $field. Original workbook has not been saved."
                }
            }
        }
        Write-Host ("PASS  {0}: 7 master-linked columns, {1} populated SKUs verified" -f $plan.Name, $plan.Rows.Count) -ForegroundColor Green
    }
    $book.Save()
    Write-Host "PASS: fleet columns installed and saved."
    Write-Host "Workbook: $Workbook"
    Write-Host "Backup:   $backup"
    Write-Host 'Reopen this workbook, then run the existing export and private-sync buttons.'
}
finally {
    if ($null -ne $book) { $book.Close($false) }
    if ($null -ne $excel) { $excel.Quit() }
    foreach ($object in @($book, $excel)) {
        if ($null -ne $object) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($object) }
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
