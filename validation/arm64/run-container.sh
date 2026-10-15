#!/usr/bin/env bash
set -Eeuo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ARCH:-}" == ARM64 && -n "${RUNNER_TEMP:-}" ]]
evidence="$MCC_ARM64_EVIDENCE"
mkdir -p "$evidence"
not_verified() {
  WHY="$1" OUT="$evidence" node -e 'const fs=require("fs");fs.writeFileSync(process.env.OUT+"/deployment-status.json",JSON.stringify({status:"NOT VERIFIED",reason:process.env.WHY,requires:"separate isolated ARM64 VM staging"},null,2));'
  echo "::warning::$1 — deployment integration NOT VERIFIED; VM staging required."
}
if ! command -v docker >/dev/null || ! docker info >/dev/null 2>&1; then not_verified 'Docker unavailable'; exit 0; fi
if [[ "$(df --output=avail -B1 "$RUNNER_TEMP" | tail -1)" -lt 6442450944 ]]; then not_verified 'Less than 6 GiB free for bounded image and snapshot work'; exit 0; fi
context="$(mktemp -d "$RUNNER_TEMP/mcc-arm64-image.XXXXXX")"
cp "$MCC_ARM64_PACKAGE/validation/arm64/Dockerfile" "$context/Dockerfile"
cp "$(command -v node)" "$context/node"
name="mcc-arm64-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
image="$name:local"
cleanup() { docker rm --force "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
if ! timeout 360 docker build --pull --tag "$image" "$context" > "$evidence/container-build.log" 2>&1; then not_verified 'Disposable container build unavailable; inspect build log'; exit 0; fi
docker image inspect "$image" > "$evidence/container-image.json"
docker image inspect ubuntu:24.04 --format '{{json .RepoDigests}}' > "$evidence/container-base-digests.json"
sha256sum "$(command -v node)" > "$evidence/node-binary.sha256.txt"
if ! docker run --detach --name "$name" --privileged --cgroupns private --network none --memory 4g --memory-swap 4g --tmpfs /run --tmpfs /run/lock --tmpfs /tmp --env MCC_ARM64_DISPOSABLE=1 --env MCC_ARM64_CANDIDATE=/input/candidate --env MCC_ARM64_LEGACY=/input/legacy-source --env MCC_ARM64_EVIDENCE=/evidence --mount "type=bind,src=$MCC_ARM64_CANDIDATE,dst=/input/candidate,readonly" --mount "type=bind,src=$MCC_ARM64_LEGACY,dst=/input/legacy-source,readonly" --mount "type=bind,src=$MCC_ARM64_PACKAGE,dst=/input/package,readonly" --mount "type=bind,src=$evidence,dst=/evidence" "$image" > "$evidence/container-id.txt" 2>&1; then not_verified 'Private systemd container could not start'; exit 0; fi
docker inspect "$name" > "$evidence/container-config.json"
limits="$(docker inspect "$name" --format '{{.HostConfig.Memory}} {{.HostConfig.MemorySwap}} {{.HostConfig.CgroupnsMode}}')"
if [[ "$limits" != '4294967296 4294967296 private' ]]; then not_verified 'Requested private cgroup and exact 4 GiB no-swap limit were not confirmed'; exit 0; fi
if ! timeout 60 docker exec "$name" /bin/bash -c 'until systemctl show --property=SystemState --value >/dev/null 2>&1; do sleep 1; done'; then not_verified 'Private systemd did not become available'; exit 0; fi
if ! timeout 90 docker exec "$name" /bin/bash /input/package/validation/arm64/probe-container.sh > "$evidence/capability-probe.log" 2>&1; then not_verified 'Real mount/systemd capability probe failed'; exit 0; fi
# A supported native test failure is a failure, never NOT VERIFIED or success.
set +e
timeout 300 docker exec "$name" /bin/bash /input/package/validation/arm64/native-deployment.sh > "$evidence/native-deployment.log" 2>&1
result=$?
set -e
docker stats --no-stream "$name" > "$evidence/container-final-stats.txt" || true
docker inspect "$name" --format '{{json .State}}' > "$evidence/container-final-state.json"
docker exec "$name" /bin/bash -c 'for p in memory.max memory.peak memory.events memory.swap.max; do echo "$p"; cat "/sys/fs/cgroup/$p"; done' > "$evidence/cgroup-memory.txt" || true
if [[ "$result" != 0 ]]; then echo '::error::Supported native deployment tests failed; see retained evidence.'; exit "$result"; fi
