#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$(uname -m)" == aarch64 && "$(node -p process.arch)" == arm64 ]]
[[ "$(id -u)" == 0 && -n "${MCC_ARM64_EVIDENCE:-}" ]]
ip link set lo up
[[ "$(ip -o link show | wc -l)" == 1 ]]
[[ -z "$(ip route show default)" ]]
node "$MCC_ARM64_PACKAGE/validation/arm64/migration.mjs"
node "$MCC_ARM64_PACKAGE/validation/arm64/run-suites.mjs"
node "$MCC_ARM64_PACKAGE/validation/arm64/profile.mjs"
