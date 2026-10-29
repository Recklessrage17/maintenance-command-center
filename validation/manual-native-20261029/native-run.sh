#!/bin/bash
set -Eeuo pipefail
umask 077
mkdir -p /evidence/home
export HOME=/evidence/home PYTHON=/harness/python-native-wrapper PYTHONPATH=/evidence/python
export XDG_CONFIG_HOME=/evidence/home/.config XDG_CACHE_HOME=/evidence/home/.cache
export MCC_PLAYWRIGHT_FRONTEND_ONLY=1 CI=true
test "$(uname -m)" = aarch64
test "$(node -p process.arch)" = arm64
test "$(node --version)" = v22.23.1
getent passwd "$(id -u)" > /evidence/runtime-identity.txt
test "$(getent passwd "$(id -u)" | cut -d: -f6)" = /evidence/home
. /etc/os-release; test "$VERSION_ID" = 13
libreoffice --version | grep -F '25.2.3.2'
dpkg-query -W > /evidence/debian-packages.txt
fc-list > /evidence/fonts.txt
node --version > /evidence/node-version.txt
for directory in . frontend backend; do
 npm ci --prefix "$directory" --include=dev --no-audit --no-fund > "/evidence/install-${directory//\//_}.log" 2>&1
done
python3 - <<'PY'
import pathlib,os,hashlib,json
root=pathlib.Path('/work/backend/node_modules');files={}
for directory,dirs,names in os.walk(root,followlinks=False):
    dirs[:]=[d for d in dirs if not (pathlib.Path(directory)/d).is_symlink()]
    for name in names:
        p=pathlib.Path(directory)/name
        if not p.is_symlink():files[p.relative_to(root).as_posix()]={'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
pathlib.Path('/evidence/backend-dependency-fingerprints.json').write_text(json.dumps(files,indent=2))
PY
python3 -m pip install --target "$PYTHONPATH" --no-cache-dir --only-binary=:all: --no-deps PyMuPDF==1.28.0 > /evidence/pdf-dependency.log 2>&1
npx --no-install playwright install chromium > /evidence/browser-install.log 2>&1
npm run build > /evidence/native-build.log 2>&1
node tests/backend-dependency-security-regression.mjs > /evidence/dependency-security.log 2>&1
set +e
npm run test:playwright -- tests/issue-208-api-regressions.spec.mts --grep requisition-status-api --project=desktop-chromium --workers=1 --forbid-only --retries=0 > /evidence/api.log 2>&1
api=$?
npm run test:playwright -- tests/issue-208-requisition-pdf.spec.mts tests/issue-208-comment-overflow.spec.mts tests/issue-208-comment-staging.spec.mts --project=desktop-chromium --workers=1 --forbid-only --retries=0 > /evidence/libreoffice-pdf.log 2>&1
pdf=$?
npm run test:playwright -- tests/issue-208-requisition-workflow.spec.mts --project=desktop-chromium --workers=1 --forbid-only --retries=0 > /evidence/native-workflows.log 2>&1
flows=$?
set -e
npm run test:playwright:cleanup > /evidence/cleanup.log 2>&1
test -z "$(find tmp/playwright-runs -mindepth 1 -maxdepth 1 -print -quit)"
cp -a diagnostics /evidence/diagnostics
printf '{"api_exit":%s,"pdf_exit":%s,"workflow_exit":%s,"source_tree":"db9b7b2bce37aa1a8c3b420de3227f1ed2c32669"}\n' "$api" "$pdf" "$flows" > /evidence/native-result.json
# Seal build outputs only after every native check passes. Source is unchanged.
if ((api==0&&pdf==0&&flows==0));then
 mkdir -p /evidence/reviewed-native-build
 for directory in frontend/dist backend/dist backend/templates shared;do
  mkdir -p "/evidence/reviewed-native-build/$(dirname "$directory")"
  cp -a "$directory" "/evidence/reviewed-native-build/$directory"
 done
 cp package.json package-lock.json /evidence/reviewed-native-build/
 for directory in backend frontend;do cp "$directory/package.json" "$directory/package-lock.json" "/evidence/reviewed-native-build/$directory/";done
 # Production dependency sealing and installation rehearsal remain separate.
 find /evidence/reviewed-native-build -type f -print0 | sort -z | xargs -0 sha256sum > /evidence/native-build-sha256.txt
fi
exit "$((api!=0||pdf!=0||flows!=0))"
