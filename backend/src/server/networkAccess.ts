export type HttpsCertificateMode = 'internal' | 'public';

const dnsLabel = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const publicCertificateExcludedSuffixes = ['.local', '.localhost', '.internal', '.home.arpa', '.example', '.example.com', '.example.net', '.example.org', '.invalid', '.test'];

function normalizedHostname(configuredHostname: string | undefined) {
  const hostname = configuredHostname?.trim();
  if (!hostname) return null;
  if (hostname.length > 253 || /^\d+(?:\.\d+){3}$/.test(hostname) || !hostname.includes('.') || hostname.split('.').some(label => !dnsLabel.test(label))) {
    throw new Error('MCC_HTTPS_HOSTNAME must be a valid DNS hostname without a scheme, port, path, or trailing dot.');
  }
  return hostname.toLowerCase();
}

export function canonicalHttpsAccess(configuredHostname: string | undefined, configuredMode?: string) {
  const hostname = normalizedHostname(configuredHostname);
  if (!hostname) return null;
  const inferredMode: HttpsCertificateMode = hostname.endsWith('.local') ? 'internal' : 'public';
  const normalizedMode = configuredMode?.trim().toLowerCase() || inferredMode;
  if (normalizedMode !== 'internal' && normalizedMode !== 'public') {
    throw new Error('MCC_HTTPS_MODE must be "internal" or "public".');
  }
  const certificateMode: HttpsCertificateMode = normalizedMode;
  if (certificateMode === 'internal' && !hostname.endsWith('.local')) {
    throw new Error('MCC_HTTPS_MODE=internal requires a .local MCC_HTTPS_HOSTNAME.');
  }
  if (certificateMode === 'public') {
    if (publicCertificateExcludedSuffixes.some(suffix => hostname.endsWith(suffix))) {
      throw new Error('MCC_HTTPS_MODE=public requires a real public DNS hostname, not a reserved or internal name.');
    }
    const topLevelLabel = hostname.slice(hostname.lastIndexOf('.') + 1);
    if (!/[A-Za-z]/.test(topLevelLabel)) {
      throw new Error('MCC_HTTPS_MODE=public requires a real public DNS hostname with a non-numeric top-level label.');
    }
  }
  return { url: `https://${hostname}`, certificateMode };
}

export function canonicalHttpsUrl(configuredHostname: string | undefined, configuredMode?: string) {
  return canonicalHttpsAccess(configuredHostname, configuredMode)?.url ?? null;
}
