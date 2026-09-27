$ErrorActionPreference = 'Stop'

$repo = 'C:\NMWEPE\GitHub\stihl configurator\stihl-battery-configurator'
$master = 'C:\Users\NM-Office\Desktop\STIHL Configurator\STIHL-Master.xlsm'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if (-not (Test-Path $repo)) { throw "Repository not found: $repo" }
if (-not (Test-Path $master)) { throw "Workbook not found: $master" }

$targets = @(
    @{ Sheet='batteries'; Csv='data\batteries.csv'; Fields=@('ProductURL','ManualURL','InventoryURL','KWh') },
    @{ Sheet='chargers'; Csv='data\chargers.csv'; Fields=@('ProductURL','ManualURL','InventoryURL','QtyDanbury','QtyNewMilford','Weight','WeightUnit','InputWatts') }
)

# Backup workbook once.
$masterBackup = "$master.before-battery-charger-product-fields-$stamp.xlsm"
Copy-Item $master $masterBackup -Force
Write-Host "BACKUP workbook: $masterBackup"

# Update workbook headers using Excel COM so macros/formulas remain intact.
$excel = $null
$book = $null
try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $book = $excel.Workbooks.Open($master)

    foreach ($target in $targets) {
        $ws = $book.Worksheets.Item($target.Sheet)
        $lastCol = $ws.Cells.Item(1, $ws.Columns.Count).End(-4159).Column # xlToLeft
        $headers = @{}
        for ($c=1; $c -le $lastCol; $c++) {
            $h = [string]$ws.Cells.Item(1,$c).Text
            if ($h) { $headers[$h.Trim()] = $c }
        }
        foreach ($field in $target.Fields) {
            if (-not $headers.ContainsKey($field)) {
                $lastCol++
                $ws.Cells.Item(1,$lastCol).Value2 = $field
                $headers[$field] = $lastCol
                Write-Host "ADD workbook $($target.Sheet): $field"
            } else {
                Write-Host "KEEP workbook $($target.Sheet): $field"
            }
        }
    }

    $book.Save()
}
finally {
    if ($book) { $book.Close($true) | Out-Null }
    if ($excel) { $excel.Quit() }
    if ($book) { [Runtime.InteropServices.Marshal]::ReleaseComObject($book) | Out-Null }
    if ($excel) { [Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

# Update published CSV schemas without changing existing values.
foreach ($target in $targets) {
    $csvPath = Join-Path $repo $target.Csv
    if (-not (Test-Path $csvPath)) { throw "CSV not found: $csvPath" }

    $csvBackup = "$csvPath.before-battery-charger-product-fields-$stamp"
    Copy-Item $csvPath $csvBackup -Force
    Write-Host "BACKUP csv: $csvBackup"

    $rows = @(Import-Csv $csvPath)
    if ($rows.Count -eq 0) { throw "CSV has no data rows: $csvPath" }

    foreach ($row in $rows) {
        foreach ($field in $target.Fields) {
            if (-not ($row.PSObject.Properties.Name -contains $field)) {
                $row | Add-Member -NotePropertyName $field -NotePropertyValue ''
            }
        }
    }

    $rows | Export-Csv $csvPath -NoTypeInformation -Encoding UTF8

    $headers = (Import-Csv $csvPath | Select-Object -First 1).PSObject.Properties.Name
    $missing = @($target.Fields | Where-Object { $headers -notcontains $_ })
    if ($missing.Count) { throw "Missing fields after update in ${csvPath}: $($missing -join ', ')" }
    Write-Host "PASS $($target.Sheet): $($target.Fields -join ', ')"
}

Write-Host ''
Write-Host 'PASS: Products remain unchanged; Batteries and Chargers now support product resource and charging-cost fields.'
Write-Host 'Attachments, Accessories, and Parts were not modified.'
