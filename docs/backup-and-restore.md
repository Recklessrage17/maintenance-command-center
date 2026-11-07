# MCC Master Backup and Restore

MCC Master Backup is the operational-data recovery system. Git/GitHub restores **application code**; a verified MCC Master Backup restores **MCC operational data** such as users, settings, inventory, vendors, machines, equipment, requisitions, history, PM records, the active PM workbook, work-order files, documents, and uploads.

SQLite remains authoritative. Excel workbooks are readable insurance and audit aids, not a replacement relational restore source.

## Existing backup engine and types

The portable feature extends the existing engine. It still uses SQLite `VACUUM INTO` after a WAL checkpoint, verifies the snapshot, applies the established retention rules, records history/audit activity, and supports the existing startup/scheduled/automatic/manual/pre-restore behavior.

The current tiered types are:

- `daily_auto` and `daily_manual`
- `weekly_scheduled` and `weekly_manual`
- `master_scheduled` and `master_manual`
- `pre_restore`
- legacy `startup`, `scheduled`, `auto`, and `manual` packages remain readable/restorable

Local verified backups remain primary. A portable-archive or external-copy failure does not delete, corrupt, or invalidate a completed local package, and no operation writes to the source ZIP.

## Master retention: newest three verified sets

**Retention: Keep newest 3 verified Master backups.** Normal manual
(`master_manual`) and monthly scheduled (`master_scheduled`) Masters share one
limit. A set means its package directory, manifest-linked local portable ZIP,
checksum sidecar, and (for new sets) small completion receipt. It is not a file
count. Ordering uses validated manifest UTC creation time, then descending ID
for ties; filesystem modification time is ignored.

Starting with three verified sets, the next successful manual **or** scheduled
Master creates and fully verifies a fourth, publishes its completion receipt,
then removes only the oldest eligible set. Three remain. Snapshot, payload,
SQLite `integrity_check`, ZIP headers/CRC/payload hashes, sidecar, and publication
must all pass before rotation. Failed attempts never trigger pruning and are
protected from automatic deletion. Their local packages remain available for
supervised verification/recovery. A failed portable archive returns a failure;
an enabled external-copy failure preserves the existing successful-local-create
response with a clear warning, marks backup health as needing attention, excludes
that attempt from retention, and prunes nothing. External copies are never deleted.

Settings > Backup Center shows verified local count, protected/excluded count,
pending cleanup count, and latest fully verified date. Creation reports the
backup ID/time and pruned/retained/skipped/failed counts. Counting requires full
verification and can take longer for large packages or backlogs.

Administrators and Owner Admins can open **MCC Master Backup > View Backups >
Preview Cleanup**. The preview is read-only: it lists the exact kept sets,
eligible deletion candidates with date/type/size/verification, protected entries
with reasons, and interrupted cleanups. To apply, type the displayed
`DELETE N MASTER BACKUPS` phrase. Confirmation binds to those immutable IDs and
a user-specific, one-use preview token valid for ten minutes. Any inventory
change requires another preview. Every candidate and all three survivors are
revalidated immediately before deletion. Manager/technician accounts cannot
preview or apply cleanup; existing read/download/import rights are unchanged.

Historical backlogs require this deliberate preview/confirmation to reduce to
three in one operation. Automatic rotation removes at most one eligible oldest
set per successful creation; it does not sweep the backlog on upgrade/startup.
Unverified or anomalous sets never count toward the three and are never swept.
Daily/Weekly retain their existing independent behavior. Master retention never
deletes pre-restore, startup, legacy/unknown, imported recovery, external,
deployment rollback or full-Pi recovery data. Pre-restore creation/restore remains
independent and its older per-type automatic pruning is disabled.

Deletion accepts only recognized direct children of the configured Master root
and specifically linked ZIP/sidecar children of its local portable root. It
rejects traversal, symlinks/junctions (including ancestors), hard links, mismatched
IDs/dates/types/archive manifests, shared ZIP ownership, and changed/unlisted
payloads. There is no recursive sweep: cleanup unlinks an exact verified file
allowlist and removes only now-empty directories. Backup/restore history is
retained, with audit events for automatic and administrator cleanup.

### Interrupted cleanup and recovery

Before removing anything, MCC flushes a signed `.master-retention-*.json` file
allowlist in the Master root. If unlink or directory removal fails, the result
reports a failed/pending cleanup, preserves the journal, and stops further
deletions. Later automatic rotations stop while cleanup is pending. After a
restart, **Preview Cleanup** displays the interrupted work; administrator
confirmation rechecks three surviving valid sets and every remaining file/hash
before resuming. Already missing allowlisted files are treated idempotently.
Changed or extra files, altered journals, unsafe paths, or fewer than three
verified survivors stop recovery for operator review. Never manually remove a
journal to make an error disappear.

New `.master-published-<backup-id>.json` receipts and pending journals use the
configured `SESSION_SECRET` for authentication. Keep that secret stable across
restarts. If it is changed/lost (or absent and regenerated), previously signed
receipts/journals require supervised review; MCC conservatively excludes them
instead of deleting anything. These small metadata files stay beside local
packages; the portable ZIP remains self-contained and does not need the secret
for download/import/restore. Normal rotation removes the matching receipt too.

This three-Master policy and imported recovery package quotas are independent.
Neither replaces a tested off-device recovery copy or a full Raspberry Pi
OS/configuration/deployment recovery plan. No deployment or production cleanup
is part of enabling this feature in development.

## Portable package structure

Each new Master Backup, including `pre_restore`, uses this stable logical structure:

```text
MCC_Master_Backup_YYYY-MM-DD_HH-mm-ss/
├── manifest.json
├── RECOVERY_README.txt
├── database/
│   └── mcc.sqlite
├── excel/
│   ├── MCC_Inventory.xlsx
│   ├── MCC_Vendors.xlsx
│   ├── MCC_Machine_List.xlsx
│   ├── MCC_Equipment_List.xlsx
│   ├── MCC_History.xlsx
│   └── PM/
│       └── PM_report_latest.xlsx       # when an active workbook exists
├── files/
│   ├── uploads/...
│   ├── documents/...
│   ├── files/...
│   └── pm-work-orders/...
└── recovery/
    └── restore-manifest.json
```

The `.zip` contains this one top-level folder. A numeric suffix may be added if two packages are created during the same second. The ZIP is generated from the already-created, verified package and the same SQLite snapshot; MCC does not take a second unrelated database snapshot for the archive.

The manifest records package/schema version, MCC version, UTC creation time, backup type, database SHA-256, payload checksums, record counts, included paths, Excel exports, and payload size. `recovery/restore-manifest.json` contains relative source-to-current-configuration mappings, never failed-drive absolute destinations.

### Excel insurance exports

Excel files are generated from the snapshot database, not changing live tables. Every persisted column from the applicable tables is exported. History/audit tables use deterministic sheets. Values exceeding Excel's cell limit are referenced from an `Oversized Values` sheet and split into complete numbered parts rather than silently truncated. PM history is copied through the current formula-free workflow; obsolete Helper formula columns are not regenerated.

`MCC_Vendors.xlsx` contains both `Vendors` (`inventory_vendors`) and `Vendor Contacts` (`vendor_contacts`), including primary and every additional/secondary contact. `MCC_Inventory.xlsx` preserves the exact `part_info_url` value; syntactically valid `http://` and `https://` values are clickable Excel hyperlinks, while blank, malformed, or non-HTTP(S) values remain blank/plain text.

`MCC_Machine_List.xlsx` includes current and legacy machine/PM tables when present plus `Document Folders`, `Documents`, `Asset Notes`, `Note Attachments`, `Inspection Records`, and `Component Images`. All persisted IDs and fields remain present. The file sheets add machine asset numbers, folder/note relationships, and safe package-relative physical paths where they can be derived. They never turn an old absolute runtime path into a recovery dependency. SQLite and the files under `files/uploads/` remain the authoritative full-fidelity restore sources.

`MCC_Equipment_List.xlsx` includes Equipment document folders and files alongside the existing asset and note sheets. `MCC_Facility_Info.xlsx` includes Facility areas, nested folders, and files. The Machine, Equipment, and Facility library sheets include full nested folder paths and safe package-relative payload locations.

## Browser download

Manager and higher can use **Download Portable Backup** in Settings. The response is streamed from a fixed MCC backup directory with `application/zip`, a safe attachment filename, `Content-Length`, `private, no-store`, and `nosniff`. The API resolves a backup ID inside the allowlisted Master Backup directory and never accepts a filesystem path.

The browser/operating system controls the Save As/download destination. Canceling or losing a download only stops that response; it never modifies the verified package or ZIP on the MCC server.

## Runtime and Raspberry Pi paths

For a full pre-release deployment rollback archive on Raspberry Pi, use the
[`create-deployment-rollback` helper](admin-one-click-updater.md#full-deployment-rollback-snapshot-for-pi-releases).
This archive includes the live database and uploads but excludes MCC's own
`backend/backups` history and reinstallable dependencies. The MCC daily/master/portable
backup workflow described here is separate from deployment rollback snapshots.

Use persistent paths for production. MCC resolves restore destinations from the current installation's environment:

```text
MCC_DATA_DIR             authoritative runtime data and mcc.sqlite
MCC_UPLOADS_DIR          uploads and document payloads
MCC_BACKUPS_DIR          local primary backups and portable ZIPs
MCC_PM_EXCEL_DIR         active PM workbook and workbook backups
MCC_PM_WORK_ORDER_DIR    PM work-order PDFs/attachments
MCC_RECOVERY_DIR         imported archives and verified extracted packages
```

When `MCC_DATA_DIR` is already outside the Git checkout, recovery defaults under that persistent data directory. When the development/default data directory is inside the checkout, recovery defaults to the service account's `.mcc/recovery` directory so imported disaster-recovery data is not stored in Git. For Raspberry Pi production, explicitly provision an MCC-owned directory such as `/var/lib/mcc-recovery` and set `MCC_RECOVERY_DIR=/var/lib/mcc-recovery` in the service environment.

Recommended production ownership and permissions are the MCC service account with directory mode `0700`; packages and archives are written as private files. Do not place databases, generated backups, recovery archives, external copies, or secrets in Git.

The compressed creation/import limit defaults to 3072 MB and can be set up to the verified 3584 MB classic-ZIP ceiling with `MCC_PORTABLE_BACKUP_MAX_MB`. MCC does not mark an archive above that same importer envelope as recovery-ready. ZIP64 remains unsupported. The importer also enforces entry-count, expanded-size, and suspicious compression-ratio limits.

ZIP inspection and extraction are bounded for Raspberry Pi use. The inspector reads only the final ZIP metadata window (at most 65,557 bytes) and a central directory capped at 32 MB. It never reads the complete archive into a JavaScript buffer. Extraction processes one entry at a time through range-limited file streams, backpressure-aware inflate, expanded-byte accounting, and CRC-32 verification. Package SHA-256, per-file manifest checksums, SQLite integrity, and Machine, Equipment, and Facility library database-to-file relationship validation run after extraction.

## Optional external backup destination

An Admin/Owner Admin can configure a mounted USB disk or server-side share in Settings, for example:

```text
/media/usb/MCC_Backups
/mnt/mcc-backup
/network/mcc-backups
```

Use **Test Backup Location** before enabling automatic copies. MCC requires an absolute path, rejects filesystem roots and any path overlapping application code, live data, local backups, uploads, PM storage, or recovery storage, rejects linked/junction paths, creates the destination when safe, writes and syncs a probe file, and reports available space.

After the local package and ZIP validate, MCC copies the ZIP to a temporary file in the configured destination, verifies its SHA-256, then atomically renames it. MCC records the last test/copy timestamp, result, filename, and safe error message separately from local backup health. If an explicitly configured disk/share is missing, read-only, full, or contains a conflicting filename, MCC reports failure and does not silently copy elsewhere.

External destinations contain no MCC credentials or destination secrets. Mount authentication remains an operating-system responsibility.

## Import into MCC-owned recovery storage

The recovery/import card is visible to Manager and higher. Final destructive restore keeps the existing stricter Master Restore rule: Admin/Owner Admin plus exact `RESTORE MCC` confirmation.

1. Select an `MCC_Master_Backup_*.zip` in Settings.
2. The browser uploads it to an MCC-owned incoming area; upload progress is based on transferred bytes.
3. MCC treats the ZIP as untrusted and validates its central directory before extraction.
4. MCC checks compressed/expanded limits, entry count, compression ratio, root/package structure, duplicates, traversal, absolute/drive-letter paths, links/devices, required payloads, manifest versions, every checksum, SQLite integrity, and database compatibility.
5. Bounded extraction occurs in a unique staging directory using create-new files only; every file is streamed and checked against its declared size and ZIP CRC.
6. MCC verifies the extracted local package, copies and checksums the archive into persistent recovery storage, then atomically promotes the extracted package.
7. Only after success does MCC show: **Backup safely copied to this MCC drive. External backup drive may now be disconnected.**

Failed imports remove their MCC-owned staging artifacts, never touch live state, and can be retried. Imported archives/packages are retained independently of normal local-backup retention. MCC never automatically deletes an imported recovery package, so it cannot silently delete the last valid recovery copy or a package being restored.

Recovery storage is bounded instead: imports stop before committed storage exceeds `MCC_RECOVERY_QUOTA_MB` (default 8192 MB) or `MCC_RECOVERY_MAX_PACKAGES` (default 3). Settings shows current bytes/package usage and disables new imports at the limit. An operator must first verify and offload an older package, then deliberately remove that package from MCC-owned recovery storage according to the site's retention procedure. Re-importing the exact already-retained package remains idempotent. Free-space checks still reserve temporary room for the incoming archive, streamed extraction, verified archive copy, and staging headroom.

## Bare-drive / new-SSD recovery

1. Replace the failed Pi/SSD/HDD and install the supported Raspberry Pi OS.
2. Clone/install the current supported MCC release from GitHub or the normal deployment artifact. This restores application code only.
3. Configure the current runtime directories and provision `MCC_RECOVERY_DIR` outside the checkout.
4. Start MCC and complete fresh-install access.
5. Temporarily connect the USB/share/PC copy containing one complete `MCC_Master_Backup_*.zip`.
6. In **Settings → Master Backup / Recovery**, a Manager+ imports the ZIP.
7. Wait for full local-copy validation and the safe-to-disconnect message; then disconnect the source if desired.
8. An Admin/Owner Admin selects **Restore Verified Backup**, types `RESTORE MCC`, and continues.
9. MCC revalidates the persistent local copy before touching live state.
10. MCC creates and verifies the normal portable `pre_restore` safety backup.
11. The restore modal reports compact phase-weighted progress from actual backend recovery events while MCC restores the database and packaged runtime payloads into the current configured locations. It does not restore old absolute paths.
12. `100%` is reported only after database/file/storage validation and recovery metadata work complete successfully.
13. Refresh/restart as prompted and log in using users restored from the backup database.

The restore runs from the verified local imported copy, not directly from removable media. A reboot or source-drive removal therefore does not create an ongoing dependency on the old mount.

## Restore safety and rollback

Before replacement, MCC verifies the complete package and SQLite `PRAGMA quick_check`. Machine Library validation additionally proves that documents, generated note PDFs, note attachments, inspection files, and component images referenced by SQLite exist in the package, have their recorded sizes, and retain valid machine/folder/note relationships. The live database is closed only after validation and the verified `pre_restore` safety backup succeeds. Database/WAL/SHM and complete portable payload folders are restored from allowlisted mappings. PM workbook and work-order storage use their current environment-derived paths.

If restore fails after replacement begins, MCC reopens the `pre_restore` snapshot, restores its runtime payloads, recreates required storage directories, and leaves the source backup unchanged. The failure is audited and the verified local imported package remains available for retry.

## Post-restore verification

After login, verify:

- expected users, roles, and applicable settings
- inventory quantities/locations and vendors
- machines, equipment, notes, documents, and specifications
- requisitions and requisition history
- MCC history/audit records
- PM schedules, meters, completion history, and participants
- `PM_report_latest.xlsx`
- PM work-order PDFs/attachments and links
- general documents, uploads, branding, and Facility Info payloads
- Settings backup health and a new test Master Backup

Create and download a new portable backup after verification so the recovered installation has a fresh off-device recovery point.

## Retention

Normal tier retention remains type-specific. When MCC retention removes a local Master Backup folder, it removes that package's adjacent portable ZIP/checksum sidecar as the same recovery unit. Retention never deletes configured external copies or imported recovery archives. Imported recovery storage uses the explicit quota/package-count stop policy described above; there is no silent age-based deletion.

## Troubleshooting

- **Portable archive missing/checksum failed:** verify the local package. Create a new Master Backup; MCC will not stream an unverified ZIP.
- **External test rejected:** use an absolute mounted destination outside MCC code/runtime/recovery trees; confirm the service account owns or can write it.
- **External copy failed:** reconnect/remount the exact configured disk/share, confirm free space and filename conflicts, retest, then create a new Master Backup. MCC does not silently fall back.
- **Import rejected:** do not manually extract/repack the ZIP. Use an intact archive from MCC and check package version, size limit, free space, and checksums.
- **Recovery limit reached:** verify that another off-device copy exists, offload an older imported package if needed, and remove it deliberately according to site policy. MCC will not choose or delete a recovery copy automatically.
- **Newer/incompatible package:** install the supported matching/newer MCC application release before importing.
- **Restore denied:** Manager can import, but the existing Master Restore permission remains Admin/Owner Admin.
- **Login changed after restore:** sessions and users come from the restored database. Refresh and sign in with a restored account.

## Required Raspberry Pi staging rehearsal before release

Do not release based on automated tests alone. On an isolated Raspberry Pi staging system with copied/sanitized data:

1. Create a Master Backup containing representative inventory, vendors, machines, equipment, requisitions, history, PM workbook/history, work-order PDFs, uploads, and documents.
2. Verify and download/copy its ZIP off-device; record SHA-256, database record counts, and representative file hashes.
3. Power down, replace or fully reimage the staging drive, and install the supported OS/MCC release with production-like persistent paths/ownership.
4. Import the ZIP from removable/network storage, wait for the safe-disconnect status, physically disconnect/unmount the source, and reboot.
5. Perform the Admin-confirmed restore from the local imported copy.
6. Reboot again, log in, compare all recorded database counts/file hashes, open the PM workbook and representative PDFs/documents, and exercise normal reads/writes.
7. Confirm a verified `pre_restore` package exists, a new Master Backup can be created/downloaded, external-copy success/failure is visible, and no service depends on the disconnected source path.

Release approval requires this rehearsal to pass without using production runtime/data.

## Portable archive readiness hardening

Creation now runs the same import inspector before publication. Entries rejected only for exceptional compression are rebuilt with ZIP STORE and inspected again; untrusted imports retain ratio/size/entry/path/ZIP64 defenses. A failed archive leaves its verified local package intact, is not advertised as portable-ready, and reports a smaller-package or supervised-recovery remedy. Existing ZIPs are also inspected before being listed as ready or downloaded. See [deployment recovery hardening](release-deployment-safety.md) for complete external snapshots and guarded lifecycle-aware recovery. A full deployment snapshot also preserves PM Excel source/backups, recovery/backup histories and OS configuration that a Master package does not replace.


### Status polling versus integrity verification (PR #213 follow-up)

Backup Center polling reads manifests and file metadata, not ZIP contents or backup
payloads. The Master counter is explicitly the **last successful integrity result**
whose file identities, sizes, change times and modification times still match.
It is not a fresh integrity certificate. A newly discovered, changed or restarted
set is shown as awaiting verification. Use **Verify**, or an administrator's
**Preview Cleanup**, to perform a fresh check. After restart no previous in-memory
verification is assumed; signed publication receipts remain on disk for the fresh
check. Unknown sets remain protected. During a check the UI shows previous results
and an in-progress/attention state. Imported recovery entries in routine status are
metadata only; selecting restore still invokes full validation.

Deep Master verification, publication and retention run in one worker thread.
Concurrent deep requests are rejected instead of starting overlapping scans. Status
polling can return during a scan without waiting for its ZIP hashing/decompression.
Cleanup never consumes the status cache: preview, inventory comparison, three
survivors, candidate checks and signed interruption journals retain fresh validation.
The live database health check remains separate from backup integrity verification.

### Persistent signing configuration and read-only Pi preflight

The application reads its repository-root `.env` using dotenv without overriding
variables already supplied by its service environment. Authentication retains its
existing behavior: an absent SESSION_SECRET gets a temporary random session key.
Master retention deliberately does **not** use that temporary key. Without a
configured SESSION_SECRET, publication/deletion fail closed and existing sets stay
on disk. Changing a configured secret makes old publication/journal signatures
untrusted; do not edit receipts, re-sign journals or automatically prune them.
Portable recovery verification remains available independently of receipt trust.
Keep the configured secret stable across application and service restarts, out of
Git, and in the operator's existing protected configuration backup. This change
neither generates a production key nor rotates an existing one.

The following is a **read-only operator procedure**, not executed as part of this
PR. No restart, credential edit, backup mutation or service stop is needed. Never
paste `.env`, `systemctl show Environment`, `/proc/.../environ`, or a key into a chat.

1. Confirm the service and accepted source without changing them:
   `systemctl is-active mcc.service` and
   `git -C /opt/maintenance-command-center rev-parse HEAD`.
2. For the repository-root `.env` configuration, run the following from the accepted
   application directory. It prints only booleans and fails if the effective key
   cannot be established safely. Adjust the application path only after confirming
   the actual service working directory. It does not import/start the MCC server.

```sh
cd /opt/maintenance-command-center
sudo node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(path.resolve('backend/package.json'));
const dotenv = require('dotenv');
const value = key => execFileSync('systemctl', ['show','mcc.service',`--property=${key}`,'--value'], {encoding:'utf8'}).trim();
try {
  const pid = Number(value('MainPID'));
  if (!pid) throw new Error();
  const filename = path.resolve('.env');
  const stat = fs.lstatSync(filename);
  const configured = dotenv.parse(fs.readFileSync(filename)).SESSION_SECRET;
  const initial = Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`,'utf8').split('\0').filter(Boolean).map(item => {
    const i=item.indexOf('='); return [item.slice(0,i),item.slice(i+1)];
  }));
  const started = Date.parse(value('ExecMainStartTimestamp'));
  const journal = execFileSync('journalctl',['-u','mcc.service','--since',value('ExecMainStartTimestamp'),'--no-pager','-o','cat'],{encoding:'utf8',maxBuffer:8*1024*1024});
  const checks = {
    persistentFileHasKey:Boolean(configured && configured!=='replace-with-a-long-random-secret'),
    regularProtectedFile:stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077)===0,
    unchangedSinceServiceStart:Number.isFinite(started) && stat.mtimeMs<=started,
    serviceEnvironmentCompatible:!initial.SESSION_SECRET || initial.SESSION_SECRET===configured,
    applicationReportedConfigured:journal.includes('SESSION_SECRET configured: yes'),
  };
  console.log(JSON.stringify(checks));
  if (!Object.values(checks).every(Boolean)) process.exitCode=1;
} catch { console.log('PREFLIGHT_UNRESOLVED: configuration could not be verified without exposing values.'); process.exitCode=1; }
NODE
```

3. If the service uses an EnvironmentFile, credential provider, wrapper or a
   different working directory instead of this `.env`, this procedure is not proof
   of its persistence. Have the operator privately compare its effective key with
   the persistent provider and verify the provider survives restart. Do not print
   values or hashes. Any failed/unknown check is a release preflight blocker, not
   permission to change credentials. Stable-key restart and changed/missing-key
   behavior are automated in disposable development fixtures; production persistence
   and physical ARM64/storage performance remain operator validation boundaries.
