# Playwright storage and cleanup

Run browser tests with `npm run test:playwright -- <test filters/options>`.
Existing `test:*` npm scripts and CI use the same managed runner. Build the
frontend and backend first (`npm run build`) when application code changes.
Direct `npx playwright test` fails with an actionable message before creating
storage. Config, reporter, output and UI-mode overrides are intentionally
blocked because they can bypass isolation or overwrite retained evidence.

Each run gets a UUID, ownership marker and process registry under
`tmp/playwright-runs/run-<timestamp>-<uuid>`. The runner starts a fresh server
on an available loopback port; it never reuses a live MCC server. An explicit
`MCC_PLAYWRIGHT_PORT` is allowed except port 4273. A port allocation race fails
safely rather than reusing a server. `MCC_PLAYWRIGHT_FRONTEND_ONLY=1` selects
Vite preview for mocked UI tests; setting a port alone no longer selects Vite.

Data, uploads, backups, PM workbooks, work-order files, updater state and OS
temporary files all live inside the owned run. SMTP/updater settings are
disabled, inherited storage settings are replaced, and the managed backend
does not load the workstation `.env`. `NODE_OPTIONS` registers Node children
before application code runs. Browser profiles carry the run ID via the
isolated OS temporary directory.

After Playwright exits (including assertion, collection and startup failures),
the runner checks that all registered child processes and matching browser
profiles have stopped, validates ownership and paths, rejects symbolic links
and junctions, and removes only that run directory. Cleanup errors produce a
nonzero exit and a retained log; they never trigger a broader sweep.

## Diagnostics

`diagnostics/playwright/<run-id>/` is Git-ignored and is never automatically
deleted. It contains `runner.log` (test and server output), JSON/HTML reports,
test results, failure screenshots/traces, result metadata and a cleanup receipt.
Recovery snapshots are moved here before runtime removal. Partial logs and
runtime evidence survive interrupted runs when present. Hard kills cannot
guarantee a finished trace or screenshot; the explicit cleaner preserves what
was actually written. A later run cannot overwrite an earlier run's evidence.

Use `npx playwright show-report diagnostics/playwright/<run-id>/html` or
`npx playwright show-trace <trace.zip>` to review. Remove a specific diagnostics
directory only after human review and an explicit decision to discard it. Do
not add timed diagnostic deletion. CI uploads failure diagnostics for 90 days;
download unresolved evidence before the hosting service's retention expires.
`MCC_PM_QA_PDF` and `MCC_PDF_QA_DIR` enable optional exports into the current
diagnostics directory; their caller-supplied destination paths are not used.

## Interrupted and stale runs

An ordinary interrupt is forwarded to the spawned test process (on Windows,
the owned test process tree is stopped). A forced kill, machine restart, or
failure to stop a child may leave the runtime intact. No subsequent test run
automatically cleans another run.

1. Run `npm run test:playwright:cleanup` for a dry-run inventory, or add
   `-- --run <run-id>` to inspect one run.
2. Investigate a refusal. Stop only the associated test processes yourself;
   this cleaner never kills processes. PID reuse and permission/inspection
   failures are treated conservatively. Unmarked/invalid directories require
   manual provenance review, not a fabricated ownership marker.
3. Once eligible, run
   `npm run test:playwright:cleanup -- --run <run-id> --apply`.

The command only examines direct children of `tmp/playwright-runs`, requires
a valid repository-specific ownership marker, a minimum age of 60 seconds,
no live registered PID or matching process command line, and no links in the
tree. The apply pass rechecks before deleting. It preserves diagnostics and
recovery evidence. There is no force/ignore-process/alternate-root option.
The 60-second guard is an additional startup-race precaution, not proof that
a process is stale. PID liveness is always checked independently of age.

## Legacy PID directories

The former config used `tmp/playwright-<PID>` without teardown, unique run
identity, or ownership metadata. It isolated only three storage variables,
leaving recovery storage on the normal user path. The existing 143 directories
were generated with that configuration; the audit found the same
`backups,data,uploads` layout, 215 scheduled-backup manifests, and empty user
and inventory tables. They are excluded from the automatic cleaner.

`powershell.exe -NoProfile -File scripts/archive-legacy-playwright.ps1` is an
explicit Windows-only archival dry run for this migration. It requires the
historical config at HEAD, verifies the exact layout and backup provenance,
rejects links/recent durable writes/live owner PIDs, and holds exclusive SQLite
read/write ownership locks to rule out live servers even when Windows hides a
service's command line. `-Apply` moves the audited directories intact under
`diagnostics/playwright/legacy-<timestamp>` and records a SHA-256 file inventory.
It deletes no file content, and is not a general stale-run sweeper. Once HEAD
contains the new config, this migration intentionally refuses to run.

Do not delete the legacy archive before its evidence has been reviewed. Do
not touch the live service, normal backups, user recovery folder, other `tmp`
directories, or the tracked `tmp/pdfs` reference images during this cleanup.

## Verification

`npm run test:playwright:cleanup-checks` runs destructive-path and ownership
guards, live orphan refusal, successful/failing Chromium probes, interrupted
Chromium cleanup, startup failure, and concurrent run isolation. All probes
use owned test storage; their diagnostics intentionally remain for review.
The failing probe is expected to fail internally while its parent check passes.

### 2026-10-21 maintenance verification

- Archived all 143 legacy directories intact in
  `diagnostics/playwright/legacy-20261021-113929/`; `inventory.json` records
  7,165 files totaling 620,365,123 bytes with SHA-256 hashes. No legacy file
  contents were discarded. The archive remains pending human review.
- The five ownership/safety and pass/fail/interruption checks passed. The
  added startup-failure and concurrent-run checks also passed after correcting
  the test port fixture's HTTP connection shutdown. A separate eighth check
  passed for CLI isolation bypass rejection, including attached `-c` arguments.
  Backend TypeScript build
  passed. Validation was performed on Windows with Chromium.
- The existing owner system-version browser regression passed with both the
  isolated backend and frontend-only preview server. All validation runtime
  directories were removed; diagnostics from intentional failures and initial
  infrastructure debugging remain for review.
- No tracked generated files were removed. The two tracked `tmp/pdfs/*.png`
  images remain unchanged. Normal data/backups, the user recovery folder,
  fixtures, unrelated temporary directories and the running MCC service were
  outside the cleanup targets. No deployment, push or merge was performed.

### GitHub preparation verification (2026-10-21)

- Re-ran all eight cleanup checks together: 8 passed, including the intentional
  browser failure whose screenshots and trace remain available for review.
- Backend TypeScript build passed. The desktop Chromium system-version suite
  passed all six tests using the managed runner and an isolated backend.
- Verified all 7,165 archived files against their recorded SHA-256 hashes and
  sizes: 143 directories, 620,365,123 bytes. The archive was read only.
- Confirmed the managed runtime directory is empty and the cleanup dry run
  reports no managed stale runs. Existing diagnostics remain retained.
- Reviewed the 19 implementation/documentation files staged for this commit;
  no databases, backups, runtime test data, diagnostics or private material are
  included. `diagnostics/playwright/` remains Git-ignored and untracked.
- The separate historical screenshot commit remains on this branch with
  exactly 26 deletions under `artifacts/issue-{52,53,56,60}` relative to `main`.
  Those historical deletions are separate from the runtime archive above.

### Changed files

| Files | Purpose |
| --- | --- |
| `AGENTS.md` | Permanent ownership, cleanup and evidence-retention rules. |
| `playwright.config.ts`, `package.json` | Managed execution, unique diagnostics, isolated server and npm entry points. |
| `scripts/playwright-run.mjs`, `scripts/playwright-register.mjs`, `scripts/playwright-storage.mjs` | Run lifecycle, process registration, guarded deletion and recovery preservation. |
| `scripts/playwright-cleanup.mjs`, `scripts/archive-legacy-playwright.ps1` | Explicit stale-run cleanup and audited legacy archival. |
| `backend/src/server/index.ts` | Prevent managed tests from loading workstation `.env` configuration. |
| `.gitignore`, `.github/workflows/ci.yml` | Ignore generated output and retain CI diagnostics. |
| `tests/playwright-cleanup.test.mjs`, `tests/playwright-cleanup-probe.spec.ts` | Cleanup and lifecycle regression checks. |
| `tests/industrial-suite-visual.spec.ts`, `tests/mcc-login-issue-56.spec.ts`, `tests/settings-system-update.spec.ts`, `tests/machine-asset-specification.spec.ts`, `tests/warning-issue-lifecycle.spec.ts` | Route existing generated evidence into the current run's diagnostics. |
| `docs/playwright-cleanup.md` | Commands, safety boundaries, migration audit and verification report. |
