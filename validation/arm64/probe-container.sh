#!/usr/bin/env bash
set -Eeuo pipefail
[[ -f /.dockerenv && -f /opt/mcc-arm64-disposable.marker && "$(id -u)" == 0 ]]
[[ "$(uname -m)" == aarch64 && "$(cat /proc/1/comm)" == systemd ]]
[[ "${MCC_ARM64_DISPOSABLE:-}" == 1 ]]
mkdir -p /sandbox/probe/mount /evidence
loop=''
cleanup() {
  systemctl stop mcc-arm64-probe.service >/dev/null 2>&1 || true
  if mountpoint -q /sandbox/probe/mount; then umount /sandbox/probe/mount; fi
  if [[ -n "$loop" ]]; then
    [[ "$(losetup --noheadings --output BACK-FILE "$loop")" == /sandbox/probe/disk.img ]] && losetup --detach "$loop"
  fi
}
trap cleanup EXIT
fallocate -l 64M /sandbox/probe/disk.img
mkfs.ext4 -q -F /sandbox/probe/disk.img
loop="$(losetup --find --show /sandbox/probe/disk.img)"
mount "$loop" /sandbox/probe/mount
findmnt --json --target /sandbox/probe/mount --output TARGET,UUID,FSTYPE > /evidence/probe-findmnt.json
systemd-run --unit=mcc-arm64-probe.service --property=Type=exec /bin/sleep 30
[[ "$(systemctl show mcc-arm64-probe.service --property=ActiveState --value)" == active ]]
[[ "$(systemctl show mcc-arm64-probe.service --property=MainPID --value)" -gt 1 ]]
systemctl stop mcc-arm64-probe.service
[[ "$(systemctl show mcc-arm64-probe.service --property=MainPID --value)" == 0 ]]
node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync("/evidence/probe-findmnt.json"));if(!v.filesystems?.[0]?.uuid)process.exit(1);fs.writeFileSync("/evidence/capability-probe.json",JSON.stringify({status:"VERIFIED",architecture:process.arch,realExt4Mount:true,privateSystemdStartStop:true,pid1:fs.readFileSync("/proc/1/comm","utf8").trim(),cgroup:fs.readFileSync("/proc/self/cgroup","utf8")},null,2));'
