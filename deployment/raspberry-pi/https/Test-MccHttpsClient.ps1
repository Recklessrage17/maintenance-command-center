<#
.SYNOPSIS
Verifies normal Windows trust, HTTP redirect, and the MCC HTTPS health endpoint.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9.-]+$')]
    [string]$Hostname
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$handler = [Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $false
$client = [Net.Http.HttpClient]::new($handler)
try {
    $httpResponse = $client.GetAsync("http://$Hostname/").GetAwaiter().GetResult()
    if ([int]$httpResponse.StatusCode -notin 301, 302, 307, 308) {
        throw "HTTP did not redirect to HTTPS (status $([int]$httpResponse.StatusCode))."
    }
    $expectedLocation = "https://$Hostname/"
    if ($httpResponse.Headers.Location.AbsoluteUri -cne $expectedLocation) {
        throw "HTTP redirect target was '$($httpResponse.Headers.Location)' instead of '$expectedLocation'."
    }

    # This request deliberately uses the normal Windows certificate verifier.
    # There is no certificate-validation bypass in this test.
    $healthResponse = $client.GetAsync("https://$Hostname/api/health").GetAwaiter().GetResult()
    $healthBody = $healthResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if (-not $healthResponse.IsSuccessStatusCode) {
        throw "HTTPS health check failed with status $([int]$healthResponse.StatusCode)."
    }
    $health = $healthBody | ConvertFrom-Json
    if ($health.ok -ne $true) {
        throw 'HTTPS health response did not report ok=true.'
    }
    Write-Output "PASS: http://$Hostname redirects to trusted https://$Hostname and /api/health reports ok=true."
} finally {
    $client.Dispose()
    $handler.Dispose()
}
