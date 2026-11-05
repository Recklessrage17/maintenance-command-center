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
