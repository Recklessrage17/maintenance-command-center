import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const envExample = read('deployment/raspberry-pi/mdns/mcc-mdns.env.example');
const installer = read('deployment/raspberry-pi/mdns/install-mcc-mdns');
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
assert.match(installer, /systemctl enable --now avahi-daemon\.service/, 'Avahi must survive reboot.');
assert.match(installer, /\/etc\/avahi\/hosts/, 'Canonical aliases must use Avahi\'s supported static-host mechanism.');
assert.match(installer, /hostname conflict:/, 'An existing different mDNS address must block installation.');
assert.match(installer, /ip -4 -o addr show dev/, 'Installer must verify the configured address belongs to the Pi interface.');
assert.match(installer, /systemctl restart avahi-daemon\.service/, 'Advertisement must reload after configuration.');
assert.doesNotMatch(installer, /hostnamectl|\/etc\/hostname/, 'MCC mDNS must not rename the mcc-server host.');
assert.doesNotMatch(installer + validator, /0\.0\.0\.0:(?:4273|4274)|http:\/\/10\.1\.2\.188:4274/, 'mDNS must never re-expose Node or replace the canonical HTTPS URL.');

for (const required of [
  /systemctl is-enabled --quiet avahi-daemon/,
  /systemctl is-active --quiet avahi-daemon/,
  /:5353/,
  /avahi-resolve-host-name -4/,
  /hostname conflict:/,
  /:80\$/,
  /:443\$/,
  /127\\\.0\\\.0\\\.1:\(4273\|4274\)/,
  /--cacert/,
  /--resolve/,
  /api\/health/,
]) assert.match(validator, required);
assert.doesNotMatch(validator, /curl[^\n]*(?:-k|--insecure)/, 'HTTPS validation must never bypass certificate checks.');

assert.match(service, /After=network-online\.target avahi-daemon\.service caddy\.service/);
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

console.log('MCC Avahi/mDNS deployment validation passed.');
