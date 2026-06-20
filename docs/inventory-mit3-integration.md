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

## Future Phase 2C

Phase 2C can add import/export and deeper native migration behavior after Phase 2B has been tested and approved.
