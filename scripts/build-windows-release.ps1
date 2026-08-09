[CmdletBinding()]
param(
    [string]$OutputDirectory,
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'lib\Runtime.ps1')
Set-Location -LiteralPath $root

Assert-SupportedNode
$nodeExecutable = (Get-Command node).Source
$releaseRoot = if ($OutputDirectory) {
    [IO.Path]::GetFullPath($OutputDirectory)
} else {
    Join-Path $root 'dist\GCC-Budget-Hardcap-Windows-x64'
}
$distRoot = [IO.Path]::GetFullPath((Join-Path $root 'dist'))
if (-not $releaseRoot.StartsWith("$distRoot$([IO.Path]::DirectorySeparatorChar)", [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Windows release output must stay under the repository dist directory.'
}

if (-not $SkipInstall) {
    Invoke-Npm ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
}
Invoke-Npm run build:web
if ($LASTEXITCODE -ne 0) { throw 'The web build failed.' }

if (Test-Path -LiteralPath $releaseRoot) {
    Remove-Item -LiteralPath $releaseRoot -Recurse -Force
}
$app = Join-Path $releaseRoot 'app'
$runtime = Join-Path $releaseRoot 'runtime'
$scripts = Join-Path $releaseRoot 'scripts'
$config = Join-Path $releaseRoot 'config'
New-Item -ItemType Directory -Path $app, $runtime, $scripts, $config | Out-Null

Copy-Item -LiteralPath (Join-Path $root 'deploy\control\package.json') -Destination $app
Copy-Item -LiteralPath (Join-Path $root 'deploy\control\package-lock.json') -Destination $app
Push-Location -LiteralPath $app
try {
    Invoke-Npm ci --omit=dev
    if ($LASTEXITCODE -ne 0) { throw 'Production dependency install failed.' }
} finally {
    Pop-Location
}

Copy-Item -LiteralPath (Join-Path $root 'index.js') -Destination $app
Copy-Item -LiteralPath (Join-Path $root 'src') -Destination $app -Recurse
New-Item -ItemType Directory -Path (Join-Path $app 'web') | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'web\dist') -Destination (Join-Path $app 'web') -Recurse
Copy-Item -LiteralPath $nodeExecutable -Destination (Join-Path $runtime 'node.exe')
Copy-Item -LiteralPath (Join-Path $root 'scripts\lib\Runtime.ps1') -Destination $scripts
Copy-Item -LiteralPath (Join-Path $root 'windows\portable.ps1') -Destination $scripts
Copy-Item -LiteralPath (Join-Path $root 'windows\Start GCC Budget Hardcap.cmd') -Destination $releaseRoot
Copy-Item -LiteralPath (Join-Path $root 'windows\Start Public Tunnel.cmd') -Destination $releaseRoot
Copy-Item -LiteralPath (Join-Path $root 'windows\README.txt') -Destination $releaseRoot
Copy-Item -LiteralPath (Join-Path $root '.env.example') -Destination (Join-Path $config 'app.env.example')
Copy-Item -LiteralPath (Join-Path $root 'LICENSE') -Destination $releaseRoot

Push-Location -LiteralPath $app
try {
    & (Join-Path $runtime 'node.exe') -e "require('better-sqlite3'); require('@modelcontextprotocol/sdk/server/mcp.js');"
    if ($LASTEXITCODE -ne 0) { throw 'Bundled native/runtime dependency verification failed.' }
} finally {
    Pop-Location
}

$forbiddenRuntimeState = @(
    (Join-Path $releaseRoot 'data'),
    (Join-Path $releaseRoot 'app.env'),
    (Join-Path $releaseRoot 'control.env'),
    (Join-Path $app 'budget-hardcap.db')
)
if ($forbiddenRuntimeState | Where-Object { Test-Path -LiteralPath $_ }) {
    throw 'Runtime configuration, secrets, or database state would be included in the release.'
}

$zip = "$releaseRoot.zip"
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
$archiveTool = (Get-Command tar.exe -ErrorAction Stop).Source
& $archiveTool -a -c -f $zip -C (Split-Path -Parent $releaseRoot) (Split-Path -Leaf $releaseRoot)
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $zip) -or (Get-Item $zip).Length -eq 0) {
    throw 'Portable release archive creation failed.'
}
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$zip.sha256" -Value "$hash  $([IO.Path]::GetFileName($zip))" -Encoding ascii

Write-Host "Portable Windows release: $zip"
Write-Host "SHA256: $hash"
Write-Host 'No configuration, generated tokens, database, logs, or Google credentials were included.'
