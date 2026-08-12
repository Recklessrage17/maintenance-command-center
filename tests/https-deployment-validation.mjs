import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

const caddyfile = read('deployment/raspberry-pi/https/Caddyfile');
const httpsEnvironment = read('deployment/raspberry-pi/https/mcc-https.env.example');
const caddyDropIn = read('deployment/raspberry-pi/https/caddy.service.d/mcc-https.conf');
const mccDropIn = read('deployment/raspberry-pi/https/mcc.service.d/https-loopback.conf');
const rootInstaller = read('deployment/raspberry-pi/https/Install-MccRootCA.ps1');
const clientCheck = read('deployment/raspberry-pi/https/Test-MccHttpsClient.ps1');
const piValidator = read('deployment/raspberry-pi/https/validate-mcc-https');
const backend = read('backend/src/server/index.ts');
const updater = read('deployment/raspberry-pi/update-mcc');
const documentation = read('docs/raspberry-pi-https.md');

assert.match(caddyfile, /admin off/, 'Caddy local admin API must remain disabled.');
assert.match(caddyfile, /\{\$MCC_HTTPS_HOSTNAME:mcc\.local\}/, 'Caddy hostname must come from deployment-owned configuration.');
assert.match(caddyfile, /tls internal/, 'The .local deployment must use the managed internal CA.');
assert.match(caddyfile, /reverse_proxy \{\$MCC_HTTPS_UPSTREAM:127\.0\.0\.1:4273\}/, 'Caddy upstream must default to the production loopback port.');
assert.doesNotMatch(caddyfile, /tls_insecure_skip_verify|auto_https\s+off|disable_redirects/, 'HTTPS configuration must not weaken TLS or redirects.');

assert.match(httpsEnvironment, /^MCC_HTTPS_HOSTNAME=mcc\.local$/m);
assert.match(httpsEnvironment, /^MCC_HTTPS_UPSTREAM=127\.0\.0\.1:4273$/m);
assert.doesNotMatch(httpsEnvironment, /^MCC_HTTPS_UPSTREAM=(?!127\.0\.0\.1:)/m, 'Example upstream must remain on IPv4 loopback.');
assert.match(caddyDropIn, /^EnvironmentFile=\/etc\/mcc-https\.env$/m);
assert.match(mccDropIn, /^Environment=MCC_BIND_HOST=127\.0\.0\.1$/m);

assert.match(backend, /app\.set\('trust proxy', 'loopback'\)/, 'Express must trust proxy headers only from loopback.');
assert.match(backend, /app\.listen\(port,bindHost,/, 'The backend must honor the configured bind host.');
assert.match(updater, /readonly HEALTH_URL="http:\/\/127\.0\.0\.1:4273\/"/, 'Updater health must remain independent on loopback HTTP.');

assert.match(rootInstaller, /ComputeHash\(\$certificate\.RawData\)/, 'CA installer must calculate the certificate SHA-256 fingerprint.');
assert.match(rootInstaller, /StoreLocation\]::LocalMachine/, 'CA trust must be machine-wide for managed Windows clients.');
assert.match(rootInstaller, /CertificateAuthority/, 'CA installer must reject non-CA certificates.');
assert.doesNotMatch(rootInstaller + clientCheck, /DangerousAcceptAnyServerCertificateValidator|ServerCertificateCustomValidationCallback|--insecure|-k\b/, 'Client tooling must never bypass certificate validation.');
assert.match(clientCheck, /https:\/\/\$Hostname\/api\/health/, 'Client verification must exercise the HTTPS health route.');
assert.match(clientCheck, /301, 302, 307, 308/, 'Client verification must require an HTTP redirect.');
assert.match(piValidator, /MCC_HTTPS_HOSTNAME.*\\\.local/, 'Pi validator must require the supported .local trust model.');
assert.match(piValidator, /127\\\.0\\\.0\\\.1:\(4273\|4274\)/, 'Pi validator must reject non-loopback or unexpected upstreams.');
assert.match(piValidator, /root:root:644/, 'Pi validator must reject writable or incorrectly owned deployment configuration.');
assert.match(piValidator, /caddy validate/, 'Pi validator must invoke Caddy configuration validation.');

for (const heading of ['Certificate trust', 'Renewal and monitoring', 'Backup and recovery', 'Staging deployment', 'Production deployment']) {
  assert.ok(documentation.includes(`## ${heading}`), `HTTPS runbook is missing the ${heading} section.`);
}

console.log('Raspberry Pi HTTPS deployment validation passed.');
