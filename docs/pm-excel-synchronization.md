# PM Excel synchronization

MCC is the authoritative preventive-maintenance record. The Excel workbook is an import source, synchronized report, audit document, and downloadable backup.

## Supported workbook contract

The workbook must be an `.xlsx` file and contain these worksheets:

- `Machine Pm Tracker`
- `PMHistory`

The parser locates existing header rows by approved normalized aliases rather than fixed row numbers. It supports the production block layout where a `Press:` / machine section row supplies the identifier for following task rows, skips repeated headers within later machine blocks, and never fills blank task-row context cells with the inherited identifier. A task without one unambiguous parent section is rejected.

The synchronized tracker supports `Hourly`, `Cycle` / `Cycles`, `Days`, and `Annual`. Hour and cycle rows use monotonically increasing meter readings. Days and Annual use real Excel dates. The production `Annual` value of `365` is retained as 365 days; legacy MCC Annual rows configured as `12` retain their existing 12-month behavior.

`PMHistory` work-order numbers are not globally unique. Imported row identity uses a composite source hash containing the asset, task, interval, dates, work order, status, performer, type, and note. MCC completions use their completion request ID. This preserves multiple valid task rows under one work order while blocking exact repeated imports and submissions.

## Controlled workflow

1. An authorized maintenance user selects an `.xlsx` workbook.
2. **Preview Changes** validates both required sheets and reports additions, updates, inherited machine sections, history additions, conflicts, warnings, and rejected rows. Preview state is held in memory for 30 minutes and does not write PM or audit data.
3. **Import Valid Rows** requires an explicit preview token and idempotency key. The backend reparses the server-held workbook and rebuilds the action plan against current MCC data before opening the transaction. Rejected and unresolved conflicting rows are skipped; valid, unambiguous rows remain importable. Decreasing-meter rows are imported only when supplied with a replacement/correction/override type and meaningful audit reason.
4. Valid changes are committed to SQLite in one transaction and audited with both the previewing importer and confirming user IDs.
5. Workbook synchronization runs after the database transaction. Failure does not roll back MCC data; the status becomes failed and the UI exposes **Retry Sync**.

PM completion uses the same post-transaction synchronization boundary and a unique completion request ID. Repeated requests return the original completion instead of appending another MCC or `PMHistory` row. Manual in-app edits use the prior task title and interval as the workbook match, then update only mapped non-formula task, interval, baseline/current, due, remaining, and status cells on that row.

## Workbook safety and storage

The implementation parses workbook semantics with the existing Linux-compatible `exceljs` dependency and applies writes through targeted OOXML ZIP-part patching. It does not automate Microsoft Excel.

Runtime files default to `backend/data/pm-excel` and may be relocated with `MCC_PM_EXCEL_DIR`. That directory contains:

- `PM_report_latest.xlsx` — the downloadable synchronized workbook
- `sources/` — accepted import source versions used for recovery/retry
- `backups/` — prior known-good synchronized workbooks

For each write, MCC patches only approved cell XML inside a private ZIP copy of the original package. Existing formulas are not replaced. Prepared Helper 1–10 formulas/styles are left untouched; when a genuinely new history row is needed beyond prepared rows, the prior row template and table boundary are extended. All unrelated worksheet and package parts remain byte-for-byte unchanged. MCC then reopens and validates the temporary workbook, moves the prior synchronized workbook to a versioned backup, and renames the validated file into place. If replacement fails after the prior file is moved, MCC restores the backup.

## Cross-platform behavior

PM preview classification, confirm eligibility, confirm-time revalidation, and database writes run through the same backend business logic on Windows and Linux/Raspberry Pi. The frontend displays the backend's `confirmEligibility` result and sends only the preview token plus explicit meter overrides; it does not independently classify safe rows or vary behavior by host OS.

Runtime filesystem locations are composed with Node's `path` APIs from `MCC_DATA_DIR` and `MCC_PM_EXCEL_DIR`. OOXML ZIP entry names use POSIX separators because that is the XLSX package format, not because of the host filesystem. Workbook date calculations use UTC and accepted text dates use explicit formats. Numeric parsing does not use the host locale.

`npm run test:pm-excel-cross-platform` creates the same workbook and MCC database state in isolated environments, then compares additions, updates, history, conflicts, rejected rows, no-change rows, confirm eligibility/payload, confirm-time revalidation, and final writes under contrasting timezone and locale settings. The test runs unchanged on Windows and Linux and must be repeated on Linux staging before release.

## Matching and validation

Tracker rows must resolve to exactly one normalized inherited-or-explicit machine identifier + PM Task + Interval Type row. Imported tasks resolve to exactly one active machine asset and one existing MCC PM task with the same normalized title and interval type. A same-title interval mismatch is reported as a conflict and that row is skipped instead of creating a duplicate schedule. Zero or multiple workbook matches are also skipped so an uncertain row is never written, while unrelated valid rows can still be imported.

The production workbook is a private development reference and is not committed. Automated coverage uses `tests/fixtures/pm-report-sanitized.xlsx`, which mirrors repeated grouped machine blocks, real headers, Hourly/Cycle/Days/Annual 365 rows, repeated work orders, preformatted Helper 1–10 columns, and an unrelated preservation sheet. The private production reference is also exercised locally to verify all 67 tracker tasks are recognized and only the two approved worksheet XML parts change during a targeted synchronization.
