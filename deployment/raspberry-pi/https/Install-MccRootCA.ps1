<#
.SYNOPSIS
Installs the fingerprint-verified MCC internal CA root for Windows clients.

.DESCRIPTION
Run from an elevated PowerShell session. The expected SHA-256 fingerprint must
be obtained from the Raspberry Pi through a separate authenticated channel.
Only a currently valid, self-issued CA certificate is accepted.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
    [string]$CertificatePath,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^(?:[0-9A-Fa-f]{2}[:-]?){31}[0-9A-Fa-f]{2}$')]
    [string]$ExpectedSha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this script from an elevated PowerShell session.'
}

$resolvedPath = (Resolve-Path -LiteralPath $CertificatePath).Path
$certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($resolvedPath)
$normalizedExpected = ($ExpectedSha256 -replace '[:-]', '').ToUpperInvariant()
$sha256 = [Security.Cryptography.SHA256]::Create()
try {
    $actualSha256 = ($sha256.ComputeHash($certificate.RawData) |
        ForEach-Object { $_.ToString('X2') }) -join ''
} finally {
    $sha256.Dispose()
}

if ($actualSha256 -cne $normalizedExpected) {
    throw "MCC root CA SHA-256 mismatch. Expected $normalizedExpected but received $actualSha256."
}
if ($certificate.Subject -cne $certificate.Issuer) {
    throw 'The supplied MCC root certificate is not self-issued.'
}
if ($certificate.NotBefore.ToUniversalTime() -gt [DateTime]::UtcNow -or
    $certificate.NotAfter.ToUniversalTime() -le [DateTime]::UtcNow) {
    throw 'The supplied MCC root certificate is not currently valid.'
}

$basicConstraints = $certificate.Extensions |
    Where-Object { $_ -is [Security.Cryptography.X509Certificates.X509BasicConstraintsExtension] } |
    Select-Object -First 1
if ($null -eq $basicConstraints -or -not $basicConstraints.CertificateAuthority) {
    throw 'The supplied certificate is not a CA certificate.'
}

$store = [Security.Cryptography.X509Certificates.X509Store]::new(
    [Security.Cryptography.X509Certificates.StoreName]::Root,
    [Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine
)
try {
    $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    $store.Add($certificate)
} finally {
    $store.Close()
}

$verificationStore = [Security.Cryptography.X509Certificates.X509Store]::new(
    [Security.Cryptography.X509Certificates.StoreName]::Root,
    [Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine
)
try {
    $verificationStore.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
    $installed = $verificationStore.Certificates |
        Where-Object { $_.Thumbprint -eq $certificate.Thumbprint } |
        Select-Object -First 1
    if ($null -eq $installed) {
        throw 'MCC root CA was not found in the Local Machine Trusted Root store after installation.'
    }
} finally {
    $verificationStore.Close()
}

Write-Output "Installed MCC root CA in Cert:\LocalMachine\Root."
Write-Output "Subject: $($certificate.Subject)"
Write-Output "SHA-256: $actualSha256"
Write-Output "Valid through: $($certificate.NotAfter.ToUniversalTime().ToString('u'))"
