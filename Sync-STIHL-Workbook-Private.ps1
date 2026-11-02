[CmdletBinding()]
param([string]$PrivateFolder = (Join-Path $env:LOCALAPPDATA 'WestEndPower\ConfiguratorPrivate'))
$ErrorActionPreference = 'Stop'
$required = @('products','attachments','accessories','parts')
$requiredFiles = $required + @('bid-fleet-programs','finance-programs','inventory')
$fields = @('FleetEligible','FleetRebateProgram','FleetTier1Discount','FleetTier1Rebate','FleetTier2Discount','FleetTier2Rebate','FleetPoints')
$datasets = @('products','attachments','accessories','batteries','chargers','parts','promotions','finance-programs','bid-fleet-programs','freight-rules','dealer-rules','inventory')
$prepared = @()
$completed = 0
try {
    # Preflight all required exports before the first upload or local mirror update.
    foreach ($dataset in $datasets) {
        $file = Join-Path $PrivateFolder ($dataset + '.csv')
        if ($dataset -eq 'inventory') { $file = Join-Path (Join-Path $PrivateFolder 'STIHL') 'inventory.csv' }
        if (-not (Test-Path -LiteralPath $file)) {
            if ($dataset -in $requiredFiles) { throw "Required current workbook export is missing: $dataset" }
            Write-Host "SKIP  $dataset - file not found" -ForegroundColor Yellow
            continue
        }
        $rows = @(Import-Csv -LiteralPath $file)
        foreach ($row in $rows) {
            if ($row.PSObject.Properties.Name -contains 'BrandID' -and -not [string]::IsNullOrWhiteSpace([string]$row.BrandID) -and ([string]$row.BrandID).Trim() -ine 'STIHL') { throw "$dataset contains another brand. Sync stopped." }
        }
        if ($dataset -in $required) {
            if ($rows.Count -eq 0) { throw "$dataset export is empty." }
            $headers = @($rows[0].PSObject.Properties.Name)
            $privateHeaders = @('SKU','BrandID','DealerCost')
            if ($dataset -eq 'products') { $privateHeaders += @('RebateToCustomer','RebateToDealer') }
            foreach ($field in $privateHeaders + $fields) {
                if ($field -notin $headers) { throw "$dataset is missing $field. Refresh and export the repaired workbook first." }
            }
            $seen = @{}
            $populated = 0
            foreach ($row in $rows) {
                $sku = ([string]$row.SKU).Trim()
                if (-not $sku -or $sku -in @('REFERENCE_ONLY','0000 000 0000')) { throw "$dataset has a blank or template SKU. Re-export before sync." }
                if ($seen.ContainsKey($sku)) { throw "$dataset has duplicate SKU $sku." }
                $seen[$sku] = $true
                if (([string]$row.BrandID).Trim() -ine 'STIHL') { throw "$dataset / $sku has blank BrandID. Run Update Data and Export from the repaired workbook." }
                $eligible = ([string]$row.FleetEligible).Trim()
                if ($eligible) {
                    if ($eligible -notmatch '^(?i:T|F|TRUE|FALSE|Y|N|YES|NO|1|0|X)$') { throw "$dataset has invalid FleetEligible for $sku." }
                    $populated++
                }
                foreach ($field in @('FleetTier1Discount','FleetTier1Rebate','FleetTier2Discount','FleetTier2Rebate','FleetPoints')) {
                    $value = ([string]$row.$field).Trim()
                    if (-not $value) { continue }
                    $amount = 0.0
                    if (-not [double]::TryParse($value.Replace('$','').Replace(',',''), [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$amount) -or [double]::IsNaN($amount) -or [double]::IsInfinity($amount) -or $amount -lt 0) {
                        throw "$dataset has an invalid $field amount for $sku."
                    }
                }
            }
            if ($populated -eq 0) { throw "$dataset has blank fleet data. Refresh and export the repaired workbook first." }
            Write-Host "PASS  $dataset fleet preflight: $($rows.Count) rows, all seven columns present" -ForegroundColor Green
        }
        if ($dataset -eq 'inventory') {
            foreach ($row in $rows) {
                if (([string]$row.Brand).Trim() -ine 'STIHL' -or [string]::IsNullOrWhiteSpace([string]$row.SKU) -or ([string]$row.SKU).Trim() -ieq 'STOP') { throw 'Inventory contains an invalid or other-brand row. Sync stopped.' }
            }
        }
        $prepared += [pscustomobject]@{ Dataset=$dataset; File=$file; Rows=$rows }
    }
    $brandFolder = Join-Path $PrivateFolder 'STIHL'
    New-Item -ItemType Directory -Path $brandFolder -Force | Out-Null
    foreach ($item in $prepared) {
        if ($item.Dataset -eq 'inventory') { continue }
        $target = Join-Path $brandFolder ($item.Dataset + '.csv')
        if (Test-Path -LiteralPath $target) { Copy-Item -LiteralPath $target -Destination ($target + '.before-current-workbook.csv') -Force }
        Copy-Item -LiteralPath $item.File -Destination $target -Force
    }
    $admin = Get-Credential -UserName 'westend-admin' -Message 'Enter West End configurator admin password'
    if ($null -eq $admin) { throw 'Sign-in cancelled. No data was synced.' }
    $pair = $admin.UserName + ':' + $admin.GetNetworkCredential().Password
    $headers = @{Authorization = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pair))}
    foreach ($item in $prepared) {
        $body = @{brandId='STIHL'; dataset=$item.Dataset; payload=@($item.Rows)}
        if ($item.Dataset -eq 'inventory') { $body.source = 'dealer-inventory-master' }
        $json = $body | ConvertTo-Json -Depth 20 -Compress
        $result = Invoke-RestMethod -Uri 'https://westendpower-configurator-api.westendpower-nm.workers.dev/config-private-sync' -Method Post -ContentType 'application/json; charset=utf-8' -Headers $headers -Body ([Text.Encoding]::UTF8.GetBytes($json))
        if (-not $result.ok) { throw "Sync failed for $($item.Dataset)." }
        $completed++
        Write-Host ("PASS  {0}  {1} rows" -f $item.Dataset, $item.Rows.Count) -ForegroundColor Green
    }
    Write-Host 'STIHL WORKBOOK PRIVATE DATA SYNC COMPLETE' -ForegroundColor Green
}
catch {
    Write-Host "STIHL SYNC FAILED: $($_.Exception.Message)" -ForegroundColor Red
    if ($completed -gt 0) { Write-Host "$completed datasets were already updated. Retry to complete the remaining sync." }
    exit 1
}
finally { Remove-Variable pair,headers,admin -ErrorAction SilentlyContinue }
