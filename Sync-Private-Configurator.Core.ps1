$ErrorActionPreference = "Stop"

$api =
    "https://westendpower-configurator-api.westendpower-nm.workers.dev"

$privateFolder =
    Join-Path $env:LOCALAPPDATA "WestEndPower\ConfiguratorPrivate\STIHL"

if (-not (Test-Path -LiteralPath $privateFolder)) {
    throw "Private configurator folder not found: $privateFolder"
}

$datasets = @(
    "products",
    "attachments",
    "accessories",
    "batteries",
    "chargers",
    "parts",
    "promotions",
    "finance-programs",
    "bid-fleet-programs",
    "freight-rules",
    "dealer-rules",
    "inventory"
)

$admin = Get-Credential `
    -UserName "westend-admin" `
    -Message "Enter West End configurator admin password"

$pair =
    $admin.UserName + ":" +
    $admin.GetNetworkCredential().Password

$basic =
    [Convert]::ToBase64String(
        [Text.Encoding]::UTF8.GetBytes($pair)
    )

$headers = @{
    "Authorization" = "Basic " + $basic
}

foreach ($dataset in $datasets) {

    $file =
        Join-Path $privateFolder ($dataset + ".csv")

    if (-not (Test-Path -LiteralPath $file)) {

        Write-Host `
            "SKIP  $dataset - file not found" `
            -ForegroundColor Yellow

        continue
    }

    $rows =
        @(Import-Csv -LiteralPath $file)

    $body = @{
        brandId = "STIHL"
        dataset = $dataset
        payload = $rows
    } |
        ConvertTo-Json -Depth 20 -Compress

    $result =
        Invoke-RestMethod `
            -Uri ($api + "/config-private-sync") `
            -Method Post `
            -ContentType "application/json" `
            -Headers $headers `
            -Body $body

    if ($result.ok) {

        Write-Host `
            ("PASS  {0}  {1} rows" -f `
                $dataset, `
                $rows.Count) `
            -ForegroundColor Green

    }
    else {

        throw "D1 sync failed for dataset: $dataset"
    }
}

Remove-Variable pair -ErrorAction SilentlyContinue
Remove-Variable basic -ErrorAction SilentlyContinue
Remove-Variable admin -ErrorAction SilentlyContinue

Write-Host ""
Write-Host `
    "PRIVATE CONFIGURATOR D1 SYNC COMPLETE" `
    -ForegroundColor Green
