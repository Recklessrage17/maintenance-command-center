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
- Client-side sorting for Part Number, Description, Location, Vendor, Qty, Min, and Status.
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

## Future Phase 2E

Phase 2E will switch MCC add/edit/requisition workflows from the MIT3 bridge to the MCC native inventory database after native write behavior is implemented and tested safely.

## Future Phase 2F

Phase 2F will bring Excel/CSV import and export workflows into MCC after native inventory add/edit/requisition workflows are proven.
