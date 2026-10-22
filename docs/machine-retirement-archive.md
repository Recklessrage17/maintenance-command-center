# Machine retirement and history preservation

This feature adds a reversible lifecycle to Machine Library assets in MCC 2.0.0.
It preserves original machine identities, history and attachments. Publication and production deployment require separate approval.

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
| Machine history ZIP | Denied | Allowed | Allowed |
| Individual record operations | Existing permissions | Existing permissions | Existing permissions |

Owner Admin uses the canonical `Admin` role. General edit/document grants do not
grant lifecycle/export abilities. The API checks the authenticated role before
export source access. Existing session expiry, disabled-user and login policies
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

## History ZIP source map

Only explicit relationships are selected. Equipment records with the same numeric
ID and unrelated records that mention a machine in prose are excluded.

| Source | Verified association | ZIP content |
| --- | --- | --- |
| Machine configuration | `machine_assets.id` | Full portable row, lifecycle metadata |
| Inspections / component photographs | `asset_id` | All rows and available original bytes |
| Machine Document Library | `asset_id`, `folder_id`, `parent_id` | Folder hierarchy, document metadata and originals |
| Notes and work orders | `machine_asset_notes.asset_id` | All notes, including preserved deleted/resolved notes, record PDFs, work-order references |
| Note original attachments | `note_id` | Originals, source/hash metadata |
| Updates / resolution / labor | `asset_library='machine'`, `note_id` | Updates, daily work entries, lifecycle events, labor |
| Update attachments | `update_id`, optional `entry_id` | Available original update files |
| PM definitions / completions / meters | `asset_library='machine'`, `asset_id` | All definitions, completion/history and meter rows, including inactive/deleted schedules |
| PM participants | Machine-associated `pm_history_id` | Recorded participant metadata |
| PM work-order PDFs | Machine library + `asset_id`, `pm_history_id` | Original PDFs and verified stored SHA-256 |
| Machine history | Machine-library numeric ID, or verified PM task/meter IDs | Recorded history snapshots and actor/reason/time |
| Audit | Typed machine/note IDs | Available typed events; connection IP/user-agent omitted |

The two legacy inspection-print audit actions use asset numbers/local-record labels
instead of numeric IDs. They are excluded from numeric-ID audit selection to prevent
cross-machine collisions. Their ambiguous relationship is disclosed in coverage.
Bulk/import/workbook-level events without a verified per-machine relationship are
not attributed to this machine. Generic requisition/work-order text is not a foreign
key. Populated legacy `machines`, `machine_library`, `machine_pms`,
`preventive_maintenance` or `work_orders` tables are explicitly reported as unsupported
sources with unverified ownership. A global PM workbook is not copied into a
machine ZIP; committed machine-associated PM rows are included. Unconfirmed workbook
data requires separate review.

The ZIP contains a machine-named root, understandable attachment folders,
`Records/*.json`, `SUMMARY.txt` and `MANIFEST.json`. JSON preserves original record
IDs, names, timestamps and relationships. Manifest entries identify output paths,
original names, sizes and SHA-256; the manifest is hashed in the durable generation
receipt. Unsafe absolute/traversal storage references are redacted from portable
record metadata. Missing generated note PDFs are disclosed rather than silently
treated as available.

### Completeness and browser-only data

`coverage.completeServerSources` is true only when every available attachment from
the supported server graph is included and no populated unsupported legacy table
was found. Missing, unsafe, linked, size-inconsistent or checksum-inconsistent files
make it false. Their records remain in the ZIP with a missing-attachment explanation.
There is no substitution with a different machine's file.

`coverage.completeAvailableHistory` is always false: the server cannot certify other
browsers/devices, orphaned files or unverified historical relationships. The UI reads
the three legacy inspection localStorage keys and the existing IndexedDB file keys
without migration or creation. It sends bounded coverage counts, marks a failed
check as unchecked, and never attributes orphaned files by name/prose. Browser-only
files are **not** included in this server ZIP. Both summary and manifest disclose
these limitations even when this browser reports zero records. Counts are client
reported coverage hints, not security decisions or proof of completeness.

Deleted originals that existing individual-record APIs already removed cannot be
recovered by export. Available surviving metadata/history is retained. Browser files
and unsynchronized legacy workbooks may need separate collection before an owner
certifies a complete retention package. This ZIP is a preservation export, not a
master-backup restore package.

### File safety and resource limits

The exporter reuses safe filename utilities and the PM stored-path resolver. It
uses configured upload/document/work-order roots, validates containment and rejects
links, absolute paths, dot traversal and inconsistent file metadata. Every payload
is streamed to an owned temporary byte snapshot before ZIP assembly; source files
are opened read-only, and size/mtime and available hashes are checked again.
Case-insensitive/NFC output collisions are rejected. ID prefixes avoid ambiguous
original names and reserved Windows basenames. No user-selected server destination
or recursive source deletion exists.

Limits per request are 2 GiB of original files, 32 MiB estimated/actual record JSON,
25,000 records and 10,000 files, with at most two concurrent exports. Disk space is
checked before copying; ZIP assembly/HTTP delivery use streams. Preparation has a
180-second ceiling and a 120-second connection inactivity timeout. Disconnect or
supported cancellation aborts processing and removes owned staging files. A hard
process/OS termination can leave temporary snapshots for supervised cleanup; it
does not alter source records. These bounds should be assessed against actual Pi
resources before production deployment.

Supported browsers can choose a ZIP save location with `showSaveFilePicker`. The
picker is invoked directly from the click, before asynchronous work. Streaming
progress uses the exact ZIP size; cancellation aborts an unfinished writable. Other
browsers use standard download handling, with explicit browser-managed progress
and cancellation. The UI reports `ZIP saved` only after a successful stream close,
and asks the user to review coverage. Native picker behavior and mobile device
behavior still need owner acceptance; automated checks use Chromium desktop/mobile
layouts with an instrumented picker plus real download fallback.

Audit/history records `machine_archived`, `machine_out_of_service`,
`machine_restored`, `machine_replacement_changed` and
`machine_history_export_generated`. Generation receipts distinguish ZIP generation
from successful client delivery. They include actor, machine ID, time, manifest
hash, category counts and coverage. The current receipt is created after the
snapshot; it therefore appears in subsequent exports rather than recursively inside
its own ZIP.

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
4. Enumerate the complete explicit graph above, plus newly introduced dependencies.
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
the new exporter resolves configured roots itself, which directly enables safe export
without changing those unrelated endpoints.

## Review boundaries and verification

Recommended publication boundaries, following separate approval:

1. **Machine lifecycle and Old Machines Archive:** migration/service, list/detail
   filtering, transactional role/revision/replacement checks, import/PM guards,
   archive/dialog styling, lifecycle API/UI and backup/restore tests.
2. **Machine history preservation ZIP:** export source map/service/route, generation
   receipts, browser coverage/save/cancel UI, byte/hash/security/resource tests and
   export documentation. Keep coverage wording and limitations in this PR.

The current working tree includes both parts for local end-to-end verification.
Split the index/page integration hunks and combined regression cases along these
boundaries when preparing approved commits. Do not claim browser/unmapped legacy
history is included in the second PR.

Run Node 22 with locked dependencies, frontend/backend production builds,
`node tests/machine-retirement-archive-api.mjs` and the matching `.spec.mts` browser
test. Related inspection, machine/document, PM/import, authentication and CI browser
checks provide regression coverage. All fixtures and exports use synthetic,
disposable Windows-local storage; no production records or Pi access are needed.
