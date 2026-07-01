# Maintenance Command Center

Maintenance Command Center is the new main dashboard/hub for the maintenance department.

MIT3 / Maintenance Inventory Tracker 3 stays protected and working in its own repo.

## Local Website Shell

MCC is a Vite + React + TypeScript frontend served by a Node/Express + TypeScript backend. The local website runs on port `4273`.

Do not use port `4173`; that port belongs to MIT3.

### Setup

```bash
npm run install:all
```

### Build

```bash
npm run build
```

### Run

```bash
npm start
```

Then open <http://localhost:4273>.

On Windows, use `Start MCC Website.cmd` to start the backend website and open the browser. Use `Stop MCC Website.cmd` to stop only processes listening on port `4273`.

## Backend Endpoints

- `GET /api/health` returns MCC health and port information.
- `GET /api/version` returns basic MCC version information.

## Planned Modules

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

## Safety Rule

Do not break MIT3. Inventory integration comes later after the MCC shell is stable. The current inventory page only displays a protected placeholder message.
