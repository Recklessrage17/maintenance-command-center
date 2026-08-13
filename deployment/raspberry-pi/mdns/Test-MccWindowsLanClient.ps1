<#
.SYNOPSIS
Validates hostname resolution, proxy ports, loopback-only Node, and trusted HTTPS from a Windows LAN client.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9.-]+\.local$')]
    [string]$Hostname,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$')]
    [string]$ExpectedAddress,

    [ValidateSet(4273, 4274)]
    [int]$NodePort = 4274,

    [switch]$RequireNoHostsOverride
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

function Test-TcpPort {
    param([string]$Address, [int]$Port, [int]$TimeoutMilliseconds = 3000)
    $client = [Net.Sockets.TcpClient]::new()
    try {
        $connect = $client.ConnectAsync($Address, $Port)
        if (-not $connect.Wait($TimeoutMilliseconds)) { return $false }
        return $client.Connected
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

$hostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$escapedHostname = [Regex]::Escape($Hostname)
$hostsMatches = @(Get-Content -LiteralPath $hostsPath | Where-Object {
    ($_ -replace '#.*$', '') -match "(^|\s)$escapedHostname(\s|$)"
})
if ($RequireNoHostsOverride -and $hostsMatches.Count -gt 0) {
    throw "$Hostname is still overridden in $hostsPath. Remove the temporary entry before accepting mDNS."
}

$addresses = @([Net.Dns]::GetHostAddresses($Hostname) | Where-Object {
    $_.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork
} | ForEach-Object IPAddressToString | Sort-Object -Unique)
if ($addresses.Count -eq 0) { throw "$Hostname did not resolve to an IPv4 address." }
if ($ExpectedAddress -notin $addresses) {
    throw "$Hostname resolved to '$($addresses -join ', ')' instead of $ExpectedAddress."
}
if (@($addresses | Where-Object { $_ -ne $ExpectedAddress }).Count -gt 0) {
    throw "$Hostname also resolved to an unexpected address: $($addresses -join ', '). Treat this as a conflict."
}

foreach ($proxyPort in 80, 443) {
    if (-not (Test-TcpPort -Address $ExpectedAddress -Port $proxyPort)) {
        throw "Caddy TCP $proxyPort is not reachable at $ExpectedAddress."
    }
}
if (Test-TcpPort -Address $ExpectedAddress -Port $NodePort) {
    throw "Node TCP $NodePort is reachable from the LAN; it must remain loopback-only."
}

$handler = [Net.Http.HttpClientHandler]::new()
$client = [Net.Http.HttpClient]::new($handler)
try {
    $healthResponse = $client.GetAsync("https://$Hostname/api/health").GetAwaiter().GetResult()
    $healthBody = $healthResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if (-not $healthResponse.IsSuccessStatusCode) {
        throw "Trusted HTTPS health returned status $([int]$healthResponse.StatusCode)."
    }
    $health = $healthBody | ConvertFrom-Json
    if ($health.ok -ne $true) { throw 'Trusted HTTPS health did not report ok=true.' }
} finally {
    $client.Dispose()
    $handler.Dispose()
}

$source = if ($hostsMatches.Count -gt 0) { 'Windows hosts file (not mDNS)' } else { 'normal Windows resolver with no hosts override' }
Write-Output "PASS: $Hostname -> $ExpectedAddress via $source; Caddy 80/443 reachable, Node $NodePort blocked, and trusted HTTPS health is valid."
