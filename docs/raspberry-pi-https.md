# Trusted HTTPS for Raspberry Pi and LAN deployments

## Architecture decision

The supported MCC path for the current `.local` hostname is Caddy TLS termination with a deployment-specific internal certificate authority (CA):

```text
Windows + Brave/Chromium
  -> trusted HTTPS on TCP 443 (Caddy)
  -> loopback HTTP (127.0.0.1:4273 production or :4274 staging)
  -> existing Node/Express MCC service

HTTP on TCP 80 -> permanent HTTPS redirect (Caddy)
Updater health -> direct loopback HTTP on 127.0.0.1:4273
```

Public CAs do not issue ordinary Web PKI certificates for private `.local` names. Caddy's `tls internal` mode manages the server certificate and its renewal, while intended Windows clients explicitly trust the CA root. This is a trusted private PKI deployment, not a browser exception and not a permanently untrusted self-signed leaf certificate.

This choice has the lowest ongoing operational cost for the existing plant/LAN name and managed Windows clients. If MCC later receives a real organizational DNS name and the organization can securely automate DNS-01 validation, prefer Caddy's public ACME certificate flow and remove `tls internal`; that avoids distributing a private trust root. Do not point a public DNS name at a private address without the network/DNS owner approving the split-DNS design.

Caddy preserves the request method, URI, body, response stream, `Host`, and cookies, and supplies `X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto`. Express trusts those headers only when the immediate peer is loopback. Excel and ZIP bodies are not regenerated, transformed, or moved into Caddy storage.

## Security boundaries

- Expose only Caddy ports 80 and 443 to the plant LAN. Never expose Node ports 4273/4274 or Caddy's admin API.
- `MCC_BIND_HOST=127.0.0.1` is enforced by a root-owned systemd drop-in. The Node default remains compatible with existing development/Windows launchers.
- Caddy's local admin API is disabled. Validate configuration and restart the service for the infrequent configuration change.
- The updater continues to check `http://127.0.0.1:4273/`. Updates and rollbacks therefore do not depend on DNS, Caddy, or CA availability.
- The CA root certificate is public material; its `root.key` is highly sensitive. Never copy, email, serve, or install the private key on a client.
- Trusting an internal CA authorizes that CA to identify TLS sites to its clients. Limit trust to managed MCC clients and protect the Pi and its Caddy data accordingly.

## Prerequisites

1. Confirm the Pi has a stable LAN address and that the chosen `.local` name resolves to it from every intended Windows client. `mcc-stage.local` and `mcc.local` are distinct certificate names.
2. Confirm TCP 80/443 are unused on the Pi. Keep 4273 for production and 4274 for staging; port 4173 remains reserved for MIT3.
3. Confirm the MCC service runs with `NODE_ENV=production` and a persistent `SESSION_SECRET`.
4. Arrange an administrator-approved way to distribute the CA root and its SHA-256 fingerprint separately, or use Windows Group Policy.
5. Take a system/configuration backup before changing services. Do not deploy this branch to production until staging passes the checks below.

## Install Caddy on Raspberry Pi OS

Use the official stable Debian/Raspbian package. The package creates the `caddy` account and `caddy.service` and keeps Caddy updates in the normal package workflow.

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

Install the tracked configuration from the approved MCC checkout:

```bash
sudo install -o root -g root -m 0644 deployment/raspberry-pi/https/Caddyfile /etc/caddy/Caddyfile
sudo install -o root -g root -m 0644 deployment/raspberry-pi/https/mcc-https.env.example /etc/mcc-https.env
sudo install -o root -g root -m 0755 deployment/raspberry-pi/https/validate-mcc-https /usr/local/sbin/validate-mcc-https
sudo install -d -o root -g root -m 0755 /etc/systemd/system/caddy.service.d
sudo install -o root -g root -m 0644 deployment/raspberry-pi/https/caddy.service.d/mcc-https.conf /etc/systemd/system/caddy.service.d/mcc-https.conf
```

Edit only the root-owned environment file. Values are plain host/address values, without URL schemes:

```bash
sudoedit /etc/mcc-https.env
sudo chown root:root /etc/caddy/Caddyfile /etc/mcc-https.env /etc/systemd/system/caddy.service.d/mcc-https.conf /usr/local/sbin/validate-mcc-https
sudo chmod 0644 /etc/caddy/Caddyfile /etc/mcc-https.env /etc/systemd/system/caddy.service.d/mcc-https.conf
sudo chmod 0755 /usr/local/sbin/validate-mcc-https
```

Before starting Caddy, verify that the upstream begins with `127.0.0.1:` and validate the expanded configuration:

```bash
sudo systemctl daemon-reload
sudo systemctl show caddy.service --property=Environment --no-pager
sudo validate-mcc-https
sudo systemctl restart caddy.service
sudo systemctl enable caddy.service
sudo systemctl status caddy.service --no-pager
```

If the validation command reports an invalid environment value, correct `/etc/mcc-https.env`; do not weaken the Caddyfile. Restrict firewall rules for 80/443 to the intended plant LAN. Firewall syntax is site-specific, so have the network owner approve the actual subnet rule.

## Bind the Node service to loopback

For the production `mcc.service`:

```bash
sudo install -d -o root -g root -m 0755 /etc/systemd/system/mcc.service.d
sudo install -o root -g root -m 0644 deployment/raspberry-pi/https/mcc.service.d/https-loopback.conf /etc/systemd/system/mcc.service.d/https-loopback.conf
sudo systemctl daemon-reload
sudo systemctl restart mcc.service
curl --fail --silent --show-error http://127.0.0.1:4273/api/health
sudo ss -ltnp | grep -E ':(80|443|4273)\b'
```

The expected listeners are Caddy on LAN-capable port 80/443 and Node only on `127.0.0.1:4273`. A listener such as `0.0.0.0:4273` or `[::]:4273` is a failed deployment and must be corrected before client testing.

## Certificate trust

After Caddy starts successfully, its public root certificate is normally at:

```text
/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt
```

On the Pi, export only `root.crt` and record its SHA-256 fingerprint:

```bash
sudo openssl x509 -in /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt -noout -subject -issuer -dates -fingerprint -sha256
sudo install -o root -g root -m 0644 /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt /var/tmp/mcc-root-ca.crt
```

Transfer `mcc-root-ca.crt` through the approved administrative channel. Communicate the fingerprint through a separate authenticated channel and compare all 64 hexadecimal digits before trusting it. Never transfer `root.key`.

For one managed Windows client, copy `Install-MccRootCA.ps1`, `Test-MccHttpsClient.ps1`, and the root certificate locally. From elevated PowerShell:

```powershell
.\Install-MccRootCA.ps1 -CertificatePath .\mcc-root-ca.crt -ExpectedSha256 'PASTE_THE_VERIFIED_64_HEX_DIGIT_FINGERPRINT'
.\Test-MccHttpsClient.ps1 -Hostname mcc-stage.local
```

The installer rejects a fingerprint mismatch, expired/not-yet-valid certificate, non-CA certificate, non-self-issued certificate, or non-elevated session. It installs into `Cert:\LocalMachine\Root`, which Chromium's certificate verifier consumes as a locally managed Windows trust decision. Close all Brave windows and restart Brave after first installation.

For multiple domain-managed clients, use Computer Configuration Group Policy to publish this same verified certificate under **Trusted Root Certification Authorities**. Keep the GPO limited to the computers intended to use MCC and record the approved fingerprint in the change ticket. Do not email an unverified root and ask users to click through browser warnings.

## Staging deployment

Use the current staging name and internal port in `/etc/mcc-https.env`:

```dotenv
MCC_HTTPS_HOSTNAME=mcc-stage.local
MCC_HTTPS_UPSTREAM=127.0.0.1:4274
```

Apply the loopback environment to the actual staging service name (for example `mcc-stage.service`) with a root-owned drop-in containing:

```ini
[Service]
Environment=MCC_BIND_HOST=127.0.0.1
```

Then validate/restart Caddy and the staging MCC service. Verify all of the following from a Windows staging client before production rollout:

The supported browser URL becomes `https://mcc-stage.local` with no port. `http://mcc-stage.local` redirects to it. The former explicit `http://mcc-stage.local:4274` URL becomes unreachable from the LAN because 4274 is deliberately loopback-only; update saved bookmarks rather than re-exposing that Node port.

1. `Test-MccHttpsClient.ps1 -Hostname mcc-stage.local` passes without a certificate bypass.
2. `http://mcc-stage.local` redirects to `https://mcc-stage.local/`.
3. Brave shows a normal trusted connection with a certificate SAN for `mcc-stage.local`.
4. Login, refresh, logout, CSRF-protected updater status/check UI, and presence updates still work.
5. `Download Excel Only` downloads `PM_report_1.2v.xlsx` without **Insecure download blocked**.
6. PM Package ZIP download succeeds without the warning; open and inspect both artifacts.
7. The stage service restart/reconnect UX still behaves as expected.
8. `ss` confirms port 4274 is loopback-only.

Do not accept `curl -k`, a Brave certificate exception, or disabling Safe Browsing as evidence of success.

## Production deployment

After staging sign-off, schedule a normal production change window. Use the production hostname and port:

```dotenv
MCC_HTTPS_HOSTNAME=mcc.local
MCC_HTTPS_UPSTREAM=127.0.0.1:4273
```

Confirm `mcc.local` resolves correctly, distribute/verify trust before changing the normal bookmark, install the production `mcc.service` loopback drop-in, validate Caddy, and repeat the complete staging checklist against production. Do not merge, tag, or deploy merely because configuration validation passes.

Existing sessions are host-scoped rather than port-scoped, but the production cookie is `Secure`; users coming from the old HTTP URL may need to log in once at the new HTTPS origin. All normal links and API calls remain same-origin. Keep the HTTP redirect so saved HTTP bookmarks converge on HTTPS.

## Renewal and monitoring

Caddy automatically renews its managed server and intermediate certificates. Clients continue trusting the stable CA root, so leaf renewal requires no Windows action. Package upgrades should use the normal Raspberry Pi patch process; validate the Caddyfile and test staging after a major Caddy upgrade.

Recommended monthly checks:

```bash
sudo systemctl is-active caddy.service mcc.service
sudo journalctl -u caddy.service --since '30 days ago' --no-pager
sudo openssl x509 -in /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt -noout -dates -fingerprint -sha256
curl --fail --silent --show-error http://127.0.0.1:4273/api/health
```

Also run `Test-MccHttpsClient.ps1` from a representative managed Windows/Brave client. Alert well before the root CA expiry; root rotation requires distributing the new root before Caddy begins serving a chain from it.

## Backup and recovery

Back up these root-owned/service-managed items through the site's protected system backup process:

- `/etc/caddy/Caddyfile`
- `/etc/mcc-https.env`
- `/etc/systemd/system/caddy.service.d/mcc-https.conf`
- the relevant MCC service loopback drop-in
- `/var/lib/caddy/.local/share/caddy` (contains CA/certificate state and private keys)

The Caddy data backup contains the CA private key. Encrypt it, restrict it to the smallest administrator group, keep it out of the MCC repository/updater state, and test restoration on an isolated host. The MCC application updater intentionally does not read, write, back up, or roll back Caddy state.

For Caddy configuration failure, leave Node on loopback, use SSH/local console, restore the last-known-good config, run `caddy validate`, and restart Caddy. The direct loopback updater health check remains available. An administrator can use an SSH local port forward for diagnosis; do not re-expose 4273/4274 to the LAN as the permanent recovery.

If Caddy data is lost but uncompromised, stop Caddy and restore the protected data backup with ownership `caddy:caddy` before starting it. If no backup exists, Caddy will create a different root; that is a planned CA rotation, not transparent recovery, and clients must verify/install the new root before use.

If the Pi or CA private key may be compromised, stop Caddy, remove the old root from Windows/GPO trust, rebuild or recover the Pi from a known-good base, generate a new CA, and distribute the new fingerprint/root through the original verified process. Never continue trusting a potentially compromised root.

## Validation and troubleshooting

Repository checks:

```bash
npm run test:https-deployment
npm run build
npm run smoke
```

Pi checks:

```bash
sudo validate-mcc-https
sudo systemctl status caddy.service mcc.service --no-pager
sudo journalctl -u caddy.service -u mcc.service --since today --no-pager
```

Common failures:

- **Name mismatch:** browse the exact hostname configured in `MCC_HTTPS_HOSTNAME`; IP-address access does not match a `.local` certificate.
- **Untrusted issuer:** verify the Pi's current root fingerprint and the Windows Local Machine/GPO root. Do not click through.
- **502 from Caddy:** confirm the configured loopback port, MCC service status, and direct loopback health.
- **HTTP does not redirect:** check that Caddy owns both ports 80 and 443 and that no global `auto_https` override was added.
- **Wrong client IP in auditing/rate limits:** confirm Node is loopback-only and Caddy is the immediate peer; do not add broader Express proxy trust.

Primary operational references: [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https), [Caddy systemd/local HTTPS](https://caddyserver.com/docs/running), [Caddy reverse proxy defaults](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [Chromium locally managed trust on Windows](https://chromium.googlesource.com/chromium/src/+/main/net/data/ssl/chrome_root_store/faq.md), and [Microsoft trusted-root deployment](https://learn.microsoft.com/en-us/troubleshoot/windows-server/certificates-and-public-key-infrastructure-pki/valid-root-ca-certificates-untrusted).
