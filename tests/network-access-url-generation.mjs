import assert from 'node:assert/strict';
import { canonicalHttpsAccess, canonicalHttpsUrl } from '../backend/dist/server/networkAccess.js';

assert.equal(canonicalHttpsUrl('mcc-stage.local'), 'https://mcc-stage.local', 'Staging must use its canonical HTTPS hostname.');
assert.equal(canonicalHttpsUrl('mcc.local'), 'https://mcc.local', 'Production must use its canonical HTTPS hostname.');
assert.equal(canonicalHttpsUrl(' MCC-STAGE.local '), 'https://mcc-stage.local', 'Configured hostnames should be normalized.');
assert.equal(canonicalHttpsUrl('MCC.PLANT.COMPANY.COM', 'public'), 'https://mcc.plant.company.com', 'Public DNS hostnames must be supported and normalized.');
assert.deepEqual(canonicalHttpsAccess('mcc-stage.local', 'internal'), {
  url: 'https://mcc-stage.local',
  certificateMode: 'internal',
}, 'Internal-CA mode must remain available for managed .local deployments.');
assert.deepEqual(canonicalHttpsAccess('mcc.plant.company.com', 'public'), {
  url: 'https://mcc.plant.company.com',
  certificateMode: 'public',
}, 'Public mode must retain its certificate mode for Network Access guidance.');
assert.equal(canonicalHttpsUrl(undefined), null, 'An unset hostname must preserve development behavior.');
assert.equal(canonicalHttpsUrl(''), null, 'A blank hostname must preserve development behavior.');

for (const invalid of ['http://mcc.local', 'mcc.local:4273', '127.0.0.1', 'mcc.local/path', 'mcc..company.com', '-mcc.company.com', 'mcc.company.com.']) {
  assert.throws(() => canonicalHttpsUrl(invalid), /valid DNS hostname/, `Rejected unsafe canonical hostname: ${invalid}`);
}
for (const reserved of [
  'mcc.alt',
  'mcc.arpa',
  'home.arpa',
  'mcc.internal',
  'mcc.local',
  'mcc.localhost',
  'mcc.onion',
  'mcc.example',
  'example.com',
  'mcc.example.com',
  'example.net',
  'mcc.example.net',
  'example.org',
  'mcc.example.org',
  'mcc.invalid',
  'mcc.test',
]) {
  assert.throws(() => canonicalHttpsUrl(reserved, 'public'), /real public DNS hostname/, `Rejected non-public hostname in public mode: ${reserved}`);
}
assert.throws(() => canonicalHttpsUrl('mcc.company.com', 'internal'), /requires a \.local/, 'Internal mode must not be mislabeled as public DNS.');
assert.throws(() => canonicalHttpsUrl('mcc.company.com', 'unsupported'), /must be "internal" or "public"/, 'Unknown HTTPS modes must fail closed.');
assert.throws(() => canonicalHttpsUrl('mcc.company.123', 'public'), /non-numeric top-level label/, 'Numeric pseudo-TLDs must not enter public mode.');

console.log('Network access canonical URL generation passed.');
