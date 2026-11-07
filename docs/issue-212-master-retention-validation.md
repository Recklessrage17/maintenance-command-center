# Issue #212 — Master retention implementation and validation

Date: November 5, 2026. Development only; no Raspberry Pi access or production operations.

## Exact source baseline

Read the complete [issue](https://github.com/Recklessrage17/maintenance-command-center/issues/212)
and [implementation handoff](https://github.com/Recklessrage17/maintenance-command-center/issues/212#issuecomment-6664924265)
before edits. The exact accepted source was present in the workspace's shared Git object store:

- Commit: `b8d13033baaf181a519b067db3f98556a260c88e`.
- Tree: `9d4280aef25d511e5e6a636bc2a374b6daeb3893`, exactly matching the handoff.
- Complete object traversal/connectivity checks passed; no missing baseline objects.
- Ancestry: GitHub main `c69f8cb6c63922c4f415eacf8ee28e7c056a0a1e` →
  `73819e48432dcbb1ff84898fabc71efc9d6939e9` → `b8d1303`.
- Feature branch `codex/issue-212-master-retention` starts at that exact commit.
  The accepted source includes 47 changed files relative to old GitHub main;
  none of those working production changes was discarded or rebuilt from old main.
- GitHub still returned “No commit found” for the baseline during initial verification.
  The PR is prepared against a separately pinned baseline branch to keep the
  retention diff focused. This does not integrate the baseline into main or authorize deployment.

## Changed files and functions

| File | Exact responsibility |
| --- | --- |
| `backend/src/server/masterRetention.ts` | New `MasterRetention.verify`, `publish`, `preview`, `cleanup`, `executeJournal` and path/tree helpers. Combined three-set policy, full local/ZIP verification, durable publication, authenticated deletion allowlists and confirmed restart recovery. |
| `backend/src/server/index.ts` | `createBackup` gates rotation on verified publication/external success; `applyBackupRetention` excludes Masters; `removeBackupFolder` cannot delete Masters or portable files. `verifyBackup` checks complete new-format normal sets while allowing local recovery independent of receipt authentication. Backup group/status/health expose counts and warnings. Adds Admin/Owner-only cleanup preview and confirmation endpoints. |
| `backend/src/server/portableBackup.ts` | New streamed `verifyPortableArchiveMatchesPackage`; `extractArchiveEntry` accepts a hash sink using the existing import CRC/header checks. `validateSqliteDatabase` uses full `PRAGMA integrity_check`. No additional payload copies or extraction are required for retention verification. |
| `frontend/src/modules/settings/SettingsPage.tsx` | Retention indicator/counts/latest verification; exact keep/delete preview; typed confirmation; precise creation/cleanup results; external-copy warning remains an attention state. |
| `frontend/src/styles/app.css` | Scoped wrapping and minimum touch sizes for Master action labels on narrow cards. |
| `tests/master-retention.spec.ts` | Synthetic zero-to-five sets, ordering/ties, corruptions, boundaries, publication, partial unlink/restart, real manual/monthly rotation, permissions/tokens/concurrency, injected creation failures, retained download/restore. |
| `tests/helpers/master-backup-faults.mjs` | Test-child-only fault injection and deterministic clock advancement for the real monthly timer. No production test hooks. |
| `tests/master-backup-regression.spec.ts`, `tests/portable-master-backup.mjs`, `tests/release-backup-readiness.mjs` | Run existing recovery/readiness regressions within managed ownership. Portable fixtures use copied applications and shorter Windows SQLite paths. Failed creation now asserts preservation of unverified backlogs rather than per-type pruning. |
| `tests/helpers/security-process.mjs` | Opt-in fault preloader, bounded fixture lifetime and per-request timeout for full verification; existing defaults retained. |
| `tests/settings-portable-backup.spec.ts` | Desktop/mobile preview, confirmation, count updates, label containment and incomplete external-copy warning tests; before/after images. |
| `package.json` | Existing portable-backup npm entry point now uses the managed runner. |
| `docs/backup-and-restore.md` | Operator policy, exclusions, historical cleanup, interruption recovery, metadata/secret requirements and separation from disaster recovery. |

## Retention decisions

- Both normal Master types share one cap, ordered by verified UTC manifest time and ID.
- With the current three good sets, the next successful manual or scheduled creation
  publishes a fourth and removes only the oldest eligible set, ZIP, sidecar and matching receipt.
- A failed snapshot, corrupt database/manifest/payload, failed ZIP/verification/publication,
  or failed enabled external copy prunes nothing. New failed attempts cannot displace good sets.
- Existing backlog reduction is deliberate: admin preview and immutable IDs plus exact
  `DELETE N MASTER BACKUPS` confirmation. Automatic rotation removes at most one oldest
  eligible set per successful creation, without sweeping existing backlogs at startup.
- Three survivors and each candidate are reverified before deletion. Unknown/changed files,
  traversal, symlinks/junctions, hard links, mismatched identities and shared ZIP links stop deletion.
- Pending signed journals survive errors/restart. Automatic pruning pauses; an admin can
  preview and confirm resumption of unchanged allowlisted leftovers. Tampering stops recovery.
- Daily/Weekly policies, scheduling and 45-second debounce remain independent. Pre-restore,
  startup, legacy, imported, external and deployment recovery data are excluded. History remains.

## Final local checks

Windows, Node 22.22.3, Chromium; zero retries, no skipped cases in these runs.

| Command | Result/evidence |
| --- | --- |
| `npm run build` | Frontend TypeScript/Vite and backend TypeScript passed. |
| `npm run build --prefix frontend` | Passed after the final label-wrap adjustment. |
| `npm run test:playwright -- tests/master-retention.spec.ts tests/master-backup-regression.spec.ts tests/settings-portable-backup.spec.ts --project=desktop-chromium --workers=1` | **29 passed**; `diagnostics/playwright/run-1793903343163-73e6ddb4-803b-4458-9b08-4c2f70b98408/`. Includes both existing Node regressions and actual monthly rotation. |
| `npm run test:playwright -- tests/settings-portable-backup.spec.ts --workers=1` | **18 passed** on final UI; `diagnostics/playwright/run-1793903534738-151a4c66-f4e0-4d9b-b277-78a20706a11b/`. Includes desktop/mobile label containment. The desktop UI cases overlap the preceding run. |
| `git diff --check` | Passed. |
| `npm run test:playwright:cleanup` | No managed stale runs. Owned runtime directories from all runs are gone. |

The backend checks cover a scheduled/manual mix, successful fourth/fifth creation,
real timer-triggered monthly rotation, SQLite/ZIP/payload integrity, complete set deletion,
permission and partial unlink failures, restart recovery, all three survivors' download
and isolated restore, pre-restore preservation, audit/history, and authenticated cleanup.
Existing portable recovery tests additionally round-trip operational records, uploads,
PM/workbooks, PDFs, equipment/machine/facility notes and attachments through isolated restore.
Neither development `backend/documents` nor `backend/files` was created or changed by restores.

Initial harness failures (module loading, Windows path length and timeout) and their
diagnostics remain retained for human review. No interrupted runtime was retained.
No broad cleanup, recovery snapshot deletion, tracked generated-file removal or production
storage operation was performed. Four deliberately retained screenshot files are included
as review evidence; other diagnostics remain ignored.

## Before/after UI evidence

These are mocked staging Backup Center screens with synthetic IDs. Real backend creation,
deletion, download and restore are separately covered by the isolated integration tests.

| View | Preview of four sets | After confirmed cleanup to three |
| --- | --- | --- |
| Desktop | [Before](../diagnostics/playwright/run-1793903534738-151a4c66-f4e0-4d9b-b277-78a20706a11b/test-results/settings-portable-backup-M-88b07-and-reports-resulting-count-desktop-chromium/master-before-cleanup.jpg) | [After](../diagnostics/playwright/run-1793903534738-151a4c66-f4e0-4d9b-b277-78a20706a11b/test-results/settings-portable-backup-M-88b07-and-reports-resulting-count-desktop-chromium/master-after-cleanup.jpg) |
| Mobile | [Before](../diagnostics/playwright/run-1793903534738-151a4c66-f4e0-4d9b-b277-78a20706a11b/test-results/settings-portable-backup-M-88b07-and-reports-resulting-count-mobile-chromium/master-before-cleanup.jpg) | [After](../diagnostics/playwright/run-1793903534738-151a4c66-f4e0-4d9b-b277-78a20706a11b/test-results/settings-portable-backup-M-88b07-and-reports-resulting-count-mobile-chromium/master-after-cleanup.jpg) |

## Remaining release considerations

Full repository CI and native ARM64 validation are separate from these focused Windows
checks; no claim of complete-suite, physical power-loss or replacement-Pi recovery proof
is made. No lint script is configured; the builds provide configured type checking.
Full verification can be slow for large packages/backlogs. Keep `SESSION_SECRET` stable:
changed/lost authentication keys conservatively exclude signed sets/journals for operator
review. Portable ZIP recovery remains independent of that secret. Failed or anomalous sets
remain protected and may require supervised review rather than automatic cleanup.

Imported recovery quotas and full Pi OS/configuration/deployment recovery remain separate.
No merge, installation on the Pi, service restart, production backup deletion or deployment
is authorized by this PR. Review and operator approval remain required before a release.


## November 6 engineering review follow-up

Read issue #212, its complete implementation handoff, PR #213 and engineering
review comment [6671464634](https://github.com/Recklessrage17/maintenance-command-center/pull/213#issuecomment-6671464634),
and the failed Actions job before this follow-up. The feature branch still descends
from exact production baseline `b8d13033baaf181a519b067db3f98556a260c88e`.

### Code changes since the initial PR commit

- `masterRetention.ts`: in-memory verification results with metadata invalidation
  (device/inode, size, modification/change times, recursive entries, linked ZIP,
  checksum and publication receipt). Status never reads payload bytes. Unknown or
  changed sets require explicit verification. Missing signing configuration blocks
  publication and cleanup; full destructive checks and journal recovery remain.
- New `masterRetentionService.ts` and `masterRetentionWorker.ts`: one persistent
  worker owns deep scans/publication/cleanup. Competing scans are rejected. Polling
  returns previous, explicitly in-progress results while verification runs. Worker
  failure clears status trust; no persistent cache can authorize deletion.
- `index.ts`: routine status inventories each backup category once, bypasses ZIP
  readiness scans, and reuses the Master status result. Explicit normal Master
  Verify runs off the API thread. Create/cleanup/verify share exclusion gates.
  Retention uses only configured SESSION_SECRET, preserving authentication fallback.
- `portableBackup.ts`: imported-package status inventory reads metadata only;
  import/restore still perform full validation, with no changes to imported quotas.
- `SettingsPage.tsx`: labels last integrity verification, unknown sets, in-progress
  results and missing persistent signing configuration. Imported inventory is no
  longer mislabeled as freshly verified by status polling.
- `master-retention.spec.ts`: zero-payload-I/O status checks, cache invalidation,
  worker serialization/responsiveness, stable/changed/missing-key restarts,
  representative 180 MiB payload benchmark and API concurrency/fault assertions.
- `master-backup-faults.mjs`: disposable-child-only I/O and delayed-worker probes.
  `security-process.mjs`: bounded 30-second startup allowance and retained startup
  diagnostics; no changes to production service startup or credentials.
- `backup-and-restore.md`: polling semantics, conservative restart behavior and
  a read-only, value-free `.env` signing preflight, including unsupported-provider
  boundaries. No Pi access or production mutation was performed.

### CI failure investigation

Original run [42085804441](https://github.com/Recklessrage17/maintenance-command-center/actions/runs/42085804441)
failed its 20th keyboard execution after 19 passes; the full browser suite was
skipped. Downloaded artifact `browser-failures-1` (ID 13442871952), inspected job
logs, failure screenshot and trace. Trace records the End key input, focused BODY,
document height 2031, and scrollend completion followed by scrollY=0. The screenshot
shows the Machine Library still at the top. No assertion has been weakened, no
retry added and no test removed.

Matched Windows/Node 22.22.3/Chromium/Vite frontend-only comparison, 2 workers,
20 independent repetitions, zero retries:

- Exact detached `b8d1303`: **20 passed**, run
  `run-1793970378893-495df261-d888-4583-8bdd-ac3ea7a721c2` in the comparison checkout.
- Feature branch: **20 passed**, run
  `run-1793970502791-3d55e4b6-9cbe-43d7-a429-f68eb17efde9`.
- Command: `npm run test:playwright -- tests/maintenance-lab-background.spec.ts --project=desktop-chromium --grep 'long Machine Library' --repeat-each=20 --workers=2 --retries=0`,
  with `MCC_PLAYWRIGHT_FRONTEND_ONLY=1`, matching CI's serving mode.

The original failure's precise root cause is **not established**. Neither matched
run reproduced it. CI serves mocked frontend APIs and runs no backup server during
this test, so repeated backend integrity scans cannot directly cause its End-key
failure. That is evidence about the execution path, not proof that the failure is
harmless or fixed. No speculative production scrolling change was made. Physical
ARM64 and hosted Ubuntu timing cannot be inferred from these Windows passes.

An earlier unmatched local run overlapped a frontend rebuild and failed later on
missing machine cards after navigation; all its End assertions passed. That run is
not evidence of the reported CI keyboard failure. Its diagnostics and the initial
worker-startup failures remain retained. The first follow-up focused run passed
30 cases and failed two startup deadlines; final results below supersede it.


### Representative storage benchmark

Windows x64, Node 22.22.3, local workstation storage; no physical ARM64 run.
Managed fixture contains three synthetic Master packages, each with an incompressible
180 MiB upload plus a real SQLite database and required manifest/workbook scaffolding.
Fourth ZIP size was **188,805,861 bytes**. No live files were used. Timings use
`performance.now()`; 30 sequential metadata-only status requests follow successful
publication, then one fresh three-set preview, then fourth creation/publication and
complete rotation with fresh survivor/candidate checks. A 10 ms API-thread timer
runs during worker verification. Separate tests forbid payload reads during status,
exercise concurrent requests, and verify all paths are removed by the managed runner.

| Measurement | Windows x64 result |
| --- | --- |
| Status, 30 requests | median **83.55 ms**, max **104.00 ms** |
| Fresh deep preview, three sets | **9,694 ms** |
| Initial fixture ZIP creation | **7,181-7,496 ms** per set |
| Durable publication and deep verification | **3,819-5,092 ms** per set |
| Fourth creation + publication + full rotation | **64,743 ms** |
| Longest 10 ms timer interval during worker preview | **42.37 ms** |
| Payload/ZIP bytes read by status | **0**, enforced by read/stream fault assertions |

The preview comparison isolates the expensive operation previously invoked by
polling; it is not a complete benchmark of the old HTTP endpoint (which also did
redundant readiness scans). Status cost now depends on metadata/file count, not
archive byte size. Results include normal OS caching; they are not cold-cache SD
card throughput or a performance promise for the Pi. Full verification remains
intentionally expensive and required for destructive cleanup. Large historical
backlogs take longer, with one scan at a time. The workload and JSON evidence are
reproducible in `tests/master-retention.spec.ts` under the managed runner.


### Final local follow-up validation and remaining gates

- `npm run build`: final frontend TypeScript/Vite and backend TypeScript passed.
- Managed focused desktop/mobile run: **66 passed, 0 failed, 0 skipped** in 11.7m.
  Command: `npm run test:playwright -- tests/master-retention.spec.ts tests/master-backup-regression.spec.ts tests/settings-portable-backup.spec.ts --workers=1`.
  Evidence: `diagnostics/playwright/run-1793970836245-2997a447-1e73-40bc-9963-cee653d67797/`.
- Final cache/status, signing, worker concurrency, actual API responsiveness and
  UI wording checks: **10 passed**, both browser profiles, after the final build.
  Command: `npm run test:playwright -- tests/master-retention.spec.ts tests/settings-portable-backup.spec.ts --grep 'real manual|status reads|stable signing|single worker|Master status' --workers=1`.
  Evidence: `diagnostics/playwright/run-1793988650149-261470f4-4bb0-4f87-96b9-172226fd2a5f/`.
  Tests forbid opening ZIP/payload files during HTTP status polling. With the
  verification worker deliberately stalled for 3 seconds, health/status return
  within 2 seconds and competing cleanup preview returns 409. Normal manual and
  scheduled rotation, all retained restores, permissions and failure injection
  still pass in this same test.
- Actual application-process restart: **1 passed** in 29.2s. Stable key preserves
  the existing authenticated session and publication signatures; changed/missing
  keys reject the old session, allow normal new login, protect signed sets and
  leave publication receipts unchanged. Missing-key cleanup is rejected.
  Command: `npm run test:playwright -- tests/master-retention.spec.ts --grep 'application process restarts' --project=desktop-chromium --workers=1`.
  Evidence: `diagnostics/playwright/run-1793988907837-ff4b3fca-4e95-435f-ab86-cfae4201c92d/`.
- Changed/missing-key interruption journal recovery: **1 passed** in 12.8s.
  Command: `npm run test:playwright -- tests/master-retention.spec.ts --grep 'partial unlink failure' --project=desktop-chromium --workers=1`.
  Evidence: `diagnostics/playwright/run-1793988850271-fcaaabdb-a504-48d7-a046-5fe73a1aac06/`.
- These targeted final runs overlap earlier coverage; the counts are not a claim
  of 78 distinct test cases. All use `MCC_PLAYWRIGHT_FRONTEND_ONLY=1` for the UI
  server; real API tests independently launch managed disposable backend fixtures.

The process-restart test found a harness shutdown bug: after signal termination,
Node leaves `exitCode` null and sets `signalCode`. A second `close()` previously
waited forever for an already-ended process. `security-process.mjs` now checks both
fields, making cleanup idempotent, and awaits any live child before removal. The
initial 180-second timeout and all three restart logs are retained in
`run-1793988786876-28ab98c7-34fc-4358-af58-562b0be1caa7`; the corrected run passed.

No interrupted runtime remains. All owned runtime directories, including the exact
baseline comparison checkout's test runtimes, were removed. Failure diagnostics,
recovery snapshots and the original CI artifact remain available for review. The
original downloaded artifact is under `diagnostics/playwright/ci-42085804441/`.
No production databases, WALs, uploads, backup sets or credentials were accessed.

`.github/workflows/ci.yml` adds a PR #213-only baseline comparison job on Ubuntu
24.04/Node 22. It checks out exact b8d1303 and runs the original 20-repetition,
2-worker, zero-retry keyboard test, with mandatory cleanup and retained diagnostics.
The candidate's complete existing CI pipeline and assertions are unchanged. Neither
job is allowed to ignore failures. Hosted results are recorded in PR #213's checks
and updated PR description after pushing this commit; they are not assumed green
from the local results above.

Release assessment: development changes are ready for engineering review, but
**keep this PR draft and do not deploy**. Hosted full CI must pass. The original
keyboard failure's precise cause remains unresolved unless new hosted evidence
establishes it. Stable production signing configuration and ARM64/storage performance
remain read-only operator preflight/staging gates. Physical power-loss durability,
full replacement-Pi recovery and baseline integration into main remain separate
release decisions. No merge or production operation is authorized.
