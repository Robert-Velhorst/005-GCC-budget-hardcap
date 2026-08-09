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

function Assert-SupportedNode {
    $version = (& node --version 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $version) { throw 'Node.js 22 LTS is required.' }
    $major = [int]($version.TrimStart('v').Split('.')[0])
    if ($major -lt 22 -or $major -ge 25) { throw "Node.js 22, 23, or 24 is required; found $version." }
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
