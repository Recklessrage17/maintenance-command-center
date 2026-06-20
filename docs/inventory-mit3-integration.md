# MCC Inventory / MIT3 Integration

## Phase 2A: read-only

Phase 2A gives Maintenance Command Center a native Inventory tab while MIT3 remains the source of truth.

MCC reads inventory data from the existing MIT3 website HTTP API at `http://localhost:4173`. The MCC backend normalizes MIT3 app-data into read-only part rows for the MCC frontend.

MCC does not write to MIT3 in this phase:

- No MIT3 database files are copied.
- No MIT3 SQLite database writes happen.
- No MIT3 source files are modified.
- Add, edit, delete, import, and export remain in MIT3.

Current MCC endpoints:

- `GET /api/inventory/mit3-status`: checks whether MIT3 is reachable.
- `GET /api/inventory/mit3-parts`: fetches MIT3 app-data and returns normalized read-only inventory rows.

The Inventory page keeps an "Open MIT3 Inventory" button so users can jump to MIT3 for all write workflows.

## Future Phase 2B

Phase 2B can add native MCC add/edit behavior only after read-only behavior is tested and the migration path is approved.
