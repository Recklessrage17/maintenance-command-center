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

### MCC 2.0.0 integration verification (2026-10-22)

Integrated `origin/main` at `190ca908a2e676976382a7ab38ccce381edb0ee8`
(merged release PR #203, candidate `75aa21fb8a2c9e91e2e999a4bd7126d99f03610f`)
into the existing PR #204 branch with a normal merge. Only `ci.yml` required
manual conflict resolution. Reviewed the clean automatic merges of
`package.json`, `.gitignore` and `backend/src/server/index.ts`: all six version
manifests/locks remain 2.0.0, release backup-readiness behavior is intact, and
managed backends still avoid workstation `.env` settings. Application,
deployment and shared source match the release except for that test-only guard.

CI now runs all 57 release browser specs plus the gated cleanup probe through
the managed runner on both original Chromium projects. Release-focused checks,
three independent native-keyboard scroll executions, zero retries, the
40-minute full-suite allowance and individual test/assertion timeouts remain.
The release's Vite preview mode is explicit; loopback ports are allocated per
run. Both native ARM64 jobs also accept the cleanup branch, preserving their
exact-source checks, historical migration input and complete native suites.
Source/browser evidence and managed diagnostics are retained for 90 days.
Smoke/API job storage has unique ownership and a guarded finalizer that refuses
active servers and preserves recovery snapshots. CI does not deploy MCC.

The full-suite review found real-backend browser fixtures that still used
shared `tmp`/`output` locations. Managed fixture helpers now create their copied
applications and all writable storage inside the current run, preserve process
registration, and resolve installed dependencies through a scoped Node loader
instead of filesystem junctions. Native, non-Playwright fixture behavior stays
unchanged. Machine archive and PM report artifacts use `testInfo.outputPath()`;
nested fixture recovery snapshots and backend logs survive runtime cleanup.
No browser assertions or application behavior were changed.

Local Windows / Node 22.22.3 / Chromium evidence:

- `npm run build`: frontend TypeScript/Vite and backend TypeScript passed.
- `npm run test:playwright:cleanup-checks`: 8/8 passed, including nested recovery
  preservation, expected failure, interruption, startup refusal and concurrency.
  Probe diagnostics include
  `diagnostics/playwright/run-1792665043246-96c40434-62b9-4847-9f55-b41a16724f03/`.
- Focused real-backend/version run: 28 passed; two archive cases exposed a
  missed screenshot-path reference during integration. Corrected that reference;
  both archive cases then passed with all 10 other release-focused cases
  (12/12). This gives 40 distinct passing focused cases across both projects.
  The original failure evidence remains in
  `diagnostics/playwright/run-1792665034872-f0db266b-34a6-4c77-a909-8ee68cfe3e4e/`;
  corrected release-focused evidence is in
  `diagnostics/playwright/run-1792665184050-d26c8261-a6b2-4f6a-a4d8-35b910b1700f/`.
- Cleanup dry run: no managed stale runs; owned runtime directory is empty.
- Workflow YAML and inline finalizer JavaScript parse; no unresolved Git merge
  entries or conflict markers remain. The only tracked deletions relative to
  main are the exact 26 obsolete screenshots from `6fdc896`.
- Read-only archive verification: all 7,165 files in 143 directories match
  recorded SHA-256 hashes and sizes, totaling 620,365,123 bytes. Neither the
  archive nor its inventory/verification records were modified.

The full browser suite and native ARM64 validation are delegated to GitHub CI
on the pushed integration commit; prior release results do not substitute for
that commit's checks. PR #204 remains draft pending explicit merge approval.
No Pi access, deployment, restart, release creation or production/recovery-data
modification is authorized by this integration.

Outstanding operational work remains open: a physical replacement-Pi disaster
recovery rehearsal has not been completed; the unexpected Pi reboot remains
under investigation; and complete installed updater orchestration has not
been independently validated. Repository integration does not close these gates.

### Full CI investigation and keyboard-input precondition (2026-10-22)

On merge commit `7517b6acd9e967e92d5a50a315a4e6e4fd70f2d9`, both jobs in
[native ARM64 run 39764210023](https://github.com/Recklessrage17/maintenance-command-center/actions/runs/39764210023)
passed: 17 migration/restore checks, 14 regression suites and 20 disposable
native deployment/recovery/resource cases. Downloaded artifacts match their
GitHub SHA-256 digests and remain under
`diagnostics/playwright/integration-7517b6a/`.

[Browser/build run 39764209975](https://github.com/Recklessrage17/maintenance-command-center/actions/runs/39764209975)
first timed out downloading Ubuntu browser dependencies. A rerun on the same
unchanged source passed setup, builds, smoke/authorization regressions, all
eight cleanup checks, 12 release-focused cases and three scroll executions.
Its complete zero-retry suite then reported **729 passed, 38 skipped, 1 failed**
in 29.9 minutes. The skips comprise the original 36 project skips and two
gated cleanup probes. All 58 specs were selected; no test was excluded.

The sole failure was desktop Chromium's `maintenance-lab-background.spec.ts`
case "long Machine Library pages and true modals keep document, keyboard,
pointer, and touch scrolling", at the bottom-edge assertion after native End.
The trace records 18 rendered cards, BODY/document focus and a scrollend event,
but scrollY remained zero. Earlier paint waits and isolated repetitions did
not establish a reliable input precondition in the complete parallel run.
The full artifact, screenshot, trace and error context remain retained locally
in `diagnostics/playwright/integration-7517b6a/`; its managed runtime cleanup
receipt confirms removal. CI's final runtime verification and smoke/API storage
finalizer also passed.

The test now activates a blank document gutter with a real pointer click after
the programmatic container probes, then additionally asserts it is still at
scrollY zero before issuing the original native keys. This establishes an
explicit scroll-start node: Blink's
[logical scroll implementation](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/core/input/scroll_manager.h)
uses focus/last-clicked node state. No scripted scroll substitutes for End,
Home or PageDown; no existing assertion, project or deadline is weakened.
Application code is unchanged. The CI stability check is expanded from three
single-worker executions to 20 independent executions with two workers; only
that orchestration step's allowance increases from three to six minutes.
The complete suite retains its 40-minute allowance and zero retries.

The input-precondition change requires exact-head Linux validation; a passing
focused run alone must not be reported as a passing complete suite.

Locally, all 20 repeated desktop scrolling cases passed with two workers and
zero retries (1.2 minutes), under
`diagnostics/playwright/run-1792668148271-1e0f93e7-5ef8-4bdc-b533-f3cfedafd153/`.
The runner then returned nonzero because Windows reused registered PIDs for
unrelated live processes. The explicit dry run refused deletion as designed.
After those PIDs exited, the default dry run became eligible. Inspection also
found a separate bug in the specific-run CLI: matching a bare run ID in process
command lines incorrectly classified its npm/shell ancestors as participants.
Orphan detection now matches the complete owned runtime path (including a path
boundary), with Windows path/case normalization. All registered PID liveness
checks remain unchanged and conservative, including PID reuse. The orphan
check now covers both an unregistered live profile-path process (refused) and
a bare-ID controller (eligible only after actual participants stop).

The corrected specific-run dry run passed; a subsequent specific-run apply
removed only
`tmp/playwright-runs/run-1792668148271-1e0f93e7-5ef8-4bdc-b533-f3cfedafd153/`.
No unrelated process was stopped, no process registry was edited to authorize
cleanup, and no stale-run sweep was performed. Its diagnostics remain retained.
After the orphan-matching correction, all eight cleanup checks passed again,
including the new unregistered-profile/bare-ID cases. The final dry run reports
no managed stale runs; no managed runtime from these local checks remains.
