# Maintenance Command Center Architecture

## Decision

Maintenance Command Center should be built as a brand-new repo first.

Recommended repo:

Recklessrage17/maintenance-command-center

Recommended local paths:

F:\maintenance-command-center = dev/testing/coding copy
D:\maintenance-command-center = future production/live copy
GitHub main = clean update bridge

## Why

MIT3 is already working and should stay protected.

Current MIT3 repo:

Recklessrage17/maintenance-inventory-tracker-3

Current MIT3 local paths:

F:\maintenance-inventory-tracker-3
D:\maintenance-inventory-tracker-3

## Ports

MIT3 stays on port 4173.

MCC should use a different dev port at first, recommended:

4273

## Planned MCC Modules

- Dashboard
- Inventory
- Preventive Maintenance
- Assets
- Work Orders
- Requisitions
- Vendors
- Locations
- Documents / Prints
- Reports
- Settings

## MIT3 Inventory Integration Plan

Phase 1:
Build MCC shell only.

Phase 2:
Mount or migrate MIT3 Inventory into the MCC Inventory tab.

Phase 3:
Add Preventive Maintenance.

Phase 4:
Add Assets / Machines.

Phase 5:
Add Documents / Building Prints.

## MIT3 Features That Must Be Preserved

- SQLite
- Normalized SQLite loading
- app_snapshots fallback
- JSON backup/import/export safety
- CSV import/export
- Excel import/export
- Backend auto JSON/CSV backups
- Requisition behavior
- Vendors and locations
- Part links
- Website mode
- Update system

## Do Not Touch Yet

Do not modify D:\maintenance-inventory-tracker-3 for MCC work.

Do not copy F:\maintenance-inventory-tracker-3 directly to D:\maintenance-inventory-tracker-3.

Do not change MIT3 production until MCC inventory integration is tested and approved.
