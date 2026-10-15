# Isolated native ARM64 validation package

This is a draft for review. It has not been committed, pushed, published or executed on GitHub ARM64. It does not authorize a merge, release, deployment, paid infrastructure, production access or Pi connection. Application version stays **1.5.18**.

The application under test is fixed at **87e1605f5bced355c484a90e1bb42b405f16f24e** (PR #201). The historical synthetic migration source is fixed at **b6a230ce22b90ed81add79b5a8d1422d6eb2250f**. The latter is a known pre-lifecycle 1.5.18 checkout, not a claim about the production Pi's installed SHA. No production configuration or data is used.

## Proposed publication and trigger

After separate publication approval, commit only the added workflow and `validation/arm64/` files on `codex/arm64-release-validation`, based on the exact PR #201 head, and open a review PR **against `codex/release-hardening-safe-recovery`**. Recheck the live base/head and main first; stop and assess drift. Do not modify PR #201 or retarget/merge it as part of validation.

The workflow uses `pull_request` with opened/synchronize/reopened events and a base-branch/path filter. It explicitly checks out the validation PR **head SHA**, then separately checks out the fixed application and legacy SHAs. It does not rely on a branch-only `workflow_dispatch`, a merge checkout silently including new main changes, `pull_request_target`, write permissions, repository secrets or credentials. The same-repository/exact-head-branch condition and source-audit script refuse an unexpected input. Only added workflow/validation files may differ from the approved candidate. Checkout credentials are not persisted.

Existing MCC CI will also run on the new review PR because its existing pull-request trigger is unfiltered. It is separate from this ARM64 workflow and is not ARM64 evidence. No existing workflow is edited.

## Compatibility job

The `ubuntu-24.04-arm` job verifies Linux/aarch64, native Node arm64/22, exact source SHAs, all package versions, native Node SQLite and zlib. It records observed CPU, RAM, storage, kernel, SQLite, Node and OS details. All candidate root/frontend/backend and legacy backend installs use their committed npm lockfiles. Candidate frontend/backend and legacy backend are built separately.

The unprivileged runtime/SQLite/zlib probe runs before workload isolation. Privileged workload processes then receive an explicit empty starting environment with only the required PATH and validation paths. No GitHub/Actions tokens are passed into them. Older test fixtures that derive PM roots from their own synthetic data directory keep those defaults; the wrapper does not inject conflicting parent PM paths. Each suite has a separate fallback sandbox, and Windows preparation uses short temporary paths for SQLite compatibility.

Application tests run inside a fresh PID/mount/network namespace, with loopback only and no default route. Only explicit temporary synthetic storage, disabled updater/HTTPS and empty SMTP settings reach the application. Dependency setup happens before network isolation. The network-namespace command fails rather than silently running with ordinary network access if the runner cannot isolate it.

`migration.mjs` creates synthetic state by booting the fixed historical source, preserves an independent pre-upgrade copy and compares original columns/IDs across 19 tables and eight attachment/workbook hashes after candidate migration. It checks default lifecycle state, repeat-start idempotence, archive/replacement identity, verified Master backup, original ZIP checksum and real restore/database integrity. Historical code is not booted against migrated work.

`run-suites.mjs` runs these existing exact candidate tests sequentially, with per-suite logs, deadlines, elapsed time and GNU time CPU/RSS/IO reports on Linux:

| Suite | Coverage |
|---|---|
| machine-retirement-archive-api.mjs | Archive/restore, IDs, relationship graph, history ZIP manifests/original hashes, permissions |
| pm-history-report-api.mjs | Machine/Equipment PDFs, exact completion selection, roles, payload/page bounds and invariance |
| portable-recovery-readiness.mjs | Original 16 MiB case inside mixed 144 MiB create/import/restore; STORE fallback; envelope/retention/hostile ZIP checks |
| portable-master-backup.mjs | Portable checksums, clean-runtime restore, recovery quotas and original records/files |
| external-uploads-api.mjs | 44 default/external retrieval and containment checks |
| backend-upload-security-regression.mjs | 78 HTTP assertions, active PM fixture, abort/queue cleanup |
| pm-workflow-upgrade.mjs | PM meters/history and role preservation |
| pm-work-order-attachments.mjs | Original PDFs, workbook links, ZIP packaging and restore |
| password-permissions-api.mjs | Authorization and session restrictions |
| authentication-password-change-regression.mjs | Credential/session/authentication invariants |
| issue-174-inspection-records-api.mjs | Inspection originals, denied-operation invariance and deletion protections |
| system-update-api.mjs | Disabled updater API and authorization only; no deployment is invoked |

The existing Windows-oriented `deployment-safety.test.mjs` is not used as native evidence: it injects mount observations and its fixtures are not root-owned on ordinary Linux execution. The dedicated native harness below uses the unmodified helper's default real `findmnt` implementation.

## Capability-gated deployment job

After native locked installs/builds, `run-container.sh` builds a disposable Ubuntu 24.04 ARM64 image with systemd, util-linux/e2fsprogs and the verified Node 22 binary. The image digest/configuration is recorded. Image/tool preparation uses public package infrastructure, then the test container has **no network**, no Docker socket, no production mounts and no credentials. Input checkouts are read-only. Only the evidence directory is a writable host bind mount. This privileged container runs only inside the disposable GitHub-hosted VM; it must never be run on a production or shared host.

The first probe must actually boot private PID 1 systemd, create a small real loop-backed ext4 filesystem, discover its UUID and start/stop a private transient service. Docker availability alone is not proof. Unsupported container, systemd, loop mount or capacity capability writes **NOT VERIFIED**, with the actual failed probe log. It does not run substitute mocks. The job may finish with a capability warning; a green job badge must not be interpreted as verified deployment acceptance. Read `deployment-status.json` and the job summary. Once the probe passes, any failed native test fails the job.

The native harness allocates two separate 768 MiB ext4 image files plus a 64 MiB changed-mount image. It requires at least 6 GiB free before the container build. Actual UUIDs and mount targets are recorded, including private bind-mounted OS configuration directories. Cleanup detaches only loop devices whose backing files are under this container's `/sandbox/` tree; it never performs global loop-device cleanup.

Prepared cases cover root ownership/mode refusal, real `/proc` environment matching/mismatch, real start/stop and stopped-service checks, complete nine-unit snapshots, original/configuration checksums, actual historical-code refusal, missing/changed mounted filesystem refusal, tampering, recovery-point decisions and recovery into a new nonexistent destination. The recovered application actually boots and verifies archive/replacement IDs, PM exclusion, inspection bytes, clean SQLite integrity/foreign keys, a later PM completion, earlier PM correction and a linked original PDF. Earlier snapshots and live storage remain separate.

Failure-path integration uses the **exact source-extracted `restore_previous_build` function** from the audited updater with the unmodified installed helper and real private systemd service. Only status output is redirected to an evidence log. The pre-start case proves changed current work holds stopped. The post-start cases prove stopped-state retention both when a failed-candidate snapshot succeeds and when snapshot creation fails. This is **not** end-to-end validation of the updater's outer fetch/install/build/ERR-trap orchestration or its successful fallback path; those remain VM gates. Post-start synthetic PM rows and attachment bytes are deliberately seeded after service start; separate existing suites cover actual PM API transactions.

## Resource measurements and limits

`profile.mjs` uses one application, a 512 MiB V8 old-space cap, 32 MiB synthetic upload payload (16 MiB repetitive and 16 MiB random), three selected PM report rows per library, and sequential history ZIP, Machine/Equipment PDF, backup creation/download and health requests. It verifies original hashes, IDs and database integrity. A preload samples actual application RSS, heap, external/ArrayBuffer usage and cumulative CPU every 200 ms; the controller records response durations, bytes, SHA-256 and synthetic disk bytes. Short peaks between samples can be missed. No p95, concurrent multi-user load or maximum dataset claim is made.

GNU time's maximum RSS is a process maximum, not the sum of simultaneous application/controller processes. Application preload samples cover that application only. Use the recorded container cgroup peak/events for the bounded container's combined envelope, and include OS/kernel overhead separately when assessing a real Pi.

The deployment container requests and verifies Docker's exact **4 GiB memory / 4 GiB memory+swap** values (zero swap allowance) and private cgroup namespace, then repeats the bounded workload under that limit. Cgroup memory.max/peak/events and Docker state are retained. An OOM, timeout or failed supported test fails; an unsupported capability is NOT VERIFIED. A V8 heap cap alone is never described as a total-memory limit. This envelope contains container init/test/application/page-cache memory but excludes the host OS/kernel and does not prove a Pi with 4 GB physical RAM has sufficient headroom.

GitHub currently documents the public standard ARM64 runner as 4 vCPU, 16 GB RAM and 14 GB SSD; runtime observations take precedence. This differs from the Pi's CPU/memory bandwidth, USB SSD, power, thermal throttling, OS/userspace architecture and available RAM. No benchmark conversion or production concurrency limit is inferred.

Sources: [GitHub-hosted runner specifications and privileges](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [pull-request workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request), [ARM64 runner image](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Arm64-Readme.md).

## Evidence and acceptance

Successful native compatibility requires strict architecture/source checks, every build and selected test passing, migration ID/hash/database preservation and profile completion. Deployment coverage requires a VERIFIED real capability probe and every executed native case passing; NOT VERIFIED is an outstanding gate, not a pass. Retained artifacts contain summaries/logs/metrics, not entire databases, uploads, mounts or dependency caches. All data is synthetic; no full host/service environment is dumped.

See `VM-STAGING-PLAN.md` for full updater, persistent storage, reboot and bare-drive acceptance. Actual Pi RAM/thermal/power, USB/SSD behavior and operator recovery remain unverified after GitHub tests. Stop and report any failure rather than changing the candidate, relaxing assertions or substituting mocked mount information to obtain a pass.
