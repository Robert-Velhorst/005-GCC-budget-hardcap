. (Join-Path $PSScriptRoot 'lib\Runtime.ps1')
$cases = @(
    @('v24.22.1', $true), @('v26.12.1', $true), @('v24.23.0', $true),
    @('v24.22.0', $false), @('v26.12.0', $false), @('v22.23.4', $false),
    @('v25.0.0', $false), @('v27.0.0', $false), @('v26.12.1-rc.1', $false)
)
foreach ($case in $cases) {
    if ((Test-SupportedNodeVersion -Version $case[0]) -ne $case[1]) { throw "Incorrect runtime decision for $($case[0])" }
}
Assert-SupportedNode
@{ passed = $cases.Count; actualNodeAccepted = $true } | ConvertTo-Json -Compress
