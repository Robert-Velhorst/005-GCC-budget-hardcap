[CmdletBinding()]
param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'lib\Runtime.ps1')
Set-Location -LiteralPath $root

Assert-SupportedNode
Import-EnvironmentFile (Join-Path $root '.env.local')
Import-EnvironmentFile (Join-Path $root '.runtime\control.env')
$env:CONTROL_HOST = '127.0.0.1'
$env:PUBLIC_ACCESS_ENABLED = 'false'
$env:TRUST_PROXY = 'false'
if (-not $env:CONTROL_PORT) { $env:CONTROL_PORT = '8787' }
Assert-LocalPortAvailable -Port ([int]$env:CONTROL_PORT)

if (-not (Test-Path -LiteralPath (Join-Path $root 'web\dist\index.html'))) {
    & npm.cmd run build:web
    if ($LASTEXITCODE -ne 0) { throw 'The web build failed.' }
}

$logOut = Join-Path $root '.runtime\control.out.log'
$logError = Join-Path $root '.runtime\control.error.log'
$process = Start-Process -FilePath (Get-Command node).Source -ArgumentList 'src/control/main.js' -WorkingDirectory $root -RedirectStandardOutput $logOut -RedirectStandardError $logError -WindowStyle Hidden -PassThru
try {
    Wait-LocalHealth -Port ([int]$env:CONTROL_PORT) -Process $process
    $url = "http://127.0.0.1:$($env:CONTROL_PORT)"
    Write-Host "GCC Budget Hardcap is running at $url"
    Write-Host "Process: $($process.Id). Logs: .runtime\control.out.log and .runtime\control.error.log"
    if (-not $NoBrowser) { Start-Process $url }
    Wait-Process -Id $process.Id
} finally {
    if (-not $process.HasExited) { Stop-Process -Id $process.Id }
}
