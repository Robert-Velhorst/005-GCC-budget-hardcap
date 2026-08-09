[CmdletBinding()]
param([string]$Domain)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'lib\Runtime.ps1')
Set-Location -LiteralPath $root

Assert-SupportedNode
if (-not (Get-Command ngrok -ErrorAction SilentlyContinue)) { throw 'ngrok is not installed or not on PATH.' }
Import-EnvironmentFile (Join-Path $root '.env.local')
Import-EnvironmentFile (Join-Path $root '.runtime\control.env')
if (-not $env:CONTROL_PLANE_TOKEN -or $env:CONTROL_PLANE_TOKEN.Length -lt 32) { throw 'Run scripts\setup-local.ps1 before public startup.' }
$env:CONTROL_HOST = '127.0.0.1'
$env:PUBLIC_ACCESS_ENABLED = 'true'
$env:TRUST_PROXY = 'true'
if (-not $env:CONTROL_PORT) { $env:CONTROL_PORT = '8787' }
Assert-LocalPortAvailable -Port ([int]$env:CONTROL_PORT)

$logOut = Join-Path $root '.runtime\public-control.out.log'
$logError = Join-Path $root '.runtime\public-control.error.log'
$process = Start-Process -FilePath (Get-Command node).Source -ArgumentList 'src/control/main.js' -WorkingDirectory $root -RedirectStandardOutput $logOut -RedirectStandardError $logError -WindowStyle Hidden -PassThru
try {
    Wait-LocalHealth -Port ([int]$env:CONTROL_PORT) -Process $process
    Write-Host 'The local service is healthy. ngrok will expose it with mandatory operator authentication.'
    $arguments = @('http', "http://127.0.0.1:$($env:CONTROL_PORT)")
    if ($Domain) { $arguments += "--domain=$Domain" }
    & ngrok @arguments
    if ($LASTEXITCODE -ne 0) { throw "ngrok exited with code $LASTEXITCODE." }
} finally {
    if (-not $process.HasExited) { Stop-Process -Id $process.Id }
}
