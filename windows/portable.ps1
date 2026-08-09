[CmdletBinding()]
param([switch]$Public)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Runtime.ps1')

$data = Join-Path $root 'data'
$configuration = Join-Path $data 'app.env'
$secrets = Join-Path $data 'control.env'
New-Item -ItemType Directory -Path $data -Force | Out-Null

if (-not (Test-Path -LiteralPath $configuration)) {
    Copy-Item -LiteralPath (Join-Path $root 'config\app.env.example') -Destination $configuration
}
if (-not (Test-Path -LiteralPath $secrets)) {
    @(
        "CONTROL_PLANE_TOKEN=$(New-SecureToken)"
        "HAI_CONNECTOR_TOKEN=$(New-SecureToken)"
    ) | Set-Content -LiteralPath $secrets -Encoding ascii
    & icacls.exe $secrets /inheritance:r /grant:r "${env:USERNAME}:F" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not restrict the generated token file.' }
}

Import-EnvironmentFile $configuration
Import-EnvironmentFile $secrets
$env:CONTROL_HOST = '127.0.0.1'
$env:TRUST_PROXY = if ($Public) { 'true' } else { 'false' }
$env:PUBLIC_ACCESS_ENABLED = if ($Public) { 'true' } else { 'false' }
$env:LOCAL_DATABASE_PATH = Join-Path $data 'budget-hardcap.db'
if (-not $env:CONTROL_PORT) { $env:CONTROL_PORT = '8787' }
$port = [int]$env:CONTROL_PORT
Assert-LocalPortAvailable -Port $port

if ($Public -and -not (Get-Command ngrok -ErrorAction SilentlyContinue)) {
    throw 'ngrok is required for the public launcher. Install it and authenticate the owning account first.'
}

$node = Join-Path $root 'runtime\node.exe'
$app = Join-Path $root 'app'
$logOut = Join-Path $data 'control.out.log'
$logError = Join-Path $data 'control.error.log'
$process = Start-Process -FilePath $node -ArgumentList 'src/control/main.js' -WorkingDirectory $app -RedirectStandardOutput $logOut -RedirectStandardError $logError -WindowStyle Hidden -PassThru
try {
    Wait-LocalHealth -Port $port -Process $process
    $url = "http://127.0.0.1:$port"
    if ($Public) {
        Write-Host 'The authenticated local service is healthy. Starting ngrok.'
        Write-Host 'The operator token is stored in data\control.env and is not printed.'
        & ngrok http $url
        if ($LASTEXITCODE -ne 0) { throw "ngrok exited with code $LASTEXITCODE." }
    } else {
        Write-Host "GCC Budget Hardcap is running at $url"
        Start-Process $url
        Wait-Process -Id $process.Id
    }
} finally {
    if (-not $process.HasExited) { Stop-Process -Id $process.Id }
}
