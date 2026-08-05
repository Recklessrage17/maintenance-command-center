let fallbackSequence = 0;

function formatUuidV4(bytes: Uint8Array): string {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function fillDefensiveFallback(bytes: Uint8Array): void {
  fallbackSequence = (fallbackSequence + 1) >>> 0;
  const highResolutionTime = typeof globalThis.performance?.now === 'function'
    ? Math.floor(globalThis.performance.now() * 1_000)
    : 0;
  let state = (Date.now() ^ highResolutionTime ^ fallbackSequence) >>> 0;

  for (let index = 0; index < bytes.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const sequenceByte = fallbackSequence >>> ((index % 4) * 8);
    bytes[index] = (state ^ sequenceByte ^ Math.floor(Math.random() * 256)) & 0xff;
  }
}

export function createRequestId(): string {
  const webCrypto = globalThis.crypto;

  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    try {
      const requestId = webCrypto.randomUUID();
      if (requestId) return requestId;
    } catch {
      // Continue to the UUID-v4 byte fallback when randomUUID is unavailable at runtime.
    }
  }

  const bytes = new Uint8Array(16);
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    try {
      webCrypto.getRandomValues(bytes);
      return formatUuidV4(bytes);
    } catch {
      // Extremely old or restricted browsers still receive a collision-resistant local ID.
    }
  }

  fillDefensiveFallback(bytes);
  return formatUuidV4(bytes);
}
