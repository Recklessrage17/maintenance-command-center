import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {backendFixture,owner,request} from './helpers/security-process.mjs';
import {inspectionFixture} from './helpers/inspection-records-fixture.mjs';
import {seedMachineHistory,digest} from './helpers/machine-archive-data.mjs';
import {storedUploadPath} from '../backend/dist/server/storedUploadPath.js';
let checks=0;
for(const layout of ['external','default']) {
 const runtime=layout==='external'?await backendFixture('external-upload-root'):await inspectionFixture('default-upload-root');let db;
 try {
  const cookie=await owner(runtime.base),assets=[];for(const assetNumber of['FILES-1','FILES-2'])assets.push((await request(runtime.base,'/api/machine-library/assets',{method:'POST',cookie,body:{assetNumber,assetName:'Configured file root',brand:'MCC'}})).data.asset);
  db=new DatabaseSync(path.join(runtime.fixture,'data/mcc.sqlite'));const graph=seedMachineHistory(db,runtime,assets[0].id,assets[1].id);
  const routes=[{url:`/api/machine-library/inspection-records/${graph.inspectionId}/file`,table:'machine_inspection_records',id:graph.inspectionId,prefix:'uploads/machine-inspection-records/',original:'uploads/machine-inspection-records/kept.txt',file:graph.payloads[0]}, {url:`/api/machine-library/assets/${assets[0].id}/component-images/screw/image`,table:'machine_component_images',id:db.prepare('SELECT id FROM machine_component_images WHERE asset_id=?').get(assets[0].id).id,prefix:'uploads/machine-component-images/',original:'uploads/machine-component-images/screw.png',file:graph.payloads[1]}];
  for(const route of routes) {
   for(const auth of [false,true]){const r=await fetch(runtime.base+route.url,{headers:auth?{Cookie:cookie}:{}});assert.equal(r.status,auth?200:401);if(auth)assert.equal(digest(Buffer.from(await r.arrayBuffer())),route.file.sha256);else await r.arrayBuffer();checks++;}
   db.prepare(`UPDATE ${route.table} SET stored_file_reference=? WHERE id=?`).run(route.prefix+'missing.txt',route.id);let r=await fetch(runtime.base+route.url,{headers:{Cookie:cookie}});assert.equal(r.status,404);await r.arrayBuffer();checks++;
   const outside=path.join(runtime.fixture,'outside');fs.mkdirSync(outside,{recursive:true});fs.writeFileSync(path.join(outside,'secret.txt'),'OUTSIDE ROOT SECRET');
   const category=path.dirname(route.file.destination),link=path.join(category,'linked');fs.symlinkSync(outside,link,'junction');
   for(const reference of[route.prefix+'../outside/secret.txt',route.prefix+'..\\outside\\secret.txt',route.prefix+'C:/outside/secret.txt',route.prefix+'/secret.txt',route.prefix+'linked/secret.txt','/etc/passwd']){db.prepare(`UPDATE ${route.table} SET stored_file_reference=? WHERE id=?`).run(reference,route.id);r=await fetch(runtime.base+route.url,{headers:{Cookie:cookie}});assert.ok(r.status>=400,`${layout}: ${reference}`);assert.ok(!(await r.text()).includes('OUTSIDE ROOT SECRET'));checks++;}
   assert.throws(()=>storedUploadPath(link,route.prefix+'secret.txt',route.prefix),/invalid/);checks++;
   db.prepare(`UPDATE ${route.table} SET stored_file_reference=? WHERE id=?`).run(route.original,route.id);
   assert.equal(digest(fs.readFileSync(route.file.destination)),route.file.sha256);checks++;
  }
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 } finally {if(db)db.close();await runtime.close();}
}
console.log(`PASS external/default uploads: ${checks} authentication, exact-byte, missing-file, traversal, drive, junction/root-link and invariance checks.`);
