# Admin one-click MCC updater

## Security and process boundary

The Settings control never runs a browser-supplied command. The browser can submit only an opaque server-issued check token, an explicit `confirm: true` value, and the session-bound `X-MCC-CSRF-Token`. The backend takes all deployment values from trusted deployment configuration:

- repository: `https://github.com/Recklessrage17/maintenance-command-center.git`
- remote: `origin`
- branch: `main` for Raspberry Pi and WindowsProduction; for WindowsTest only, one branch stored by the elevated installer in protected ProgramData configuration
- health port: `4273`

The backend performs a controlled read/check workflow (`git remote get-url`, exact configured-branch and clean-tree checks, a single-branch `git fetch`, commit ancestry, and `git show <verified commit>:package.json`). It never accepts a repository, branch, path, command, service, version, or commit from the browser. Settings exposes no branch input.

Installation crosses a narrow process boundary:

```text
Admin/Owner Settings
  -> authenticated and rate-limited MCC API
  -> same-origin/session CSRF validation
  -> fixed request.json with the server-verified target
  -> exact external update trigger
  -> root-owned Raspberry Pi runner OR isolated Z: PowerShell runner
```

The Linux `mcc` web account receives no shell and no unrestricted `sudo`. Its only passwordless command is:

```text
/usr/bin/systemctl start mcc-update-request.service
```

The root runner independently revalidates the fixed repository, `main` branch, clean worktree, installed commit, requested target, remote target, semantic version, and fast-forward ancestry. A compromised or stale request therefore cannot select another source.

## API and authorization

All three endpoints require the existing authenticated Admin role. The protected Owner Admin is an Admin and receives the same access. Manager and Maintenance Tech 1/2/3 receive the normal `403` JSON response; an unauthenticated request receives the normal `401`.

- `GET /api/system/update/status` returns only sanitized persistent state and a session-bound CSRF token.
- `POST /api/system/update/check` is rate-limited, serialized by a check lock, and never changes the checked-out worktree.
- `POST /api/system/update/install` is rate-limited, requires the CSRF header and explicit confirmation, rejects extra fields, rejects duplicate jobs, and accepts only a fresh server-issued check token.

The install endpoint returns `202 Accepted` after queueing. The browser polls the persistent status with bounded retry/backoff while MCC restarts. It stops retrying after 30 consecutive connection failures or five minutes; it never enters a reload loop.

## Persistent status and audit data

Linux uses `/var/lib/mcc-update/status.json`; Windows test mode uses `Z:\MCC_UPDATE\state\status.json`. The file contains only:

- current state and safe message
- installed and target semantic versions and Git commits
- start, last-update, and completion timestamps
- requester numeric ID and display name
- outcome and sanitized transition events

It never contains cookies, session tokens, Git credentials, environment contents, passwords, private keys, or raw command output. On Linux the file is `mcc:mcc 0640`; `request.json` is `mcc:mcc 0600`; the state directory is `mcc:mcc 0750`. The root runner rewrites the status atomically and returns ownership to `mcc:mcc`.

MCC records sanitized History and audit events for check, available, requested, started, succeeded, failed, rollback started, rollback succeeded, and rollback failed. External runner transitions are reconciled into the database after MCC starts again. Raw build logs never enter History.

## Raspberry Pi installation

These instructions assume the existing service is named `mcc.service`, runs as user/group `mcc:mcc`, and the approved clone is `/opt/maintenance-command-center`. Change the root-owned `/etc/mcc-update.conf` before installation only if the production clone uses another location. The browser cannot change it.

From the approved repository checkout:

```bash
sudo getent group mcc >/dev/null || sudo groupadd --system mcc
sudo id mcc >/dev/null 2>&1 || sudo useradd --system --gid mcc --home-dir /opt/maintenance-command-center --shell /usr/sbin/nologin mcc

sudo install -d -o root -g root -m 0755 /usr/local/lib/mcc-update
sudo install -d -o mcc -g mcc -m 0750 /var/lib/mcc-update
sudo install -d -o root -g root -m 0750 /var/backups/mcc-updates

sudo install -o root -g root -m 0755 deployment/raspberry-pi/update-mcc /usr/local/sbin/update-mcc
sudo install -o root -g root -m 0755 deployment/raspberry-pi/mcc-update /usr/local/bin/mcc-update
sudo install -o root -g root -m 0755 deployment/raspberry-pi/write-status.py /usr/local/lib/mcc-update/write-status.py
sudo install -o root -g root -m 0644 deployment/raspberry-pi/mcc-update.conf /etc/mcc-update.conf

sudo install -o root -g root -m 0644 deployment/raspberry-pi/mcc-update-request.service /etc/systemd/system/mcc-update-request.service
sudo install -o root -g root -m 0644 deployment/raspberry-pi/mcc-update-runner.service /etc/systemd/system/mcc-update-runner.service

sudo visudo -cf deployment/raspberry-pi/mcc-update.sudoers
sudo install -o root -g root -m 0440 deployment/raspberry-pi/mcc-update.sudoers /etc/sudoers.d/mcc-update
sudo visudo -cf /etc/sudoers.d/mcc-update

sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/mcc-update-request.service /etc/systemd/system/mcc-update-runner.service
```

Add the controlled production mode to `/opt/maintenance-command-center/.env`:

```dotenv
MCC_UPDATE_MODE=raspberry_pi
MCC_UPDATE_APP_DIR=/opt/maintenance-command-center
MCC_UPDATE_STATE_DIR=/var/lib/mcc-update
```

Then ensure the production checkout and runtime locations have the expected ownership and restart MCC:

```bash
sudo chown -R mcc:mcc /opt/maintenance-command-center
sudo chown root:root /usr/local/sbin/update-mcc /usr/local/bin/mcc-update /usr/local/lib/mcc-update/write-status.py /etc/mcc-update.conf
sudo chmod 0755 /usr/local/sbin/update-mcc /usr/local/bin/mcc-update /usr/local/lib/mcc-update/write-status.py
sudo chmod 0644 /etc/mcc-update.conf
sudo systemctl restart mcc.service
sudo systemctl status mcc.service --no-pager
```

The root-owned runner and service definitions must never be writable by `mcc`. Only the state/request files are writable by the web account. The retained safety backups are root-only (`root:root`, directory `0750`, archive `0600`).

The manual recovery command remains:

```bash
sudo mcc-update
```

The manual command uses the same fixed repository, clean-tree check, backup, build, health check, and rollback sequence.

If the repository becomes private, configure a read-only deploy key in the production account's Git configuration. Keep the private key outside MCC, its database, `.env`, request/status files, and History.

## Raspberry Pi update and rollback sequence

The runner acquires `/run/lock/mcc-update.lock`, validates configuration and Git state, fetches `origin/main`, verifies fast-forward ancestry, and records both commits and versions. It stops `mcc.service`, then creates and verifies a timestamped `tar.gz` containing these paths when present:

- `backend/data`
- `backend/uploads`
- `backend/documents`
- `backend/files`
- `backend/.env`
- root `.env`

It fast-forwards with `git merge --ff-only`, runs locked `npm ci` installs for frontend and backend, builds both through the root build command, starts MCC, checks `http://127.0.0.1:4273/`, and verifies the target commit/version. The safety backup is retained.

After any post-change failure, the runner stops MCC, moves the `main` ref back to the recorded old commit with guarded `git update-ref`, refreshes the index/worktree with `git read-tree --reset -u`, restores the safety snapshot, reinstalls and rebuilds the previous version, starts MCC, and health-checks it. It records `rolled_back` only when that recovery is healthy; otherwise it records a critical `failed` outcome.

`Critical rollback failure` is the explicit operator-visible status when the previous healthy build cannot be restored.

Tracked or untracked production changes block the workflow. Nothing is automatically stashed, cleaned, discarded, or overwritten.

## Legacy Windows Z: manual test harness

The Issue #60 PowerShell harness remains available for manual validation and rollback simulation. It is deliberately restricted to `Z:\MCC_V1_FINAL`; its validation rejects `F:\MCC_V1_FINAL` and every non-Z target.

Use a dedicated local service account named `MCCService` for the Z: test backend. From an elevated PowerShell:

```powershell
New-Item -ItemType Directory -Force -Path 'Z:\MCC_UPDATE','Z:\MCC_UPDATE\state','Z:\MCC_UPDATE_BACKUPS' | Out-Null
Copy-Item -LiteralPath '.\deployment\windows\Invoke-MccTestUpdate.ps1' -Destination 'Z:\MCC_UPDATE\Invoke-MccTestUpdate.ps1' -Force
Copy-Item -LiteralPath '.\deployment\windows\mcc-update.test.example.json' -Destination 'Z:\MCC_UPDATE\config.json' -Force
Unblock-File -LiteralPath 'Z:\MCC_UPDATE\Invoke-MccTestUpdate.ps1'

icacls 'Z:\MCC_UPDATE' /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' 'MCCService:(RX)'
icacls 'Z:\MCC_UPDATE\state' /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' 'MCCService:(OI)(CI)M'
icacls 'Z:\MCC_UPDATE_BACKUPS' /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' 'MCCService:(OI)(CI)M'
icacls 'Z:\MCC_V1_FINAL' /grant 'MCCService:(OI)(CI)M'

powershell.exe -NoLogo -NoProfile -ExecutionPolicy RemoteSigned -File 'Z:\MCC_UPDATE\Invoke-MccTestUpdate.ps1' -ConfigurationPath 'Z:\MCC_UPDATE\config.json' -ValidateOnly
```

The helper uses the fixed Z: clone, stops only the controlled PID/port `4273` process, creates and verifies a ZIP safety backup, fast-forwards, runs locked installs/build, restarts, health-checks, and rolls back on failure. The `simulation.failInstall`, `simulation.failBuild`, and `simulation.failHealth` switches exist only in the administrator-owned Windows test config so rollback paths can be exercised; they are never accepted through the API.

The Node backend no longer spawns this PowerShell harness. Setting `MCC_UPDATE_MODE=windows_test` alone leaves the Settings card at `UPDATER NOT CONFIGURED`; an Administrator runs the legacy script directly.

For managed `WINDOWS TEST MODE` or `WINDOWS 11 PRODUCTION` Settings control, install the Issue #61 agent from [`deploy/windows/README-Windows-Updater.md`](../deploy/windows/README-Windows-Updater.md). The managed installer sets `MCC_UPDATE_MODE=windows_agent` inside the controlled Windows task only after protected configuration and agent health are available. WindowsTest defaults to `main` and accepts one explicit elevated `-TestBranch`; WindowsProduction rejects that parameter and any non-`main` protected configuration. Raspberry Pi continues to display `RASPBERRY PI PRODUCTION`.

## Removal and recovery

To disable the button without deleting data, remove `MCC_UPDATE_MODE` from `.env` and restart `mcc.service`.

To remove the Linux integration while retaining status and safety backups:

```bash
sudo rm -f /etc/sudoers.d/mcc-update
sudo rm -f /etc/systemd/system/mcc-update-request.service /etc/systemd/system/mcc-update-runner.service
sudo rm -f /usr/local/sbin/update-mcc /usr/local/bin/mcc-update
sudo rm -rf /usr/local/lib/mcc-update
sudo systemctl daemon-reload
sudo systemctl reset-failed
```

Do not delete `/var/lib/mcc-update` or `/var/backups/mcc-updates` until status and retained backups have been reviewed and copied elsewhere if needed.

For investigation:

```bash
sudo systemctl status mcc-update-request.service mcc-update-runner.service --no-pager
sudo journalctl -u mcc-update-runner.service --since today
sudo cat /var/lib/mcc-update/status.json
sudo systemctl restart mcc.service
```

Do not paste journal output into normal MCC History; deployment logs can contain operational details that the sanitized API intentionally excludes.
