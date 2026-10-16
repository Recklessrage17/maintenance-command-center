import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {candidate,candidateSha,packageRoot,legacy,legacySha,local,write} from './config.mjs';
const git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8'}).trim();
assert.match(candidateSha??'',/^[a-f0-9]{40}$/,'Supply the reviewed immutable MCC_ARM64_CANDIDATE_SHA.');
for(const directory of[candidate,packageRoot]){
 assert.equal(git(directory,'rev-parse','HEAD'),candidateSha,'Validation and application must use the same approved commit.');
 assert.equal(git(directory,'status','--porcelain','--untracked-files=normal'),'','Candidate must be clean.');
}
assert.equal(git(legacy,'rev-parse','HEAD'),legacySha);
assert.equal(git(legacy,'status','--porcelain','--untracked-files=normal'),'');
git(candidate,'merge-base','--is-ancestor',legacySha,candidateSha);
write('source-audit.json',{candidate:candidateSha,legacy:legacySha,validationHead:git(packageRoot,'rev-parse','HEAD'),localPreparation:local,version:'2.0.0'});
console.log('Exact clean candidate, validation code, and installed historical source verified.');
