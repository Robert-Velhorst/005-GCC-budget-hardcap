Set-StrictMode -Version Latest

function Import-EnvironmentFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $index = $trimmed.IndexOf('=')
        if ($index -lt 1) { throw "Invalid environment line in $Path" }
        $name = $trimmed.Substring(0, $index).Trim()
        $value = $trimmed.Substring($index + 1)
        if ($name -notmatch '^[A-Z][A-Z0-9_]*$') { throw "Invalid environment variable name in $Path" }
        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
}

function New-SecureToken {
    $bytes = [byte[]]::new(32)
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    } finally {
        $generator.Dispose()
    }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Test-SupportedNodeVersion {
    param([Parameter(Mandatory = $true)][string]$Version)
    if ($Version -notmatch '^v?\d+\.\d+\.\d+$') { return $false }
    $parsed = [Version]$Version.TrimStart('v')
    return (($parsed.Major -eq 24 -and $parsed -ge [Version]'24.22.1') -or
        ($parsed.Major -eq 26 -and $parsed -ge [Version]'26.12.1'))
}

function Assert-SupportedNode {
    $version = (& node --version 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $version) { throw 'Node.js 24.22.1+ or 26.12.1+ is required.' }
    if (-not (Test-SupportedNodeVersion -Version $version)) { throw "Node.js 24.22.1+ (24.x) or 26.12.1+ (26.x) is required; found $version." }
}

function Invoke-Npm {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$NpmArguments)
    $node = (Get-Command node).Source
    $npmCli = $env:npm_execpath
    if (-not $npmCli -or -not (Test-Path -LiteralPath $npmCli -PathType Leaf) -or (Split-Path -Leaf $npmCli) -ne 'npm-cli.js') {
        $npmCommand = (Get-Command npm.cmd).Source
        $npmCli = Join-Path (Split-Path -Parent $npmCommand) 'node_modules\npm\bin\npm-cli.js'
    }
    if (-not (Test-Path -LiteralPath $npmCli -PathType Leaf)) { throw 'Could not locate npm-cli.js; run this build through the pinned npm version.' }
    & $node $npmCli @NpmArguments
}

function Assert-LocalPortAvailable {
    param([int]$Port = 8787)
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
    try {
        $listener.Start()
    } catch {
        throw "Local port $Port is already in use. Stop the existing service or choose another CONTROL_PORT."
    } finally {
        $listener.Stop()
    }
}

function Wait-LocalHealth {
    param(
        [int]$Port = 8787,
        [int]$TimeoutSeconds = 45,
        [Diagnostics.Process]$Process
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        if ($Process) {
            $Process.Refresh()
            if ($Process.HasExited) {
                throw "Control plane exited during startup with code $($Process.ExitCode)."
            }
        }
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/healthz" -TimeoutSec 2
            if ($health.status -eq 'ok') { return }
        } catch { Start-Sleep -Milliseconds 500 }
    } while ((Get-Date) -lt $deadline)
    throw "Control plane did not become healthy on port $Port."
}
