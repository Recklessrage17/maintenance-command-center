# Deployment recovery hardening for the 2.0.0 candidate

Version remains 1.5.18 during local engineering. These are reviewable source changes, not authorization to install helpers, contact a Pi, stop services, change mounts, update, publish or recover production. No Pi access occurred in local validation.

## Compatibility and fallback rules

`deployment/compatibility.json` declares that this reviewed source understands lifecycle schema 1 and active/out_of_service/archived states. The root-installed `deployment-safety.mjs` checks a separate copy of the quiescent SQLite database, its integrity and foreign keys, and that declaration before allowing code to operate migrated state. A missing declaration fails closed even if the old build displays the same version. It deliberately blocks undeclared historical builds; version comparison and HTTP success are insufficient.

1. **Before any candidate start:** the updater can restore the previous source only after proving all runtime roots and deployment configuration match the full pre-update snapshot. It never overlays old data. It also checks previous-code lifecycle compatibility before restart. If unchanged state, mount identity or compatibility cannot be proved, MCC remains stopped and requires operator recovery.
2. **After any candidate start attempt:** the application may have migrated data or accepted retirement, PM or attachment writes even if HTTP health failed. Automatic rollback is disabled. The updater stops MCC, attempts a complete failed-candidate snapshot, records failure and leaves current data/source intact. If snapshotting fails, the stopped original state remains intact; the journal records that failure. Do not delete either the pre-update or failed-candidate state.
3. **Operator recovery:** choose a verified snapshot and reviewed lifecycle-aware source, then recover into a new empty storage tree. Explicitly accept the recorded recovery point. Starting pre-lifecycle code against migrated data is rejected. The helper never changes original destinations, restarts services or switches production configuration. Review ownership and environment mappings before a separately approved start.
4. **Pre-upgrade snapshots after new writes:** they omit all work after their timestamp. An operator must preserve the failed-candidate state and explicitly accept that data-loss window. The helper requires the exact snapshot-ID recovery decision even when no writes are believed to have occurred; it does not infer approval from health or elapsed time. Prefer recovering the failed-candidate snapshot with lifecycle-aware code so later work is retained.

Old releases launched directly outside the controlled tools cannot be retroactively prevented from ignoring lifecycle. Restrict operator procedures to the reviewed guard/recovery path. Do not replace it with `git checkout`, a direct old Node start, a blind tar extraction, clearing lifecycle columns, or changing `deleted` flags.

## Complete storage inventory

Before enabling the updater, inspect effective systemd/MCC paths on a separately authorized host. Create a root-owned, non-group/world-writable `/etc/mcc-storage.json`, using [the example](../deployment/raspberry-pi/mcc-storage.example.json) only as a schema illustration. Replace every example path, UUID and filesystem type using observed values. Files/directories must already exist. Do not create directories on an unmounted fallback filesystem simply to make validation pass.

The inventory requires **data, uploads, documents, files, PM work orders, the entire PM Excel directory, recovery and all existing backup history**. `documents` and `files` must match the actual backend-relative locations. PM Excel `sources/` and `backups/`, imported recovery ZIPs/packages, original work orders, nested uploads/library documents and sidecars are included. Nested runtime roots are stored as separate units without double-copying their bytes. Source, package locks and local root/backend `.env` are also preserved. Dependencies and `.npm`/`.cache` directories are excluded from the source unit and must be reinstalled from locks.

`configurationFiles` must enumerate actual systemd units/drop-ins/EnvironmentFiles, updater config/helpers/sudoers, network and Caddy configuration, mount configuration (`/etc/fstab` or actual mount units), external-share authentication and private PKI files required for this installation. Enumerate files inside any required configuration directory explicitly, including Caddy trust/keys; no helper can infer an unlisted host dependency. Root/backend `.env` are included automatically when present. The example is intentionally incomplete until site discovery/review. Protect snapshot permissions and off-device copies because they contain credentials and private data. Updater status/request history remains at its existing location; preserve a separate copy during operator investigation before any later job.

All runtime roots and configuration files are checked against actual Linux `findmnt` **target + UUID + filesystem**. The running service PID's effective environment and working directory must match before stopping. The snapshot destination is root-owned, private, and separate from every application/runtime root, and is mount-checked before and after copying. A missing SSD that exposes its mount-point directory on the OS filesystem is rejected. Distinct UUIDs/mounts must be supplied for OS source/configuration versus SSD runtime where applicable. Links/special files and aliased storage roles fail closed. A linked/junction storage tree is not silently followed; use real verified paths.

Linux mount discovery, root ownership, actual systemd PID/environment handling, reboot persistence and hardware resource behavior require isolated ARM staging. Windows functional tests inject explicitly labeled synthetic mount observations into module functions; the Linux CLI has no mount-bypass flag and refuses Windows/non-root execution.

## Installing reviewed tooling — separate approval required

Only after release review and explicit staging installation approval, provision the manifest and install the approved helper as `/usr/local/lib/mcc-update/deployment-safety.mjs`, root-owned and not writable by MCC, alongside the approved `update-mcc`, status writer and wrapper. Set `MCC_STORAGE_MANIFEST=/etc/mcc-storage.json` in root-owned `/etc/mcc-update.conf`. Do not point it at an example containing placeholder UUIDs. Preserve previously installed tooling/configuration before replacing it. This task did not execute installation commands.

The updater now refuses to proceed without this configuration. Existing installations must complete discovery and preparation before reenabling one-click updates. A source pull by itself does not update root-installed helpers; the staged installation and installed-helper provenance are release gates.

## Snapshot and recovery commands — not executed on a Pi

The service must already be stopped by a separately approved maintenance procedure for snapshot/recovery commands. Validation itself does not stop it. These examples show operator actions after explicit host-specific authorization:

```bash
# Read/verify effective paths against an already reviewed manifest.
sudo node /usr/local/lib/mcc-update/deployment-safety.mjs validate-live \
  --manifest /etc/mcc-storage.json --pid CONFIRMED_MCC_MAINPID

# Full source + all runtime + configuration snapshot, while MCC is stopped.
sudo create-deployment-rollback --storage-manifest /etc/mcc-storage.json

# Verify all original file hashes/trees, config checksums and SQLite consistency.
sudo node /usr/local/lib/mcc-update/deployment-safety.mjs verify \
  --snapshot /MOUNT/deployment-snapshots/SELECTED_SNAPSHOT

# Only a new empty directory on the reviewed snapshot filesystem is accepted.
# The exact decision string includes the ID from the verified manifest.
sudo node /usr/local/lib/mcc-update/deployment-safety.mjs recover \
  --manifest /etc/mcc-storage.json --service mcc.service \
  --snapshot /MOUNT/deployment-snapshots/SELECTED_SNAPSHOT \
  --destination /MOUNT/deployment-snapshots/NEW_RECOVERY_DIRECTORY \
  --target-app /PATH/TO/REVIEWED_LIFECYCLE_AWARE_SOURCE \
  --decision 'RECOVER EXACT_SNAPSHOT_ID INTO NEW STORAGE; REVIEW AND ACCEPT THE SNAPSHOT RECOVERY POINT'
```

Recovery emits `recovery.json` with the selected timestamp, decision, new application and all new root mappings. It preserves configuration files under `preserved-configuration/` without applying old absolute paths. Install locked dependencies into the new application and set MCC_DATA_DIR, MCC_UPLOADS_DIR, MCC_BACKUPS_DIR, MCC_RECOVERY_DIR, MCC_PM_EXCEL_DIR and MCC_PM_WORK_ORDER_DIR to the emitted paths. `documents/files` are placed under the new backend where current code expects them. Fix ownership for the approved service account and repeat all hash/DB/lifecycle/PM/inspection/file tests before a separately authorized configuration switch or start. The helper does not make that switch.

The old tar format remains only behind explicit `--legacy-checkout-only`, with a warning that it lacks external/mount/lifecycle guarantees. `--verify-only` can inspect an old archive. It is not a supported release rollback method. New complete snapshots are private directories with manifests, not tar files to extract over production.

## Capacity and retained evidence

Let **S** be the distinct source + complete runtime + configuration snapshot bytes, excluding reinstallable source dependencies/caches, **D/W** the SQLite main/WAL/SHM bytes, **B/Z** a Master package/ZIP, and **H/M** history file/metadata bytes. Creating a deployment snapshot adds roughly **S + D/W temporary validation + metadata + 64 MiB margin**. Verifying uses another temporary D/W copy so SQLite cannot modify snapshot sidecars. Recovery into new storage adds another source/runtime set plus D/W validation space. Keeping pre-update and failed-candidate snapshots costs both S sets; there is no automatic pruning. Master Backup and pre_restore use their separate B+Z budgets. History export takes about 2(H+M) per job; two jobs can take about 4(H+M), plus guards/manifests. Inspect available bytes and inodes on each actual filesystem; a 2 TB label proves no free space or mount layout.

Full snapshot hashing and copying use bounded buffers, but traverse all retained backup/recovery history. Updater downtime can therefore be long. Measure on separate ARM staging and agree a maintenance window. Partial snapshots are retained as private `.partial` evidence and never replace a valid snapshot; investigate and deliberately remove/offload them only under an approved retention procedure. Inventory is bounded to 200,000 entries per unit. Backup history on the same SSD still needs a verified off-device disaster-recovery copy.

## Pi 400 staging and production checkpoints

No Pi access is authorized yet. First present read-only discovery commands for approval: OS/userspace architecture, exact Node 22 binary, service WorkingDirectory/User/MainPID and filtered storage environment, `findmnt`/UUID/fstab/mount units, `df`/inodes, RAM/swap, thermal/throttle/power and SSD/filesystem health. Never print full environment secrets. Confirm installed helpers and actual configuration files.

Provision a physically separate ARM staging host/SSD/service user, no production mounts, SMTP, Caddy or updater jobs. Use SSD-backed TMPDIR with known free space, never assume `/tmp` is disk rather than tmpfs. Begin with one <=256 MiB history export, <=50 PM completions and no concurrent backup/import; these are proposed administrative limits, not enforced application settings. Measure full RSS/CPU, thermal and normal five-user response before expanding toward two exports or the 200-completion/120-page PDF cap. No Windows timing certifies Pi capacity.

Rehearse synthetic legacy 1.5.18 migration, full snapshots, producer-compatible 16/32 MiB text and mixed files, two exports/cancellation, both upload layouts, complete Master import/restore, a failed candidate after archived-machine/PM/attachment writes, guarded old-code rejection and new-storage recovery of the later state. Reboot only spare staging, test SSD mount persistence/missing-mount refusal, and perform bare-drive recovery with the source media disconnected. An ARM64 VM is useful for Linux semantics but leaves Pi CPU/USB/thermal/power behavior open.

Proposed acceptance: supported OS and patched Node 22; working node:sqlite/crc32; baseline MemAvailable >=1.5 GiB, workload >=768 MiB (stop below 512 MiB or any OOM/sustained swap); prefer <75 C sustained and stop at >=80 C/new throttle/undervoltage; healthy filesystem/inodes, >=20% free capacity plus explicit operation peaks; normal read p95 <=1 s baseline and <=2 s under allowed work, no sustained >5 s or failed writes. These require site approval and hardware measurement. Do not apply them as unmeasured guarantees.

Before production approval: install only reviewed root helpers/config, verify the exact future release SHA and successful integrated CI, freeze writes, capture full paired source/data/config and off-device recovery, validate mappings/mounts, then follow the approved upgrade window. After start, verify lifecycle/PM exclusion, original file hashes, users/roles, PDF/ZIP/backup recovery and resource readings before reopening access. Publication, version bump, deployment and Pi access remain separate approvals.
