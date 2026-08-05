import assert from 'node:assert/strict';
import { createPmMachineAssetResolver, strictPressNumberAlias } from '../backend/dist/server/pmAssetResolver.js';

const press25={id:1,asset_number:'Press 25'};
const resolver=createPmMachineAssetResolver([press25,{id:2,asset_number:'Mixer A'}]);

for(const value of ['25','Press 25','Press #25','Press No 25','Press No. 25','Press Number 25'])assert.equal(strictPressNumberAlias(value),'press:25',`${value} must qualify as a strict Press-number alias`);
for(const value of ['Line 25','Cell 25','ABC25','Serial 25','Machine serial 25','Building 25','Tool 25'])assert.equal(strictPressNumberAlias(value),null,`${value} must not qualify as a Press-number alias`);

for(const workbookIdentifier of ['25','Press #25','Press No 25','Press Number 25']){
  const resolution=resolver.resolve(workbookIdentifier);
  assert.equal(resolution.status,'resolved');
  assert.equal(resolution.asset,press25);
  assert.equal(resolution.matchType,'press_alias');
}
const exactPress=resolver.resolve('  PRESS   25  ');assert.equal(exactPress.status,'resolved');assert.equal(exactPress.asset,press25);assert.equal(exactPress.matchType,'exact');

const exactAsset={id:3,asset_number:'25'};
const exactPrecedence=createPmMachineAssetResolver([press25,exactAsset]).resolve('25');
assert.equal(exactPrecedence.status,'resolved');
assert.equal(exactPrecedence.asset,exactAsset,'an exact normalized asset number must win before Press alias matching');
assert.equal(exactPrecedence.matchType,'exact');

const ambiguous=createPmMachineAssetResolver([press25,{id:4,asset_number:'Press #25'}]).resolve('25');
assert.equal(ambiguous.status,'ambiguous');
assert.equal(ambiguous.matchType,'press_alias');
assert.deepEqual(ambiguous.assets.map(asset=>asset.id),[1,4]);

assert.equal(resolver.resolve('Press 999').status,'missing','a missing strict Press identifier must stay unresolved');
assert.equal(resolver.resolve('Line 25').status,'missing','unrelated numeric suffixes must stay unresolved');
const exactText=resolver.resolve('  MIXER   A  ');
assert.equal(exactText.status,'resolved');
assert.equal(exactText.asset.asset_number,'Mixer A','existing normalized exact text matching must continue to work');
assert.equal(exactText.matchType,'exact');

console.log('PM Excel asset resolver tests passed: strict aliases, exact precedence, ambiguity, missing assets, suffix rejection, and exact text matching.');
