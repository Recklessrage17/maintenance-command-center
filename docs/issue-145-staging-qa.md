# Issue 145: Windows staging no-op Apply verification

The private staging workbook was tested locally against application code at
`9c398c4` in a temporary database. Preview returned 96 ignored rows, one rejected
tracker row (31), zero conflicts, and 65 warnings displayed under No Changes.
Its eligibility was:

```json
{"importableRows":0,"resolutionRequiredRows":[],"replacementEligible":true,"canConfirm":true}
```

Confirmation returned HTTP 200 and successful workbook synchronization with zero
database additions/updates/history additions. The private workbook is not checked
in. `tests/fixtures/pm-staging-noop.mjs` generates invented data with these exact
counts for workflow and API regression tests; desktop/mobile UI coverage checks
the same preview state and confirms Apply is enabled. Missing required sheets or
headers still fail preview and cannot expose Apply.

On September 23, 2026, the local listener on port 5131 was Node PID 15396, started
at 08:51:52 Central. Commit `9c398c4` was created at 09:07:26 Central. The running
backend therefore predated that fix. Building output files does not reload the
JavaScript already loaded by Node. No staging process was restarted during this
investigation, and no production service was accessed.

## Complete eligibility path at 9c398c4

1. `inspectPmWorkbook` throws for invalid XLSX data, missing required sheets, or
   missing required headers. Such failures return HTTP 400 without a preview
   token. Individual malformed data rows enter `rejectedRows` instead.
2. `buildPmImportStage` resolves asset identifiers. Missing workbook-only assets
   enter `ignoredRows`; `missing` is distinct from `ambiguous`. Ambiguous tracker
   resolution produces a visible conflict. Summary counts are derived from the
   classified arrays; there is no separate fatal summary flag.
3. For zero database actions, `replacementEligible` requires at least one parsed
   tracker row, no nonrepairable tracker conflict, and no ambiguous tracker asset
   resolution. The real workbook has 68 parsed tracker rows, all missing in this
   reproduction, and passes those conditions. Ignored and rejected counts do not
   participate. `canConfirm` is true for importable actions or an eligible no-op
   replacement.
4. The frontend's `canConfirmPmReplacement` uses backend `canConfirm` and checks
   unresolved `resolutionRequiredRows`. The backend currently emits an empty
   required-override list. `pmImportableRowCount` changes the button label only.
   The button is disabled by `busy || !canConfirm`; `busy` is the pending workbook
   request. No other rejected/ignored/warning count or asset/structure flag gates
   the button. The confirmation handler also requires a preview and operation.
5. `/api/pm-excel/confirm` reparses the staged bytes and rebuilds the same backend
   eligibility against current database state before applying. A no-op still
   promotes the uploaded workbook and retains a backup of the prior active file.

## Clean rebuild and restart: Windows staging only

Run these steps manually in PowerShell. They target `F:\MCC_V1_FINAL` and port
5131. Do not use `Start MCC Website.cmd` or `Stop MCC Website.cmd`: those scripts
hard-code port 4273. Keep the staging data/environment settings already in use.

First use Ctrl+C in the terminal running staging. If that terminal is unavailable,
inspect and stop only the current listener on 5131:

```powershell
$stagingPids = @(Get-NetTCPConnection -LocalPort 5131 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
$stagingPids | ForEach-Object { Get-Process -Id $_ | Select-Object Id,ProcessName,StartTime,Path }
$stagingPids | ForEach-Object { Stop-Process -Id $_ }
```

Then update and rebuild. Stop if any command fails. The clean-tree check protects
uncommitted work; only generated build output is deleted.

```powershell
Set-Location -LiteralPath 'F:\MCC_V1_FINAL'
if (git status --porcelain) { throw 'Checkout has local changes; review them before continuing.' }
git fetch origin fix/issue-145-pm-excel-sync
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed' }
git switch fix/issue-145-pm-excel-sync
if ($LASTEXITCODE -ne 0) { throw 'Branch switch failed' }
git pull --ff-only origin fix/issue-145-pm-excel-sync
if ($LASTEXITCODE -ne 0) { throw 'Pull failed' }
git merge-base --is-ancestor 9c398c4 HEAD
if ($LASTEXITCODE -ne 0) { throw 'The staging checkout does not contain fix 9c398c4' }
git log -1 --format='%h %s'
git diff 9c398c4 HEAD -- backend/src frontend/src

$stagingRoot = (Resolve-Path -LiteralPath 'F:\MCC_V1_FINAL').Path
foreach ($buildDirectory in @('frontend\dist','backend\dist')) {
    $buildTarget = [IO.Path]::GetFullPath((Join-Path $stagingRoot $buildDirectory))
    if (-not $buildTarget.StartsWith($stagingRoot + '\',[StringComparison]::OrdinalIgnoreCase)) {
        throw 'Build output path is outside the staging checkout'
    }
    if (Test-Path -LiteralPath $buildTarget) { Remove-Item -LiteralPath $buildTarget -Recurse -Force }
}
if (Test-Path -LiteralPath 'frontend\tsconfig.tsbuildinfo') {
    Remove-Item -LiteralPath 'frontend\tsconfig.tsbuildinfo' -Force
}
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Root dependency install failed' }
npm ci --prefix frontend
if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency install failed' }
npm ci --prefix backend
if ($LASTEXITCODE -ne 0) { throw 'Backend dependency install failed' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed; do not start staging' }
$env:HOST = '0.0.0.0'
$env:PORT = '5131'
npm start
```

This regression-only follow-up has no application-source differences from
`9c398c4`, so the `git diff` above should be empty for this revision. The latest
HEAD will be the newer regression commit, and includes `9c398c4`.

In a second PowerShell window, check the new listener and health:

```powershell
Get-NetTCPConnection -LocalPort 5131 -State Listen |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Get-Process -Id $_ | Select-Object Id,StartTime,Path }
Invoke-RestMethod 'http://localhost:5131/api/health'
git -C 'F:\MCC_V1_FINAL' rev-parse --short=7 HEAD
```

Open `http://localhost:5131`, hard-refresh with Ctrl+Shift+R, and sign in as Admin
or Owner Admin. Open `/api/version` on that same origin: its `commit` must match
the final Git command above. This value is captured when the backend starts;
version `1.5.12` alone does not identify the running revision.

Upload the workbook again to get a fresh preview. In browser DevTools, inspect
the response for `/api/pm-excel/preview`. Expect the eligibility JSON above and
an enabled Apply Workbook button. Confirm the expected counts, apply, and verify
the successful replacement. If it remains disabled, retain the preview response,
`/api/version` response, and browser console errors for diagnosis.
