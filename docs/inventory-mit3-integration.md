# MCC Inventory / MIT3 Integration

## Phase 2A: read-only

Phase 2A gave Maintenance Command Center a native Inventory tab while MIT3 remained the source of truth.

MCC reads inventory data from the existing MIT3 website HTTP API at `http://localhost:4173`. The MCC backend normalizes MIT3 app-data into inventory rows for the MCC frontend.

Read-only safeguards remain in place:

- No MIT3 database files are copied.
- No MCC code directly reads or writes the MIT3 SQLite database.
- No MIT3 source files are modified.
- The Inventory page keeps an "Open MIT3 Inventory" button for direct MIT3 access.

## Phase 2B: write bridge v1

Phase 2B adds guarded MCC add, edit, and requisition actions that write through the existing MIT3 HTTP API only.

MCC endpoints:

- `GET /api/inventory/mit3-status`: checks whether MIT3 is reachable.
- `GET /api/inventory/mit3-parts`: fetches MIT3 app-data and returns normalized inventory rows.
- `POST /api/inventory/mit3-parts`: validates a basic part form and sends the updated app-data payload to MIT3.
- `PATCH /api/inventory/mit3-parts/:id`: validates edits and sends the updated app-data payload to MIT3.
- `PATCH /api/inventory/mit3-parts/:id/requisition`: updates the MIT3 requisition marker for the selected part when supported.

Phase 2B rules:

- MIT3 remains the source of truth.
- MCC does not directly touch the MIT3 database.
- Writes go through MIT3 HTTP API at `http://localhost:4173`.
- Delete is not included in this phase.
- Import and export remain in MIT3 for now.
- MCC audit logs record add, edit, requisition update, and failed write attempts without storing secrets.

## Phase 2C: production UI polish v1

Phase 2C improves the MCC Inventory focus workspace for production use with larger MIT3 inventories.

Phase 2C adds:

- Full-width Inventory focus mode with a sticky compact toolbar.
- Last-refreshed time and visible "showing X of Y parts" counts.
- Client-side sorting for Part Number, Description, Location, Vendor, Qty, Cost, and Status.
- Client-side page-size controls for 50, 100, 250, or All rows.
- Search across part number, description, location, and vendor.
- Filters for All, Low Stock, Requisition, Has Link, and No Link.
- Smaller table text, smaller status badges, compact link buttons, and controlled description wrapping.
- A compact safety message that MIT3 remains the source of truth and MCC writes only through the MIT3 API.
- Role-aware Inventory controls: Admin, Manager, Maintenance Tech 3, and Maintenance Tech 2 can add, edit, and requisition when MIT3 is online; Maintenance Tech 1 remains view-only.

Phase 2C rules:

- MIT3 remains the source of truth.
- MCC writes only through the MIT3 HTTP API at `http://localhost:4173`.
- MCC does not directly touch the MIT3 database.
- No MIT3 database files are copied.
- No MIT3 source files are modified.
- Import and export remain in MIT3 for now.

## Phase 2D: native MCC inventory database and MIT3 import

Phase 2D starts the move toward MCC-owned inventory while keeping MIT3 protected and untouched.

MCC now owns native inventory tables in `backend/data/mcc.sqlite`:

- `inventory_parts`
- `inventory_vendors`
- `inventory_locations`
- `inventory_audit`

Phase 2D endpoints:

- `GET /api/inventory/native/summary`: returns MCC native inventory counts and the latest MIT3 import time.
- `GET /api/inventory/native/parts`: returns normalized parts from the MCC native inventory database.
- `POST /api/inventory/native/import-from-mit3`: imports MIT3 inventory into MCC through the MIT3 HTTP API.

Phase 2D import rules:

- MCC fetches MIT3 inventory through `http://localhost:4173/api/app-data`.
- MCC does not directly read or write the MIT3 database.
- MCC does not copy MIT3 database files.
- MIT3 source files and MIT3 data remain unmodified.
- Import upserts parts by MIT3 item ID first, then by part number as the fallback anti-dupe key.
- Missing vendors and locations are created in MCC native tables.
- `part_info_url` values are kept only when they are `http` or `https`; local, file, mail, blob, and data links are skipped.
- Admin, Manager, and Maintenance Tech 3 users can run the import.
- Maintenance Tech 2 and Maintenance Tech 1 users can view native inventory but cannot run the import.
- Import activity is recorded in MCC inventory audit and MCC audit logs.

Inventory Focus Mode now has two explicit source modes:

- `MCC Native Inventory`: reads from MCC native inventory tables and is the future daily viewing source.
- `MIT3 Bridge`: keeps the existing MIT3-backed view and guarded MIT3 HTTP write bridge.

Default behavior:

- If MCC native inventory has parts, Inventory Focus Mode opens on `MCC Native Inventory`.
- If MCC native inventory is empty, the page shows a setup/import card: "Native MCC inventory is empty. Import from MIT3 to begin migration."
- The "Open MIT3 Inventory" button remains available for safety and reference.

For Phase 2D, MCC native inventory is read-only after import. The existing MIT3 write bridge remains in place and should not be removed yet.

## Phase 2E: native MCC inventory add/edit/requisition

Phase 2E switches daily inventory write workflows to the MCC native database.

MCC native inventory is now the daily-use inventory system after import. Add, edit, and requisition actions write to `backend/data/mcc.sqlite` through MCC native inventory endpoints:

- `POST /api/inventory/native/parts`: creates a native MCC inventory part.
- `PATCH /api/inventory/native/parts/:id`: updates a native MCC inventory part.
- `PATCH /api/inventory/native/parts/:id/requisition`: updates native MCC requisition status.

Phase 2E rules:

- MIT3 is backup/reference after import, not the daily write source.
- MCC does not directly read or write the MIT3 database.
- MCC does not copy MIT3 database files.
- MIT3 source files and MIT3 data remain unmodified.
- The MIT3 import remains available for migration and reference.
- The "Open MIT3 Inventory" reference link remains available inside Inventory Tools for migration/reference use.
- Add/edit/requisition permissions are Admin, Manager, Maintenance Tech 3, and Maintenance Tech 2.
- Maintenance Tech 1 remains view-only.
- Missing native MCC vendors and locations are created when a part is added or edited.
- Part Info URL values must be blank or safe `http` / `https` URLs. Local, file, mail, blob, and data URLs are rejected.
- Hard delete is not included in this phase.
- Native inventory audit entries record part create, part edit, requisition change, failed native writes, and vendor/location auto-create events.

Inventory Focus Mode now defaults to and remains on `MCC Native Inventory`. MIT3 appears only as:

- `Import from MIT3`
- `Open MIT3 Inventory`
- MIT3 status/reference information

If native inventory has parts, MCC shows native parts and does not require MIT3 to be running. If native inventory is empty, MCC shows the MIT3 import setup card.

The old MIT3 write bridge routes remain present for reference compatibility, but the MCC frontend no longer uses them for daily add/edit/requisition workflows.

## Phase 2F: native MCC requisition workflow

Phase 2F adds the native MCC requisition workflow. Requisitions now live in the MCC database at `backend/data/mcc.sqlite` instead of MIT3.

MCC native inventory remains the daily-use inventory system. MIT3 remains backup/reference only through the MIT3 import bridge, MIT3 status card, and "Open MIT3 Inventory" reference button.

MCC now owns the native requisition header and line tables:

- `inventory_requisitions`
- `inventory_requisition_lines`

Phase 2F requisition endpoints:

- `GET /api/requisitions`: returns active native MCC requisitions by default and supports status filters.
- `GET /api/requisitions/:id`: returns one native MCC requisition.
- `GET /api/requisitions/:id/pdf`: generates a clean printable PDF from the MCC native requisition record. Add `?preview=true` for inline PDF preview.
- `GET /api/requisitions/summary`: returns requested, ordered, received, canceled, and active counts.
- `POST /api/requisitions`: creates requisitions from one native MCC inventory part or from an `items` array of selected native MCC inventory parts, grouped by vendor, and returns the created requisition list with PDF URLs.
- `PATCH /api/requisitions/:id/status`: marks a native MCC requisition Ordered, Received, or Canceled.
- `PATCH /api/requisitions/:id`: updates requested quantity, WO#, and notes while the requisition is still Requested.
- `DELETE /api/requisitions/:id`: soft deletes a requisition for Admin and Manager users.

Phase 2F requisition rules:

- Requisition numbers are generated in readable yearly sequence, such as `REQ-2026-000001`.
- Creating a requisition from selected inventory rows groups the selection by vendor. The same vendor stays on one requisition, different vendors create separate requisitions, and blank vendors are grouped separately as `Unknown Vendor`.
- Each line snapshots the native part number, description, vendor, location, unit cost, item number, unit of measure, requested quantity, and line notes into MCC.
- Older single-part requisitions that predate line records remain readable; MCC synthesizes one line from the legacy header fields when no line rows exist.
- Creating a requisition marks each selected native inventory part as requested.
- Requested and Ordered requisitions are active.
- Received and Canceled requisitions are closed.
- When no active requisitions remain for a part, MCC clears that native part's requisition status. This check is line-aware for multi-line requisitions.
- If an active requisition already exists for a part, MCC warns before allowing another active requisition.
- Canceling a requisition requires a reason.
- Requisition PDFs are generated from MCC native requisition records, not MIT3 records, and use professional filenames such as `MCC_Requisition_REQ-2026-000001.pdf`.
- MCC ports MIT3's official requisition workbook-template behavior for parity. The backend fills the copied `backend/templates/requisition-under-100.xlsx` or `backend/templates/requisition-over-100.xlsx` template, then converts the workbook to PDF with Microsoft Excel or LibreOffice when available.
- Each generated PDF is vendor-specific and never uses `Multiple Vendors` as the vendor name.
- Requisition PDFs fill Unit Price and Total Price from the requisition unit-cost snapshot. Older requisitions without a cost snapshot fall back to the current native inventory part cost; missing or invalid costs print as `$0.00`.
- Requisition PDFs are generated from the requisition header plus all line items. The table rows show quantity, unit, item/part number, description, due date when available, unit price, and total price.
- PDF row prices use `quantity_requested * unit_cost`, and the orange total box shows the grand total across all lines.
- Requisition PDF values are written into the official template cells with shrink-to-fit currency formatting so price, total, and description text do not cross table lines. Long item descriptions wrap to two lines and truncate with `...` when needed.
- Delete is soft delete only: MCC sets deleted metadata and hides the requisition from the active list without physically removing the database record.
- Admin, Manager, Maintenance Tech 3, and Maintenance Tech 2 can create and update requisitions.
- Admin and Manager can soft delete requisitions.
- Maintenance Tech 1 remains view-only.

The Requisitions page provides MCC-native summary cards, filters, multi-line search, PDF preview, PDF downloads, status actions, and Admin/Manager soft delete. The Inventory page creates native requisitions from one or more selected part rows, opens a PDF preview automatically after create, shows Cost instead of daily Link buttons, hides the Min column from the daily table, keeps requisition tracking out of the Status column, and refreshes MCC native inventory after each create.

The current PDF generator uses the copied MIT3/JBT workbook templates in `backend/templates`; MIT3 remains archive/reference only and is not read at PDF generation time.

Audit entries are recorded for requisition create, requisition create from selection, vendor-grouped requisition create, status changed, ordered, received, canceled, edit, PDF preview generated, PDF generated, soft deleted, failed PDF generation, failed delete, and failed requisition action events. Secrets are not logged.

Future Phase 2G will add or harden native inventory import/export/backup tools.

## Future Phase 2G: native MCC inventory import/export/backup tools

Phase 2G is the native Excel/CSV import, export, and backup tool phase.

MCC native inventory remains the daily-use inventory system. MIT3 remains available as backup/reference through the MIT3 import bridge, MIT3 status card, and "Open MIT3 Inventory" reference button.

Phase 2G endpoints:

- `GET /api/inventory/native/export/csv`: exports current native inventory rows to CSV.
- `GET /api/inventory/native/export/excel-update-template`: exports an Excel workbook using sheet `MCC Inventory Update`.
- `GET /api/inventory/native/export/blank-import-template`: exports a blank Excel workbook using sheet `MCC Inventory Import`.
- `POST /api/inventory/native/import`: imports a CSV or `.xlsx` file into MCC native inventory.
- `POST /api/inventory/native/backups/create`: creates manual JSON and CSV backups.
- `GET /api/inventory/native/backups`: lists native inventory backup files by file name, created time, type, and size.

Template columns:

- Update template: `MCC Item ID`, `Part Number`, `Description`, `Location`, `Vendor`, `Quantity`, `Minimum Quantity`, `Requisition`, `Part Info URL`, `Manufacturer/Brand`, `Unit Cost`, `Supplier Part Number`, `Notes`.
- Blank import template: `Part Number`, `Description`, `Location`, `Vendor`, `Quantity`, `Minimum Quantity`, `Requisition`, `Part Info URL`, `Manufacturer/Brand`, `Unit Cost`, `Supplier Part Number`, `Notes`.

Import rules:

- Imports automatically create JSON and CSV backups before any import rows are applied.
- Backup files are written under `backend/backups` and should not be committed.
- Excel imports support sheets named `MCC Inventory Import` and `MCC Inventory Update`.
- `MCC Item ID` is used first for updates. If it is missing or does not match an active native item, Part Number is used as the fallback anti-dupe key.
- Missing vendors and locations are created in MCC native tables.
- Quantity, Minimum Quantity, and Unit Cost must be numeric; blank numeric fields import as `0`.
- Unit Cost is exported in CSV, Excel templates, JSON backups, and CSV backups.
- Requisition accepts `true/false`, `yes/no`, `y/n`, and `1/0`; existing text values can also be preserved.
- Part Info URL values must be blank or safe `http` / `https` URLs. Local, file, mail, blob, and data URLs are skipped.
- Import responses report `addedCount`, `updatedCount`, `skippedCount`, `vendorCreatedCount`, `locationCreatedCount`, `invalidUrlCount`, and `errors`.

Permissions:

- Admin, Manager, Maintenance Tech 3, and Maintenance Tech 2 can import, export, and create backups.
- Maintenance Tech 1 remains view-only.

Audit entries are recorded for CSV export, Excel update template export, blank template export, native import, backup creation, failed import, and failed backup.

Restore is intentionally reserved for a later hardening pass.

Future native inventory work can add restore, delete/restore archive workflows, and final MIT3 retirement mode after the native import/export/backup workflow has been used safely.

## Inventory tools visibility

Inventory Focus Mode keeps the daily toolbar focused on normal work:

- Back to Command Center
- Inventory title, refresh detail, and row count
- Add Part
- Inventory Tools settings button
- Refresh Inventory

The main daily toolbar no longer shows the noisy native/MIT3 status badges or migration/reference banner, and the daily table no longer includes Link or Min columns. Part Info URL data is still available through add/edit and import/export, while `Open MIT3 Inventory` is kept only inside the Inventory Tools panel under MIT3 reference/migration. Minimum Quantity remains stored in MCC, editable in Add/Edit, exported/imported in templates, and used for low-stock alert logic.

Inventory import/export/backup tools are hidden behind the Inventory Tools settings button instead of always being visible.

The Inventory Tools panel contains:

- Export CSV
- Export Excel Update Template
- Export Blank Import Template
- Import CSV / Excel
- Create Backup
- Refresh Backups
- Backup list
- Import from MIT3
- Open MIT3 Inventory under `MIT3 Reference / Migration`

MIT3 is backup/reference only. It is not shown in the main daily Inventory toolbar, and the main toolbar no longer shows the old MCC Native Inventory, MIT3 Reference Offline, or Native writes active badges.

## Inventory row selection and requisition workflow

- Each writable daily inventory row has compact `Select`, `Edit`, and `Req` actions.
- Selected rows are subtly highlighted, and the selection panel shows the selected count.
- `Select Current Page` and `Clear Selection` are available for fast selection cleanup.
- The daily `Preview Requisition` button opens the native MCC requisition modal when one or more parts are selected.
- The `Req` row action opens the same native requisition modal for a quick single-line requisition.
- The native requisition modal lists the selected parts with requested quantity inputs and optional line notes, plus optional WO# and header notes.
- Created requisitions are stored as one MCC native requisition header per vendor with one or more line records and appear on the Requisitions page.
- After requisitions are created, MCC automatically opens a PDF preview modal. Multi-vendor selections show one preview tab per requisition, and the preview includes Print, Download PDF, and Close actions.
- If a selected part has an active requisition, Inventory shows only a subtle `Active req` note in Actions; the Status column remains reserved for stock status.
