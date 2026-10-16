# MCC 2.0.0 Pi 400 upgrade — operator review copy

**Current decision: NO-GO for production.** This procedure is prepared, not executed. Owner approval, exact-candidate native ARM64/Debian 13 validation, a complete updater rehearsal, non-root ownership acceptance, production-copy migration rehearsal and spare-device recovery acceptance are required first. No command in this document grants approval to access the Pi or alter a service, configuration, database, backup or mount.

The installed source is `3929a957d4f633d8129997ed1eec818e2e3efbdb` (1.5.18). The candidate SHA and bundle SHA-256 must come from the signed-off readiness report. A later merge/rebase changes the candidate: repeat exact-commit validation before deployment. PR #201/#202 remain open; their green checks do not certify this locally changed 2.0.0 candidate.

## Stop 0 — authorization and staging acceptance

The owner must separately approve the final source, helper changes, evidence, maintenance window, target host and recovery plan. Do not start with the browser Update button. For this initial major migration use the supervised sequence below; keep the deployment updater disabled until its complete installed execution path has passed isolated staging. This document never requires restarting Caddy.

Before approval, in isolated Debian 13 ARM64/Node 22 staging, run both ARM workflows against the exact commit and inspect artifacts, not only badges. Rehearse the whole installed updater with real Git/npm/build/systemd/status writer/ERR handling, successful pre-start fallback, failures at every boundary, failed post-start state with new PM correction/attachment writes, timeout/SIGTERM/power interruption, non-root services, mount loss, reboot and recovery to a spare clean drive. Repeat the absent-directory and independent-snapshot-filesystem cases. Ubuntu ARM container results do not substitute for Debian/Pi acceptance. Test hardlink creation on the actual primary backup filesystem. Measure peak memory, temperature/throttling, concurrent exports/uploads, disk usage and response times at representative data volume.

Obtain a separately authorized stopped-service copy of production for offline migration verification; this task used synthetic data only. Compare original IDs, all original table columns, row relationships, deleted/archive state, equipment, PM corrections/history, inspection metadata and every referenced attachment/workbook hash before and after migration. Review any intentionally generated metadata changes. No production database has been read or copied by this task.

## Prepare the maintenance window

Keep users and automated writers out for the whole window. Stop import jobs, backup schedules and any independent process that can write MCC roots, including shares. A service stop alone does not quiesce external writers. Have console access and a second operator if available. Preserve configuration/credentials privately; never paste them into issue comments.

Reserve at least twice the measured snapshot + install/build + smoke-test duration, **plus the measured clean-storage recovery duration**. Until measured, budget a 2–4 hour attended window and extend it rather than promising a fixed completion time. Large local backup histories and the existing 13 GB HDD copy can dominate I/O. Recovery snapshots are complete copies and can be expensive. No deletion of old backups is a capacity remedy in this procedure.

Compute `S` = source (excluding dependencies/caches) + all distinct runtime roots + configuration; nested PM roots count once. Reserve space for pre-update S, failed-candidate S, clean recovered source/runtime, retained partial copies, npm/build/temp space and new operational backups. Preserve the existing 13 GB copy **in addition** to this budget. The helper's 64 MiB minimum is an implementation floor, not operational capacity acceptance. Keep at least 20% working free space after the planned worst case or use larger independent recovery media. Stop if capacity or the 200,000-entry snapshot bound is exceeded. Test copy/verification time and interrupt behavior in staging.

## Read-only host preflight, after separate access approval

All values below must be observed on the actual host and retained in private evidence. Do not infer them from the sample manifest.

```bash
# Only the separately authorized operator opens an attended root console first:
sudo -i
set -Eeuo pipefail
APP=/opt/maintenance-command-center
RC_SHA=REPLACE_WITH_REVIEWED_40_CHARACTER_SHA
[[ "$RC_SHA" =~ ^[0-9a-f]{40}$ ]]
test "$(git -c safe.directory="$APP" -C "$APP" rev-parse HEAD)" = 3929a957d4f633d8129997ed1eec818e2e3efbdb
test -z "$(git -c safe.directory="$APP" -C "$APP" status --porcelain=v1 --untracked-files=normal)"
git -c safe.directory="$APP" -C "$APP" remote -v
uname -m
cat /etc/os-release
node -p 'JSON.stringify({node:process.version,arch:process.arch,sqlite:process.versions.sqlite})'
systemctl show mcc.service -p User -p Group -p WorkingDirectory -p MainPID -p KillMode -p Restart -p FragmentPath -p DropInPaths -p EnvironmentFiles
systemctl is-active mcc.service
systemctl is-active caddy.service
findmnt --json --target "$APP" --output TARGET,UUID,FSTYPE,OPTIONS
findmnt --json --target /srv/mcc --output TARGET,UUID,FSTYPE,OPTIONS
mountpoint -q /srv/mcc
df -B1 "$APP" /srv/mcc
df -i "$APP" /srv/mcc
```

Require Debian 13, `aarch64`/Node `arm64`, native Node 22 with `node:sqlite`, and `/srv/mcc` itself mounted ext4 read/write with its reviewed UUID. Its UUID and mount target must differ from the application filesystem. A path existing at `/srv/mcc` without the HDD mounted is a STOP. Do not mount/reformat/change fstab as an improvised repair. Confirm mount persistence and ordering in staging; review the service's mount dependencies and failure behavior.

Inspect the unit, every drop-in and EnvironmentFile privately. Confirm the actual Node PID and all children/writers; `MainPID` may be npm/a launcher. `/proc/PID/environ` shows initial exported variables and may omit values loaded later by dotenv. The helper requires its resolved effective roots to match; resolve this in staging using explicit approved service environment values. Do not bypass a mismatch. Verify the service account (examples below assume `mcc:mcc`) and its access to every directory; stop and adapt the reviewed runbook if different.

Record actual absolute roots: data, uploads, backups, recovery, entire PM Excel tree including sources/backups, entire PM work-order tree and backend-relative documents/files. Known live data/uploads/backups are under the checkout; **leave them there for this release**. Separately moving storage would expand the migration/recovery scope. Default PM paths are derived from the effective data root; recovery may be under the service HOME. Observe these values, do not assume them. Browser IndexedDB/local inspection records live on users' devices; export/preserve them separately with the same origin before changing access URLs. Server snapshots cannot capture browser-only files.

Confirm `backend/documents` and `backend/files` are absent without creating them. Check every other root independently. For a reviewed absent non-data root, retain its absolute path and add its role to `absentRoots`. Data and its operational `mcc.sqlite` must exist. Never list an existing directory as absent. Never copy missing paths from the sample into a create-directory loop.

Inventory actual OS/service/mount configuration: unit files and drop-ins, EnvironmentFiles, root `.env` and backend `.env` if present, `/etc/fstab` or mount units, Caddy configuration and imported files, Caddy trust/PKI/certificates with required ownership, updater helpers/config/sudoers if installed, Node executable/runtime provenance and share configuration/credentials if used. Enumerate regular files explicitly. Missing optional sample configuration files are omitted after review; missing required files are a STOP. Symlinks/special entries are refused by the helper. Preserve needed external dependencies separately with an independently verified recovery method.

Locate the existing 13 GB HDD backup copy, record its exact path/size/count and **read-only** per-file checksums before any upgrade work. Set `EXISTING_COPY` only to that observed path. It must be outside the new snapshot destination and any retention-managed directory being modified. Stop if paths overlap; arrange a separately approved preserved copy. Do not rename, prune, overwrite, reuse, or run retention against this copy.

```bash
# Private evidence location is a new directory, never the existing backup copy.
# Run only after the HDD UUID/capacity checks and authorization to write evidence.
EXISTING_COPY=/REPLACE_WITH_OBSERVED_EXISTING_COPY
EVIDENCE=/srv/mcc/release-evidence/REPLACE_WITH_UNIQUE_WINDOW_ID
test -d "$EXISTING_COPY"
test ! -e "$EVIDENCE"
sudo install -d -o root -g root -m 0700 "$EVIDENCE"
sudo sh -c 'cd "$1" && find . -type f -print0 | sort -z | xargs -0 -r sha256sum --zero' _ "$EXISTING_COPY" > "$EVIDENCE/existing-copy.before.sha256z"
du -sb "$EXISTING_COPY"
```

The inventory must exclude the evidence directory from any runtime root; otherwise its changing contents will block unchanged-state checks. Record hashes for symlinks/directories with a reviewed method if the existing copy contains them; the command above covers regular file bytes only.

## Prepare trusted source and manifest

Verify the locally produced Git bundle against the report's SHA-256 and `git bundle verify`. Transfer it using the owner's approved method; do not fetch an unreviewed latest main. The bundle includes production ancestry and the candidate without a GitHub push or tag. Stage a clone in a **new development/preparation directory on the Pi**, not the live app. Use the existing non-root build account and explicit isolated temporary roots. Verify `HEAD=$RC_SHA`, a clean tree, all six versions and lockfile root/parent records = 2.0.0. Locked installs require dev dependencies for TypeScript/Vite; an inherited `NODE_ENV=production` must not omit them. Cache locked dependencies and rehearse builds on identical ARM64 first. Do not use Windows `node_modules` on ARM.

The staged clone's synthetic data roots and environment must be distinct from live roots if any application command/test is run there. A build alone does not exercise production migration. Any production-copy rehearsal must use a separate immutable backup/copy and loopback, empty SMTP, updater disabled and no production mount bindings.

Prepare `/etc/mcc-storage.json` using `schemaVersion: 1`, `appDir: /opt/maintenance-command-center`, `snapshotDir: /srv/mcc/deployment-snapshots`, all eight observed `roots`, `absentRoots: ["documents","files"]` plus any independently reviewed absent roles, only actual required `configurationFiles`, and real `{target,uuid,fstype}` entries for each filesystem involved. All role paths must be distinct; nested roots are supported. The manifest itself and present root/backend .env are included automatically. This file is sensitive and must be root-owned 0600 (never group/world writable).

After verifying the HDD mount again, create **only** the new snapshot destination (root:root 0700). Preserve pre-existing installed helpers/configuration before replacing anything. Install the reviewed snapshot helper into a new root-owned private tools directory (for example `/root/mcc-release-tools/$RC_SHA/deployment-safety.mjs`); verify its SHA-256 against the candidate. Use that exact helper for this procedure. It requires only Node 22 built-ins. Do not run the generic updater installer or edit Caddy as a preflight shortcut.

```bash
HELPER=/root/mcc-release-tools/$RC_SHA/deployment-safety.mjs
MANIFEST=/etc/mcc-storage.json
sudo node "$HELPER" validate-live --manifest "$MANIFEST" \
  --pid "$(systemctl show mcc.service -p MainPID --value)"
```

**Stop 1:** all source/manifest/UUID/path/identity/capacity/ownership/effective-environment checks must pass. Preserve the existing-copy checksum inventory in a second approved location. If a required file/root or independent mount cannot be established, leave MCC running and postpone. Confirm no external writers and an adequate recovery window before the stop.

## Full stopped-service snapshot

Only after maintenance-window approval and writer exclusion:

```bash
sudo systemctl stop mcc.service
test "$(systemctl show mcc.service -p MainPID --value)" = 0
test "$(systemctl show mcc.service -p ActiveState --value)" = inactive
# Inspect the cgroup/process list and all external writers as well.
sudo node "$HELPER" snapshot --manifest "$MANIFEST" --service mcc.service \
  --phase pre-update > "$EVIDENCE/pre-update-result.json"
SNAPSHOT=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1])).directory)' "$EVIDENCE/pre-update-result.json")
sudo node "$HELPER" verify --snapshot "$SNAPSHOT" > "$EVIDENCE/pre-update-verified.json"
sudo sha256sum "$SNAPSHOT/manifest.json" > "$EVIDENCE/pre-update-manifest.sha256"
```

The helper copies and verifies source, all present runtime roots, configuration and database/WAL/SHM bytes, checks independent-copy SQLite integrity/foreign keys and rechecks source/runtime/config hashes and mounts. Explicit absent roots remain absent. Snapshot payload permissions follow source mode; the containing directory is private. Dependencies/caches are excluded. The helper does **not** fsync a transaction to redundant media, preserve ACLs/xattrs/timestamps or restore non-root ownership. Logical checksum success does not prove survival of power failure or a bad drive.

Copy the completed full snapshot and its checksum inventory to a **second independently verified recovery medium** or approved off-device target without touching the 13 GB copy, and verify all copied payloads with the helper there. Securely retain OS/runtime/tooling configuration and source bundle too. Test recovery with original source media disconnected on staging. Do not assume an application Master ZIP includes OS/Caddy/mount/helper configuration. A single HDD snapshot does not protect against loss of that HDD.

**Stop 2:** refuse deployment unless full snapshot verification, independent recovery copy, unchanged-state check, existing-copy invariance and tested recoverability all pass. If snapshot fails, retain `.partial` evidence, resolve capacity/mount/links/writers in staging, and leave current data untouched. Before any candidate start, restarting the original source is allowed only after original dependencies/build/configuration, original data identity and compatibility have been verified; this is an explicit operator decision, not an automatic action in this document.

## Supervised source install and first migration

The candidate bundle must already be verified and contain the exact SHA. The production source and branch must still match preflight. The following mutates production only after Stop 2 and separate approval. Do not use `git clean`, hard reset, recursive app replacement, `rsync --delete`, or extraction over runtime data.

```bash
# Import objects only from the already verified local bundle, then prove ancestry.
# MCC_BUNDLE names that exact approved transferred file.
sudo -u mcc git -c safe.directory="$APP" -C "$APP" fetch "$MCC_BUNDLE" refs/heads/codex/mcc-2-0-0-rc
test "$(git -c safe.directory="$APP" -C "$APP" rev-parse FETCH_HEAD)" = "$RC_SHA"
git -c safe.directory="$APP" -C "$APP" merge-base --is-ancestor 3929a957d4f633d8129997ed1eec818e2e3efbdb "$RC_SHA"
sudo -u mcc git -c safe.directory="$APP" -C "$APP" merge --ff-only "$RC_SHA"
test "$(git -c safe.directory="$APP" -C "$APP" rev-parse HEAD)" = "$RC_SHA"
sudo -u mcc env NODE_ENV=production npm ci --include=dev --prefix "$APP/frontend" --no-audit --no-fund
sudo -u mcc env NODE_ENV=production npm ci --include=dev --prefix "$APP/backend" --no-audit --no-fund
sudo -u mcc env NODE_ENV=production npm run build --prefix "$APP"
sudo node "$HELPER" unchanged --manifest "$MANIFEST" --snapshot "$SNAPSHOT" --service mcc.service
sudo node "$HELPER" compatible --manifest "$MANIFEST" --target-app "$APP" --service mcc.service
```

If app ownership prevents a non-root Git/npm/build operation, STOP. Do not recursively chown the app/runtime or run package scripts as root to get past it. Approve and rehearse a targeted ownership plan. New dependencies/compiled files must be readable by the service account. App source `.env` and path settings must still match the reviewed configuration. Mounts must still match. Root-installed updater/helper bytes are a separate installation; a Git fast-forward does not replace them.

Record a durable marker that a candidate start is now being attempted. **From this point onward assume database migration or operational writes occurred, even when systemd start or HTTP health fails.** The PM exception column defaults to false; lifecycle migration transaction adds active/out_of_service/archived fields and revision 0 without replacing machine IDs. No manual renumbering, schema stripping, archive deletion, or old-code restart is permitted.

```bash
printf '%s\n' "$RC_SHA $(date -u +%FT%TZ)" | sudo tee "$EVIDENCE/candidate-start-attempted" >/dev/null
sudo systemctl start mcc.service
curl --fail --silent --show-error --max-time 5 http://127.0.0.1:4273/api/health
sudo node "$HELPER" validate-live --manifest "$MANIFEST" \
  --pid "$(systemctl show mcc.service -p MainPID --value)"
```

**Stop 3:** keep users excluded until the authenticated build/version, complete ID/row/hash reconciliation, original file access and all smoke tests pass. `/` returning HTML is not proof of migrations, authorization, or data correctness. API health alone is not acceptance. If a formerly absent root is legitimately created, review and update `absentRoots` for later snapshots without altering the earlier snapshot/manifest. A mismatch is a hold point, never a reason to hide state.

## Post-upgrade smoke tests and release to users

Check the running service and journal, expected process account, mounts, unchanged Caddy status and HTTPS/LAN access using the existing trusted origin. In authenticated Settings confirm 2.0.0 **and the candidate commit**, roles and updater-disabled state. Compare original Machine/Equipment IDs, deleted records, active/archive counts, replacement links, PM task/history/correction counts and attachment hashes against the staged production baseline. A pre-lifecycle production database should have no lifecycle archives; do not invent a count or treat old deleted rows as new archived rows.

Open original inspection records, work-order PDFs, photographs and documents with authorized users and verify bytes. Check denied access with a lower role; confirm PM/dashboard exclude archived machines. Verify PM due dates/meters, earlier correction text and original workbook links. Generate a small Machine-history ZIP and Machine/Equipment selected-history PDFs and check hashes/manifest coverage. History ZIPs explicitly exclude browser-only and unverified legacy/free-text relationships; a successful ZIP is not universal completeness. Test representative production volumes in staging first.

Any PM completion/correction or archive/restore smoke operation creates real work: use a separately approved designated test record or perform writes only in the isolated production-copy rehearsal. If production writes are approved, record their IDs and retain them on failure. Do not create fictitious maintenance history silently. Create a new Master backup only after storage capacity, hardlink support, quotas and preservation of the existing external copy are confirmed; verify package checksums, download hash and import/restore **in separate clean staging storage**. Never restore over production for a smoke test. A 13 GB file exceeds current bounded portable-import limits (maximum configurable compressed size 3584 MiB); if the existing copy contains such a file, preserve it and use supervised full-snapshot recovery, without raising parser limits casually.

Recompute the regular-file checksum inventory of `EXISTING_COPY` and compare byte-for-byte with `existing-copy.before.sha256z`. Review row/hash differences and logs with the owner. Stop on any unexplained difference. Observe resource use and disk growth for the agreed acceptance period. Obtain explicit acceptance before reopening writes; retain both pre-upgrade and post-upgrade evidence and full recovery sets. Updater reenablement, release publication/tagging and PR merges each need their own approval and successful remaining gates.

## Failure handling and recovery

**Before candidate start:** do not overlay any database. Preserve logs and partial snapshots. If source/dependencies changed, keep MCC stopped while diagnosing. A return to 3929a957 is allowed only when all runtime and configuration match the pre-update snapshot, no candidate start was attempted, the old build is re-created from its locks and separately verified against untouched pre-upgrade state. Full updater successful-fallback orchestration is unverified; do not assume it works.

**After any candidate start attempt:** stop MCC (owner-authorized recovery action), verify PID 0 and all writers stopped. Retain current code/data/configuration and attempts/logs. Try a new `failed-candidate` snapshot with the reviewed current manifest and verify it. If capture fails, leave the original current state intact and MCC stopped; arrange verified additional media and preserve it before doing anything else. Never delete the pre-update set, later writes or the 13 GB copy to make space. Prefer later failed-candidate recovery points that retain PM completions/corrections and attachments.

Use only an explicit selected snapshot and reviewed lifecycle-aware code, restoring into a new nonexistent destination under reviewed snapshot storage:

```bash
# Operator supplies a verified SELECTED_SNAPSHOT and exact ID from its manifest.
# RECOVERY_SOURCE is immutable reviewed 2.0.0 code, never historical 3929a957.
sudo node "$HELPER" verify --snapshot "$SELECTED_SNAPSHOT"
sudo node "$HELPER" recover --manifest "$MANIFEST" --service mcc.service \
  --snapshot "$SELECTED_SNAPSHOT" --destination "$NEW_EMPTY_RECOVERY_PATH" \
  --target-app "$RECOVERY_SOURCE" \
  --decision "RECOVER $SELECTED_SNAPSHOT_ID INTO NEW STORAGE; REVIEW AND ACCEPT THE SNAPSHOT RECOVERY POINT"
```

The exact decision accepts that snapshot's timestamp; work after it is absent. An older pre-upgrade point requires explicit owner acceptance of the specific lost-work interval and reconciliation plan, after preserving later state. The helper does not switch paths, restore service ownership/configuration, install dependencies, or start services. Review `recovery.json`, create new isolated environment files pointing exclusively to recovered roots, install locked dependencies/build, set narrowly scoped non-root ownership/mode according to the preserved inventory, and test under a separate non-root loopback service with SMTP/updater disabled. Do not apply the preserved absolute-path `.env` blindly. Stop if any recovery path resolves to live roots. Verify IDs, archive/replacement graph, later PM history/correction rows, originals and SQLite integrity/foreign keys.

**Stop 4:** only after independent recovery boot/data reconciliation, owner acceptance of the recovery point and separately approved service-path/configuration changes may the operator switch production to the recovered tree. Preserve original and recovered trees and every snapshot. Do not implement a blind recursive copy or automatic old-code restart. If the HDD/source media itself failed, use the independently verified recovery copy and spare-drive procedure rehearsed with original media disconnected. Console recovery of OS/boot/mounts/Node/service/Caddy/PKI is outside the helper; use the privately retained complete installation inventory and rehearsed host rebuild procedure. If those are unavailable, remain NO-GO.

## Full updater limitations to retain in the approval record

Actual route: Admin Settings API queues a verified request → fixed sudo/systemd request unit → root updater runner → installed `/usr/local/sbin/update-mcc` → installed status writer/safety helper. The manual wrapper invokes the same updater. It validates main/remote/cleanliness/ancestry/request, fetches **current origin/main**, validates live paths, stops MCC, captures full snapshot, fast-forwards Git, runs locked installs/build, compares unchanged runtime/configuration, checks compatibility, marks start attempted, starts MCC and checks HTTP `/`, paths and package/commit.

The updater does not install its own new root-owned helper/wrapper/unit/configuration. Installed-source provenance, helper ownership/mode, interpreter PATH, actual non-root account, filesystem access, systemd sandbox/mount ordering, npm hooks and dependency-network availability must be reviewed. Its successful pre-start fallback reinstalls/rebuilds old source and needs npm/cache access. The outer fetch/install/build/status/ERR-trap path, successful fallback, runner timeout/termination/power loss and concurrent external writers are not proved by source-extracted fallback tests. `TimeoutStartSec=20min` may terminate a long full-history snapshot/build without completing recovery. The HTTP check is weak and does not query the authenticated running version or record/file integrity. Post-start failures deliberately hold MCC stopped; this is not automatic service restoration. Snapshot byte verification has no independent media durability guarantee. Maintain these as unresolved gates until direct exact-candidate staging evidence exists.
