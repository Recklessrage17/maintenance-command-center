const supportedHttpsHostname = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.local$/;

export function canonicalHttpsUrl(configuredHostname: string | undefined) {
  const hostname = configuredHostname?.trim();
  if (!hostname) return null;
  if (!supportedHttpsHostname.test(hostname)) {
    throw new Error('MCC_HTTPS_HOSTNAME must be a valid .local hostname without a scheme or port.');
  }
  return `https://${hostname.toLowerCase()}`;
}
