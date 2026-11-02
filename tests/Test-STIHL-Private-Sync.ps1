$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$underTest = Join-Path $root 'Sync-STIHL-Workbook-Private.ps1'
$shell = (Get-Process -Id $PID).Path
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('stihl-sync-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary -Force | Out-Null
$harness = Join-Path $temporary 'harness.ps1'
@'
param([string]$ScriptUnderTest,[string]$DataFolder)
$ErrorActionPreference='Stop'
$global:stihlTestCalls=0
function Get-Credential {
    param($UserName,$Message)
    Write-Output 'TEST credential reached' | Out-Host
    return New-Object Management.Automation.PSCredential('fixture',(ConvertTo-SecureString 'fixture-only' -AsPlainText -Force))
}
function Invoke-RestMethod {
    param($Uri,$Method,$ContentType,$Headers,$Body)
    $decoded=[Text.Encoding]::UTF8.GetString($Body) | ConvertFrom-Json
    if ($decoded.brandId -ne 'STIHL') { throw 'Wrong upload brand' }
    if ($decoded.dataset -eq 'inventory' -and $decoded.source -ne 'dealer-inventory-master') { throw 'Inventory authority missing' }
    if ($decoded.dataset -ne 'inventory' -and @($decoded.payload).Count -ne 1) { throw 'Missing current dataset rows' }
    $global:stihlTestCalls++
    return @{ok=$true}
}
& $ScriptUnderTest -PrivateFolder $DataFolder
if ($global:stihlTestCalls -ne 7) { throw "Expected seven uploads, got $global:stihlTestCalls" }
foreach ($name in @('products','attachments','accessories','parts')) {
    $source=Join-Path $DataFolder ($name+'.csv')
    $mirror=Join-Path (Join-Path $DataFolder 'STIHL') ($name+'.csv')
    if ((Get-FileHash $source).Hash -ne (Get-FileHash $mirror).Hash) { throw "Stale mirror for $name" }
}
Write-Output 'TEST validated uploads and all four mirrors'
'@ | Set-Content -LiteralPath $harness -Encoding UTF8
try {
    foreach ($mode in @('valid','blank','missing-header','foreign-brand','negative','duplicate','missing-file')) {
        $folder = Join-Path $temporary $mode
        $brand = Join-Path $folder 'STIHL'
        New-Item -ItemType Directory -Path $brand -Force | Out-Null
        'Brand,SKU' | Set-Content (Join-Path $brand 'inventory.csv') -Encoding UTF8
        [pscustomobject]@{BrandID='STIHL';ProgramID='FIN';ExcludeFromFleet='F'} | Export-Csv -LiteralPath (Join-Path $folder 'finance-programs.csv') -NoTypeInformation -Encoding UTF8
        [pscustomobject]@{BrandID='STIHL';ProgramType='Fleet';Tier='1';Active='T';RuleID='HH';QualifyingFleetGroup='HANDHELD';MinimumSpend='2500'} | Export-Csv -LiteralPath (Join-Path $folder 'bid-fleet-programs.csv') -NoTypeInformation -Encoding UTF8
        foreach ($name in @('products','attachments','accessories','parts')) {
            $record=[ordered]@{SKU=$name;BrandID='STIHL';DealerCost='600';RebateToCustomer='0';RebateToDealer='0';FleetEligible='T';FleetRebateProgram='G';FleetTier1Discount='100';FleetTier1Rebate='50';FleetTier2Discount='200';FleetTier2Rebate='100';FleetPoints='0'}
            if ($name -eq 'parts') {
                switch ($mode) {
                    'blank' { $record.FleetEligible='' }
                    'missing-header' { $record.Remove('FleetTier2Rebate') }
                    'foreign-brand' { $record.BrandID='TORO' }
                    'negative' { $record.FleetTier1Discount='-1' }
                }
            }
            $rows=@([pscustomobject]$record)
            if ($mode -eq 'duplicate' -and $name -eq 'parts') { $rows+= [pscustomobject]$record }
            $rows | Export-Csv -LiteralPath (Join-Path $folder ($name+'.csv')) -NoTypeInformation -Encoding UTF8
        }
        if ($mode -eq 'missing-file') { Remove-Item -LiteralPath (Join-Path $folder 'parts.csv') }
        $oldPreference=$ErrorActionPreference
        $ErrorActionPreference='Continue'
        $output = & $shell -NoProfile -File $harness -ScriptUnderTest $underTest -DataFolder $folder 2>&1
        $code=$LASTEXITCODE
        $ErrorActionPreference=$oldPreference
        $result=$output -join "`n"
        if ($mode -eq 'valid') {
            if ($code -ne 0 -or $result -notmatch 'TEST validated uploads and all four mirrors') { throw "Valid export test failed: $result" }
        } else {
            if ($code -eq 0 -or $result -match 'TEST credential reached') { throw "$mode did not stop before sign-in/upload: $result" }
            $expected=switch ($mode) { 'blank' {'blank fleet data'} 'missing-header' {'missing FleetTier2Rebate'} 'foreign-brand' {'contains another brand'} 'negative' {'invalid FleetTier1Discount'} 'duplicate' {'duplicate SKU'} 'missing-file' {'export is missing: parts'} }
            if ($result -notmatch [regex]::Escape($expected)) { throw "$mode failed for an unexpected reason: $result" }
        }
        Write-Host "PASS private sync: $mode"
    }
}
finally { Remove-Item -LiteralPath $temporary -Recurse -Force }
