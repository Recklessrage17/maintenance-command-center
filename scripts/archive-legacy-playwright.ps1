# One-time, explicit archival of the pre-marker PID directories. No deletion.
# New runs must use playwright-cleanup.mjs instead.
param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$legacyRoot = Join-Path $repo 'tmp'
$archiveRoot = Join-Path $repo ('diagnostics\playwright\legacy-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$locks = [System.Collections.Generic.List[System.IO.FileStream]]::new()
$inventory = [System.Collections.Generic.List[object]]::new()

function Assert-ContainedPath([string]$Base, [string]$Target) {
    $baseFull = [IO.Path]::GetFullPath($Base).TrimEnd('\') + '\'
    $targetFull = [IO.Path]::GetFullPath($Target)
    if (-not $targetFull.StartsWith($baseFull, [StringComparison]::OrdinalIgnoreCase)) { throw "Outside designated root: $Target" }
    $part = $targetFull
    while ($part -and $part.Length -ge $repo.Length) {
        if (Test-Path -LiteralPath $part) {
            $item = Get-Item -LiteralPath $part -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing reparse point: $part" }
        }
        $part = Split-Path -Parent $part
    }
}

try {
    # Verify provenance against the historical config, not just a name prefix.
    $oldConfig = (& git -C $repo show HEAD:playwright.config.ts) -join "`n"
    if ($LASTEXITCODE -ne 0 -or -not $oldConfig.Contains('`playwright-${process.pid}`') -or
        -not $oldConfig.Contains("resolve('tmp',") -or -not $oldConfig.Contains('MCC_BACKUPS_DIR')) {
        throw 'HEAD no longer contains the legacy config. Review provenance manually; do not bypass this guard.'
    }
    $processes = @(Get-CimInstance Win32_Process)
    $directories = @(Get-ChildItem -LiteralPath $legacyRoot -Directory -Force | Where-Object { $_.Name -match '^playwright-\d+$' })
    foreach ($directory in $directories) {
        Assert-ContainedPath $legacyRoot $directory.FullName
        $children = @(Get-ChildItem -LiteralPath $directory.FullName -Force)
        if (($children.Name | Sort-Object) -join ',' -ne 'backups,data,uploads' -or @($children | Where-Object { -not $_.PSIsContainer }).Count) {
            throw "Unexpected legacy layout: $($directory.FullName)"
        }
        # Walk one level at a time, rejecting links before recursing into them.
        $pending = [System.Collections.Generic.Queue[string]]::new()
        $pending.Enqueue($directory.FullName)
        $files = [System.Collections.Generic.List[object]]::new()
        while ($pending.Count) {
            foreach ($item in Get-ChildItem -LiteralPath $pending.Dequeue() -Force) {
                # Parent was already validated. Inspect the child before it can
                # enter the traversal queue; never recurse through a reparse point.
                if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing reparse point: $($item.FullName)" }
                if ($item.PSIsContainer) { $pending.Enqueue($item.FullName) } else { $files.Add($item) }
            }
        }
        # A read-only SQLite inspection can refresh its shared-memory index.
        # Use durable content age plus the exclusive DB lock, not SHM timestamps.
        $newest = ($files | Where-Object { $_.Name -notlike '*.sqlite-shm' } | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc
        if ($newest -gt [DateTime]::UtcNow.AddDays(-1)) { throw "Recently modified legacy run: $($directory.Name)" }
        $oldPid = [int]($directory.Name -replace '^playwright-', '')
        foreach ($process in $processes) {
            if ($process.ProcessId -eq $oldPid -and $process.CreationDate.ToUniversalTime() -le $newest) { throw "Legacy owner PID is still active: $oldPid" }
            if ($process.CommandLine -and $process.CommandLine.Contains($directory.FullName)) { throw "Associated process is active: $($process.ProcessId)" }
        }
        $database = Join-Path $directory.FullName 'data\mcc.sqlite'
        # SQLite stays open throughout MCC server lifetime. Deny read/write sharing
        # to prove no live backend owns this DB, including services whose command
        # line we cannot inspect. Keep this lock through the move; allow rename only.
        $stream = [IO.File]::Open($database, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Delete)
        $locks.Add($stream)
        $header = New-Object byte[] 16
        [void]$stream.Read($header, 0, 16)
        if ([Text.Encoding]::ASCII.GetString($header) -ne "SQLite format 3`0") { throw "Invalid database: $database" }
        $manifestFiles = @($files | Where-Object { $_.Name -eq 'manifest.json' -and $_.FullName.StartsWith((Join-Path $directory.FullName 'backups\')) })
        if (-not $manifestFiles.Count) { throw "No generated backup provenance: $($directory.Name)" }
        foreach ($manifestFile in $manifestFiles) {
            $manifest = Get-Content -LiteralPath $manifestFile.FullName -Raw | ConvertFrom-Json
            if ($manifest.appName -ne 'Maintenance Command Center' -or $manifest.backupType -notin @('weekly_scheduled', 'master_scheduled') -or $manifest.recordCounts.users -ne 0) {
                throw "Unexpected backup provenance: $($manifestFile.FullName)"
            }
        }
        # Hash the locked database through its existing handle; all other files
        # are read-only. The manifest preserves every byte's identity for review.
        $records = foreach ($file in $files) {
            if ($file.FullName -eq $database) {
                $stream.Position = 0
                $sha = [Security.Cryptography.SHA256]::Create()
                try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') } finally { $sha.Dispose() }
            } else { $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash }
            [ordered]@{ path = $file.FullName.Substring($directory.FullName.Length + 1); bytes = $file.Length; sha256 = $hash }
        }
        $inventory.Add([ordered]@{ name = $directory.Name; source = $directory.FullName; files = @($records) })
    }
    Write-Output "Verified $($inventory.Count) legacy directories; all database ownership locks acquired."
    if (-not $Apply) { Write-Output 'Dry run only. Use -Apply to move these exact directories to retained diagnostics.'; return }
    Assert-ContainedPath (Join-Path $repo 'diagnostics\playwright') $archiveRoot
    if (Test-Path -LiteralPath $archiveRoot) { throw 'Archive destination already exists' }
    [void](New-Item -ItemType Directory -Path $archiveRoot)
    $inventory | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $archiveRoot 'inventory.json') -Encoding UTF8
    foreach ($entry in $inventory) {
        $destination = Join-Path $archiveRoot $entry.name
        Assert-ContainedPath $legacyRoot $entry.source
        Assert-ContainedPath $archiveRoot $destination
        if (Test-Path -LiteralPath $destination) { throw "Destination exists: $destination" }
        Move-Item -LiteralPath $entry.source -Destination $destination
    }
    Write-Output "Archived $($inventory.Count) directories without deleting their contents: $archiveRoot"
} finally {
    foreach ($stream in $locks) { $stream.Dispose() }
}
