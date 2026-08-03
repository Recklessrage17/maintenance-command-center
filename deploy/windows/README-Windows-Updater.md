# Maintenance Command Center Windows 11 Updater

This package installs a narrow privilege boundary for the existing Admin/Owner Admin Settings update card. A browser never submits a command, repository, remote, branch, service/task name, path, npm argument, version, or commit. The only WindowsTest branch override is an elevated installer parameter.

## Architecture

```text
Admin / Owner Admin Settings card
  -> authenticated, rate-limited, same-origin/CSRF-protected MCC API
  -> C:\ProgramData\MCC\Updater\request\request.json
  -> MaintenanceCommandCenterUpdater scheduled task (SYSTEM)
  -> protected fixed Update-MccWindows.ps1
  -> MaintenanceCommandCenter scheduled task (LOCAL SERVICE)
  -> sanitized status.json back to the existing Settings card
```

The deployment mode and configured update branch come only from the Administrator-installed `config.json`. Windows itself is not treated as proof of production. A normal Windows development clone remains `UPDATER NOT CONFIGURED`.

The package uses tightly scoped Task Scheduler jobs, which are the supported Windows managed-process equivalent for this release:

- `MaintenanceCommandCenter` starts at boot as `NT AUTHORITY\LOCAL SERVICE`, runs only `backend\dist\server\index.js`, uses port 4273, records its exact PID, and restarts after failure.
- `MaintenanceCommandCenterUpdater` starts at boot as `NT AUTHORITY\SYSTEM`, polls only the fixed request path, publishes a heartbeat, and invokes only the protected fixed update script.

The updater stops the managed task, validates the exact PID recorded by the launcher against the configured Node executable and C: backend command line, requests graceful shutdown through one fixed protected ProgramData signal, and terminates only that verified process tree as a timeout fallback. It waits for port 4273 to be completely released and refuses to kill an unknown owner. It never uses `taskkill /IM node.exe`, never stops unrelated Node.js applications, and never takes commands from HTTP.

Every launcher start publishes a unique launch ID, launcher PID, child PID, application/entry-point/configuration identity, and the fixed `windows_agent`/`production` environment attestation in protected `mcc-process.json`. Update success requires a different launch ID and child PID, both scheduled tasks running, the exact child command line, exclusive ownership of port 4273, the loopback-only managed-readiness API, a fresh healthy updater heartbeat, the configured mode/label/branch, and the requested version/commit. A generic 200 response from `/api/health` is never enough.

## Supported Windows 11 editions

Windows 11 Pro, Enterprise, and Education are supported. Windows 11 Home is not a supported production host because the production operating model assumes centrally administered local security policy, Task Scheduler service identities, and recoverable administrative access.

## Prerequisites

- Elevated Administrator PowerShell for installation, validation, manual update, and uninstall.
- A dedicated Windows clone of `https://github.com/Recklessrage17/maintenance-command-center.git`.
- A WindowsProduction clone must be on `main`. A WindowsTest clone must be on its exact configured test branch, which defaults to `main`.
- The configured branch must exist on `origin`; every target must have a clean tracked and untracked worktree and use `origin`.
- Node.js 22 or newer.
- npm and Git available to the installing Administrator.
- Root, frontend, and backend `package-lock.json` files.
- Port 4273 available for MCC.
- A production/test target outside the protected F: development drive.

`F:\MCC_V1_FINAL` is the protected development/master copy and is always rejected. The installer intentionally rejects every F: target. It does not hard-code Z: as the only allowed deployment drive.

## Installation

The scripts are local checked-in files, so a machine configured with the normal `RemoteSigned` policy does not require an execution-policy override:

```powershell
Set-ExecutionPolicy -Scope LocalMachine RemoteSigned
```

If organizational policy is stricter, sign the scripts with the organization’s trusted code-signing certificate. Do not weaken Group Policy. `ExecutionPolicy Bypass` is not required or recommended.

From an elevated PowerShell in the MCC repository:

```powershell
.\deploy\windows\Install-MccWindowsUpdater.ps1 `
  -MccPath 'C:\MCC\MCC_V1_FINAL' `
  -Mode WindowsProduction
```

Windows Test Mode example:

```powershell
.\deploy\windows\Install-MccWindowsUpdater.ps1 `
  -MccPath 'Z:\MCC_V1_FINAL' `
  -Mode WindowsTest
```

With no `-TestBranch`, WindowsTest remains on `origin/main`. To validate an unmerged feature from an elevated PowerShell, the target clone must already be clean and checked out on that exact origin branch:

```powershell
& 'Z:\MCC_V1_FINAL\deploy\windows\Install-MccWindowsUpdater.ps1' `
  -MccPath 'Z:\MCC_V1_FINAL' `
  -Mode WindowsTest `
  -TestBranch 'feature/windows-11-updater-agent' `
  -Confirm:$false
```

The installer validates the branch name with Git, confirms the exact branch exists on `origin`, and writes it to protected ProgramData configuration. `-TestBranch` is always rejected with `WindowsProduction`, even when its supplied value is `main`.

Windows 11 Production examples:

```powershell
.\deploy\windows\Install-MccWindowsUpdater.ps1 `
  -MccPath 'C:\MCC\MCC_V1_FINAL' `
  -Mode WindowsProduction

.\deploy\windows\Install-MccWindowsUpdater.ps1 `
  -MccPath 'D:\MCC\MCC_V1_FINAL' `
  -Mode WindowsProduction
```

The installer validates before it changes managed-task or ProgramData state. It installs locked frontend/backend dependencies, builds MCC, starts both tasks, checks `http://127.0.0.1:4273/`, confirms a healthy agent heartbeat, and verifies the updater API rejects an unauthenticated request. The checked-in [`config.schema.json`](config.schema.json) documents the protected configuration contract and its permanent WindowsProduction `main` constraint.

If a previous installer attempt left broken ACLs under the known updater tree, rerun from an elevated PowerShell with the scoped repair switch:

```powershell
& 'F:\MCC_V1_FINAL\deploy\windows\Install-MccWindowsUpdater.ps1' `
  -MccPath 'C:\MCC\MCC_V1_FINAL' `
  -Mode WindowsProduction `
  -RepairUpdaterAcl `
  -Confirm:$false
```

`-RepairUpdaterAcl` is restricted to `C:\ProgramData\MCC\Updater`. It preserves existing configuration, requests, status, logs, and backups; restores Administrators/SYSTEM Full Control and child inheritance; and takes ownership of only that updater tree if normal elevated ACL repair cannot proceed. It never repairs the MCC runtime clone or another ProgramData directory.

For the unmerged WindowsTest branch in this workspace, the elevated retry command is:

```powershell
& 'F:\MCC_V1_FINAL\deploy\windows\Install-MccWindowsUpdater.ps1' `
  -MccPath 'Z:\MCC_V1_FINAL' `
  -Mode WindowsTest `
  -TestBranch 'feature/windows-11-updater-agent' `
  -RepairUpdaterAcl `
  -Confirm:$false
```

For the C: Windows test installation used by this branch, run this exact command from an elevated PowerShell after the feature branch has been pushed and the F: development checkout is on the target commit:

```powershell
& 'F:\MCC_V1_FINAL\deploy\windows\Install-MccWindowsUpdater.ps1' `
  -MccPath 'C:\MCC-Windows-Test\MCC_V1_FINAL' `
  -Mode WindowsTest `
  -TestBranch 'feature/windows-11-updater-agent' `
  -RepairUpdaterAcl `
  -Confirm:$false
```

## Deployment labels

- `WindowsTest` displays `WINDOWS TEST MODE`.
- `WindowsProduction` displays `WINDOWS 11 PRODUCTION`.
- Raspberry Pi production continues to display `RASPBERRY PI PRODUCTION`.
- An ordinary Windows clone without this installer displays `UPDATER NOT CONFIGURED`.

The Settings card also supports `MCC IS UP TO DATE` with `No new updates are available.`, `UPDATER AGENT OFFLINE`, `CONFIGURATION INVALID`, `MCC SERVICE NOT RUNNING`, update progress, `UPDATE COMPLETE`, `UPDATE FAILED — PREVIOUS VERSION RESTORED`, and `CRITICAL UPDATE FAILURE — MANUAL RECOVERY REQUIRED`.

## ProgramData layout

```text
C:\ProgramData\MCC\Updater\
  config.json
  updater.lock
  scripts\
  request\request.json
  request\api-status.json
  request\shutdown-request.json
  status\status.json
  status\agent-health.json
  logs\
  web-logs\
  backups\<timestamp>-<old-version>-before-<target-version>\
```

`config.json` contains the single configured branch. Its ACL grants Full Control only to Administrators and SYSTEM and read-only access to LOCAL SERVICE. No Settings or API operation rewrites it.

Backups remain outside the Git worktree. Each contains sanitized job metadata, a configuration snapshot without secrets, runtime data when present, and SHA-256 verification metadata.

## ACL design

Installation has two ordered ACL phases. The bootstrap phase enables inheritance throughout the known updater tree and confirms Administrators and SYSTEM Full Control before the installer appends, copies, or replaces any managed file. Scripts and JSON are validated in same-directory temporary files and atomically replace their destinations. The installer then verifies log append, script/config/status create-and-replace, and installed-script reads. Neither scheduled task is installed before those checks pass.

Only after all managed files and bootstrap checks succeed does the final phase replace the bootstrap ACLs with the protected design:

- `Administrators` and `SYSTEM`: Full Control.
- `LOCAL SERVICE` (MCC):
  - read/execute access to the protected root and configuration values needed to start MCC;
  - modify access only to the fixed request/API-check-state and MCC web-log directories;
  - read-only access to canonical sanitized agent status and heartbeat files;
  - read/execute access to application code;
  - modify access to the explicit runtime data/upload/document/file directories;
  - no write permission to updater scripts, protected configuration, privileged logs, or updater backups.
- Normal `Users` and `Everyone`: no write/modify grant.
- Browser clients: no filesystem access.

Application permissions are applied without a recursive `icacls /T` walk of the clone. The installer grants bounded inheritable read/execute access at the backend, built frontend, and Git metadata roots; applies read-only grants to package manifests and environment files; and grants Modify only at `backend\data`, `backend\uploads`, `backend\documents`, and `backend\files`. It reapplies the same idempotent profile after the build and verifies every required runtime target.

The LOCAL SERVICE launcher also configures one process-scoped Git `safe.directory` entry for the exact Administrator-configured application path before Node starts. It removes inherited command-scope Git configuration entries, uses the normalized forward-slash Windows path, and validates the approved origin and protected branch. The setting is inherited only by the managed Node process and its Git children; the installer never writes global, system, or user Git configuration and never enables wildcard trust.

The status directory contains only the sanitized Issue #60 state model; detailed Administrator output is written separately under `logs`. Run the test script after installation to check for broad write ACLs.

## Update behavior

An Admin check is fixed to the protected configured origin branch: always `origin/main` for WindowsProduction, and the one elevated-installer branch for WindowsTest. Installation requires a fresh server-issued check token and explicit confirmation. The API creates one unpredictable job ID and one fixed request from protected configuration; request fields cannot override that configuration. The agent re-fetches and verifies the configured target before changing code. Duplicate or stale requests are rejected.

The updater:

1. Acquires `updater.lock`.
2. Revalidates configuration, the target, origin, the exact configured branch, cleanliness, versions, commits, and fast-forward ancestry.
3. Records and validates the old managed child, stops only `MaintenanceCommandCenter`, terminates only that exact child/tree if it remains detached, and proves port 4273 is released.
4. creates and verifies an external runtime backup.
5. fast-forwards to the approved commit.
6. runs `npm ci` for frontend and backend.
7. builds frontend and backend.
8. starts only `MaintenanceCommandCenter` through its scheduled task and protected launcher.
9. waits for a distinct launch ID and PID, verifies the exact C: backend command line and exclusive port owner, checks the loopback managed-readiness response (`configured:true`), and refreshes/verifies the updater-agent heartbeat.
10. verifies the requested commit/version, records sanitized success, and retains the backup.

A dirty tracked or untracked worktree blocks the update. Nothing is stashed, reset, cleaned, restored, or discarded.

The Settings client applies one immediate in-flight guard to check and install actions, disables the initiating control before yielding to React, and never retries the install POST. Server-side rate limits, CSRF validation, and the verified check token remain authoritative; a 429 response includes a bounded retry delay for the UI.

After login, an authorized user may see one non-blocking smoke-glass notice only for `update_available` or `same_version_different_commit`. Dismissal is stored per user plus target version/commit, so route navigation does not repeat it and a newer build appears normally. **View update** opens and focuses the Settings updater. Unauthorized users, healthy up-to-date systems, offline/not-configured agents, and active installations never show the notice. A successful installed version/build may produce one similarly keyed success notice.

## Manual update fallback

The manual fallback still derives the target from a fresh fetch of the protected configured branch; it accepts no branch, commit, or version:

```powershell
& 'C:\ProgramData\MCC\Updater\scripts\Update-MccWindows.ps1' `
  -ConfigurationPath 'C:\ProgramData\MCC\Updater\config.json' `
  -Manual
```

This is an elevated Administrator operation. It uses the same lock, validation, backup, build, health, status, and rollback path as the agent.

## Check status and logs

```powershell
Get-ScheduledTask -TaskName MaintenanceCommandCenter,MaintenanceCommandCenterUpdater |
  Select-Object TaskName,State

Get-Content 'C:\ProgramData\MCC\Updater\status\status.json' -Raw
Get-Content 'C:\ProgramData\MCC\Updater\status\agent-health.json' -Raw

& 'C:\ProgramData\MCC\Updater\scripts\Test-MccWindowsUpdater.ps1'
```

Administrator logs:

- `C:\ProgramData\MCC\Updater\logs\install.log`
- `C:\ProgramData\MCC\Updater\logs\agent.log`
- `C:\ProgramData\MCC\Updater\logs\update-*.log`
- `C:\ProgramData\MCC\Updater\web-logs\mcc-launcher-*.log`
- `C:\ProgramData\MCC\Updater\web-logs\mcc-*.log`

`install.log`, `agent.log`, and each `update-*.log` explicitly identify `WINDOWS TEST MODE` and `origin/<configured-test-branch>` for test deployments. Production logs identify `WINDOWS 11 PRODUCTION` and `origin/main`.

Normal History UI records only sanitized update/audit fields and never raw PowerShell output, credentials, environment-file contents, or secrets.

## Rollback and recovery

After installed code changes, any dependency, build, managed-handoff, task, process identity, port owner, updater readiness, heartbeat, commit, or version failure records `rolling_back`, stops only the verified managed child, restores the previous commit and verified runtime backup, reinstalls the previous locked dependencies, rebuilds, and restarts through the same scheduled task and protected launcher. The restored version/commit, launcher attestation, process identity, port ownership, tasks, and heartbeat must pass before `rolled_back` is published. No detached Node process is intentionally left behind.

## Live end-to-end WindowsTest procedure

1. Confirm `feature/windows-11-updater-agent` is pushed and the C: target is a clean older commit of that same configured branch. Do not copy files into C: manually.
2. Run the exact elevated F: installer command above. It safely replaces the protected scripts/configuration and recreates both tasks.
3. Run `& 'C:\ProgramData\MCC\Updater\scripts\Test-MccWindowsUpdater.ps1'` and require every check to pass.
4. Sign in at `http://localhost:4273` as an authorized Admin, open Settings, and confirm `WINDOWS TEST MODE`, the older installed version/build, and updater availability.
5. Select **Check for updates** once, confirm the target version/build, then select **Install Update** once. Do not refresh while the progress panel is reconnecting.
6. After success, rerun `Test-MccWindowsUpdater.ps1`. Confirm both tasks are `Running`, `mcc-process.json` contains a new PID/launch ID, the C: backend exclusively owns 4273, managed readiness reports `configured:true`, and the heartbeat is healthy.
7. Refresh Settings and run one further check. Require `MCC IS UP TO DATE` and `No new updates are available.` The authenticated status response must remain `configured:true`, `mode:windows_test`, and `environmentLabel:WINDOWS TEST MODE`.
8. Sign out and back in with an authorized account to verify the one-time update-success notice. Verify Manager/Maintenance Tech accounts do not receive updater metadata or a popup.
9. For an approved rollback drill on a disposable older C: test clone, force the target backend readiness endpoint to fail after build, run the same update, and require `rolled_back`; then rerun the installed validation and confirm the prior version/commit and managed task/PID are restored. Restore the clean test branch before any further update check.

After a Windows restart, the agent safely continues a request that had not changed code. If the verified target commit is already checked out while the same job remains active, it locates that job’s verified backup and enters rollback instead of guessing that the update succeeded.

If rollback fails, the updater records `failed`, preserves the backup and detailed logs, and creates `MANUAL-RECOVERY-<job>.txt`. The Settings card shows `CRITICAL UPDATE FAILURE — MANUAL RECOVERY REQUIRED`.

Installer bootstrap failures print the exact failed stage to the elevated console. If `install.log` cannot be opened, the original exception is still written to the console. A rerun with `-RepairUpdaterAcl` repairs the partial updater tree before continuing; task definitions are not changed until bootstrap verification succeeds, and task registration is rolled back if later install health checks fail.

Manual recovery:

1. Keep both updater logs and the matching backup directory.
2. Run `Test-MccWindowsUpdater.ps1`.
3. Stop only `MaintenanceCommandCenter`.
4. Review `MANUAL-RECOVERY-<job>.txt` and the matching update log.
5. Restore the recorded previous commit and verified runtime backup under Administrator control.
6. Run `npm ci --prefix frontend`, `npm ci --prefix backend`, and `npm run build`.
7. start `MaintenanceCommandCenter` and verify `http://127.0.0.1:4273/`.
8. do not claim recovery until the previous version/commit and health endpoint agree.

## Uninstall

Remove only the updater agent and preserve MCC, status/logs, and backups:

```powershell
& 'C:\ProgramData\MCC\Updater\scripts\Uninstall-MccWindowsUpdater.ps1'
```

Also remove the MCC managed task, without deleting MCC or runtime data:

```powershell
& 'C:\ProgramData\MCC\Updater\scripts\Uninstall-MccWindowsUpdater.ps1' -RemoveMccTask
```

Explicitly remove updater config/status/logs while preserving backups:

```powershell
& 'C:\ProgramData\MCC\Updater\scripts\Uninstall-MccWindowsUpdater.ps1' `
  -RemoveMccTask `
  -RemoveUpdaterData
```

Add `-RemoveBackups` only when the safety backups are deliberately no longer needed. The uninstaller never deletes `MCC_V1_FINAL`, the live database, uploads, documents, files, or environment files.

## Windows reboot validation

After installation or reinstall:

1. Restart Windows during an approved maintenance window.
2. Confirm both scheduled tasks show `Running`.
3. run `Test-MccWindowsUpdater.ps1`.
4. sign in as Admin/Owner Admin and confirm the correct deployment label.
5. confirm Manager and Maintenance Tech accounts cannot see the card and receive the normal backend 403 from direct calls.

## Windows and Raspberry Pi differences

Windows uses protected ProgramData JSON, `LOCAL SERVICE`/`SYSTEM`, and two fixed scheduled tasks. Raspberry Pi uses `/var/lib/mcc-update`, the `mcc` account, systemd units, the narrow sudoers entry, and the manual `sudo mcc-update` command. WindowsProduction and Raspberry Pi remain fixed to `origin/main`; WindowsTest may use one protected Administrator-configured origin branch. All share the same admin-only API, persistent state model, clean-worktree/fast-forward rules, backup paths outside Git, health verification, reconnect behavior, and rollback states. The Windows package does not replace or modify the Raspberry Pi runner.
