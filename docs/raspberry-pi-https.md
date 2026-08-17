# Trusted HTTPS for Raspberry Pi and LAN deployments

## Architecture decision

MCC supports two explicit Caddy certificate modes:

```text
Windows / Firefox / iPhone / iPad / Android / tablet
  -> canonical HTTPS hostname on TCP 443 (Caddy)
  -> loopback HTTP (127.0.0.1:4273 production or :4274 staging)
  -> existing Node/Express MCC service

HTTP on TCP 80 -> HTTPS redirect (Caddy)
Updater health -> direct loopback HTTP on 127.0.0.1:4273
```

`public` is preferred when unmanaged phones or tablets must work without installing an MCC CA. It uses a real registered DNS hostname and a publicly trusted certificate. DNS-01 lets Caddy issue and renew the certificate without making MCC reachable from the public Internet: only the temporary public `_acme-challenge` TXT record and outbound ACME/DNS-provider API traffic are required.

`internal` preserves the managed-LAN `.local` fallback. Caddy uses its internal CA, and every client must trust that CA. It is suitable for centrally managed clients, but it is not a universal zero-setup mobile solution.

Caddy preserves request methods, URIs, bodies, downloads, `Host`, cookies, and the normal forwarding headers. Express trusts proxy headers only from loopback. Excel and PM package bodies are not regenerated or moved into Caddy storage.

## Security boundaries

- Expose Caddy ports 80/443 only to approved LAN subnets. Do not expose them through the Internet router/NAT.
- Never expose Node ports 4273/4274 to the LAN or Internet. `MCC_BIND_HOST=127.0.0.1` is enforced by the systemd drop-in.
- Caddy's unauthenticated local admin API remains disabled.
- The updater and rollback health check remains `http://127.0.0.1:4273/`; it does not depend on DNS, ACME, or Caddy.
- DNS API credentials stay in `/etc/mcc-https-dns.env`, owned by `root:root` with mode `0600`. Never commit them or write literal secrets into a Caddyfile.
- Give the DNS credential only the record permissions needed for ACME TXT creation/deletion in the relevant zone. Do not use a global account key when a scoped token is available.
- Keep Caddy certificate data persistent and protected. Internal-CA private keys and DNS API credentials are secrets.

## Administrator inputs required before public issuance

Do not start public certificate issuance until the administrator/network owner supplies and approves all of the following:

1. The registered parent domain and exact MCC FQDN for each environment. Use a separate staging FQDN if staging will be tested with a public certificate.
2. The authoritative DNS provider and zone that owns the FQDN.
3. The exact Caddy DNS module name and provider configuration syntax. Determine this from the selected provider module's documentation; MCC does not hardcode a provider.
4. The provider-required credential variable name(s) and a least-privilege API token/credential that can manage the `_acme-challenge` TXT record.
5. The internal DNS owner and split-horizon record that resolves the FQDN to the Pi's stable LAN address. DNS-01 does not require a public A/AAAA record. Do not publish an Internet-routable MCC address.
6. The ACME account contact email and any approved CA requirement. If a CAA record exists, confirm it permits the selected public CA.
7. Confirmation that the Pi has outbound DNS, ACME HTTPS, and DNS-provider API access, and that LAN clients use DNS that can resolve the private MCC address.
8. Whether a single-host certificate is sufficient. Prefer it; request a wildcard only for a documented operational need.

The domain and DNS provider are deployment inputs, not source defaults. `mcc.example` in the example file is an intentionally reserved placeholder and is rejected by validation.

## Prerequisites

1. Give the Pi a stable LAN address and ensure the selected hostname resolves to it from every intended LAN/Wi-Fi client.
2. Confirm TCP 80/443 are unused on the Pi. Production Node remains 4273; staging remains 4274; MIT3 remains 4173.
3. Confirm MCC runs with `NODE_ENV=production`, a persistent `SESSION_SECRET`, and persistent application data.
4. Take a protected system/configuration backup before changing services.
5. Test on Raspberry Pi staging and representative Windows, Firefox, iOS/iPadOS, and Android clients before production rollout.

## Install the shared Caddy service

Install the official Caddy Debian/Raspbian package for its service account and systemd support files:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

Install the provider-neutral MCC configuration and service files:

```bash
sudo install -o root -g root -m 0644 deployment/raspberry-pi/https/Caddyfile /etc/caddy/Caddyfile
sudo install -o root -g root -m 0644 deployment/raspberry-pi/https/mcc-tls-internal.caddy /etc/caddy/mcc-tls-internal.caddy
sudo install -o root -g root -m 0644 deployment/raspberry-pi/https/mcc-onboarding-disabled.caddy /etc/caddy/mcc-onboarding-disabled.caddy
sudo install -o root -g root -m 0755 deployment/raspberry-pi/https/validate-mcc-https /usr/local/sbin/validate-mcc-https
sudo install -d -o root -g root -m 0755 /etc/systemd/system/caddy.service.d
sudo install -o root -g root -m 0644 deployment/raspberry-pi/https/caddy.service.d/mcc-https.conf /etc/systemd/system/caddy.service.d/mcc-https.conf
```

The shared Caddyfile imports the root-owned TLS fragment selected by `MCC_HTTPS_TLS_CONFIG` and always proxies to `MCC_HTTPS_UPSTREAM`. The validator only permits a TLS fragment directly under `/etc/caddy` and an upstream of `127.0.0.1:4273` or `127.0.0.1:4274`.

## Public-CA DNS-01 deployment

### Select and install the DNS provider module

The standard Caddy package does not contain every DNS provider module. After the authoritative DNS provider is supplied:

1. Locate that provider under the Caddy DNS modules and record its exact module/package name, supported credential method, and an approved version/tag or commit.
2. Build or download a Caddy binary containing only that required provider module. With `xcaddy`, the provider-specific form is `xcaddy build <approved-caddy-version> --with <provider-go-module>@<approved-provider-version>`.
3. On Debian/Raspberry Pi OS, use Caddy's documented `dpkg-divert`/`update-alternatives` procedure so package support files remain installed while `/usr/bin/caddy` selects the custom binary.
4. Verify the result before configuring credentials:

```bash
caddy version
caddy list-modules | grep '^dns.providers.'
```

The selected module must appear as `dns.providers.<selected-name>`. Rebuild and re-verify the custom binary whenever Caddy is upgraded; an ordinary provider-less binary cannot renew DNS-01 certificates.

### Configure public mode

Create the provider fragment from the tracked example, then replace both placeholders with the exact syntax from the selected module documentation:

```bash
sudo install -o root -g root -m 0644 deployment/raspberry-pi/https/mcc-tls-public-dns.caddy.example /etc/caddy/mcc-tls-public-dns.caddy
sudoedit /etc/caddy/mcc-tls-public-dns.caddy
```

The result has this shape; provider names and argument counts vary:

```caddyfile
tls {
    dns <selected-provider-name> {env.<SELECTED_PROVIDER_CREDENTIAL_VARIABLE>}
}
```

Create the non-secret deployment file from `mcc-https-public.env.example`. Replace the reserved example hostname with the administrator-approved FQDN:

```dotenv
MCC_HTTPS_MODE=public
MCC_HTTPS_HOSTNAME=<real-mcc-fqdn>
MCC_HTTPS_TLS_CONFIG=/etc/caddy/mcc-tls-public-dns.caddy
MCC_HTTPS_UPSTREAM=127.0.0.1:4273
```

Install it as `/etc/mcc-https.env` with `root:root` mode `0644`. Create `/etc/mcc-https-dns.env` with the exact credential variable name(s) referenced by the provider fragment. Values must use shell-safe/systemd-compatible assignment syntax because systemd loads the file for Caddy and the root validator loads it for offline config validation:

```dotenv
<SELECTED_PROVIDER_CREDENTIAL_VARIABLE>='administrator-supplied-secret'
```

```bash
sudo chown root:root /etc/mcc-https.env /etc/mcc-https-dns.env /etc/caddy/Caddyfile /etc/caddy/mcc-tls-public-dns.caddy
sudo chmod 0644 /etc/mcc-https.env /etc/caddy/Caddyfile /etc/caddy/mcc-tls-public-dns.caddy
sudo chmod 0600 /etc/mcc-https-dns.env
sudo systemctl daemon-reload
sudo validate-mcc-https
sudo systemctl restart caddy.service
sudo systemctl enable caddy.service
sudo systemctl status caddy.service --no-pager
sudo validate-mcc-https --check-public-ready
```

Run the first `validate-mcc-https` before restarting Caddy; it performs offline configuration, provider-module, credential-reference, ownership, and loopback-upstream checks. Run `--check-public-ready` only after Caddy has obtained the real certificate and split DNS is active. The readiness gate requires Caddy to own TCP 80/443, any production or staging Node listener to use only its defined loopback port, every A or AAAA answer for the canonical FQDN to be assigned to this Pi, direct loopback and canonical HTTPS health to return `ok=true`, HTTP to redirect to the exact canonical HTTPS URL, the normal OS trust store to accept the certificate, the leaf certificate to cover the hostname, and at least seven days of certificate validity. It never uses an insecure TLS bypass.

The readiness gate cannot prove fresh-client behavior, authoritative DNS permissions, credential least privilege, CAA approval, or future renewal by itself. Complete the staging client matrix and inspect Caddy/provider logs before production approval.

DNS-01 needs no inbound Internet connection to ports 80/443. The public CA queries authoritative DNS for the TXT challenge while Caddy makes outbound requests. Restrict the Pi firewall and upstream router so MCC 80/443 remain reachable only from approved LANs. Confirm no public A/AAAA/NAT/port-forward exposes MCC.

### Private LAN DNS

Create an internal/split-horizon A record for the exact FQDN pointing to the Pi's stable LAN IPv4 address. Add AAAA only if IPv6 routing and firewalling are intentionally supported. Test the same FQDN on every supported Wi-Fi/VLAN; do not rely on `.local`/mDNS in public mode.

Public authoritative DNS must remain able to publish the ACME TXT record. The MCC A/AAAA record may exist only in internal DNS. If the organization uses browser/device secure-DNS policies, ensure they still resolve the approved internal record; otherwise the certificate can be valid while the device cannot find MCC.

## Internal-CA .local fallback

Install the tracked internal environment example as `/etc/mcc-https.env` and select the internal fragment:

```dotenv
MCC_HTTPS_MODE=internal
MCC_HTTPS_HOSTNAME=mcc.local
MCC_HTTPS_TLS_CONFIG=/etc/caddy/mcc-tls-internal.caddy
MCC_HTTPS_ONBOARDING_CONFIG=/etc/caddy/mcc-onboarding-disabled.caddy
MCC_HTTPS_UPSTREAM=127.0.0.1:4273
```

Staging uses `mcc-stage.local` and `127.0.0.1:4274`. Run `sudo validate-mcc-https`, restart Caddy, and distribute trust as described below. Public CAs do not issue ordinary Web PKI certificates for `.local`; do not remove client trust requirements or use browser exceptions.

## mDNS and .local deployment

`.local` is the mDNS/Bonjour namespace. A Windows hosts-file entry proves only that one PC can map the name; it does not advertise the name to the LAN. On the Issue #86 staging PC, normal resolution succeeded because `C:\Windows\System32\drivers\etc\hosts` contained `10.1.2.188 mcc-stage.local`; direct DNS without that file returned NXDOMAIN from `10.1.2.6`. With the hosts file explicitly bypassed, `mcc-stage.local` still failed while the Pi's existing `mcc-server.local` Avahi name resolved to `10.1.2.188`. This proves current PC-to-Pi mDNS multicast works and isolates the missing component to the canonical `mcc-stage.local` advertisement. Certificate trust and name resolution are independent and must both pass.

For the internal-CA fallback, install Avahi's supported daemon and validation utilities on the Pi:

```bash
sudo apt update
sudo apt install avahi-daemon avahi-utils
sudo systemctl enable --now avahi-daemon.service
```

MCC publishes its canonical alias with Avahi's supported `avahi-publish-address --no-reverse` operation. The publisher is supervised by systemd, reconnects when Avahi restarts, and deliberately does not register a reverse PTR for the MCC alias. The operating-system and reverse mDNS identity therefore remain `mcc-server` / `mcc-server.local`. Do not use `/etc/avahi/hosts` for an additional name on the Pi's own address: that path also attempts reverse registration and caused the real staging `Local name collision` failure.

Install the deployment files:

```bash
sudo install -o root -g root -m 0644 deployment/raspberry-pi/mdns/mcc-mdns.env.example /etc/mcc-mdns.env
sudo install -o root -g root -m 0755 deployment/raspberry-pi/mdns/migrate-mcc-https-env /usr/local/sbin/migrate-mcc-https-env
sudo install -o root -g root -m 0755 deployment/raspberry-pi/mdns/publish-mcc-mdns /usr/local/sbin/publish-mcc-mdns
sudo install -o root -g root -m 0755 deployment/raspberry-pi/mdns/install-mcc-mdns /usr/local/sbin/install-mcc-mdns
sudo install -o root -g root -m 0755 deployment/raspberry-pi/mdns/validate-mcc-network /usr/local/sbin/validate-mcc-network
sudo install -o root -g root -m 0644 deployment/raspberry-pi/mdns/mcc-mdns-publisher.service /etc/systemd/system/mcc-mdns-publisher.service
sudo install -o root -g root -m 0644 deployment/raspberry-pi/mdns/mcc-network-validation.service /etc/systemd/system/mcc-network-validation.service
sudo install -o root -g root -m 0644 deployment/raspberry-pi/mdns/mcc-network-validation.timer /etc/systemd/system/mcc-network-validation.timer
```

Configure staging in `/etc/mcc-mdns.env`:

```dotenv
MCC_MDNS_HOSTNAME=mcc-stage.local
MCC_MDNS_ADDRESS=10.1.2.188
MCC_MDNS_INTERFACE=wlan0
```

The IP must be a DHCP reservation or otherwise stable, assigned to the named interface, and identical to the Pi LAN address used for Caddy. Production uses `MCC_MDNS_HOSTNAME=mcc.local` and the administrator-approved production address. Do not put a scheme, port, or path in the hostname.

Install and validate the advertisement:

```bash
sudo install-mcc-mdns
sudo systemctl enable --now mcc-network-validation.timer
sudo systemctl start mcc-network-validation.service
sudo systemctl status avahi-daemon.service mcc-mdns-publisher.service mcc-network-validation.service mcc-network-validation.timer --no-pager
```

`install-mcc-mdns` first runs the idempotent HTTPS environment migrator. An older internal-CA file containing only `MCC_HTTPS_HOSTNAME` and `MCC_HTTPS_UPSTREAM` retains those exact deployment values and gains `MCC_HTTPS_MODE=internal`, the internal TLS fragment, and disabled onboarding. The first changed file is backed up at `/var/backups/mcc-https.env.pre-mdns-migration`. Non-`.local` files are never guessed into a certificate mode.

The installer removes only the configured MCC hostname from `/etc/avahi/hosts`, preserves unrelated static hosts/aliases, and retains the existing first-install backup at `/var/backups/mcc-avahi-hosts.preinstall`. It then enables the root-owned `mcc-mdns-publisher.service`. The publisher preflights the exact FQDN, aborts if it resolves to another IPv4 address, uses `--no-reverse --no-fail`, and refuses Avahi's automatic `-2`/`-3` collision rename. It reports ready only after the exact canonical name resolves to the configured address. The Bash wrapper invokes `systemd-notify` as a child with explicit `--pid=parent`; `NotifyAccess=all` admits that helper only because it belongs to the service cgroup. This is required because the hardened empty capability bounding set prevents the helper from forging its parent's process credentials, and it avoids granting broad `CAP_SYS_ADMIN`. A collision uses a non-restarting service exit so it cannot loop while briefly attempting suffixed names; after removing the external conflict, rerun `sudo install-mcc-mdns` or reset/restart the publisher explicitly. Never accept a suffixed name such as `mcc-stage-2.local`, because the certificate, Settings URL, and QR payload require the exact canonical name.

Avahi and the publisher start at boot independently of MCC and Caddy. `--no-fail` reconnects and republishes after an Avahi restart, and the Avahi entry remains registered across Wi-Fi reconnects. The persistent timer rechecks the active Wi-Fi address, UDP 5353, publisher process/flags, exact alias answer, normal Pi hostname, unchanged reverse identity, Caddy listeners, Node loopback binding, and trusted HTTPS health every five minutes. Missing HTTPS variables produce a controlled migration message instead of a `set -u` crash.

### Upgrade the partially deployed Issue #86 staging Pi

After pulling the corrected release-branch commit into the existing staging checkout, keep the validation timer disabled until the one-time migration succeeds, then run from the repository root:

```bash
sudo systemctl disable --now mcc-network-validation.timer
sudo install -o root -g root -m 0755 deployment/raspberry-pi/mdns/migrate-mcc-https-env /usr/local/sbin/migrate-mcc-https-env
sudo install -o root -g root -m 0755 deployment/raspberry-pi/mdns/publish-mcc-mdns /usr/local/sbin/publish-mcc-mdns
sudo install -o root -g root -m 0755 deployment/raspberry-pi/mdns/install-mcc-mdns /usr/local/sbin/install-mcc-mdns
sudo install -o root -g root -m 0755 deployment/raspberry-pi/mdns/validate-mcc-network /usr/local/sbin/validate-mcc-network
sudo install -o root -g root -m 0644 deployment/raspberry-pi/mdns/mcc-mdns-publisher.service /etc/systemd/system/mcc-mdns-publisher.service
sudo install -o root -g root -m 0644 deployment/raspberry-pi/mdns/mcc-network-validation.service /etc/systemd/system/mcc-network-validation.service
sudo install -o root -g root -m 0644 deployment/raspberry-pi/mdns/mcc-network-validation.timer /etc/systemd/system/mcc-network-validation.timer
sudo systemctl daemon-reload
sudo install-mcc-mdns
sudo systemctl reset-failed mcc-network-validation.service
sudo systemctl enable --now mcc-network-validation.timer
sudo systemctl start mcc-network-validation.service
sudo systemctl status avahi-daemon.service mcc-mdns-publisher.service mcc-network-validation.service mcc-network-validation.timer caddy.service --no-pager
sudo journalctl -b -u mcc-mdns-publisher.service -u mcc-network-validation.service --no-pager
```

Before running `install-mcc-mdns`, confirm `/etc/mcc-mdns.env` still contains staging hostname `mcc-stage.local`, address `10.1.2.188`, and interface `wlan0`. The migrator does not replace `MCC_HTTPS_HOSTNAME=mcc-stage.local` or `MCC_HTTPS_UPSTREAM=127.0.0.1:4274`.

From a second mDNS-capable client on the same DM Wi-Fi, verify `mcc-stage.local` resolves to `10.1.2.188`. If it does not, confirm the access point permits IPv4 multicast `224.0.0.251:5353` between wireless clients and that client isolation, multicast suppression, VLAN boundaries, or secure-DNS policy is not blocking local discovery. Avahi cannot cross routed VLANs without an approved mDNS gateway/reflector; do not enable Avahi reflector mode casually.

## Internal-CA client onboarding

Only the public certificate `/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt` may be distributed. The private `/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.key` must never be copied, served, emailed, committed, or installed on a client.

Export a read-only onboarding copy and record its SHA-256 fingerprint:

```bash
sudo install -o root -g root -m 0755 deployment/raspberry-pi/https/export-mcc-root-onboarding /usr/local/sbin/export-mcc-root-onboarding
sudo export-mcc-root-onboarding
sudo openssl x509 -in /var/lib/mcc-onboarding/mcc-root-ca.crt -noout -subject -issuer -dates -fingerprint -sha256
```

Communicate the entire fingerprint through a separate authenticated channel. The user must compare it before trusting the root.

For a new client with neither name resolution nor trust, an administrator may explicitly enable the restricted IP onboarding endpoint:

```bash
sudo install -o root -g root -m 0644 deployment/raspberry-pi/https/mcc-onboarding-http.caddy.example /etc/caddy/mcc-onboarding-http.caddy
```

Then add these staging values to `/etc/mcc-https.env`:

```dotenv
MCC_ONBOARDING_IP=10.1.2.188
MCC_HTTPS_ONBOARDING_CONFIG=/etc/caddy/mcc-onboarding-http.caddy
```

Run `sudo validate-mcc-https`, restart Caddy, and download only `http://10.1.2.188/mcc-root-ca.crt`. Every other path on that IP-only HTTP site returns 404; it never proxies the MCC app or Node. Because HTTP cannot authenticate the certificate file, independently compare its SHA-256 fingerprint before installation. Disable this optional endpoint after onboarding by restoring `MCC_HTTPS_ONBOARDING_CONFIG=/etc/caddy/mcc-onboarding-disabled.caddy` and restarting Caddy.

## Windows second-PC onboarding

1. Connect the PC to the same approved DM LAN/Wi-Fi.
2. Before adding any hosts entry, run `Resolve-DnsName mcc-stage.local` or `ping mcc-stage.local` and require `10.1.2.188`. A hosts entry is not acceptable for mDNS acceptance.
3. Obtain `mcc-root-ca.crt` through the approved administrative channel or restricted onboarding endpoint. Compare all 64 SHA-256 hexadecimal digits through a separate authenticated channel.
4. Copy `Install-MccRootCA.ps1` and `Test-MccHttpsClient.ps1` locally. From elevated Windows PowerShell:

```powershell
.\Install-MccRootCA.ps1 -CertificatePath .\mcc-root-ca.crt -ExpectedSha256 'PASTE_VERIFIED_64_HEX_FINGERPRINT'
.\Test-MccHttpsClient.ps1 -Hostname mcc-stage.local
.\Test-MccWindowsLanClient.ps1 -Hostname mcc-stage.local -ExpectedAddress 10.1.2.188 -NodePort 4274 -RequireNoHostsOverride
```

5. Close every Edge/Chrome/Brave/Firefox window, reopen the browser, and open `https://mcc-stage.local`.

Domain-managed Windows PCs should receive the independently verified public root through a computer-scoped Trusted Root Certification Authorities GPO. Never distribute `root.key`.

## iPhone and iPad onboarding

1. Join the same DM Wi-Fi and turn off cellular data temporarily for the acceptance test.
2. Before installing a certificate, open `http://mcc-stage.local` or use a Bonjour/mDNS discovery tool to prove the name reaches `10.1.2.188`. A timeout is a resolution/multicast problem, not a certificate problem.
3. Download only `mcc-root-ca.crt` through the administrator-approved method. Verify its SHA-256 fingerprint separately.
4. After Safari downloads the certificate profile, open **Settings > General > VPN & Device Management** (or **Profile Downloaded**), select the MCC certificate profile, review it, and install it.
5. Manual profile installation does not enable TLS trust automatically. Open **Settings > General > About > Certificate Trust Settings**, then enable full trust for the verified MCC root. If the full-trust section is absent, the root profile was not installed.
6. Open `https://mcc-stage.local/api/health`, require JSON containing `"ok":true`, then open the QR/canonical application URL.

Apple recommends Apple Configurator or MDM for managed certificate deployment. Those mechanisms are preferable to repeated manual onboarding.

## Android onboarding

Android menus vary by manufacturer and release. On current Pixel/Android, start at **Settings > Security & privacy > More security settings > Encryption & credentials > Install a certificate**. Select **CA certificate** for a web trust anchor—not **Wi-Fi certificate** unless the certificate is specifically for enterprise Wi-Fi—and choose the independently verified `mcc-root-ca.crt`. A device PIN/pattern/password may be required.

After installation:

1. Confirm the device is on DM Wi-Fi and that `mcc-stage.local` resolves/reaches `10.1.2.188` independently of certificate trust.
2. Open `https://mcc-stage.local/api/health` in Chrome and require `"ok":true` without a warning.
3. Open the Settings QR URL and verify normal application/login/download behavior.

Some vendor browsers or managed-app policies do not trust user-installed roots. Use the organization's Android Enterprise/MDM certificate policy when manual trust is unavailable; do not disable Chrome security checks.

## Bind the Node service to loopback

For production `mcc.service`:

```bash
sudo install -d -o root -g root -m 0755 /etc/systemd/system/mcc.service.d
sudo install -o root -g root -m 0644 deployment/raspberry-pi/https/mcc.service.d/https-loopback.conf /etc/systemd/system/mcc.service.d/https-loopback.conf
sudo systemctl daemon-reload
sudo systemctl restart mcc.service
curl --fail --silent --show-error http://127.0.0.1:4273/api/health
sudo ss -ltnp | grep -E ':(80|443|4273)\b'
```

The MCC drop-in loads the same `MCC_HTTPS_MODE` and `MCC_HTTPS_HOSTNAME` used by Caddy, so Settings > Network Access, every Copy action, and the phone/tablet QR code use the canonical HTTPS URL. Expected listeners are Caddy on LAN-approved 80/443 and Node only on `127.0.0.1:4273` (or staging `:4274`). `0.0.0.0:4273`, `[::]:4273`, or equivalent staging listeners are deployment failures.

## Certificate trust

Public mode uses the normal public Web PKI. Current standard Windows browsers, Firefox, iPhone/iPad Safari, Android Chrome, and tablets should need no MCC-specific CA installation when the certificate chain and device clocks are valid.

Internal mode requires explicit trust. Caddy's public root is normally:

```text
/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt
```

Export only `root.crt`, verify its SHA-256 fingerprint through a separate authenticated channel, and use `Install-MccRootCA.ps1` or a restricted Windows GPO. Never transfer `root.key`. Manually managed phones/tablets require platform-specific profile/root installation and trust enablement; this is why internal mode is only a fallback.

```powershell
.\Install-MccRootCA.ps1 -CertificatePath .\mcc-root-ca.crt -ExpectedSha256 'PASTE_VERIFIED_64_HEX_FINGERPRINT'
.\Test-MccHttpsClient.ps1 -Hostname mcc-stage.local
```

`Test-MccHttpsClient.ps1` always uses normal certificate validation; it has no bypass switch and works with either certificate mode.

## Staging deployment

Use a staging-only FQDN and port 4274. For public mode, do not request a certificate until the staging DNS name, provider module, scoped credential, internal A/AAAA behavior, CAA policy, and outbound access are approved. Apply the loopback drop-in to the actual staging service and verify:

```bash
# /etc/mcc-https.env must select the approved staging FQDN and loopback upstream:
# MCC_HTTPS_MODE=public
# MCC_HTTPS_HOSTNAME=<staging-fqdn>
# MCC_HTTPS_UPSTREAM=127.0.0.1:4274
sudo validate-mcc-https
sudo systemctl restart <staging-mcc-service>.service caddy.service
sudo validate-mcc-https --check-public-ready
```

1. `sudo validate-mcc-https` passes and Caddy logs show successful issuance/renewal state.
2. Direct `curl http://127.0.0.1:4274/api/health` and trusted `https://<staging-fqdn>/api/health` return `ok=true`.
3. HTTP redirects to the exact canonical HTTPS hostname.
4. `ss` confirms Node 4274 is loopback-only and there is no Internet port-forward.
5. Windows Edge/Chrome/Brave, Firefox, iPhone/iPad Safari, Android Chrome, and representative tablets open MCC without a warning. Public mode must not require a custom CA.
6. Settings > Network Access display, Copy actions, and QR payload all equal `https://<staging-fqdn>` with no Node port.
7. Login, logout, authentication, sessions, presence, secure cookies, CSRF-protected updater controls, and reconnect behavior work.
8. Excel-only and PM package downloads complete, open successfully, and show no insecure-download warning.
9. Updater check/apply/health and a staged rollback exercise still work through their documented loopback paths.

Do not accept `curl -k`, browser exceptions, disabled Safe Browsing, or a manually installed MCC CA as evidence that public mode passes.

## Production deployment

After staging sign-off, schedule a normal production change window. Replace the staging FQDN/upstream with the administrator-approved production FQDN and `127.0.0.1:4273`; do not reuse the reserved example. Repeat the complete staging checklist before changing normal bookmarks.

```bash
# /etc/mcc-https.env must select the approved production FQDN and loopback upstream:
# MCC_HTTPS_MODE=public
# MCC_HTTPS_HOSTNAME=<production-fqdn>
# MCC_HTTPS_UPSTREAM=127.0.0.1:4273
sudo validate-mcc-https
sudo systemctl restart mcc.service caddy.service
sudo validate-mcc-https --check-public-ready
```

Existing sessions are hostname-scoped. Moving from `.local` to a real FQDN creates a different browser origin, so users should expect to sign in once at the new URL. All application links and downloads remain same-origin, and production cookies remain `Secure`.

Do not merge, tag, or production-deploy solely because Caddy validation or certificate issuance succeeds.

## Renewal and monitoring

Caddy renews either certificate type automatically. Public mode requires the selected DNS plugin and working scoped credential for every renewal; keep the credential active and monitor provider audit logs. Internal mode renews leaf/intermediate certificates locally while clients trust the stable root.

Recommended monthly checks:

```bash
sudo systemctl is-active caddy.service mcc.service
sudo journalctl -u caddy.service --since '30 days ago' --no-pager
caddy list-modules | grep '^dns.providers.'
curl --fail --silent --show-error http://127.0.0.1:4273/api/health
sudo validate-mcc-https --check-public-ready
```

Also run `Test-MccHttpsClient.ps1` and a real mobile browser check against the canonical name. Alert on ACME renewal errors, credential expiry, DNS API failures, and certificate expiry. Test with the ACME CA's staging endpoint during repeated issuance experiments to avoid public rate limits; production must return to the approved public CA endpoint.

## Backup and recovery

Back up through the protected system backup process:

- `/etc/caddy/Caddyfile` and the selected `/etc/caddy/mcc-tls-*.caddy` fragment
- `/etc/caddy/mcc-onboarding-*.caddy` and `/var/lib/mcc-onboarding/mcc-root-ca.crt` when internal-CA onboarding is enabled
- `/etc/mcc-https.env`
- `/etc/mcc-mdns.env`, the root-owned MCC publisher scripts/unit, `/etc/avahi/hosts`, `/var/backups/mcc-avahi-hosts.preinstall`, and `/var/backups/mcc-https.env.pre-mdns-migration` for `.local` deployments
- `/etc/systemd/system/mcc-mdns-publisher.service`, `mcc-network-validation.service`, and `.timer`
- `/etc/mcc-https-dns.env` in public mode, encrypted and access-restricted
- `/etc/systemd/system/caddy.service.d/mcc-https.conf`
- the relevant MCC service loopback drop-in
- `/var/lib/caddy/.local/share/caddy` certificate/account state
- the custom Caddy binary provenance: Caddy version, provider module/package, and pinned provider version/commit

The MCC updater intentionally does not read, write, back up, or roll back Caddy state or DNS credentials. Restoring an application version therefore preserves TLS configuration. Verify backup permissions and restoration on an isolated host.

For a Caddy configuration failure, keep Node loopback-only, use SSH/local console, restore the last-known-good Caddy/environment/TLS fragment, run `sudo validate-mcc-https`, and restart Caddy. Use an SSH local port forward for emergency diagnosis; never recover by binding 4273/4274 to the LAN.

If public certificate state is lost, restore protected Caddy state or allow controlled reissuance after checking CA rate limits and DNS credentials. If a DNS credential may be compromised, revoke/rotate it at the provider, update the root-only environment file, review provider audit logs, validate, and restart Caddy.

If the internal CA key may be compromised, remove the old root from all trust stores/GPO/MDM, rebuild or recover from a known-good base, generate a new CA, and redistribute the independently verified root. Never continue trusting a potentially compromised CA.

To roll back public mode to the internal fallback, schedule the DNS/origin change, select `MCC_HTTPS_MODE=internal`, a `.local` hostname, and the internal TLS fragment, then distribute CA trust before users switch. Rollback never includes re-exposing Node ports.

## mDNS recovery and conflicts

If `.local` resolution fails after reboot or Wi-Fi reconnect:

```bash
ip -4 -o addr show dev wlan0 scope global
sudo systemctl status avahi-daemon.service mcc-network-validation.service mcc-network-validation.timer --no-pager
sudo systemctl status mcc-mdns-publisher.service --no-pager
sudo journalctl -b -u avahi-daemon.service -u mcc-mdns-publisher.service -u mcc-network-validation.service --no-pager
grep -n 'mcc-stage.local' /etc/avahi/hosts || true
avahi-resolve-host-name -4 mcc-stage.local
avahi-resolve-host-name -4 mcc-server.local
avahi-resolve-address 10.1.2.188
sudo validate-mcc-network
```

- If the interface address differs from `/etc/mcc-mdns.env`, correct the DHCP reservation/network configuration first. Do not advertise a stale address.
- If the name resolves to another address or the publisher journal reports a collision/attempted rename, stop and identify/remove or rename the conflicting device. Do not change MCC to an automatically suffixed hostname and do not weaken the certificate hostname check.
- If the journal reports the exact alias established and exact resolution succeeds but the unit remains `activating`, confirm the installed unit has `NotifyAccess=all`, the installed wrapper calls `systemd-notify --pid=parent --ready`, and `systemctl daemon-reload` was run after installation. Do not grant `CAP_SYS_ADMIN` to work around notification attribution.
- `avahi-resolve-address 10.1.2.188` must continue returning `mcc-server.local`, not `mcc-stage.local`. A reverse takeover means the obsolete static-host path or another incorrect publisher remains.
- If local Pi resolution passes but iPhone/Android/another PC times out, investigate DM Wi-Fi multicast, client isolation, VLAN boundaries, and mDNS gateway policy. Restarting Caddy or Node will not repair multicast.
- If trust fails while resolution succeeds, compare the served certificate chain and independently verified root fingerprint. Do not edit hosts/DNS to mask a certificate problem.
- If resolution fails while trust is installed, repair Avahi/network discovery. Reinstalling the same root cannot repair name resolution.

To restore the original Avahi static-host file from the first-install backup, inspect both exact paths first, then during a maintenance window:

```bash
sudo systemctl stop mcc-mdns-publisher.service avahi-daemon.service
sudo install -o root -g root -m 0644 /var/backups/mcc-avahi-hosts.preinstall /etc/avahi/hosts
sudo systemctl start avahi-daemon.service
```

This disables the supervised MCC alias and restores the original static-host state. Settings and the QR code intentionally continue to show the configured canonical HTTPS hostname, so complete recovery by rerunning `sudo install-mcc-mdns` or deliberately changing the whole approved hostname/certificate configuration. Never recover by exposing Node 4273/4274 or using an IP/HTTP QR URL.

## Validation and troubleshooting

Repository checks:

```bash
npm run test:network-access
npm run test:https-deployment
npm run test:mdns-deployment
npm run test:mobile-qr
npm run build
npm run smoke
```

Pi checks:

```bash
sudo validate-mcc-https
sudo validate-mcc-https --check-public-ready  # public mode after issuance only
sudo systemctl status caddy.service mcc.service --no-pager
sudo journalctl -u caddy.service -u mcc.service --since today --no-pager
```

Common failures:

- **Provider module missing:** `caddy list-modules` must contain the `dns.providers.<name>` referenced by the public TLS fragment.
- **DNS-01 fails:** verify scoped credential variables, authoritative TXT visibility, CAA, outbound access, provider audit logs, and split-DNS resolver selection.
- **Valid certificate but hostname does not load:** test the internal A/AAAA answer and Wi-Fi/VLAN path on that device. Certificate trust does not supply LAN name resolution.
- **Name mismatch:** browse exactly `MCC_HTTPS_HOSTNAME`; IP-address access will not match the certificate.
- **Untrusted issuer in public mode:** inspect the served chain, Caddy issuance logs, client clock, and configured issuer. Do not install the MCC internal root to mask the defect.
- **502 from Caddy:** check the configured loopback port, MCC service status, and direct loopback health.
- **HTTP does not redirect:** confirm Caddy owns 80/443 and no `auto_https` override was added.
- **Wrong client IP in auditing/rate limits:** confirm Node is loopback-only and Caddy is the immediate peer; never broaden Express proxy trust.

Primary references: [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https), [Caddy TLS DNS challenge](https://caddyserver.com/docs/caddyfile/directives/tls), [Caddy custom builds](https://caddyserver.com/docs/build), [Caddy systemd operation](https://caddyserver.com/docs/running), [IANA special-use domain names](https://www.iana.org/assignments/special-use-domain-names/special-use-domain-names.xhtml), [Raspberry Pi mDNS guidance](https://www.raspberrypi.com/documentation/computers/remote-access.html#resolve-raspberrypilocal-with-mdns), [Debian Bookworm Avahi publisher source](https://sources.debian.org/src/avahi/0.8-10%2Bdeb12u1/avahi-utils/avahi-publish.c/), [Apple manual root trust](https://support.apple.com/102390), and [Google/Pixel certificate management](https://support.google.com/pixelphone/answer/2844832).
