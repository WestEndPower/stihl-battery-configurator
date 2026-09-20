param(
    [string]$WorkbookPath = (Join-Path $PSScriptRoot 'STIHL-Master(6).xlsm'),
    [string]$OutputPath = (Join-Path $PSScriptRoot 'STIHL-Master-Commit-DealerSpike.xlsm')
)

$ErrorActionPreference = 'Stop'

function Release-ComObject([object]$Object) {
    if ($null -ne $Object) {
        try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($Object) } catch {}
    }
}

if (-not (Test-Path -LiteralPath $WorkbookPath)) {
    $fallbacks = @(
        'C:\Users\NM-Office\Desktop\STIHL Configurator\STIHL-Master.xlsm',
        'C:\Users\NM-Office\Desktop\STIHL Configurator\STIHL-Master(6).xlsm'
    )
    $found = $fallbacks | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($found) { $WorkbookPath = $found }
    else { throw "Workbook not found: $WorkbookPath" }
}

$WorkbookPath = (Resolve-Path -LiteralPath $WorkbookPath).Path
if ([IO.Path]::GetExtension($OutputPath) -ne '.xlsm') { throw 'OutputPath must end in .xlsm' }

# Excel only reads AccessVBOM when the application starts. Enabling it here lets this
# installer add a standard VBA module without changing any existing VBA modules.
$securityKey = 'HKCU:\Software\Microsoft\Office\16.0\Excel\Security'
if (-not (Test-Path $securityKey)) { New-Item -Path $securityKey -Force | Out-Null }
New-ItemProperty -Path $securityKey -Name AccessVBOM -PropertyType DWord -Value 1 -Force | Out-Null

Copy-Item -LiteralPath $WorkbookPath -Destination $OutputPath -Force
$OutputPath = (Resolve-Path -LiteralPath $OutputPath).Path
$backup = $OutputPath + '.before-buttons-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.xlsm'
Copy-Item -LiteralPath $OutputPath -Destination $backup -Force

$excel = $null
$book = $null
$sheet = $null
$vbProject = $null
$components = $null
$module = $null

try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.EnableEvents = $false

    $book = $excel.Workbooks.Open($OutputPath)
    $sheet = $book.Worksheets.Item('export')

    $vba = @'
Option Explicit

Private Function STIHL_RepoPath() As String
    Dim p As String
    On Error Resume Next
    p = CStr(ThisWorkbook.Worksheets("export").Range("F3").Value)
    On Error GoTo 0
    p = Trim$(p)
    If Len(p) > 0 Then
        p = Replace(p, "/", "\")
        If Right$(p, 1) = "\" Then p = Left$(p, Len(p) - 1)
        If LCase$(Right$(p, 5)) = "\data" Then p = Left$(p, Len(p) - 5)
        If Len(Dir$(p, vbDirectory)) > 0 Then
            STIHL_RepoPath = p
            Exit Function
        End If
    End If

    p = "C:\NMWEPE\GitHub\stihl-battery-configurator"
    If Len(Dir$(p, vbDirectory)) > 0 Then
        STIHL_RepoPath = p
        Exit Function
    End If

    p = "C:\NMWEPE\GitHub\stihl configurator\stihl-battery-configurator"
    If Len(Dir$(p, vbDirectory)) > 0 Then STIHL_RepoPath = p
End Function

Public Sub Commit_STIHL_Configurator()
    Dim repo As String, cmd As String
    repo = STIHL_RepoPath()
    If Len(repo) = 0 Then
        MsgBox "STIHL repository folder was not found. Check export!F3.", vbExclamation, "STIHL Commit"
        Exit Sub
    End If

    ThisWorkbook.Save
    cmd = "powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -Command """ & _
          "$ErrorActionPreference='Stop'; Set-Location -LiteralPath '" & Replace(repo, "'", "''") & "'; " & _
          "Write-Host 'STIHL CONFIGURATOR COMMIT' -ForegroundColor Cyan; " & _
          "git add -A; " & _
          "if ((git diff --cached --name-only).Count -eq 0) { Write-Host 'Nothing new to commit.' -ForegroundColor Yellow; git status -sb } " & _
          "else { git diff --cached --check; if ($LASTEXITCODE -ne 0) { throw 'git diff --check failed.' }; " & _
          "git commit -m 'Update STIHL configurator'; if ($LASTEXITCODE -ne 0) { throw 'git commit failed.' }; " & _
          "git push; if ($LASTEXITCODE -ne 0) { throw 'git push failed.' }; git status -sb; Write-Host 'PASS: STIHL changes committed and pushed.' -ForegroundColor Green }"""
    CreateObject("WScript.Shell").Run cmd, 1, False
End Sub

Public Sub Crawl_STIHL_Dealer_Spike()
    Dim repo As String, cmd As String
    repo = STIHL_RepoPath()
    If Len(repo) = 0 Then
        MsgBox "STIHL repository folder was not found. Check export!F3.", vbExclamation, "Dealer Spike Crawl"
        Exit Sub
    End If

    ThisWorkbook.Save
    cmd = "powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -Command """ & _
          "$ErrorActionPreference='Stop'; Set-Location -LiteralPath '" & Replace(repo, "'", "''") & "'; " & _
          "$scripts = Get-ChildItem -LiteralPath . -Recurse -File -Filter '*.ps1' | Where-Object { $_.FullName -notmatch '\\.git\\|\\node_modules\\' -and $_.Name -match '(?i)dealer.*spike|spike.*dealer' }; " & _
          "$script = $scripts | Sort-Object @{Expression={ if ($_.Name -match '(?i)crawl|refresh') {0} else {1} }}, Name | Select-Object -First 1; " & _
          "if (-not $script) { Write-Host 'No Dealer Spike crawler script was found in the STIHL repository.' -ForegroundColor Red; Write-Host 'Expected a .ps1 filename containing Dealer and Spike.' -ForegroundColor Yellow; exit 1 }; " & _
          "Write-Host ('Running ' + $script.FullName) -ForegroundColor Cyan; & $script.FullName; " & _
          "if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw ('Dealer Spike crawler exited with code ' + $LASTEXITCODE) }; " & _
          "Write-Host 'PASS: Dealer Spike crawl finished.' -ForegroundColor Green"""
    CreateObject("WScript.Shell").Run cmd, 1, False
End Sub
'@

    $vbProject = $book.VBProject
    $components = $vbProject.VBComponents

    # Replace only our own module if this installer is run again.
    for ($i = $components.Count; $i -ge 1; $i--) {
        $c = $components.Item($i)
        if ($c.Name -eq 'STIHLGitDealerSpikeTools') {
            $components.Remove($c)
            break
        }
    }

    $module = $components.Add(1) # vbext_ct_StdModule
    $module.Name = 'STIHLGitDealerSpikeTools'
    $module.CodeModule.AddFromString($vba)

    # Remove prior installer-created buttons, but preserve every pre-existing button/control.
    for ($i = $sheet.Buttons().Count; $i -ge 1; $i--) {
        $b = $sheet.Buttons().Item($i)
        if ($b.Name -eq 'btnCrawlDealerSpike' -or $b.Name -eq 'btnCommitSTIHL') { $b.Delete() }
    }

    # Existing action buttons occupy A1:C1. Put these immediately to the right in D1:E1.
    $d = $sheet.Range('D1')
    $e = $sheet.Range('E1')
    $height = [Math]::Max(26, $d.Height)

    $crawl = $sheet.Buttons().Add($d.Left + 3, $d.Top + 3, [Math]::Max(125, $d.Width - 6), $height - 6)
    $crawl.Name = 'btnCrawlDealerSpike'
    $crawl.Caption = 'Crawl Dealer Spike'
    $crawl.OnAction = 'Crawl_STIHL_Dealer_Spike'
    $crawl.PrintObject = $false

    $commit = $sheet.Buttons().Add($e.Left + 3, $e.Top + 3, [Math]::Max(110, $e.Width - 6), $height - 6)
    $commit.Name = 'btnCommitSTIHL'
    $commit.Caption = 'Commit && Push'
    $commit.OnAction = 'Commit_STIHL_Configurator'
    $commit.PrintObject = $false

    # Widen D/E enough for readable button captions without disturbing existing A:C controls.
    if ($sheet.Columns.Item('D').ColumnWidth -lt 20) { $sheet.Columns.Item('D').ColumnWidth = 20 }
    if ($sheet.Columns.Item('E').ColumnWidth -lt 18) { $sheet.Columns.Item('E').ColumnWidth = 18 }

    $book.Save()
    Write-Host ''
    Write-Host 'PASS: STIHL buttons installed.' -ForegroundColor Green
    Write-Host "Workbook: $OutputPath"
    Write-Host "Backup:   $backup"
    Write-Host 'Buttons:  Crawl Dealer Spike | Commit & Push'
}
finally {
    if ($book) { try { $book.Close($true) } catch {} }
    if ($excel) { try { $excel.Quit() } catch {} }
    Release-ComObject $module
    Release-ComObject $components
    Release-ComObject $vbProject
    Release-ComObject $sheet
    Release-ComObject $book
    Release-ComObject $excel
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
