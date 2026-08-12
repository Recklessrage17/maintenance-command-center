import assert from 'node:assert/strict';
import { canonicalHttpsUrl } from '../backend/dist/server/networkAccess.js';

assert.equal(canonicalHttpsUrl('mcc-stage.local'), 'https://mcc-stage.local', 'Staging must use its canonical HTTPS hostname.');
assert.equal(canonicalHttpsUrl('mcc.local'), 'https://mcc.local', 'Production must use its canonical HTTPS hostname.');
assert.equal(canonicalHttpsUrl(' MCC-STAGE.local '), 'https://mcc-stage.local', 'Configured hostnames should be normalized.');
assert.equal(canonicalHttpsUrl(undefined), null, 'An unset hostname must preserve development behavior.');
assert.equal(canonicalHttpsUrl(''), null, 'A blank hostname must preserve development behavior.');

for (const invalid of ['http://mcc.local', 'mcc.local:4273', 'mcc.example.com', '127.0.0.1', 'mcc.local/path']) {
  assert.throws(() => canonicalHttpsUrl(invalid), /valid \.local hostname/, `Rejected unsafe canonical hostname: ${invalid}`);
}

console.log('Network access canonical URL generation passed.');
