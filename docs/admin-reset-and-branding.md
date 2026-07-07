# Owner Admin Resets and Company Branding

## Owner Admin reset tools

The Settings page includes an Owner Admin Danger Zone. It is hidden from regular Admin, Manager, and Tech roles, and the backend also enforces Owner Admin access on every reset endpoint.

Each reset requires:

- A required reason note.
- The exact typed confirmation shown in the modal.
- A pre-reset MCC Master Backup created and verified before data is removed.
- A reset history/audit record after the reset completes.

If the pre-reset backup fails or cannot be verified, no reset data is removed.

## Reset options

- Inventory data: deletes MCC inventory parts. Optional checkboxes can also reset linked requisitions, clean inventory vendor/location lookup rows, or remove native inventory backup list files. Master backups are never deleted.
- Requisitions data: deletes requisitions and requisition lines, then clears active requisition flags on remaining inventory parts.
- Section history logs: deletes only the selected `history_logs` section.
- Machine Library, Equipment Library, Facility Info, and Preventive Maintenance: deletes only allowlisted tables that exist. If a section has no data table yet, MCC reports that safely.

There is no one-click reset-all action in this patch.

## Company branding

Company Branding in Settings controls the command launcher mark.

- Company Name is required and limited to 20 characters.
- Accent Text is optional and limited to 8 characters.
- Subtitle is optional and limited to 40 characters.
- Logo Mode can be Text Logo or Uploaded Logo/Icon.
- Icon Animation can be None, Soft Glow, Slow Rotate, or Pulse.

Uploaded logos accept PNG, JPG, WEBP, and GIF files up to 1 MB. SVG is intentionally not accepted in this patch. Uploaded branding files are served from the branding uploads folder through a safe public URL and full filesystem paths are not returned to the UI.

Default branding remains MCC with the Maintenance Command Center subtitle. If branding fails to load, the launcher falls back to that default.

## Files that should not be committed

Do not commit environment files, databases, write-ahead log files, backups, or uploads. In particular, keep these out of Git:

- `.env`
- `backend/data/*.sqlite`
- `backend/data/*.sqlite-wal`
- `backend/data/*.sqlite-shm`
- `backend/data/*.db`
- `backend/backups/`
- `backend/uploads/`

## Restore reminder

Use Settings > MCC Master Backup to verify and restore a master backup. MCC creates a pre-restore backup before applying a restore. After restore, refresh MCC and log in again if the restored session is no longer active.
