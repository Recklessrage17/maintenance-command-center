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

## Future Phase 2D

Phase 2D can add an import/export bridge or deeper native migration behavior after Phase 2C has been tested and approved. Any future bridge must continue to preserve the MIT3 source-of-truth boundary unless that boundary is explicitly changed and tested.
