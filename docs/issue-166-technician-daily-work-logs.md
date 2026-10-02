# Issue #166: technician daily work logs

Target: v1.5.17 staging recheck. The application version remains v1.5.16.

## Model and compatibility

`asset_note_updates` remains the technician-owned thread. Its ID, original creator,
creation timestamp, attachment relationships, and historic edit metadata remain intact.
`asset_note_update_entries` contains individual dated entries with body, labor increment,
creation/edit timestamps, and creator/editor user IDs. An initial-entry flag and partial
unique index ensure each normalized thread has one initial entry. Attachment rows now
have an optional `entry_id`; legacy attachments continue to belong to their thread.

The additive startup migration marks normalized threads with `daily_entries_version=1`.
For a legacy thread, it copies the existing body into the initial entry, derives the
work date from the original `created_at` in the existing server-local calendar
convention, preserves historic editor metadata, and assigns zero daily labor. Repeated
migration does not duplicate entries. Invalid creation dates fail migration instead of
inventing dates. The compatibility `body` column mirrors only the initial entry;
appending or correcting a later entry never replaces that body or another entry.

## Ownership, daily work, and lifecycle

The thread's original creator is the only allowed author. Manager, Admin, and Owner
Admin roles do not override this check. Cross-owner append/correction requests,
including labor or attachment additions, return HTTP 403 with
`TECHNICIAN_UPDATE_OWNER_REQUIRED`. Lifecycle authority remains separate.

Both libraries use the same handlers and component. New threads accept the initial
dated entry. Owned threads offer **+ Add Daily Entry** and individual **Correct Entry**
controls. Entries sort by work date, creation timestamp, and ID. Work date defaults to
today in the UI and uses MCC's date input/display formatting. Labor is optional,
0–24 hours per entry, with at most two decimal places. Existing thread-level Edit
Update and the legacy PATCH endpoint correct the initial entry only.

The existing server-authoritative correction window still controls every operation:
active issues allow owned changes; resolved issues allow owned changes strictly before
48 hours; exactly 48 hours and later return the existing expiry response. The server
checks again inside the write transaction. Reopen returns to normal ownership rules,
and a later resolution starts a new window. The one-shot browser expiry timer remains.

Reopen inserts an actor-owned thread and initial reason entry in the same transaction
as the lifecycle transition and audit evidence. Rollback/retry tests verify that failed
transitions do not leave duplicate work. Draft body, date, labor, and files participate
in the existing unsaved-work guards for issue, work-log, lifecycle, and accordion changes.

Audit events use `update_added`, `daily_entry_added`, and enriched `update_edited`
payloads containing entry/thread IDs, owner, work date, body, labor, added attachments,
actor, timestamp, and correction before/after values. Historic metadata stays internal;
the main comments view does not add a verbose edited line.

## Labor calculation and presentation

Daily entries are the authoritative increments for new work-log labor. Existing
`asset_note_labor` rows remain a separately identified manual baseline:

`technician hours = manualHours + sum(owned daily-entry labor_hours)`

`issue hours = sum(technician hours)`

Thread subtotal uses only that thread's entries. Migration contributes zero new hours,
so existing manual labor is not counted again. Editing the issue's manual labor form
loads only manual hours, not the combined total. API and ZIP history expose manual
and daily source totals explicitly. This does not infer or transfer existing manual
hours into dated entries.

The labor panel is content-sized and capped at 440px on desktop, responsive on small
screens, and displays `Name / 1.50 Hrs` inline. Daily bodies retain MCC amber, the
comments panel retains its light border, and interactive daily-entry controls have
44px minimum height.

## Completion, PDFs, exports, and recovery

The server derives one `technicianCompletionEntryId` for the current resolution. It
selects the latest eligible dated entry across all threads, breaking ties by creation
timestamp and ID. Entries created after resolution, future work dates, and entries
created before the latest reopen are excluded. Active issues have no current marker.
Historical text is not changed. A new resolution selects the new cycle's endpoint.
The UI uses MCC success green, a one-time 400ms pop followed by a static check, and
suppresses animation for reduced-motion preferences. Opening history again does not
replay an already consumed animation.

Maintenance Record PDFs show the original technician/thread timestamp, every daily
date/body/labor increment, thread subtotal, and combined issue labor, with existing
wrapping, pagination, asset identity, lifecycle, and attachments preserved. Work Order
ZIP JSON includes structured entries, ownership, labor subtotals/source totals, and
entry attachment references. Existing fields and ZIP schema version remain intact.

Portable backup snapshots include the new SQLite table and relationships. Each
library's readable Excel insurance export adds a Daily Work Entries sheet. Validation
checks normalized initial entries, ownership, dates, labor, edit metadata, attachment
entry/thread membership, and daily-entry audit relationships alongside existing
database/file integrity validation. Historic initial-entry edits by a different user
remain valid evidence. Restore preserves entry IDs and all relationships. Legacy
packages remain compatible and receive the additive migration after restore; the
portable schema version is unchanged.

## Validation

- `npm run build`: passed.
- `node tests/technician-work-logs.mjs`: passed.
- `node tests/warning-issue-lifecycle-api.mjs`: passed for both libraries, including
  the strict ownership role matrix, 47-hour/exactly-48-hour boundary, per-entry
  correction, labor rollup, PDF content, actual ZIP content, reopen rollback, and
  resolution cycles.
- `node tests/portable-master-backup.mjs`: passed, including new-entry corruption
  rejection, exact ownership/entry/labor/attachment roundtrip, and existing file hashes.
- `node tests/issue-129-asset-notes-api.mjs`: passed.
- `node tests/work-order-records-export.mjs`: passed.
- `node tests/issue-128-work-order-records-api.mjs`: passed.
- `node tests/equipment-library-api.mjs`: passed.
- Playwright `warning-issue-lifecycle.spec.ts`: 40 passed on desktop/mobile Chromium.
- Playwright `issue-129-asset-notes-ui.spec.ts`: 42 passed.
- Playwright `issue-136-work-order-pdf-history.spec.ts`: 12 passed.
- Playwright `dashboard-pm-alerts.spec.ts`: 37 passed, 1 intentional skip (desktop-only
  wheel continuity scenario in the mobile project).
- Focused migration, lifecycle API, and source/restored portable databases:
  `PRAGMA integrity_check = ok`; `PRAGMA foreign_key_check = 0 rows`.
- `git diff --check`: passed.

The initial combined browser run exposed four failures in the new re-resolution
test's paused-clock handling. The test now advances the existing save-success timer
and waits for the saved entry before resolving again; the focused four cases and full
40-test lifecycle rerun pass. No application workaround was needed.

## Changed files

- `backend/src/server/assetNoteWorkLogs.ts`
- `backend/src/server/index.ts`
- `backend/src/server/portableBackup.ts`
- `backend/src/server/workOrderRecordsExport.ts`
- `frontend/src/modules/machine-library/AssetNotesAttachments.tsx`
- `frontend/src/styles/app.css`
- `tests/technician-work-logs.mjs`
- `tests/warning-issue-lifecycle-api.mjs`
- `tests/warning-issue-lifecycle.spec.ts`
- `tests/portable-master-backup.mjs`
- `docs/issue-166-technician-daily-work-logs.md`

READY FOR STAGING RECHECK after the listed validation. Issue #166 remains open.
Commit and push stay on `feature/issue-166-edit-technician-updates`; no merge,
deployment, version bump, or production infrastructure change is included.
