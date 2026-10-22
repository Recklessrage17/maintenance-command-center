# Separate isolated ARM64 VM staging plan — not provisioned

No VM, account, network or disk has been provisioned. Do not allocate a paid VM without separate owner approval. Prefer an already available native ARM64 host/hypervisor if explicitly authorized. An x64 machine using ARM emulation is not native evidence.

## Environment and review before execution

Obtain approval for the named VM, provider/hypervisor, cost/retention limits and exact storage devices. Allocate separate disposable OS and data volumes with independently reviewed UUIDs; use conservative example minimums of 20 GiB each and increase only from measured snapshot/restore headroom. Begin with 4 GiB RAM, no swap for the bounded test, and record vCPU model/count. A later approved swap configuration is a distinct test. These are fixture sizes, not production capacity estimates.

No production mounts, copied databases, credentials, SSH/deploy keys, SMTP, LAN integrations or external MCC connections may exist. Provision disposable local credentials only. Prepare trusted packages and locked dependency caches first, then isolate application traffic to loopback. Allow only separately reviewed administrative access. The VM must have its own boot/reboot lifecycle, synthetic data only and an independently disposable filesystem; never reuse production's service or storage device.

Record native uname/aarch64, OS/userspace architecture, exact Node 22 binary and hashes, kernel/systemd/util-linux versions, memory/cgroup/swap observations, filesystem UUID/type/target, inode/free space and device topology. Use `findmnt`, `lsblk`, `blkid` and explicit mount units/fstab review. Do not infer persistent SSD behavior from loop files or assume /dev device names remain stable.

Review every configured MCC root and every OS/service/updater/mount/Caddy/PKI/share dependency. The test inventory must contain actual files, not placeholder UUIDs or an incomplete example manifest. Use dedicated systemd units and a dedicated non-root service user, with the root-owned safety helper and manifest, private snapshot destination and correct ownership on restored files. Verify installed helper bytes against the exact candidate before each rehearsal.

## Full updater rehearsal

Run the exact installed `update-mcc` bytes only inside this VM. Keep network access to production impossible. Prepare a VM-local bare Git fixture and a root-owned Git URL rewrite mapping the approved repository URL to that local fixture; no Git operation may reach a remote MCC service or change GitHub. Record this fixture setup explicitly as test infrastructure, not production configuration. Build synthetic old/new commits from the installed 1.5.18 source and the exact reviewed 2.0.0 candidate; record all intentional fault-injection changes separately from the audited application SHA. Existing locks and an offline npm cache must support real installs/builds without mocked npm/systemctl/findmnt commands.

Exercise the complete runner, ERR trap, request/status files, Git ref changes and actual service lifecycle:

1. A normal supported update with all current state preserved, exact running commit/version, real health and storage-environment verification.
2. A controlled real install/build failure before candidate startup. Compatible unchanged previous source may resume only after real guards pass. Changed runtime/configuration or an undeclared historical lifecycle capability must hold stopped. Assert the exact old/new Git refs, no data overlay and truthful status.
3. A failed candidate start/health after potential migration. The runner must stop the service, retain all current work, attempt a complete failed-candidate snapshot and never automatically boot historical code. Also test snapshot failure from a bounded, isolated full/quota-limited snapshot filesystem. Preserve current original state and explicit failed-snapshot status.
4. A candidate that accepts new PM completion, correction, lifecycle/replacement and attachment writes before the injected failure. Capture original IDs/bytes and API responses before failure. Prefer recovering the later failed-candidate snapshot into new storage and actually boot it. If choosing an older snapshot, require the exact recovery-point decision and enumerate excluded later work; no silent data loss is acceptable.
5. Recovery with denied/incorrect operator decision, nonempty destination, wrong code capability, tampered manifest/file/configuration, missing required root, linked/special file or insufficient space must refuse and leave live/earlier state intact.

An injection that changes configuration after the pre-update snapshot is a configuration-invariance refusal case, not proof of a candidate-start failure path. Keep phase markers and controlled service/build fault mechanisms reviewable so each case reaches the intended branch. Do not modify the audited updater to force an expected result.

## Persistent mount, reboot and recovery cases

Stop the synthetic service before storage operations. Detach only the explicitly owned disposable data volume; confirm the mount identity guard refuses missing storage or OS-filesystem fallback without writing to the underlying mount directory. Attach a different filesystem at the same target and require UUID/type refusal. Never format a computed /dev path without verifying ownership, size, UUID and containment in the approved fixture.

Perform an orderly VM reboot, verify persistent fstab/mount-unit ordering and UUIDs, and require the service to remain stopped if required data storage is missing. Test controlled VM power interruption only with separate explicit approval; a loop unmount or orderly reboot is not power-loss evidence.

Perform bare-drive recovery onto a different newly allocated disposable data filesystem, with the source filesystem disconnected. Reinstall reviewed code/dependencies/configuration, apply freshly reviewed paths and ownership, validate all snapshot checksums/database integrity, and boot only lifecycle-aware code. Verify archived/replacement identities, ordinary-library/PM exclusion, PM/history IDs, latest completions/corrections, original uploads/work orders/inspection files and prior backup/recovery history. Reconnect the old volume only under a reviewed read-only investigation plan; never overlay it with a chosen older recovery point.

## Acceptance and limits

Record all commands, phase timings, resource measurements, failures and recovery-point decisions without exposing credentials. Every required case must pass against the recorded code/helper/manifest/device IDs. A skipped/unsupported case is NOT VERIFIED. Full runner success must be demonstrated separately from the source-extracted fallback-function test in GitHub CI.

Measure snapshot + independent SQLite validation + failed-candidate snapshot + new recovery set on each relevant filesystem. Measure sustained ZIP/PDF/backup CPU/RSS/heap/IO, free inodes and user-visible response times under an agreed bounded workload before considering concurrent load. Establish site-specific memory, free-space and latency thresholds from evidence; do not infer them from a VM's nominal allocation or from GitHub's faster ARM hardware.

A passing VM still does not establish Pi 400 USB/SSD cable/enclosure health, thermal throttling, power stability, firmware, real reboot/mount ordering, 4 GB physical-RAM headroom or bare-drive operator execution. Those remain separate named Pi staging gates and require separate owner authorization. No release/version bump/tag/merge/production deployment is approved here.
