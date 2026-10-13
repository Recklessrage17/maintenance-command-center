# Machine retirement and history preservation

This feature adds a reversible lifecycle to Machine Library assets. It does not
change the application version (1.5.18), implement permanent deletion, or move
attachments. Publication and production deployment require separate approval.

## Lifecycle and authorization

`machine_assets.lifecycle_status` is independent of the existing operational
`status` (active/down/disabled/removed). Existing rows default to lifecycle Active.

| Lifecycle | Ordinary list | Archive list | Daily PM/Tech Note alerts | New PM scheduling/completion |
| --- | --- | --- | --- | --- |
| Active | Yes | No | Existing rules | Existing permissions |
| Out of Service | Yes, labeled | No | Excluded | Rejected |
| Archived | Excluded | Yes | Excluded | Rejected |

Historic machine, inspection, note, document and PM lookups keep using the same
machine ID. PM definitions, dates and meter/history rows are retained. Restoring
reactivates their previous scheduling eligibility; it does not recalculate due
dates. A manager should review overdue schedules before recommissioning.

| Action | Tech 1/2/3 | Manager | Admin / Owner Admin |
| --- | --- | --- | --- |
| Normal historical viewing | Existing view permissions | Existing view permissions | Existing view permissions |
| Archive / Out of Service / Restore / replacement link | Denied | Allowed | Allowed |
| Individual record operations | Existing permissions | Existing permissions | Existing permissions |

Owner Admin uses the canonical `Admin` role. General edit/document grants do not
grant lifecycle abilities. The API checks the authenticated role before transitions. Existing session expiry, disabled-user and login policies
remain in force.

Each lifecycle request requires the current `expectedRevision`. Validation,
replacement-chain checks, the row change and its history/audit events happen in
one SQLite transaction. Stale/repeated submissions return 409. Retirement requires
Replaced, Scrapped, Retired or Other; Other requires an explanation. Restore requires
a reason. Replacement IDs must exist, cannot be deleted, and cannot self-link or
form a cycle. Restore keeps the previous retirement metadata as historical context.

Archived configuration edits and the old soft-remove action require restoration
first. Imports reject non-active identities, including both spellings created by
the CSV/XLSX importer's automatic `Press ` prefix. Active-machine matching remains
unchanged. PM workbook resolution identifies archived sections explicitly and
preserves them without importing new maintenance changes; workbook dropdowns include
lifecycle Active machines only. Confirmation rejects previously active actions
whose machine was archived after preview, and commit-time guards cover
schedule/history/meter changes. Equipment lifecycle is unchanged.

## Migration and backup compatibility

`migrateMachineLifecycle` adds twelve columns and a lifecycle index in an atomic,
repeatable transaction. No table is rebuilt. Retirement stores reason/notes,
timestamp, actor ID/name, replacement ID, revision, last updater and restore
metadata. The replacement column references the original machine table.

Master backups already copy the complete SQLite database and configured upload/PM
storage. The existing restore flow reruns migrations, so old backups receive Active
defaults; new backups retain lifecycle metadata, relationships and original files.
Disposable regression coverage performs a real master backup/restore round trip,
compares the machine row and original file hashes, and checks SQLite integrity.

Before any eventual deployment, create and verify a master backup with the approved
release, use a disposable copy of representative company data to assess size and
retention, and agree on a rollback procedure. **Old application code ignores lifecycle
columns and can show archived machines as active.** A rollback therefore needs an
appropriate verified backup or a lifecycle-aware rollback build; simply reverting
the executable is insufficient. Restoring an older database intentionally restores
its historical state, including its then-current lifecycle.

## Permanent deletion contract — design only

No permanent deletion is implemented, and no age-based deletion is planned here.
The existing inspection year groups remain virtual, with the unsafe year-delete
control removed by Issue #174.

An eventual deletion feature must:

1. Require an authenticated Manager/Admin and a separately authorized retention
   policy covering legal holds, company retention periods, replacement links and
   active maintenance dependencies. Tech/document grants must not suffice.
2. Offer a verified history ZIP first, disclose missing/browser-only sources, and
   record whether a preservation package was actually delivered/accepted. A
   generation receipt alone cannot certify preservation.
3. Require a second confirmation containing machine number **and ID**, a mandatory
   deletion reason and the current lifecycle revision. Clearly list affected
   records/files, incoming replacement references and any blockers.
4. Enumerate the complete machine-ID graph (inspections, notes/updates/labor, documents,
   photos, PM definitions/history/participants/meters and typed history), plus newly introduced dependencies.
   Shared, orphaned, free-text and external/browser records require separate policy;
   never recursively delete a directory inferred from a name.
5. Use a durable operation journal and recoverable quarantine for exact verified
   file paths. SQLite and filesystem removal are not one transaction: validate and
   stage all paths first, commit metadata/tombstones atomically, finalize physical
   removal only under the approved contract, and recover safely from each partial
   failure. Do not report success after partial deletion.
6. Keep an independent durable deletion receipt containing actor, identity, reason,
   policy/hold decisions, preservation-package hash, dependency manifest, timestamps,
   phase outcomes and recovery information. Receipt retention must survive machine
   deletion and must not expose unnecessary private file contents.
7. Define verified backup retention, restore semantics, rollback ownership and
   recovery drills. Restoring an older backup can reintroduce deleted records and
   files; policy must govern that explicitly.

The existing individual inspection DELETE endpoint retains `machine.documents_manage`
authorization (base Tech 3/Manager/Admin, with existing permission-grant semantics).
Explicit selected-record deletion remains available. Its existing client partial
failure reporting and database-before-filesystem removal are known risks for the
future deletion contract. They are not broadened or refactored here. Older individual
inspection/component file getters also retain their external-upload-root limitation;
the separately stacked export change will resolve configured roots without changing
those unrelated endpoints.

## Lifecycle verification

This independently buildable change contains no machine-history ZIP endpoint or UI.
The separately stacked export PR adds that functionality and its coverage disclosures.
Run Node 22 locked installs, both builds, `node tests/machine-retirement-archive-api.mjs`,
and the matching Playwright `.spec.mts` for lifecycle, roles, preservation and backup
checks. Fixtures are synthetic and disposable. Permanent deletion remains design only.
