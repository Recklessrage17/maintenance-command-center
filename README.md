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

Raspberry Pi/LAN production and staging deployments use Caddy as the trusted
HTTPS endpoint while Node remains on loopback. See
[`docs/raspberry-pi-https.md`](docs/raspberry-pi-https.md); direct HTTP is a
development/updater-health path, not the supported browser path on the Pi.

On Windows, use `Start MCC Website.cmd` to start the backend website and open the browser. Use `Stop MCC Website.cmd` to stop only processes listening on port `4273`.

## Backend Endpoints

- `GET /api/health` returns MCC health and port information.
- `GET /api/version` returns MCC version/build metadata to authenticated Admin and Owner Admin users.
- `GET /api/system/update/status`, `POST /api/system/update/check`, and `POST /api/system/update/install` provide the Admin/Owner-only fixed-source updater workflow. See `docs/admin-one-click-updater.md` before enabling it.

## Managed Windows updater

The managed Windows installer keeps `WindowsProduction` permanently restricted to `origin/main`. `WindowsTest` also defaults to `main`, but an elevated Administrator may configure one explicit origin branch during installation with `-TestBranch`. That branch is validated on origin and stored only in the protected `C:\ProgramData\MCC\Updater\config.json`; the browser and API cannot select or change it, and Settings has no branch control.

See [`deploy/windows/README-Windows-Updater.md`](deploy/windows/README-Windows-Updater.md) for installation, validation, rollback, and removal commands.

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
