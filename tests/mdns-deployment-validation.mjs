import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const read = path => fs.readFileSync(path, 'utf8');
const envExample = read('deployment/raspberry-pi/mdns/mcc-mdns.env.example');
const installer = read('deployment/raspberry-pi/mdns/install-mcc-mdns');
const publisher = read('deployment/raspberry-pi/mdns/publish-mcc-mdns');
const publisherService = read('deployment/raspberry-pi/mdns/mcc-mdns-publisher.service');
const httpsMigrator = read('deployment/raspberry-pi/mdns/migrate-mcc-https-env');
const validator = read('deployment/raspberry-pi/mdns/validate-mcc-network');
const service = read('deployment/raspberry-pi/mdns/mcc-network-validation.service');
const timer = read('deployment/raspberry-pi/mdns/mcc-network-validation.timer');
const windowsClient = read('deployment/raspberry-pi/mdns/Test-MccWindowsLanClient.ps1');
const caddyfile = read('deployment/raspberry-pi/https/Caddyfile');
const rootExporter = read('deployment/raspberry-pi/https/export-mcc-root-onboarding');
const onboarding = read('deployment/raspberry-pi/https/mcc-onboarding-http.caddy.example');
const docs = read('docs/raspberry-pi-https.md');

assert.match(envExample, /^MCC_MDNS_HOSTNAME=mcc-stage\.local$/m);
assert.match(envExample, /^MCC_MDNS_ADDRESS=10\.1\.2\.188$/m);
assert.match(envExample, /^MCC_MDNS_INTERFACE=wlan0$/m);
assert.match(envExample, /Production uses mcc\.local/, 'The same deployment mechanism must support the production alias.');

assert.match(installer, /dpkg-query[\s\S]*avahi-daemon/, 'Installer must require the supported Avahi package.');
assert.match(installer, /avahi-publish-address --help[\s\S]*--no-reverse/, 'Installer must verify the deployed Avahi build supports no-reverse publication.');
assert.match(installer, /systemctl enable --now avahi-daemon\.service/, 'Avahi must survive reboot.');
assert.match(installer, /render_avahi_hosts_without_alias/, 'Installer must migrate the obsolete static alias.');
assert.match(installer, /mcc-avahi-hosts\.preinstall/, 'Installer must retain the existing Avahi recovery backup.');
assert.match(installer, /migrate-mcc-https-env/, 'Installer must migrate older HTTPS environments before validation.');
assert.match(installer, /systemctl enable --now "\$\{PUBLISHER_SERVICE\}"/, 'The alias publisher must survive reboot.');
assert.match(installer, /ip -4 -o addr show dev/, 'Installer must verify the configured address belongs to the Pi interface.');
assert.doesNotMatch(installer, /hostnamectl|\/etc\/hostname/, 'MCC mDNS must not rename the mcc-server host.');
assert.doesNotMatch(installer + validator, /0\.0\.0\.0:(?:4273|4274)|http:\/\/10\.1\.2\.188:4274/, 'mDNS must never re-expose Node or replace the canonical HTTPS URL.');

assert.match(publisher, /avahi-publish-address[\s\S]*--no-reverse --no-fail/, 'Alias publication must suppress the reverse PTR and reconnect after Avahi restarts.');
assert.match(publisher, /external hostname collision:/, 'Publisher must reject an external address using the canonical hostname.');
assert.match(publisher, /Name collision, picking new name/, 'Publisher must detect Avahi automatic collision renaming.');
assert.match(publisher, /refusing Avahi's automatically renamed alias/, 'A suffixed alias must be fatal.');
assert.match(publisher, /Established under name '\$\{hostname\}'/, 'Publisher readiness must require the exact configured name.');
assert.match(publisher, /systemd-notify --pid=parent --ready/, 'The helper must explicitly attribute readiness to its main wrapper parent.');
assert.ok(
  publisher.indexOf('if check_exact_resolution; then') < publisher.indexOf('systemd-notify --pid=parent --ready'),
  'READY=1 must be sent only after exact-name resolution succeeds.',
);
assert.match(publisher, /MCC_MDNS_ADDRESS contains an invalid IPv4 octet/);
assert.match(publisher, /MCC_MDNS_INTERFACE contains unsupported characters/);
assert.match(publisher, /ip link show dev "\$\{interface\}"/);

assert.match(publisherService, /Requires=avahi-daemon\.service/);
assert.match(publisherService, /After=network-online\.target avahi-daemon\.service/);
assert.match(publisherService, /Type=notify/);
assert.match(publisherService, /NotifyAccess=all/, 'The systemd-notify child must be authorized to send readiness from the service cgroup.');
assert.doesNotMatch(publisherService, /NotifyAccess=main/, 'NotifyAccess=main rejects the capability-restricted systemd-notify child.');
assert.match(publisherService, /ExecStart=\/usr\/local\/sbin\/publish-mcc-mdns/);
assert.match(publisherService, /Restart=on-failure/);
assert.match(publisherService, /RestartPreventExitStatus=78/, 'A real exact-name collision must stop instead of looping on suffixed aliases.');
assert.match(publisherService, /WantedBy=multi-user\.target/);
assert.match(publisherService, /User=root/);
assert.match(publisherService, /^CapabilityBoundingSet=$/m, 'Publisher must not gain CAP_SYS_ADMIN merely to impersonate the main PID.');

// Model the capability-restricted Bookworm path: systemd-notify cannot forge
// the Bash parent's SCM_CREDENTIALS, so PID 1 sees the short-lived helper as
// sender. NotifyAccess=all is the narrowest supported mode that accepts a
// service-cgroup child; --pid=parent keeps MAINPID attributed to the wrapper.
const notifyAccess = publisherService.match(/^NotifyAccess=(\w+)$/m)?.[1];
const timeoutStartMs = Number(publisherService.match(/^TimeoutStartSec=(\d+)s$/m)?.[1]) * 1000;
const wrapperMainPid = 100;
const notifyHelperPid = 102;
const publisherPid = 101;
const serviceCgroupPids = new Set([wrapperMainPid, publisherPid, notifyHelperPid]);
const notificationAccepted = access => access === 'all' && serviceCgroupPids.has(notifyHelperPid);
const simulateEstablishedAlias = access => {
  let state = 'activating';
  const establishedAtMs = 1000;
  const exactResolutionSucceeded = true;
  const parentPidWasExplicit = /systemd-notify --pid=parent --ready/.test(publisher);
  if (exactResolutionSucceeded && parentPidWasExplicit && notificationAccepted(access)) state = 'active';
  return { state, elapsedMs: state === 'active' ? establishedAtMs : timeoutStartMs };
};
assert.deepEqual(
  simulateEstablishedAlias(notifyAccess),
  { state: 'active', elapsedMs: 1000 },
  'An exactly resolved established alias must transition the unit to active before TimeoutStartSec.',
);
assert.deepEqual(
  simulateEstablishedAlias('main'),
  { state: 'activating', elapsedMs: timeoutStartMs },
  'Regression guard: the former NotifyAccess=main path must reproduce activation timeout in the model.',
);

assert.match(httpsMigrator, /MCC_HTTPS_MODE:-/, 'Migration must tolerate an older file with no mode.');
assert.match(httpsMigrator, /mode="internal"/, 'A .local older environment must migrate to internal mode.');
assert.match(httpsMigrator, /mcc-tls-internal\.caddy/);
assert.match(httpsMigrator, /mcc-onboarding-disabled\.caddy/);
assert.match(httpsMigrator, /mcc-https\.env\.pre-mdns-migration/, 'Migration must retain a first-upgrade recovery copy.');
assert.match(httpsMigrator, /hostname="\$\{hostname\}"[\s\S]*upstream="\$\{upstream\}"/, 'Migration must carry forward deployment-specific hostname and upstream values.');

for (const required of [
  /systemctl is-enabled --quiet avahi-daemon/,
  /systemctl is-active --quiet avahi-daemon/,
  /systemctl is-enabled --quiet "\$\{PUBLISHER_SERVICE\}"/,
  /systemctl is-active --quiet "\$\{PUBLISHER_SERVICE\}"/,
  /:5353/,
  /avahi-resolve-host-name -4/,
  /hostname conflict:/,
  /avahi-resolve-address/,
  /reverse identity changed:/,
  /--no-reverse/,
  /:80\$/,
  /:443\$/,
  /127\\\.0\\\.0\\\.1:\(4273\|4274\)/,
  /--cacert/,
  /--resolve/,
  /api\/health/,
]) assert.match(validator, required);
assert.doesNotMatch(validator, /curl[^\n]*(?:-k|--insecure)/, 'HTTPS validation must never bypass certificate checks.');
assert.match(validator, /MCC_HTTPS_MODE MCC_HTTPS_HOSTNAME MCC_HTTPS_TLS_CONFIG MCC_HTTPS_ONBOARDING_CONFIG MCC_HTTPS_UPSTREAM/);
assert.ok(
  validator.indexOf('for required_variable in MCC_HTTPS_MODE') < validator.indexOf('https_mode="${MCC_HTTPS_MODE,,}"'),
  'Validator must check missing HTTPS variables before dereferencing them under set -u.',
);

assert.match(service, /After=network-online\.target avahi-daemon\.service mcc-mdns-publisher\.service caddy\.service/);
assert.match(service, /ExecStart=\/usr\/local\/sbin\/validate-mcc-network/);
assert.match(timer, /OnBootSec=1min/);
assert.match(timer, /OnUnitActiveSec=5min/);
assert.match(timer, /Persistent=true/);

assert.match(windowsClient, /RequireNoHostsOverride/, 'Second-PC acceptance must reject a hosts-file crutch.');
assert.match(windowsClient, /System32\\drivers\\etc\\hosts/);
assert.match(windowsClient, /foreach \(\$proxyPort in 80, 443\)/);
assert.match(windowsClient, /Node TCP \$NodePort is reachable from the LAN/);
assert.match(windowsClient, /https:\/\/\$Hostname\/api\/health/);
assert.doesNotMatch(windowsClient, /DangerousAcceptAnyServerCertificateValidator|ServerCertificateCustomValidationCallback|--insecure|-k\b/);

assert.match(caddyfile, /import \{\$MCC_HTTPS_ONBOARDING_CONFIG:\/etc\/caddy\/mcc-onboarding-disabled\.caddy\}/);
assert.match(onboarding, /^http:\/\/\{\$MCC_ONBOARDING_IP\}/m);
assert.match(onboarding, /@root_ca path \/mcc-root-ca\.crt/);
assert.match(onboarding, /respond "Not found" 404/);
assert.doesNotMatch(onboarding, /reverse_proxy/, 'IP onboarding must never expose Node or the MCC app.');
assert.match(rootExporter, /root\.crt/);
assert.match(rootExporter, /CA:TRUE/);
assert.match(rootExporter, /private root\.key was not copied/);
assert.doesNotMatch(rootExporter, /install[^\n]*root\.key|cp[^\n]*root\.key/);

for (const heading of ['mDNS and .local deployment', 'Internal-CA client onboarding', 'Windows second-PC onboarding', 'iPhone and iPad onboarding', 'Android onboarding', 'mDNS recovery and conflicts']) {
  assert.ok(docs.includes(`## ${heading}`), `Runbook is missing ${heading}.`);
}

const bash = process.platform === 'win32'
  ? 'C:/Program Files/Git/bin/bash.exe'
  : 'bash';
const bashAvailable = spawnSync(bash, ['--version'], { encoding: 'utf8' }).status === 0;
if (bashAvailable) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-mdns-test-'));
  const posixPath = value => value.replaceAll('\\', '/');
  const migrationScript = posixPath(path.resolve('deployment/raspberry-pi/mdns/migrate-mcc-https-env'));
  const installerScript = posixPath(path.resolve('deployment/raspberry-pi/mdns/install-mcc-mdns'));
  const renderMigration = contents => {
    const fixture = path.join(tempDir, `https-${Math.random().toString(16).slice(2)}.env`);
    fs.writeFileSync(fixture, contents);
    const result = spawnSync(bash, [migrationScript, '--render', posixPath(fixture)], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  try {
    const oldStaging = renderMigration('MCC_HTTPS_HOSTNAME=mcc-stage.local\nMCC_HTTPS_UPSTREAM=127.0.0.1:4274\n');
    assert.match(oldStaging, /^MCC_HTTPS_MODE=internal$/m);
    assert.match(oldStaging, /^MCC_HTTPS_HOSTNAME=mcc-stage\.local$/m);
    assert.match(oldStaging, /^MCC_HTTPS_TLS_CONFIG=\/etc\/caddy\/mcc-tls-internal\.caddy$/m);
    assert.match(oldStaging, /^MCC_HTTPS_ONBOARDING_CONFIG=\/etc\/caddy\/mcc-onboarding-disabled\.caddy$/m);
    assert.match(oldStaging, /^MCC_HTTPS_UPSTREAM=127\.0\.0\.1:4274$/m);

    const oldProduction = renderMigration('MCC_HTTPS_HOSTNAME=mcc.local\nMCC_HTTPS_UPSTREAM=127.0.0.1:4273\n');
    assert.match(oldProduction, /^MCC_HTTPS_MODE=internal$/m);
    assert.match(oldProduction, /^MCC_HTTPS_HOSTNAME=mcc\.local$/m);
    assert.match(oldProduction, /^MCC_HTTPS_UPSTREAM=127\.0\.0\.1:4273$/m);

    const currentEnvironment = [
      'MCC_HTTPS_MODE=internal',
      'MCC_HTTPS_HOSTNAME=mcc-stage.local',
      'MCC_HTTPS_TLS_CONFIG=/etc/caddy/mcc-tls-internal.caddy',
      'MCC_HTTPS_ONBOARDING_CONFIG=/etc/caddy/mcc-onboarding-disabled.caddy',
      'MCC_HTTPS_UPSTREAM=127.0.0.1:4274',
      '',
    ].join('\n');
    assert.equal(renderMigration(currentEnvironment), currentEnvironment, 'Fresh/current deployment rendering must be idempotent.');

    const invalidPublicFixture = path.join(tempDir, 'ambiguous-public.env');
    fs.writeFileSync(invalidPublicFixture, 'MCC_HTTPS_HOSTNAME=mcc.example.com\nMCC_HTTPS_UPSTREAM=127.0.0.1:4273\n');
    const invalidPublic = spawnSync(bash, [migrationScript, '--render', posixPath(invalidPublicFixture)], { encoding: 'utf8' });
    assert.notEqual(invalidPublic.status, 0, 'Migration must not guess certificate mode for a non-.local deployment.');
    assert.match(invalidPublic.stderr, /cannot infer MCC_HTTPS_MODE/);

    const exposedNodeFixture = path.join(tempDir, 'exposed-node.env');
    fs.writeFileSync(exposedNodeFixture, 'MCC_HTTPS_HOSTNAME=mcc-stage.local\nMCC_HTTPS_UPSTREAM=0.0.0.0:4274\n');
    const exposedNode = spawnSync(bash, [migrationScript, '--render', posixPath(exposedNodeFixture)], { encoding: 'utf8' });
    assert.notEqual(exposedNode.status, 0, 'Migration must reject a LAN-exposed Node upstream.');
    assert.match(exposedNode.stderr, /must remain loopback-only/);

    const duplicateFixture = path.join(tempDir, 'duplicate.env');
    fs.writeFileSync(duplicateFixture, 'MCC_HTTPS_HOSTNAME=mcc.local\nMCC_HTTPS_HOSTNAME=mcc-stage.local\nMCC_HTTPS_UPSTREAM=127.0.0.1:4274\n');
    const duplicate = spawnSync(bash, [migrationScript, '--render', posixPath(duplicateFixture)], { encoding: 'utf8' });
    assert.notEqual(duplicate.status, 0, 'Migration must reject duplicate managed assignments.');
    assert.match(duplicate.stderr, /duplicate MCC_HTTPS_HOSTNAME/);

    const avahiFixture = path.join(tempDir, 'avahi.hosts');
    fs.writeFileSync(avahiFixture, [
      '# unrelated entries stay byte-for-byte where possible',
      '10.1.2.50 printer.local',
      '10.1.2.188 mcc-stage.local',
      '10.1.2.60 scanner.local mcc-stage.local backup-scanner.local # keep aliases',
      '10.1.2.70 other.local # mention mcc-stage.local only in a comment',
      '',
    ].join('\n'));
    const migratedHosts = spawnSync(
      bash,
      [installerScript, '--render-avahi-hosts', posixPath(avahiFixture), 'mcc-stage.local'],
      { encoding: 'utf8' },
    );
    assert.equal(migratedHosts.status, 0, migratedHosts.stderr);
    assert.doesNotMatch(migratedHosts.stdout, /^10\.1\.2\.188 mcc-stage\.local$/m);
    assert.match(migratedHosts.stdout, /^10\.1\.2\.50 printer\.local$/m);
    assert.match(migratedHosts.stdout, /^10\.1\.2\.60 scanner\.local backup-scanner\.local # keep aliases$/m);
    assert.match(migratedHosts.stdout, /^10\.1\.2\.70 other\.local # mention mcc-stage\.local only in a comment$/m);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

console.log('MCC Avahi/mDNS deployment validation passed.');
