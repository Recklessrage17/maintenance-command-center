# MCC Inventory Retirement Note

Maintenance Inventory Tracker 3 is retired and no longer used for daily maintenance work.

MCC is now the current source of truth for:

- Inventory parts
- Vendors
- Requisitions and requisition lines
- History logs
- Inventory import/export/backup tools
- Master backup and restore protection

The old tracker integration notes are historical only. Do not direct users to old tracker workflows, old tracker websites, old tracker imports, or old tracker reference buttons.

## Current Inventory Workflow

Use MCC Inventory for normal work:

- Add and edit parts in MCC.
- Manage vendors in MCC.
- Create requisitions from MCC inventory rows.
- Export and import MCC inventory through the Inventory Tools panel.
- Use MCC Master Backup for system-level protection.

## Inventory Import Templates

The MCC inventory blank import templates include a `Part Info URL` column for supplier or part-reference hyperlinks. The Excel template also notes that users can paste the supplier URL into `Part Info URL`; hidden Excel hyperlinks on Part Number cells can still populate `part_info_url` when supported. CSV imports require the actual URL text in the `Part Info URL` column.

During import, a nonblank `Part Info URL` column wins. If it is blank in an Excel file, MCC can fall back to a hidden hyperlink on the Part Number cell. URL values must be safe `http` or `https` links.

## Retired Compatibility Code

Some backend route names and helper names may still contain old integration terms because they are compatibility surfaces. Leave them in place unless a focused cleanup can prove removal will not break existing MCC data, imports, requisitions, PDFs, backups, or smoke tests.

Those compatibility surfaces must not appear in normal MCC UI. Any future replacement should keep user-facing wording MCC-native.

## Source Of Truth

MCC data lives in `backend/data/mcc.sqlite`.

Do not copy data from retired tracker folders into MCC. Do not modify retired tracker folders during MCC work.
