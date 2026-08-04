# PM Excel synchronization

MCC is the authoritative preventive-maintenance record. The Excel workbook is an import source, synchronized report, audit document, and downloadable backup.

## Supported workbook contract

The workbook must be an `.xlsx` file and contain these worksheets:

- `Machine Pm Tracker`
- `PMHistory`

The parser locates the existing header rows by approved header aliases rather than fixed row numbers. It reads only those two worksheets. Other worksheets are not inspected or used for imports, and their worksheet XML and related package parts are restored byte-for-byte after the server-side workbook round trip.

The synchronized tracker supports `Hourly`, `Cycle` / `Cycles`, `Days`, and `Annual`. Hour and cycle rows use monotonically increasing meter readings. Days and Annual use real Excel dates; Annual follows MCC's existing 12-month cadence.

## Controlled workflow

1. An authorized maintenance user selects an `.xlsx` workbook.
2. **Preview Changes** validates both required sheets and reports additions, updates, history additions, conflicts, warnings, and rejected rows. Preview state is held in memory for 30 minutes and does not write PM or audit data.
3. **Confirm Import** requires an explicit preview token and idempotency key. Ambiguous matches block confirmation. Decreasing meters require a replacement/correction/override type and meaningful audit reason.
4. Valid changes are committed to SQLite in one transaction and audited with both the previewing importer and confirming user IDs.
5. Workbook synchronization runs after the database transaction. Failure does not roll back MCC data; the status becomes failed and the UI exposes **Retry Sync**.

PM completion uses the same post-transaction synchronization boundary and a unique completion request ID. Repeated requests return the original completion instead of appending another MCC or `PMHistory` row. Manual in-app edits use the prior task title and interval as the workbook match, then update only the mapped task, interval, baseline/current, remaining, and status cells on that row.

## Workbook safety and storage

The implementation uses the existing Linux-compatible `exceljs` dependency and does not automate Microsoft Excel.

Runtime files default to `backend/data/pm-excel` and may be relocated with `MCC_PM_EXCEL_DIR`. That directory contains:

- `PM_report_latest.xlsx` — the downloadable synchronized workbook
- `sources/` — accepted import source versions used for recovery/retry
- `backups/` — prior known-good synchronized workbooks

For each write, MCC copies the source to a same-directory temporary file, changes only mapped tracker cells and new history cells, saves and reopens the temporary workbook, verifies both required sheets, moves the prior synchronized workbook to a versioned backup, and then renames the validated temporary file into place. If replacement fails after the prior file is moved, MCC restores the backup.

## Matching and current limitations

Tracker rows must resolve to exactly one normalized Asset Number + PM Task + Interval Type row. Imported tasks resolve to exactly one active machine asset and one existing MCC PM task with the same normalized title and interval type. A same-title interval mismatch is reported as a blocking conflict instead of creating a duplicate schedule. Zero or multiple workbook matches fail synchronization instead of changing an uncertain row.

The production workbook was not committed to this repository. Automated coverage uses `tests/fixtures/pm-report-sanitized.xlsx`, which includes the two required sheets plus an unrelated sheet, formulas, styles, merges, validation lists, widths, heights, filters, and print settings. The implementation preserves formulas in mapped cells rather than replacing them with calculated values. As with any server-side `.xlsx` library, unsupported proprietary Excel extension records are outside the validated contract and should be checked against a separately approved sanitized copy of the real workbook before production rollout.
