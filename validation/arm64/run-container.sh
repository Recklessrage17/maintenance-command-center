#!/usr/bin/env bash
set -Eeuo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ARCH:-}" == ARM64 && -n "${RUNNER_TEMP:-}" ]]
evidence="$MCC_ARM64_EVIDENCE"
mkdir -p "$evidence"
not_verified() {
  WHY="$1" OUT="$evidence" node -e 'const fs=require("fs");fs.writeFileSync(process.env.OUT+"/deployment-status.json",JSON.stringify({status:"NOT VERIFIED",reason:process.env.WHY,requires:"separate isolated ARM64 VM staging"},null,2));'
  echo "::warning::$1 — deployment integration NOT VERIFIED; VM staging required."
}
# Provenance helpers: failures stop before any capability test or container start.
provenance_failed() {
  WHY="$1" OUT="$evidence" node -e 'const fs=require("fs");fs.writeFileSync(process.env.OUT+"/deployment-status.json",JSON.stringify({status:"FAILED",phase:"image-provenance",reason:process.env.WHY,capabilities:"NOT VERIFIED"},null,2));'
  echo "::error::$1 — image provenance failed; native deployment tests did not run."
  exit 1
}
record_base_image() {
  if ! timeout 120 docker pull --platform linux/arm64 ubuntu:24.04 > "$evidence/base-image-pull.log" 2>&1; then provenance_failed 'ARM64 Ubuntu base image pull failed; inspect base-image-pull.log'; fi
  if ! docker image inspect ubuntu:24.04 > "$context/base-image-inspect.json" 2> "$evidence/image-provenance.log"; then provenance_failed 'Pulled Ubuntu base image inspection failed; inspect image-provenance.log'; fi
  if ! base_digest="$(node - "$context/base-image-inspect.json" "$evidence" 2>> "$evidence/image-provenance.log" <<'NODE'
const fs=require('node:fs'),assert=require('node:assert/strict');
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));assert.equal(input.length,1,'Expected one base image');const base=input[0];
assert.equal(base.Os,'linux');assert.equal(base.Architecture,'arm64');assert.match(base.Id,/^sha256:[a-f0-9]{64}$/);
assert.ok(base.RepoTags?.includes('ubuntu:24.04'),'Expected pulled Ubuntu 24.04 tag');
const digest=base.RepoDigests?.find(value=>/^(?:docker\.io\/library\/)?ubuntu@sha256:[a-f0-9]{64}$/.test(value));assert.ok(digest,'Expected official Ubuntu immutable digest');
assert.ok(Array.isArray(base.RootFS?.Layers)&&base.RootFS.Layers.length,'Expected base filesystem layers');
fs.writeFileSync(process.argv[3]+'/container-base-image.json',JSON.stringify(input,null,2)+'\n',{flag:'wx'});
fs.writeFileSync(process.argv[3]+'/container-base-digests.json',JSON.stringify(base.RepoDigests,null,2)+'\n',{flag:'wx'});
process.stdout.write(digest);
NODE
  )"; then provenance_failed 'Ubuntu base identity/ARM64/digest verification failed; inspect image-provenance.log'; fi
}
record_built_image() {
  if ! docker image inspect "$image" > "$context/built-image-inspect.json" 2>> "$evidence/image-provenance.log"; then provenance_failed 'Built disposable image inspection failed; inspect image-provenance.log'; fi
  if ! node - "$context/built-image-inspect.json" "$evidence" "$base_digest" 2>> "$evidence/image-provenance.log" <<'NODE'
const fs=require('node:fs'),assert=require('node:assert/strict'),out=process.argv[3];
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));assert.equal(input.length,1,'Expected one built image');const built=input[0],base=JSON.parse(fs.readFileSync(out+'/container-base-image.json','utf8'))[0];
assert.equal(built.Os,'linux');assert.equal(built.Architecture,'arm64');assert.match(built.Id,/^sha256:[a-f0-9]{64}$/);
assert.ok(built.RootFS?.Layers?.length>base.RootFS.Layers.length,'Expected disposable image layers');
assert.deepEqual(built.RootFS.Layers.slice(0,base.RootFS.Layers.length),base.RootFS.Layers,'Built image must retain the verified base layers');
fs.writeFileSync(out+'/container-image.json',JSON.stringify(input,null,2)+'\n',{flag:'wx'});
fs.writeFileSync(out+'/container-image-provenance.json',JSON.stringify({status:'VERIFIED',platform:'linux/arm64',requestedBase:'ubuntu:24.04',baseDigest:process.argv[4],baseImageId:base.Id,builtImageId:built.Id,baseLayersVerified:base.RootFS.Layers.length},null,2)+'\n',{flag:'wx'});
NODE
  then provenance_failed 'Built image ARM64/base-layer provenance verification failed; inspect image-provenance.log'; fi
}
# End provenance helpers.
if ! command -v docker >/dev/null || ! docker info >/dev/null 2>&1; then not_verified 'Docker unavailable'; exit 0; fi
if [[ "$(df --output=avail -B1 "$RUNNER_TEMP" | tail -1)" -lt 6442450944 ]]; then not_verified 'Less than 6 GiB free for bounded image and snapshot work'; exit 0; fi
context="$(mktemp -d "$RUNNER_TEMP/mcc-arm64-image.XXXXXX")"
cp "$MCC_ARM64_PACKAGE/validation/arm64/Dockerfile" "$context/Dockerfile"
cp "$(command -v node)" "$context/node"
name="mcc-arm64-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
image="$name:local"
cleanup() { docker rm --force "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
record_base_image
if ! timeout 360 docker build --pull --platform linux/arm64 --build-arg "MCC_ARM64_BASE_IMAGE=$base_digest" --tag "$image" "$context" > "$evidence/container-build.log" 2>&1; then provenance_failed 'Disposable container build failed; inspect container-build.log'; fi
record_built_image
sha256sum "$(command -v node)" > "$evidence/node-binary.sha256.txt"
if ! docker run --detach --name "$name" --privileged --cgroupns private --network none --memory 4g --memory-swap 4g --tmpfs /run --tmpfs /run/lock --tmpfs /tmp --env MCC_ARM64_DISPOSABLE=1 --env "MCC_ARM64_CANDIDATE_SHA=$MCC_ARM64_CANDIDATE_SHA" --env MCC_ARM64_CANDIDATE=/input/candidate --env MCC_ARM64_LEGACY=/input/legacy-source --env MCC_ARM64_EVIDENCE=/evidence --mount "type=bind,src=$MCC_ARM64_CANDIDATE,dst=/input/candidate,readonly" --mount "type=bind,src=$MCC_ARM64_LEGACY,dst=/input/legacy-source,readonly" --mount "type=bind,src=$MCC_ARM64_PACKAGE,dst=/input/package,readonly" --mount "type=bind,src=$evidence,dst=/evidence" "$image" > "$evidence/container-id.txt" 2>&1; then not_verified 'Private systemd container could not start'; exit 0; fi
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
