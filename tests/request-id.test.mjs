import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestId } from '../frontend/src/utils/requestId.ts';

const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

function withCrypto(value, callback) {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value });
  try {
    callback();
  } finally {
    if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
    else delete globalThis.crypto;
  }
}

test('uses crypto.randomUUID when it is available', () => {
  const expected = '12345678-1234-4123-8123-123456789abc';
  withCrypto({
    randomUUID: () => expected,
    getRandomValues: () => { throw new Error('getRandomValues should not be used'); },
  }, () => {
    assert.equal(createRequestId(), expected);
  });
});

test('creates distinct RFC 4122 UUID-v4 IDs when randomUUID is unavailable', () => {
  let seed = 0;
  withCrypto({
    randomUUID: undefined,
    getRandomValues: bytes => {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = (seed + index) & 0xff;
      seed += 31;
      return bytes;
    },
  }, () => {
    const first = createRequestId();
    const second = createRequestId();
    assert.ok(first);
    assert.ok(second);
    assert.notEqual(first, second);
    assert.match(first, uuidV4Pattern);
    assert.match(second, uuidV4Pattern);
    assert.equal(first[14], '4');
    assert.match(first[19], /[89ab]/);
  });
});

test('uses a non-empty, changing UUID-v4 defensive fallback without Web Crypto', () => {
  withCrypto(undefined, () => {
    const first = createRequestId();
    const second = createRequestId();
    assert.ok(first);
    assert.ok(second);
    assert.notEqual(first, second);
    assert.match(first, uuidV4Pattern);
    assert.match(second, uuidV4Pattern);
  });
});
