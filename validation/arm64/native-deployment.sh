#!/usr/bin/env bash
set -Eeuo pipefail
[[ -f /.dockerenv && -f /opt/mcc-arm64-disposable.marker && "${MCC_ARM64_DISPOSABLE:-}" == 1 ]]
[[ "$(node -p process.arch)" == arm64 && "$(cat /proc/1/comm)" == systemd ]]
node -e 'if(JSON.parse(require("fs").readFileSync("/evidence/capability-probe.json")).status!=="VERIFIED")process.exit(1)'
mkdir -p /sandbox/images /sandbox/os /sandbox/data
loops=()
cleanup() {
  systemctl stop mcc-arm64-fixture.service mcc-arm64-recovered.service mcc-arm64-nonroot.service >/dev/null 2>&1 || true
  for mount in /usr/local/lib/mcc-update /etc/systemd/system /sandbox/data /sandbox/os; do if mountpoint -q "$mount"; then umount "$mount"; fi; done
  for device in "${loops[@]}"; do
    backing="$(losetup --noheadings --output BACK-FILE "$device")"
    case "$backing" in /sandbox/images/*.img) losetup --detach "$device";; *) echo 'Refusing to detach an unowned loop device' >&2; return 1;; esac
  done
}
trap cleanup EXIT
for role in os data; do
  fallocate -l 768M "/sandbox/images/$role.img"
  mkfs.ext4 -q -F "/sandbox/images/$role.img"
  device="$(losetup --find --show "/sandbox/images/$role.img")"
  loops+=("$device")
  mount "$device" "/sandbox/$role"
done
mkdir -p /sandbox/os/systemd /sandbox/os/mcc-update /usr/local/lib/mcc-update
mount --bind /sandbox/os/systemd /etc/systemd/system
mount --bind /sandbox/os/mcc-update /usr/local/lib/mcc-update
fallocate -l 64M /sandbox/images/changed.img
mkfs.ext4 -q -F /sandbox/images/changed.img
changed="$(losetup --find --show /sandbox/images/changed.img)"
loops+=("$changed")
export MCC_ARM64_DATA_DEVICE="${loops[1]}" MCC_ARM64_CHANGED_DEVICE="$changed"
node /input/package/validation/arm64/native-deployment.mjs
