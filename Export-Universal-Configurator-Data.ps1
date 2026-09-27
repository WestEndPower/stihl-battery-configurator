[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$Workbook = "C:\Users\NM-Office\Desktop\STIHL Configurator\STIHL-Master.xlsm",

    [Parameter(Mandatory = $false)]
    [string]$Repository = "C:\NMWEPE\GitHub\stihl configurator\stihl-battery-configurator",

    [Parameter(Mandatory = $false)]
    [string]$OutputFolder = "",

    [switch]$NoWorkbookStatusUpdate
)

$ErrorActionPreference = "Stop"
$Invariant = [System.Globalization.CultureInfo]::InvariantCulture

function Release-ComObject {
    param($Object)
    if ($null -ne $Object) {
        try { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($Object) } catch {}
    }
}

function Clean-Text {
    param($Value)

    if ($null -eq $Value) {
        return ""
    }

    $text = [string]$Value

    if ([string]::IsNullOrWhiteSpace($text)) {
        return ""
    }

    return $text.Trim()
}

function Get-WorksheetByCleanName {
    param($WorkbookObject,[string]$RequestedName)
    $wanted = Clean-Text $RequestedName
    $count = [int]$WorkbookObject.Worksheets.Count
    for ($i=1; $i -le $count; $i++) {
        $candidate = $null
        try {
            $candidate = $WorkbookObject.Worksheets.Item($i)
            if ((Clean-Text $candidate.Name) -eq $wanted) { return $candidate }
        }
        finally {
            if ($null -ne $candidate -and (Clean-Text $candidate.Name) -ne $wanted) {
                Release-ComObject $candidate
            }
        }
    }
    return $null
}

function Get-RangeSnapshot {
    param($Worksheet)
    $used = $null
    try {
        $used = $Worksheet.UsedRange
        $firstRow = [int]$used.Row
        $firstCol = [int]$used.Column
        $rowCount = [Math]::Max([int]$used.Rows.Count,1)
        $colCount = [Math]::Max([int]$used.Columns.Count,1)
        $values = $used.Value2
        return [pscustomobject]@{
            FirstRow=$firstRow
            FirstCol=$firstCol
            RowCount=$rowCount
            ColCount=$colCount
            LastRow=$firstRow+$rowCount-1
            LastCol=$firstCol+$colCount-1
            Values=$values
        }
    }
    finally { Release-ComObject $used }
}

function Get-SnapshotValue {
    param($Snapshot,[int]$Row,[int]$Column)
    if ($null -eq $Snapshot) { return $null }
    if ($Row -lt $Snapshot.FirstRow -or $Row -gt $Snapshot.LastRow) { return $null }
    if ($Column -lt $Snapshot.FirstCol -or $Column -gt $Snapshot.LastCol) { return $null }
    $r = $Row - $Snapshot.FirstRow + 1
    $c = $Column - $Snapshot.FirstCol + 1
    if ($Snapshot.RowCount -eq 1 -and $Snapshot.ColCount -eq 1) { return $Snapshot.Values }
    return $Snapshot.Values[$r,$c]
}

function Get-HeaderMapFromSnapshot {
    param($Worksheet,$Snapshot)
    $map = @{}
    for ($col=$Snapshot.FirstCol; $col -le $Snapshot.LastCol; $col++) {
        $header = Clean-Text (Get-SnapshotValue -Snapshot $Snapshot -Row 1 -Column $col)
        if ($header) {
            if ($map.ContainsKey($header)) { throw "Duplicate header '$header' on worksheet '$($Worksheet.Name)'." }
            $map[$header] = $col
        }
    }
    return $map
}

function Get-LastDataRowForColumnsFromSnapshot {
    param($Snapshot,[int[]]$Columns)
    for ($row=$Snapshot.LastRow; $row -ge 2; $row--) {
        foreach ($col in $Columns) {
            $v = Get-SnapshotValue -Snapshot $Snapshot -Row $row -Column $col
            if ($null -ne $v -and [string]$v -ne "") { return $row }
        }
    }
    return 1
}

function Get-ExistingPublicHeaders {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return @() }
    $reader = New-Object System.IO.StreamReader($Path,$true)
    try { $line = $reader.ReadLine() }
    finally { $reader.Close() }
    if (-not $line) { return @() }
    if ($line.Length -gt 0 -and $line[0] -eq [char]0xFEFF) { $line = $line.Substring(1) }
    return @($line.Split(',') | ForEach-Object { $_.Trim('"').Trim() } | Where-Object { $_ })
}

function Get-DealerSettingsHeaders {
    return @(
        'BrandID','DealerName','Currency','SalesTaxRate','QuoteValidDays','DefaultLocationID',
        'ExportFolder','SchemaVersion','ApplicationID','BrandName','DealerID','DealerPhone',
        'DealerCell','DealerEmail','DealerWebsite','LastExportDate','DealerLogoURL',
        'GA4MeasurementID','GoogleTagManagerID','DefaultSEOName','DefaultShareImage'
    )
}

function Test-SpecPairs {
    param([string]$SheetName,$HeaderMap)
    $errors = @()
    for ($n=1; $n -le 10; $n++) {
        $label = "SpecLabel$n"
        $value = "SpecValue$n"
        $hasLabel = $HeaderMap.ContainsKey($label)
        $hasValue = $HeaderMap.ContainsKey($value)
        if ($hasLabel -xor $hasValue) { $errors += "${SheetName}: $label/$value mismatch" }
    }
    return $errors
}

function Convert-SnapshotValue {
    param($Snapshot,[int]$Row,[int]$Column,[string]$Header)

    $v = Get-SnapshotValue -Snapshot $Snapshot -Row $Row -Column $Column

    if ($null -eq $v) {
        return ''
    }

    if ($v -is [string]) {
        return $v
    }

    # Excel COM exposes worksheet error values as signed HRESULT integers.
    # Convert them back to the text customers/dealers see in Excel.
    $excelErrors = @{
        '-2146826288' = '#NULL!'
        '-2146826281' = '#DIV/0!'
        '-2146826273' = '#VALUE!'
        '-2146826265' = '#REF!'
        '-2146826259' = '#NAME?'
        '-2146826252' = '#NUM!'
        '-2146826246' = '#N/A'
    }

    $errorKey = [string]$v

    if ($excelErrors.ContainsKey($errorKey)) {
        return $excelErrors[$errorKey]
    }

    if ($v -is [double] -or
        $v -is [decimal] -or
        $v -is [int] -or
        $v -is [long]) {

        if ($Header -match '(?i)Date$' -and [double]$v -gt 20000) {
            try {
                return [DateTime]::FromOADate([double]$v).ToString('yyyy-MM-dd',$Invariant)
            }
            catch {}
        }

        return ([double]$v).ToString('0.###############',$Invariant)
    }

    return [string]$v
}

function Escape-CsvField {
    param([string]$Value,[switch]$QuoteAll)
    if ($null -eq $Value) { $Value = '' }
    if ($QuoteAll) {
        return '"' + $Value.Replace('"','""') + '"'
    }
    if ($Value.IndexOfAny([char[]]",`"`r`n") -ge 0) {
        return '"' + $Value.Replace('"','""') + '"'
    }
    return $Value
}

function Get-ExistingCsvStyle {
    param([string]$Path)

    $style = [ordered]@{
        QuoteAll = $false
        Utf8Bom  = $false
    }

    if (-not (Test-Path -LiteralPath $Path)) {
        return [pscustomobject]$style
    }

    $bytes = [System.IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        $style.Utf8Bom = $true
    }

    $reader = New-Object System.IO.StreamReader($Path,$true)
    try { $line = $reader.ReadLine() }
    finally { $reader.Close() }

    if ($line) {
        if ($line.Length -gt 0 -and $line[0] -eq [char]0xFEFF) { $line = $line.Substring(1) }
        $style.QuoteAll = $line.StartsWith('"')
    }

    return [pscustomobject]$style
}

function Write-PublicCsvFromSnapshot {
    param($Worksheet,$Snapshot,[string[]]$Headers,[hashtable]$HeaderMap,[string]$Target)
    $missing = @($Headers | Where-Object { -not $HeaderMap.ContainsKey($_) })
    if ($missing.Count -gt 0) {
        throw "Worksheet '$($Worksheet.Name)' is missing required public header(s): $($missing -join ', ')"
    }

    $style = Get-ExistingCsvStyle -Path $Target
    $cols = @($Headers | ForEach-Object { [int]$HeaderMap[$_] })
    $lastRow = Get-LastDataRowForColumnsFromSnapshot -Snapshot $Snapshot -Columns $cols
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add((($Headers | ForEach-Object { Escape-CsvField $_ -QuoteAll:$style.QuoteAll }) -join ','))

    for ($row=2; $row -le $lastRow; $row++) {
        $fields = New-Object System.Collections.Generic.List[string]
        for ($i=0; $i -lt $Headers.Count; $i++) {
            $raw = Convert-SnapshotValue -Snapshot $Snapshot -Row $row -Column $cols[$i] -Header $Headers[$i]

            if ($null -eq $raw) {
                $raw = ""
            }
            elseif ([string]::IsNullOrWhiteSpace([string]$raw)) {
                $raw = ""
            }

            $fields.Add((Escape-CsvField $raw -QuoteAll:$style.QuoteAll))
        }
        $lines.Add(($fields -join ','))
    }

    # Preserve the established encoding style of each public CSV. New files default to UTF-8 without BOM.
    $utf8 = New-Object System.Text.UTF8Encoding([bool]$style.Utf8Bom)
    [System.IO.File]::WriteAllLines($Target,$lines,$utf8)
    return [Math]::Max($lastRow-1,0)
}

if (-not (Test-Path -LiteralPath $Workbook)) { throw "Workbook not found: $Workbook" }
if (-not (Test-Path -LiteralPath $Repository)) { throw "Repository not found: $Repository" }
if (-not $OutputFolder) { $OutputFolder = Join-Path $Repository 'data' }
New-Item -ItemType Directory -Path $OutputFolder -Force | Out-Null
$OutputFolder = (Resolve-Path -LiteralPath $OutputFolder).Path
$Workbook = (Resolve-Path -LiteralPath $Workbook).Path

$excel=$null; $wb=$null; $exportSheet=$null
try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible=$false; $excel.DisplayAlerts=$false; $excel.EnableEvents=$false; $excel.ScreenUpdating=$false
    $wb = $excel.Workbooks.Open($Workbook,0,$false)
    $excel.CalculateFull()

    Write-Host 'UNIVERSAL CONFIGURATOR EXPORT' -ForegroundColor Cyan
    Write-Host "Workbook : $Workbook"
    Write-Host "Output   : $OutputFolder"
    Write-Host ''

    $exportSheet = Get-WorksheetByCleanName -WorkbookObject $wb -RequestedName 'export'
    if ($null -eq $exportSheet) { throw "Worksheet 'export' was not found." }
    $exportSnapshot = Get-RangeSnapshot -Worksheet $exportSheet
    $lastExportRow = $exportSnapshot.LastRow

    $preflightErrors = New-Object System.Collections.Generic.List[string]
    $publicRows = @()
    for ($row=7; $row -le $lastExportRow; $row++) {
        $enabled = Clean-Text (Get-SnapshotValue -Snapshot $exportSnapshot -Row $row -Column 1)
        $sheetName = Clean-Text (Get-SnapshotValue -Snapshot $exportSnapshot -Row $row -Column 2)
        $fileName = Clean-Text (Get-SnapshotValue -Snapshot $exportSnapshot -Row $row -Column 3)
        $status = Clean-Text (Get-SnapshotValue -Snapshot $exportSnapshot -Row $row -Column 5)
        if (-not $sheetName -and -not $fileName) { continue }
        if ($enabled -notin @('T','TRUE','Y','YES','1')) { continue }
        if ($status -match 'Private\s*/\s*D1\s*Only') { continue }

        $ws=$null
        try {
            $ws=Get-WorksheetByCleanName -WorkbookObject $wb -RequestedName $sheetName
            if ($null -eq $ws) { $preflightErrors.Add("Export worksheet '$sheetName' was not found."); continue }
            $snap=Get-RangeSnapshot -Worksheet $ws
            $map=Get-HeaderMapFromSnapshot -Worksheet $ws -Snapshot $snap
            foreach ($err in @(Test-SpecPairs -SheetName $sheetName -HeaderMap $map)) { $preflightErrors.Add($err) }

            $target=Join-Path $OutputFolder $fileName
            if ($fileName -ieq 'dealer-settings.csv') { $headers=Get-DealerSettingsHeaders }
            else { $headers=Get-ExistingPublicHeaders -Path $target }
            if ($headers.Count -eq 0) {
                $preflightErrors.Add("$fileName has no existing public schema. Add an approved public header contract before first export.")
                continue
            }
            $missing=@($headers | Where-Object { -not $map.ContainsKey($_) })
            if ($missing.Count -gt 0) { $preflightErrors.Add("${sheetName}: missing public header(s): $($missing -join ', ')") }
            $publicRows += [pscustomobject]@{Row=$row;Sheet=$sheetName;File=$fileName;Headers=$headers}
        }
        catch { $preflightErrors.Add("${sheetName}: $($_.Exception.Message)") }
        finally { Release-ComObject $ws }
    }

    if ($preflightErrors.Count -gt 0) {
        Write-Host 'PUBLIC EXPORT VALIDATION FAILED' -ForegroundColor Red
        $preflightErrors | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
        throw 'Public export validation failed. No CSV files were exported.'
    }

    Write-Host ("PASS: validated {0} public export worksheet(s)" -f $publicRows.Count) -ForegroundColor Green
    Write-Host ''

    $exported=0; $skippedPrivate=0; $skippedDisabled=0
    for ($row=7; $row -le $lastExportRow; $row++) {
        $enabled = Clean-Text (Get-SnapshotValue -Snapshot $exportSnapshot -Row $row -Column 1)
        $sheetName = Clean-Text (Get-SnapshotValue -Snapshot $exportSnapshot -Row $row -Column 2)
        $fileName = Clean-Text (Get-SnapshotValue -Snapshot $exportSnapshot -Row $row -Column 3)
        $status = Clean-Text (Get-SnapshotValue -Snapshot $exportSnapshot -Row $row -Column 5)
        if (-not $sheetName -and -not $fileName) { continue }
        if ($enabled -notin @('T','TRUE','Y','YES','1')) { $skippedDisabled++; continue }
        if ($status -match 'Private\s*/\s*D1\s*Only') { $skippedPrivate++; Write-Host "PRIVATE  $sheetName -> $fileName" -ForegroundColor DarkYellow; continue }

        $contract=$publicRows | Where-Object { $_.Row -eq $row } | Select-Object -First 1
        if ($null -eq $contract) { throw "Internal exporter error: no public contract for export row $row." }
        $ws=$null
        try {
            $ws=Get-WorksheetByCleanName -WorkbookObject $wb -RequestedName $sheetName
            if ($null -eq $ws) { throw "Worksheet '$sheetName' was not found." }
            $snap=Get-RangeSnapshot -Worksheet $ws
            $map=Get-HeaderMapFromSnapshot -Worksheet $ws -Snapshot $snap
            $target=Join-Path $OutputFolder $fileName
            $rows=Write-PublicCsvFromSnapshot -Worksheet $ws -Snapshot $snap -Headers $contract.Headers -HeaderMap $map -Target $target
            if (-not $NoWorkbookStatusUpdate) {
                $exportSheet.Cells.Item($row,4).Value2=[double]$rows
                $exportSheet.Cells.Item($row,5).Value2='Exported'
            }
            $exported++
            Write-Host ("PASS     {0} -> {1}  ({2} rows)" -f $sheetName,$fileName,$rows) -ForegroundColor Green
        }
        finally { Release-ComObject $ws }
    }

    if (-not $NoWorkbookStatusUpdate) {
        $exportSheet.Cells.Item(3,5).Value2=(Get-Date).ToOADate()
        $exportSheet.Cells.Item(3,6).Value2=$OutputFolder + [IO.Path]::DirectorySeparatorChar
        $exportSheet.Cells.Item(3,7).Value2='PASS'
        $wb.Save()
    }

    Write-Host ''
    Write-Host 'PASS: universal export complete' -ForegroundColor Green
    Write-Host "Exported       : $exported"
    Write-Host "Private / D1   : $skippedPrivate"
    Write-Host "Disabled       : $skippedDisabled"
}
finally {
    Release-ComObject $exportSheet
    if ($null -ne $wb) { try { $wb.Close($false) } catch {}; Release-ComObject $wb }
    if ($null -ne $excel) { try { $excel.Quit() } catch {}; Release-ComObject $excel }
    [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}



