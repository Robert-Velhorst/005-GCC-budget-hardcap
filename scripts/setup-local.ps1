[CmdletBinding()]
param([switch]$SkipInstall)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'lib\Runtime.ps1')
Set-Location -LiteralPath $root

Assert-SupportedNode
$runtime = Join-Path $root '.runtime'
$secrets = Join-Path $runtime 'control.env'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null

if (-not (Test-Path -LiteralPath $secrets)) {
    $operatorToken = New-SecureToken
    $haiToken = New-SecureToken
    @(
        "CONTROL_PLANE_TOKEN=$operatorToken"
        "HAI_CONNECTOR_TOKEN=$haiToken"
    ) | Set-Content -LiteralPath $secrets -Encoding ascii
    & icacls.exe $secrets /inheritance:r /grant:r "${env:USERNAME}:F" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not restrict the generated secret file permissions.' }
}

$localEnvironment = Join-Path $root '.env.local'
if (-not (Test-Path -LiteralPath $localEnvironment)) {
    Copy-Item -LiteralPath (Join-Path $root '.env.example') -Destination $localEnvironment
}

if (-not $SkipInstall) { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' } }
& npm.cmd run build:web
if ($LASTEXITCODE -ne 0) { throw 'The web build failed.' }

Write-Host 'Local setup is ready.'
Write-Host 'Review .env.local, especially PROJECT_ID, budget name, currency, and allowed zones.'
Write-Host 'Secrets were generated under .runtime with restricted Windows permissions and were not printed.'
