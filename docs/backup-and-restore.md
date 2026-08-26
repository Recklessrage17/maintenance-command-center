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
