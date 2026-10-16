import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {candidate,candidateSha,packageRoot,legacy,legacySha,local,write} from './config.mjs';
const git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8'}).trim();
assert.equal(git(candidate,'rev-parse','HEAD'),candidateSha);assert.equal(git(legacy,'rev-parse','HEAD'),legacySha);
assert.equal(git(candidate,'diff','HEAD','--name-only'),'');
const head=git(packageRoot,'rev-parse','HEAD');git(packageRoot,'merge-base','--is-ancestor',candidateSha,head);
const entries=git(packageRoot,'diff','--name-status',candidateSha,head).split('\n').filter(Boolean);
for(const line of entries){const[type,file]=line.split('\t');assert.equal(type,'A','Only added validation files are permitted.');assert.ok(file==='.github/workflows/arm64-release-validation.yml'||file.startsWith('validation/arm64/'),`Unexpected published change: ${file}`);}
if(!local){const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH));assert.equal(event.pull_request.base.sha,candidateSha);assert.equal(event.pull_request.base.ref,'codex/release-hardening-safe-recovery');assert.equal(event.pull_request.head.ref,'codex/arm64-release-validation');assert.equal(event.pull_request.head.repo.full_name,'Recklessrage17/maintenance-command-center');assert.equal(head,event.pull_request.head.sha);assert.ok(entries.length>=10,'Validation package is missing from the published head.');}
write('source-audit.json',{candidate:candidateSha,legacy:legacySha,validationHead:head,baseSha:candidateSha,changes:entries,localPreparation:local,version:'1.5.18'});console.log('Pinned source and validation-only changes verified.');
