# MCC Master Backup and Restore

MCC uses `backend/data/mcc.sqlite` as the main source of truth. The master backup system snapshots that SQLite database into timestamped folders under `backend/backups/master`, which is ignored by Git.

## Backup Types

- `startup`: created after the MCC backend starts successfully.
- `scheduled`: created every hour while the backend is running.
- `auto`: created after important MCC write activity, debounced to avoid rapid backup spam.
- `manual`: created from Settings by an allowed user.
- `pre_restore`: created automatically before restoring a backup.

Each master backup folder contains:

- `mcc.sqlite`
- `manifest.json`
- `files/` when `backend/uploads`, `backend/documents`, or `backend/files` exists

The manifest includes app name, backup type, created date, safe user summary for manual/restore actions, app version, database size, included paths, record counts, checksum, and notes.

## Retention

Retention only deletes folders inside `backend/backups/master`.

- Manual: last 30
- Scheduled: last 30
- Auto: last 50
- Startup: last 10
- Pre-restore: last 20

## Restore Safety

Restore is Admin-only and requires typing:

```text
RESTORE MCC
```

Before replacing the live database, MCC creates a `pre_restore` backup of the current database. After restore, users may need to refresh and log in again because sessions come from the restored database.

Backups, live databases, WAL/SHM files, `.env`, and generated backup folders must not be committed.
