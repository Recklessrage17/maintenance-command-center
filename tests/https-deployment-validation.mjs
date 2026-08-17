import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

const caddyfile = read('deployment/raspberry-pi/https/Caddyfile');
const httpsEnvironment = read('deployment/raspberry-pi/https/mcc-https.env.example');
const publicHttpsEnvironment = read('deployment/raspberry-pi/https/mcc-https-public.env.example');
const internalTls = read('deployment/raspberry-pi/https/mcc-tls-internal.caddy');
const publicDnsTls = read('deployment/raspberry-pi/https/mcc-tls-public-dns.caddy.example');
const dnsEnvironment = read('deployment/raspberry-pi/https/mcc-https-dns.env.example');
const onboardingDisabled = read('deployment/raspberry-pi/https/mcc-onboarding-disabled.caddy');
const onboardingHttp = read('deployment/raspberry-pi/https/mcc-onboarding-http.caddy.example');
const rootExporter = read('deployment/raspberry-pi/https/export-mcc-root-onboarding');
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
assert.match(caddyfile, /import \{\$MCC_HTTPS_TLS_CONFIG:\/etc\/caddy\/mcc-tls-internal\.caddy\}/, 'Caddy must import the selected root-owned TLS mode.');
assert.match(caddyfile, /reverse_proxy \{\$MCC_HTTPS_UPSTREAM:127\.0\.0\.1:4273\}/, 'Caddy upstream must default to the production loopback port.');
assert.match(caddyfile, /import \{\$MCC_HTTPS_ONBOARDING_CONFIG:\/etc\/caddy\/mcc-onboarding-disabled\.caddy\}/, 'LAN-IP certificate onboarding must be explicitly selected.');
assert.doesNotMatch(caddyfile, /tls_insecure_skip_verify|auto_https\s+off|disable_redirects/, 'HTTPS configuration must not weaken TLS or redirects.');

assert.match(httpsEnvironment, /^MCC_HTTPS_MODE=internal$/m);
assert.match(httpsEnvironment, /^MCC_HTTPS_HOSTNAME=mcc\.local$/m);
assert.match(httpsEnvironment, /^MCC_HTTPS_TLS_CONFIG=\/etc\/caddy\/mcc-tls-internal\.caddy$/m);
assert.match(httpsEnvironment, /^MCC_HTTPS_ONBOARDING_CONFIG=\/etc\/caddy\/mcc-onboarding-disabled\.caddy$/m);
assert.match(httpsEnvironment, /^MCC_HTTPS_UPSTREAM=127\.0\.0\.1:4273$/m);
assert.doesNotMatch(httpsEnvironment, /^MCC_HTTPS_UPSTREAM=(?!127\.0\.0\.1:)/m, 'Example upstream must remain on IPv4 loopback.');
assert.match(internalTls, /^tls internal$/m, 'The .local fallback must use Caddy\'s managed internal CA.');

assert.match(publicHttpsEnvironment, /^MCC_HTTPS_MODE=public$/m);
assert.match(publicHttpsEnvironment, /^MCC_HTTPS_HOSTNAME=mcc\.example$/m, 'Public template must use a reserved placeholder, never a guessed company domain.');
assert.match(publicHttpsEnvironment, /^MCC_HTTPS_TLS_CONFIG=\/etc\/caddy\/mcc-tls-public-dns\.caddy$/m);
assert.match(publicHttpsEnvironment, /^MCC_HTTPS_ONBOARDING_CONFIG=\/etc\/caddy\/mcc-onboarding-disabled\.caddy$/m);
assert.match(publicHttpsEnvironment, /^MCC_HTTPS_UPSTREAM=127\.0\.0\.1:4273$/m);
assert.match(publicDnsTls, /dns DNS_PROVIDER_NAME \{env\.DNS_PROVIDER_API_TOKEN\}/, 'Public template must require administrator-selected provider syntax.');
assert.doesNotMatch(publicDnsTls, /cloudflare|route53|godaddy|azure|google|digitalocean/i, 'The deployment must not hardcode a DNS provider.');
assert.match(dnsEnvironment, /mode 0600/, 'DNS secrets must be documented as root-only.');
assert.match(dnsEnvironment, /^DNS_PROVIDER_API_TOKEN=replace-with-a-least-privilege-dns-api-token$/m, 'Only a non-secret credential placeholder may be committed.');
assert.doesNotMatch(onboardingDisabled, /http:\/\//, 'IP onboarding must be disabled by default.');
assert.match(onboardingHttp, /^http:\/\/\{\$MCC_ONBOARDING_IP\}/m);
assert.match(onboardingHttp, /@root_ca path \/mcc-root-ca\.crt/, 'The optional IP site may distribute only the public CA root path.');
assert.doesNotMatch(onboardingHttp, /reverse_proxy/, 'The IP onboarding endpoint must never proxy MCC or Node.');
assert.match(rootExporter, /\/root\.crt/);
assert.match(rootExporter, /CA:TRUE/);
assert.doesNotMatch(rootExporter, /install[^\n]*root\.key|cp[^\n]*root\.key/, 'The private CA key must never be distributed.');
assert.match(caddyDropIn, /^EnvironmentFile=\/etc\/mcc-https\.env$/m);
assert.match(caddyDropIn, /^EnvironmentFile=-\/etc\/mcc-https-dns\.env$/m);
assert.match(mccDropIn, /^EnvironmentFile=\/etc\/mcc-https\.env$/m, 'Node must consume the same canonical hostname configuration as Caddy.');
assert.match(mccDropIn, /^Environment=MCC_BIND_HOST=127\.0\.0\.1$/m);

assert.match(backend, /app\.set\('trust proxy', 'loopback'\)/, 'Express must trust proxy headers only from loopback.');
assert.match(backend, /app\.listen\(port,bindHost,/, 'The backend must honor the configured bind host.');
assert.match(backend, /canonicalHttpsAccess\(process\.env\.MCC_HTTPS_HOSTNAME, process\.env\.MCC_HTTPS_MODE\)/, 'Node must use the configured hostname and certificate mode.');
assert.match(backend, /certificateMode: canonicalHttps\.certificateMode/, 'Network Access must receive the configured certificate mode.');
assert.match(updater, /readonly HEALTH_URL="http:\/\/127\.0\.0\.1:4273\/"/, 'Updater health must remain independent on loopback HTTP.');

assert.match(rootInstaller, /ComputeHash\(\$certificate\.RawData\)/, 'CA installer must calculate the certificate SHA-256 fingerprint.');
assert.match(rootInstaller, /StoreLocation\]::LocalMachine/, 'CA trust must be machine-wide for managed Windows clients.');
assert.match(rootInstaller, /CertificateAuthority/, 'CA installer must reject non-CA certificates.');
assert.doesNotMatch(rootInstaller + clientCheck, /DangerousAcceptAnyServerCertificateValidator|ServerCertificateCustomValidationCallback|--insecure|-k\b/, 'Client tooling must never bypass certificate validation.');
assert.match(clientCheck, /Add-Type -AssemblyName System\.Net\.Http/, 'Windows PowerShell 5.1 must load System.Net.Http explicitly.');
assert.ok(
  clientCheck.indexOf('Add-Type -AssemblyName System.Net.Http') < clientCheck.indexOf('[Net.Http.HttpClientHandler]'),
  'System.Net.Http must load before HttpClientHandler is referenced.',
);
assert.match(clientCheck, /https:\/\/\$Hostname\/api\/health/, 'Client verification must exercise the HTTPS health route.');
assert.match(clientCheck, /301, 302, 307, 308/, 'Client verification must require an HTTP redirect.');
assert.match(piValidator, /MCC_HTTPS_MODE.*internal.*public/, 'Pi validator must allow only the two supported certificate modes.');
assert.match(piValidator, /Internal mode requires a \.local/, 'Pi validator must preserve the .local internal-CA fallback.');
assert.match(piValidator, /Public mode requires a real public DNS hostname/, 'Pi validator must require a non-reserved public hostname.');
for (const reservedDomain of ['alt', 'arpa', 'example.com', 'example.net', 'example.org', 'internal', 'local', 'localhost', 'onion', 'test']) {
  assert.match(piValidator, new RegExp(`public_excluded_domains=.*\\b${reservedDomain.replace('.', '\\.') }\\b`), `Pi validator must reject ${reservedDomain} and its subdomains in public mode.`);
}
assert.match(piValidator, /dns\.providers\.\$\{dns_provider\}/, 'Pi validator must verify the selected provider plugin is installed.');
assert.match(piValidator, /root:root:600/, 'Pi validator must require root-only DNS credentials.');
assert.match(piValidator, /DNS_ENV_FILE[\s\S]*does not assign it/, 'Every provider credential reference must come from the root-only DNS environment file.');
assert.match(piValidator, /TLS credential[\s\S]*must not be empty/, 'Provider credential values must not be empty.');
assert.match(piValidator, /MCC_HTTPS_ONBOARDING_CONFIG.*mcc-onboarding-\(disabled\|http\)/, 'Only reviewed onboarding fragments may be selected.');
assert.match(piValidator, /Public certificate mode must disable internal-CA root onboarding/, 'Public mode must not serve internal-CA onboarding material.');
assert.match(piValidator, /127\\\.0\\\.0\\\.1:\(4273\|4274\)/, 'Pi validator must reject non-loopback or unexpected upstreams.');
assert.match(piValidator, /root:root:644/, 'Pi validator must reject writable or incorrectly owned deployment configuration.');
assert.match(piValidator, /caddy validate/, 'Pi validator must invoke Caddy configuration validation.');
assert.match(piValidator, /--check-public-ready/, 'Pi validator must expose an explicit post-issuance public readiness gate.');
assert.match(piValidator, /getent ahostsv4/, 'Public readiness must exercise split-DNS resolution.');
assert.match(piValidator, /getent ahostsv6/, 'Public readiness must validate an AAAA answer when one is present.');
assert.match(piValidator, /\^::ffff:/, 'IPv4-mapped resolver output must not be mistaken for a real AAAA answer.');
assert.match(piValidator, /not assigned to this Pi/, 'Public readiness must reject DNS answers that do not point to the Pi.');
assert.match(piValidator, /ss -ltnpH/, 'Public readiness must inspect live listener ownership.');
assert.match(piValidator, /not owned exclusively by Caddy/, 'Public readiness must require Caddy on LAN-facing HTTP\/HTTPS ports.');
assert.match(piValidator, /for protected_node_port in 4273 4274/, 'Public readiness must keep both production and staging Node ports loopback-only when present.');
assert.match(piValidator, /http:\/\/\$\{MCC_HTTPS_UPSTREAM\}\/api\/health/, 'Public readiness must verify the loopback Node health route.');
assert.match(piValidator, /https:\/\/\$\{MCC_HTTPS_HOSTNAME\}\/api\/health/, 'Public readiness must verify canonical HTTPS health.');
assert.match(piValidator, /--noproxy '\*'/, 'Public readiness must connect directly instead of using an outbound proxy.');
assert.doesNotMatch(piValidator, /curl[^\n]*(?:-k|--insecure)/, 'Public readiness must never bypass certificate validation.');
assert.match(piValidator, /openssl x509 -noout -checkhost/, 'Public readiness must verify the leaf certificate hostname.');
assert.match(piValidator, /openssl x509 -noout -checkend 604800/, 'Public readiness must reject a certificate expiring within seven days.');

for (const heading of ['Administrator inputs required before public issuance', 'Public-CA DNS-01 deployment', 'Internal-CA .local fallback', 'Certificate trust', 'Renewal and monitoring', 'Backup and recovery', 'Staging deployment', 'Production deployment']) {
  assert.ok(documentation.includes(`## ${heading}`), `HTTPS runbook is missing the ${heading} section.`);
}

console.log('Raspberry Pi HTTPS deployment validation passed.');
