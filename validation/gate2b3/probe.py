"""Capability inventory only. No installation, service start, build or recovery."""
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
APPROVED = 'c69f8cb6c63922c4f415eacf8ee28e7c056a0a1e'
BRANCH = 'codex/gate2b3-capability-20261027-af16222b'
FILES = ('.github/workflows/gate2b3-capability.yml', 'validation/gate2b3/probe.py',
         'validation/gate2b3/run.mjs', 'validation/gate2b3/tooling-inputs.json')
BASE = 'scripts/playwright-storage.mjs'
TOOLS = ('python3', 'git', 'systemctl', 'systemd-run', 'unshare', 'findmnt', 'mount',
         'losetup', 'mkfs.ext4', 'flock', 'make', 'gcc', 'g++', 'tar', 'xz', 'sudo')
ASSURANCE = dict.fromkeys(('nativeBuildExecuted', 'offlineInstallExecuted', 'workerIsolationVerified',
                          'serviceTestsExecuted', 'debianPiCompatibilityVerified',
                          'outboundNetworkIsolationEnforced', 'gate2Accepted'), False)


class Rejected(Exception):
    pass


def validate(value, schema, depth=0):
    """Closed JSON-schema subset; every object has an exact property set."""
    if depth > 20:
        raise Rejected()
    types = {'object': dict, 'array': list, 'string': str, 'integer': int, 'boolean': bool, 'null': type(None)}
    allowed = schema['type'] if isinstance(schema['type'], list) else [schema['type']]
    if not any(type(value) is types[t] for t in allowed):
        raise Rejected()
    if 'enum' in schema and value not in schema['enum']:
        raise Rejected()
    if type(value) is dict:
        if set(value) != set(schema['properties']) or schema.get('additionalProperties') is not False:
            raise Rejected()
        for key, child in value.items():
            validate(child, schema['properties'][key], depth + 1)
    elif type(value) is list:
        if len(value) > schema['maxItems'] or len({json.dumps(v, sort_keys=True) for v in value}) != len(value):
            raise Rejected()
        for child in value:
            validate(child, schema['items'], depth + 1)
    elif type(value) is str:
        if len(value) > schema['maxLength'] or ('pattern' in schema and not re.fullmatch(schema['pattern'], value)):
            raise Rejected()
    elif type(value) is int and not schema['minimum'] <= value <= schema['maximum']:
        raise Rejected()


def safe_file(root, name):
    current = root
    for part in name.split('/'):
        current = current / part
        if current.is_symlink():
            raise Rejected()
    if not current.is_file() or not current.resolve().is_relative_to(root.resolve()):
        raise Rejected()
    return current


def inputs(root=ROOT):
    lock = json.loads(safe_file(root, FILES[3]).read_text())
    if set(lock) != {'schemaVersion', 'mode', 'approvedBaseSha', 'stagingBranch', 'publicationFiles',
                     'baseDependencies', 'packageSha256', 'inventorySchema', 'resultSchema'}:
        raise Rejected()
    if lock['schemaVersion'] != 2 or lock['mode'] != 'capability-only' or lock['approvedBaseSha'] != APPROVED or lock['stagingBranch'] != BRANCH or lock['publicationFiles'] != list(FILES):
        raise Rejected()
    if set(lock['baseDependencies']) != {BASE} or set(lock['packageSha256']) != set(FILES[:3]):
        raise Rejected()
    for name, digest in {**lock['baseDependencies'], **lock['packageSha256']}.items():
        if not re.fullmatch('[0-9a-f]{64}', digest) or hashlib.sha256(safe_file(root, name).read_bytes()).hexdigest() != digest:
            raise Rejected()
    return lock


def verify_facts(head, parents, changes, modes, event):
    """Pure admission check, tested without creating any Git commits."""
    expected = {'repository': 'Recklessrage17/maintenance-command-center', 'ref': 'refs/heads/' + BRANCH,
                'event': 'push', 'created': 'true', 'deleted': 'false', 'attempt': '1', 'sha': head}
    if event != expected or not re.fullmatch('[0-9a-f]{40}', head) or parents != [APPROVED]:
        raise Rejected()
    if sorted(changes) != sorted(('A', name) for name in FILES):
        raise Rejected()
    if sorted(modes) != sorted(('100644', 'blob', name) for name in FILES):
        raise Rejected()


def verify_source(root=ROOT):
    def git(*args):
        result = subprocess.run(['git', '--no-optional-locks', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
                                 '-C', str(root), *args], capture_output=True, timeout=10, check=True)
        if len(result.stdout) > 16384:
            raise Rejected()
        return result.stdout.decode('utf-8')
    head = git('rev-parse', 'HEAD').strip()
    parents = git('show', '-s', '--format=%P', 'HEAD').strip().split()
    fields = git('diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-status', '-z', APPROVED, 'HEAD').split('\0')
    if fields[-1] != '' or len(fields) % 2 != 1:
        raise Rejected()
    changes = list(zip(fields[:-1:2], fields[1:-1:2]))
    modes = []
    for record in git('ls-tree', '-r', '-z', 'HEAD', '--', *FILES).split('\0'):
        if record:
            metadata, name = record.split('\t')
            mode, kind, _ = metadata.split()
            modes.append((mode, kind, name))
    event = {key: os.environ.get(variable) for key, variable in {
        'repository': 'GITHUB_REPOSITORY', 'ref': 'GITHUB_REF', 'event': 'GITHUB_EVENT_NAME',
        'created': 'MCC_EVENT_CREATED', 'deleted': 'MCC_EVENT_DELETED',
        'attempt': 'GITHUB_RUN_ATTEMPT', 'sha': 'GITHUB_SHA'}.items()}
    verify_facts(head, parents, changes, modes, event)
    if git('status', '--porcelain', '--untracked-files=no').strip():
        raise Rejected()
    inputs(root)


def executable(raw, name):
    if raw is None:
        return None
    resolved = str(Path(raw).resolve())
    ordinary = r'/usr/(?:bin|sbin|local/bin|local/sbin)/[a-zA-Z0-9.+-]+'
    hosted = r'/opt/hostedtoolcache/node/[0-9]+\.[0-9]+\.[0-9]+/(?:arm64|x64)/(?:bin/node|lib/node_modules/npm/bin/npm-cli\.js)'
    npm = r'/usr/(?:local/lib/node_modules|share/nodejs)/npm/bin/npm-cli\.js'
    if name == 'node':
        ordinary = r'/usr/(?:bin|local/bin)/(?:node|nodejs)'
    elif name == 'npm':
        ordinary = r'/usr/(?:bin|local/bin)/npm'
    if not re.fullmatch(ordinary, resolved) and not (name in {'node', 'npm'} and re.fullmatch(hosted, resolved)) and not (name == 'npm' and re.fullmatch(npm, resolved)):
        raise Rejected()
    return resolved


def command(name, *args, codes=(0,)):
    filename = executable(shutil.which(name), name)
    if filename is None:
        return None
    result = subprocess.run([filename, *args], capture_output=True, text=True, timeout=5)
    if result.returncode not in codes or len(result.stdout) > 8192:
        raise Rejected()
    return result.returncode, result.stdout.strip()


def read(filename):
    try:
        with open(filename) as handle:
            return handle.read(16384).strip()
    except FileNotFoundError:
        return None


def collect(runtime):
    linux = sys.platform == 'linux'
    machine = platform.machine().lower()
    architecture = 'arm64' if machine in {'aarch64', 'arm64'} else 'x64' if machine in {'x86_64', 'amd64'} else 'other'
    tools = {name: bool(executable(shutil.which(name), name)) if linux else False for name in TOOLS}
    node, npm = {'version': None, 'executable': None}, {'version': None, 'executable': None}
    if linux:
        for name, target in [('node', node), ('npm', npm)]:
            target['executable'] = executable(shutil.which(name), name)
            result = command(name, '--version')
            if result:
                if not re.fullmatch(r'v?[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}', result[1]):
                    raise Rejected()
                target['version'] = result[1]
    version, state, bus = None, 'unavailable', None
    pid1 = linux and read('/proc/1/comm') == 'systemd'
    if linux and tools['systemctl']:
        result = command('systemctl', '--version')
        match = re.match(r'^systemd ([0-9]{1,4})(?:\s|$)', result[1])
        if not match:
            raise Rejected()
        version = int(match[1])
        if pid1:
            result = command('systemctl', 'is-system-running', codes=(0, 1))
            if result[1] not in {'running', 'degraded', 'starting', 'maintenance', 'initializing', 'stopping', 'offline', 'unknown'}:
                raise Rejected()
            state, bus = result[1], result[1] not in {'offline', 'unknown'}
    sudo = command('sudo', '-n', 'true', codes=(0, 1)) if linux and tools['sudo'] else None
    namespace = {name: linux and Path('/proc/self/ns/' + name).exists() for name in ('mnt', 'net', 'user')}
    fields = dict(line.split(':', 1) for line in (read('/proc/self/status') or '').splitlines() if ':' in line) if linux else {}
    controllers = (read('/sys/fs/cgroup/cgroup.controllers') or '').split() if linux else []
    account = {'present': False, 'nonRoot': None, 'primaryGroupMatches': None, 'supplementaryGroupsRestricted': None, 'loginDisabled': None}
    if linux:
        import grp
        import pwd
        try:
            user, group = pwd.getpwnam('mcc-build'), grp.getgrnam('mcc-build')
            account = {'present': True, 'nonRoot': user.pw_uid != 0 and group.gr_gid != 0,
                       'primaryGroupMatches': user.pw_gid == group.gr_gid,
                       'supplementaryGroupsRestricted': set(os.getgrouplist(user.pw_name, user.pw_gid)) == {group.gr_gid},
                       'loginDisabled': user.pw_shell in {'/usr/sbin/nologin', '/sbin/nologin', '/bin/false'}}
        except KeyError:
            pass
    filesystem, readonly = 'unknown', None
    if linux and tools['findmnt']:
        result = command('findmnt', '-n', '-o', 'FSTYPE,OPTIONS', '--target', str(runtime))
        parts = result[1].split()
        if len(parts) != 2:
            raise Rejected()
        filesystem = parts[0] if parts[0] in {'ext4', 'xfs', 'overlay', 'btrfs', 'tmpfs'} else 'other'
        readonly = 'ro' in parts[1].split(',')
    space = os.statvfs(runtime) if linux else None
    def numeric(name):
        return int(fields[name]) if name in fields else None
    return {'os': 'linux' if linux else 'windows' if sys.platform == 'win32' else 'other',
            'architecture': architecture, 'node': node, 'npm': npm,
            'systemd': {'present': tools['systemctl'], 'version': version, 'pid1': bool(pid1),
                        'systemBusAccessible': bus, 'managerState': state, 'sudoNoninteractive': sudo[0] == 0 if sudo else None},
            'namespaces': {'mountAvailable': namespace['mnt'], 'networkAvailable': namespace['net'], 'userAvailable': namespace['user'],
                           'seccompMode': numeric('Seccomp'), 'noNewPrivileges': bool(numeric('NoNewPrivs')) if 'NoNewPrivs' in fields else None},
            'cgroup': {'v2': linux and Path('/sys/fs/cgroup/cgroup.controllers').is_file(),
                       'cpu': 'cpu' in controllers, 'memory': 'memory' in controllers, 'pids': 'pids' in controllers,
                       'writableByRunner': os.access('/sys/fs/cgroup', os.W_OK) if linux else None},
            'filesystem': {'type': filesystem, 'readOnly': readonly, 'freeBytes': shutil.disk_usage(runtime).free,
                           'freeInodes': space.f_favail if space else None}, 'account': account, 'tools': tools,
            'offlineInputs': {'reviewedRootfsSupplied': False, 'reviewedCacheSupplied': False, 'cacheCompletenessVerified': False, 'missingPackagesKnown': False}}


def inventory(observed):
    blockers = ['reviewed_rootfs_not_supplied', 'reviewed_offline_cache_not_supplied']
    checks = [(observed['os'] == 'linux' and observed['architecture'] == 'arm64', 'native_linux_arm64_required'),
              (observed['node']['version'] == 'v22.23.1', 'target_node_missing_or_different'),
              (observed['npm']['version'] == '10.9.8', 'target_npm_missing_or_different'),
              (observed['systemd']['pid1'], 'systemd_pid1_required'),
              (observed['systemd']['systemBusAccessible'] is True, 'system_bus_unavailable'),
              (all(observed['cgroup'][key] for key in ('v2', 'cpu', 'memory', 'pids')), 'cgroup_requirements_missing'),
              (observed['account']['present'], 'worker_account_unavailable'),
              (all(value is True for value in observed['account'].values()), 'worker_identity_unproved'),
              (all(observed['tools'].values()), 'required_tooling_missing'),
              (all(observed['namespaces'][key] for key in ('mountAvailable', 'networkAvailable', 'userAvailable')), 'namespace_prerequisites_missing')]
    blockers.extend(code for passed, code in checks if not passed)
    return {'schemaVersion': 1, 'mode': 'capability-only', 'approvedBaseSha': APPROVED,
            'status': 'INVENTORY_COMPLETE', 'observed': observed, 'blockers': blockers,
            'errorCode': None, 'assurance': ASSURANCE}


def failure():
    return {'schemaVersion': 1, 'mode': 'capability-only', 'approvedBaseSha': APPROVED,
            'status': 'INVENTORY_FAILED', 'observed': None, 'blockers': ['probe_failed'],
            'errorCode': 'PROBE_FAILED', 'assurance': ASSURANCE}


def main():
    if sys.argv[1:] == ['--verify-source']:
        try:
            verify_source()
            print('Approved-base capability package verified.')
            return 0
        except Exception:
            print('Capability source validation rejected.')
            return 1
    if sys.argv[1:] != ['--inventory']:
        return 1
    try:
        lock = inputs()
        observed = collect(Path(os.environ['MCC_GATE2B3_RUNTIME']))
        result = inventory(observed)
        validate(result, lock['inventorySchema'])
        print(json.dumps(result, separators=(',', ':')))
        return 0
    except Exception:
        print(json.dumps(failure(), separators=(',', ':')))
        return 1


if __name__ == '__main__':
    sys.exit(main())
