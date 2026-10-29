# Patch bundle integration and manual-release readiness

October 29, 2026. Plan only. Integration, publication and production execution
have not been performed by Patch 1 implementation.

## Exact source origins

Use reviewed base `c69f8cb6c63922c4f415eacf8ee28e7c056a0a1e`. It already
contains PR #205; do not reapply or substitute its maintenance-record PDF work.
Its main application changes are `backend/src/server/assetMaintenanceRecordPdf.ts`
and the corresponding `backend/src/server/index.ts` generator delegation.
The merge also includes its reviewed CI, PDF inspector, documentation and
regression updates; keep the full reviewed base intact.

Patch 1 is the local uncommitted diff and new files listed in
`mcc-patch1-requisition-review.md`, with before/after hashes and a selective
source snapshot retained locally. The three application source changes are
`backend/src/server/index.ts`,
`frontend/src/modules/inventory/InventoryPage.tsx`, and
`frontend/src/modules/requisitions/RequisitionsPage.tsx`. Do not substitute a branch
head for these reviewed bytes.

Patch 2 snapshot `ac69951278ef3078308aace01206a592d5d77fae` contains only:

- `frontend/src/modules/equipment-library/EquipmentLibraryPage.tsx`
- `tests/issue-176-compact-detail-cards.spec.ts`
- `tests/issue-209-equipment-persistence.spec.mts`
- `docs/mcc-patch2-equipment-layout.md`

Patch 3 snapshot `37acbb76284bc1f5338a9b837e5f42884cfc0656` contains only:

- `frontend/src/components/auth/MccLogin.tsx`
- `frontend/src/styles/mcc-login-concept.css`
- `frontend/src/main.tsx`
- `frontend/src/assets/jbt-usa-login.webp`
- `frontend/src/assets/mcc-login-factory.webp`
- `tests/mcc-login-issue-56.spec.ts`
- `tests/mcc-login-auth-preservation.spec.ts`
- `tests/issue-91-ui-polish.spec.ts`
- `docs/mcc-patch3-login-review.md`

Both snapshots parent the reviewed base. Their source paths do not overlap
Patch 1 application paths. That reduces conflict risk but does not establish
runtime compatibility or release approval. Preserve owner-approved visuals.

## Next bounded integration stage, after separate authorization

1. Inventory all dirty/untracked files, archived refs and private diagnostics
   again; compare recorded hashes. Preserve the primary Gate 2 work and all
   recovery evidence. Do not reset, sweep, bulk-stage or overwrite worktrees.
2. Create one isolated candidate from the exact reviewed base. Apply only the
   reviewed Patch 1 bytes and the two exact snapshot diffs. Review all hunks and
   every new asset/test/document. Exclude updater/Gate 2/backup-project changes.
3. Validate that PR #205's generator delegation remains intact in the shared
   backend file. Distinguish requisition workbook PDFs, asset maintenance-record
   PDFs and PM work-order attachment PDFs; expand scope only with an identified
   generator and explicit review.
4. Build, run managed full relevant suites and retain exact commands/results.
   Pin the resulting complete candidate and artifact manifest independently.
   The old approved SHA is the base; it cannot approve a new combined candidate.
5. Conduct source/security/license/privacy review, then seek separate approval
   for selective commit/push/PR/merge or CI dispatch. Local readiness does not
   authorize any of those publication actions.

## Outstanding integration tests

- Full candidate build and all relevant authentication, password-reset/session,
  permissions, inventory/persistence, requisition lifecycle, staging/batches,
  vendor grouping, totals, audit/history, and dashboard suites.
- Patch 1's both-tier Yes/No matrix on the exact intended LibreOffice/native
  ARM64 stack, including long wrapped identifiers/descriptions and pagination.
  Recheck checkbox ink and actual row geometry on that renderer.
- Actual browser preview/download and native print dialog for both templates;
  operator-reviewed color and grayscale output. No real orders without approval.
- Equipment and Machine cards, edit/save/cancel/unsaved guards, deep links,
  all Equipment stored fields, mobile/touch/keyboard/reduced motion/200% zoom.
- Approved login assets/design, focus/readability/accessibility, successful and
  invalid authentication, forced rotation, recovery, logout and session races.
- PM schedule/history/workbook/attachment workflows; actual Machine AND Equipment
  completed/resolve -> view/save/print -> history reprint maintenance-record PDFs.
  Preserve uploaded and historical PDFs; do not regenerate them in bulk.
- Regression on the combined native runtime and repeatable clean-start/stopped
  service artifact, dependency/config and migration compatibility.

Patch 2 reported 80 passed / 2 existing mobile duplicate skips (download-only
fallback and direct-write cancellation, both passed on desktop). Patch 3's
three mobile skips are now source-identified: `invalid, recovery, keyboard login,
authenticating, and dashboard flows remain intact` (desktop flow/screenshot),
`reduced motion keeps login state legible without animation` (single audit), and
`session loading, first-admin setup, and forced password change still render`
(single pre-auth audit). Their desktop equivalents were reported passed.
These are historical patch reports, not fresh combined-candidate results.

## Manual-release HOLD prerequisites

No production access is authorized by this document. A separately authorized
read-only preflight must establish trusted access, local console/recovery access,
the actual installed source identity/service/runtime, authoritative database,
uploads, workbooks, generated and historical PDFs, config/secrets, and every
writable/persistent path. Record sensitive paths and evidence privately.

Before approving a maintenance window or any write/restart:

- Prove current storage ownership/layout, database integrity, free space and
  complete data inventory. Identify all writers and a reviewed quiescence and
  in-flight-request drain procedure. Preserve users' unsaved work and sessions.
- Design a consistent backup across database and files, including SQLite WAL
  handling. Create integrity manifests and a separate off-device copy. An
  attached external SSD alone is not off-device disaster recovery.
- Demonstrate at least one isolated restoration, checking representative DB
  records, uploads, PM workbooks, attachments, PDF history, permissions and counts.
  Identify the operator, recovery owner, restore location and measured downtime.
- Verify exact candidate source/artifact hashes, native ARM64 compatibility,
  pinned dependencies/toolchain, config and migration behavior. No moving refs.
- Review a bounded manual installation and code rollback procedure. Do not run
  the outdated `update-mcc` or `create-deployment-rollback` production helpers.
  Do not replace authoritative data/config/uploads with a checkout or artifact.
- Separate code rollback from data recovery. Once the new app accepts writes,
  never automatically restore an old DB/files snapshot over those newer records.
  Schema/backward compatibility and preservation of post-release writes must
  inform an explicit recovery decision.
- Agree the maintenance window, downtime, notifications, unsaved-work handling,
  single release operator, go/no-go checklist and immediate stop conditions.

Only after demonstrated evidence and review, request explicit owner approval
for ONE exact candidate, ONE bounded manual release and its recovery procedure.
That authorization would cover only the approved stop/preserve/install/start/
health-check sequence. Missing access, consistent backup, off-device copy,
restoration evidence or candidate identity keeps the release on HOLD.

## Acceptance after an authorized release

Verify service health and before/after data counts/identities; authentication,
Equipment/Machine detail/edit, inventory persistence, PM schedules/history,
both requisition tiers, asset maintenance-record completion/history/print,
attachments, permissions and audit. Use agreed synthetic/non-destructive checks.
Privately record candidate/artifact hashes, timestamps, backup and restore
evidence, acceptance results and any recovery decision. Post sanitized milestones
to #211/#206. No production acceptance is inferred from a local test pass.

The One-Click Updater remains deferred at Gate 2 NOT ACCEPTED and
`accepted_hold`. Manual delivery does not waive its future gates, and it does
not require finishing the updater first. No production action has been taken.

Public continuity: [readiness plan on #211](https://github.com/Recklessrage17/maintenance-command-center/issues/211#issuecomment-6494045484). Implementation evidence remains in the local Patch 1 review report.
