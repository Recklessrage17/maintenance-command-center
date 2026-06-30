# Maintenance Command Center Architecture

## Decision

Maintenance Command Center is the daily-use maintenance system and the current source of truth.

Primary repo:

Recklessrage17/maintenance-command-center

Primary local path:

F:\maintenance-command-center

## Runtime

MCC runs on port `4273`.

Do not change this port without an explicit deployment decision.

## Current MCC Modules

- Dashboard
- Inventory
- Vendors
- Requisitions
- History Logs
- Machine Library
- Equipment Library
- Facility Info
- Preventive Maintenance
- Settings
- Admin / Users

## Retired Tracker Boundary

Maintenance Inventory Tracker 3 is retired/scrapped and no longer part of the daily MCC workflow.

Do not point users to retired tracker workflows. Do not modify retired tracker folders during MCC work.

Protected old local paths:

- `F:\maintenance-inventory-tracker-3`
- `D:\maintenance-inventory-tracker-3`

These paths are listed only as a safety boundary so MCC work does not touch them.
