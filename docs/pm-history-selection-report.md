# PM completion history selection and PDF reporting

Machine and Equipment Library share checkbox selection and reporting in their
Immutable Completion History and asset-level All PM History dialogs. Dashboard
task-history dialogs also reuse the same implementation. Existing completion
forms, original work-order PDF links, Close controls and authorization remain.

Selection uses immutable completion IDs. Select Month adds every loaded authorized
completion matching the stored `YYYY-MM` calendar prefix, including records below
the scroll viewport and separate completions on the same day. These existing
history APIs return the complete history without pagination. Year is part of the
match and no date-to-local-time conversion is used. Clear Selection removes all
chosen IDs. Manual selections can span months. Selection resets when the asset,
library or task changes; stale history responses are ignored.

Download PDF and Print Selected submit the same ID set to:

`POST /api/{machine|equipment}-library/assets/:assetId/preventive-maintenance/history/report.pdf`

```json
{"completionIds":[12,15],"pmTaskId":3}
```

`pmTaskId` is mandatory in the task-dialog client request and omitted for asset
history. The server validates the optional task constraint when present. Every
request requires an authenticated session and the corresponding `machine.view`
or `equipment.view` permission, matching existing history viewing. IDs must be
distinct positive integers. Each completion must match library, asset and optional
task; the joined task must itself belong to that library and asset. Unauthorized,
missing or inconsistent IDs reject the entire request without returning a partial
report. Assets follow existing history-view rules; preserved deleted PM schedules
remain reportable through All PM History.

The report is generated from server records, never client-supplied report text.
It contains MCC/library identity, asset number/name/model/serial, UTC generation
time and count; each completion includes its stable record/task ID, recorded task
title, completion date, performer and stored participants, work-order number or
documented exception, previous/next due dates and meters, completed meter/units,
follow-up status/reason, full notes and original PDF filename/availability. Records
sort by completion date then ID. Notes wrap and continue across numbered Letter
pages, with the continuing completion/task identified. Original PDFs are separate
documents and are never opened for merging, altered or copied into the report.

One-month filenames use the actual selected dates, such as
`MCC_PM_History_Press-7001_October-2026.pdf`. Mixed or unclassified dates use
`MCC_PM_History_Press-7001_Selected-Dates.pdf`. Missing originals do not prevent
reporting; their recorded availability is disclosed. Legacy missing fields are
identified as not recorded rather than inferred.

Generation is read-only: no completion/task/work-order/meter update, export audit
write, new persistent report file, migration or attachment mutation occurs. The
server bounds requests to 8 KiB, 200 distinct completions, 1 MiB of report text,
120 pages, 4 MiB PDF output and two concurrent generations. Text size is checked
before materializing notes; metadata is checked again before PDF generation.
Exceeding a limit returns an explanatory 413, with no truncated report. A third
simultaneous build returns 429. Selection remains available after failures. A month
containing more than 200 records is fully selected; reporting asks the user to choose
a smaller group rather than silently dropping records.

The existing `pdf-lib` engine and portable standard fonts are reused without
dependency or font-package changes. Characters outside standard-font coverage are
shown explicitly as `[U+code point]`, with a report notice; they are not silently
removed. Native multilingual glyph rendering would require a separately reviewed
embedded Unicode-font strategy. This is a known display limitation.

Download uses the browser's PDF download flow. Print Selected opens a window during
the user gesture, then fills a dedicated view with the generated PDF, Print PDF,
Open PDF and Download PDF controls. The print window owns its report URL, allowing
the history modal to close while printing remains available. Browser print-policy
restrictions show instructions to use the PDF viewer or Open PDF and the normal
print dialog. A blocked/closed popup exposes a deliberate Open PDF for printing
link. The interface never claims a completed print job. OS dialogs, native PDF
viewer rendering and physical printer output require owner browser/device QA.

The independently reviewable feature is based on verified main and has no dependency
on pending archive PRs #196/#197. Review the report builder and scoped read-only API,
shared selection/print controls, the two dialog integrations and focused tests as
one independent PR after publication authorization. Keep its future interactive QA
in a separate disposable runtime; do not replace or stop the existing archive QA
instance. No publication, version bump or release/deployment action is part of this
local implementation.
