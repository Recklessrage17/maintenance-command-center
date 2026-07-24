import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=path.join(root,'tmp',`password-permissions-${Date.now()}-${process.pid}`);
const dataDir=path.join(fixture,'data');
const ownerPassword='Owner-Permissions!7';
const managerPassword='Manager-Permissions!7';
const tech3Password='Tech3-Permissions!7';
const tech1Password='Tech1-Permissions!7';
const resetPassword='Reset-Temporary!8';
const finalPassword='Final-Password!9A';
let server;
let serverOutput='';

async function freePort(){return new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const address=probe.address();probe.close(error=>error?reject(error):resolve(address.port));});});}
async function start(port){
  const child=spawn(process.execPath,['backend/dist/server/index.js'],{cwd:root,env:{...process.env,PORT:String(port),NODE_ENV:'test',SESSION_SECRET:'password-permissions-test',MCC_DATA_DIR:dataDir,MCC_UPLOADS_DIR:path.join(fixture,'uploads'),MCC_BACKUPS_DIR:path.join(fixture,'backups')},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',chunk=>serverOutput+=chunk);child.stderr.on('data',chunk=>serverOutput+=chunk);
  const base=`http://127.0.0.1:${port}`;
  for(let attempt=0;attempt<100;attempt+=1){if(child.exitCode!==null)throw new Error(`Backend exited.\n${serverOutput}`);try{if((await fetch(`${base}/api/health`)).ok)return{child,base};}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  throw new Error(`Backend did not start.\n${serverOutput}`);
}
async function request(base,pathname,{method='GET',cookie='',body}={}){
  const response=await fetch(`${base}${pathname}`,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  return{response,data,cookie:response.headers.get('set-cookie')?.split(';')[0]||''};
}
async function login(base,email,password){
  const result=await request(base,'/api/auth/login',{method:'POST',body:{email,password}});
  assert.equal(result.response.status,200,`Login failed for ${email}: ${JSON.stringify(result.data)}`);
  return result.cookie;
}
async function createUser(base,cookie,{fullName,email,role,password}){
  const result=await request(base,'/api/users',{method:'POST',cookie,body:{fullName,email,role,temporaryPassword:password}});
  assert.equal(result.response.status,201,JSON.stringify(result.data));
  return result.data.user;
}

async function run(){
  fs.mkdirSync(fixture,{recursive:true});
  const runtime=await start(await freePort());server=runtime.child;const{base}=runtime;
  let result=await request(base,'/api/auth/setup-first-admin',{method:'POST',body:{fullName:'Owner Admin',email:'owner@example.com',password:ownerPassword,confirmPassword:ownerPassword}});
  assert.equal(result.response.status,200);
  const ownerCookie=await login(base,'owner@example.com',ownerPassword);
  const manager=await createUser(base,ownerCookie,{fullName:'Manager User',email:'manager@example.com',role:'Manager',password:managerPassword});
  const tech3=await createUser(base,ownerCookie,{fullName:'Tier 3 User',email:'tech3@example.com',role:'Maintenance Tech 3',password:tech3Password});
  const tech1=await createUser(base,ownerCookie,{fullName:'Tier 1 User',email:'tech1@example.com',role:'Maintenance Tech 1',password:tech1Password});
  const disabled=await createUser(base,ownerCookie,{fullName:'Disabled User',email:'disabled@example.com',role:'Maintenance Tech 1',password:'Disabled-User!7'});
  const deleted=await createUser(base,ownerCookie,{fullName:'Deleted User',email:'deleted@example.com',role:'Maintenance Tech 1',password:'Deleted-User!7'});
  await request(base,`/api/users/${disabled.id}/disable`,{method:'POST',cookie:ownerCookie});
  await request(base,`/api/users/${deleted.id}`,{method:'DELETE',cookie:ownerCookie});

  const managerCookie=await login(base,'manager@example.com',managerPassword);
  const tech3Cookie=await login(base,'tech3@example.com',tech3Password);
  const tech1Cookie=await login(base,'tech1@example.com',tech1Password);

  result=await request(base,`/api/users/${tech1.id}/reset-password`,{method:'POST',cookie:tech3Cookie,body:{temporaryPassword:resetPassword,confirmTemporaryPassword:resetPassword}});
  assert.equal(result.response.status,403);
  assert.equal(result.data.code,'PERMISSION_REQUIRED');
  result=await request(base,'/api/users/1/reset-password',{method:'POST',cookie:managerCookie,body:{temporaryPassword:resetPassword,confirmTemporaryPassword:resetPassword}});
  assert.equal(result.response.status,403);
  result=await request(base,`/api/users/${deleted.id}/reset-password`,{method:'POST',cookie:managerCookie,body:{temporaryPassword:resetPassword,confirmTemporaryPassword:resetPassword}});
  assert.equal(result.response.status,404);
  result=await request(base,`/api/users/${tech1.id}/reset-password`,{method:'POST',cookie:managerCookie,body:{temporaryPassword:'weak',confirmTemporaryPassword:'weak'}});
  assert.equal(result.response.status,400);
  assert.equal(result.data.code,'PASSWORD_COMPLEXITY');
  result=await request(base,`/api/users/${tech1.id}/reset-password`,{method:'POST',cookie:managerCookie,body:{temporaryPassword:resetPassword,confirmTemporaryPassword:'Mismatch-Password!7'}});
  assert.equal(result.response.status,400);
  assert.equal(result.data.code,'PASSWORD_CONFIRMATION_MISMATCH');

  result=await request(base,`/api/users/${tech1.id}/reset-password`,{method:'POST',cookie:managerCookie,body:{temporaryPassword:resetPassword,confirmTemporaryPassword:resetPassword}});
  assert.equal(result.response.status,200);
  assert.equal(result.data.temporaryPassword,resetPassword);
  assert.equal(result.data.forcePasswordChange,true);
  assert.ok(result.data.sessionsInvalidated>=1);
  assert.equal(result.response.headers.get('cache-control'),'no-store');
  result=await request(base,'/api/auth/status',{cookie:tech1Cookie});
  assert.equal(result.data.user,null);

  result=await request(base,`/api/users/${disabled.id}/reset-password`,{method:'POST',cookie:managerCookie,body:{temporaryPassword:resetPassword,confirmTemporaryPassword:resetPassword}});
  assert.equal(result.response.status,200);
  const database=new DatabaseSync(path.join(dataDir,'mcc.sqlite'));
  let row=database.prepare('SELECT disabled,force_password_change,temp_password_expires_at,password_hash FROM users WHERE id=?').get(disabled.id);
  assert.equal(row.disabled,1);
  assert.equal(row.force_password_change,1);
  assert.notEqual(row.password_hash,resetPassword);

  const temporaryCookie=await login(base,'tech1@example.com',resetPassword);
  result=await request(base,'/api/auth/status',{cookie:temporaryCookie});
  assert.equal(result.data.user.forcePasswordChange,true);
  result=await request(base,'/api/auth/change-password',{method:'POST',cookie:temporaryCookie,body:{currentPassword:resetPassword,newPassword:finalPassword,confirmPassword:finalPassword}});
  assert.equal(result.response.status,200);
  row=database.prepare('SELECT force_password_change,temp_password_expires_at FROM users WHERE id=?').get(tech1.id);
  assert.equal(row.force_password_change,0);
  assert.equal(row.temp_password_expires_at,null);
  const finalCookie=await login(base,'tech1@example.com',finalPassword);
  result=await request(base,'/api/auth/status',{cookie:finalCookie});
  assert.equal(result.data.user.forcePasswordChange,false);

  result=await request(base,`/api/users/${tech1.id}/permissions`,{method:'PUT',cookie:tech3Cookie,body:{permissionKeys:['inventory.create','inventory.edit']}});
  assert.equal(result.response.status,200,JSON.stringify(result.data));
  assert.deepEqual(result.data.specialPermissionGrants.map(grant=>grant.permissionKey),['inventory.create','inventory.edit']);
  assert.equal(result.data.user.role,'Maintenance Tech 1');
  result=await request(base,`/api/users/${tech1.id}/permissions`,{cookie:tech3Cookie});
  assert.equal(result.response.status,200);
  assert.deepEqual(result.data.specialPermissionGrants.map(grant=>grant.permissionKey),['inventory.create','inventory.edit']);
  assert.equal(result.data.inheritedPermissions.includes('inventory.view'),true);
  assert.equal(result.data.specialPermissionGrants.some(grant=>grant.permissionKey==='inventory.view'),false);

  const partPayload={partNumber:'PERM-001',description:'Permission-created part',vendor:'Permission Vendor',location:'Stores',quantity:1,minQuantity:0,unitCost:1,status:'In Stock',requisition:'No'};
  result=await request(base,'/api/inventory/native/parts',{method:'POST',cookie:finalCookie,body:partPayload});
  assert.equal(result.response.status,201,JSON.stringify(result.data));
  const partId=result.data.part.id;
  result=await request(base,`/api/inventory/native/parts/${partId}`,{method:'PATCH',cookie:finalCookie,body:{...partPayload,description:'Permission-edited part',quantity:2}});
  assert.equal(result.response.status,200,JSON.stringify(result.data));
  result=await request(base,'/api/inventory/native/import',{method:'POST',cookie:finalCookie});
  assert.equal(result.response.status,403);
  assert.equal(result.data.permission,'inventory.import');

  result=await request(base,`/api/users/${manager.id}/permissions`,{method:'PUT',cookie:tech3Cookie,body:{permissionKeys:['inventory.create']}});
  assert.equal(result.response.status,403);
  result=await request(base,`/api/users/${tech1.id}/permissions`,{method:'PUT',cookie:tech3Cookie,body:{permissionKeys:['inventory.delete']}});
  assert.equal(result.response.status,403);
  assert.equal(result.data.permission,'inventory.delete');

  result=await request(base,`/api/users/${tech1.id}/permissions`,{method:'PUT',cookie:managerCookie,body:{permissionKeys:['inventory.create','inventory.edit','history.view']}});
  assert.equal(result.response.status,200);
  result=await request(base,'/api/history/summary',{cookie:finalCookie});
  assert.equal(result.response.status,200);
  result=await request(base,'/api/history/export/pdf',{method:'POST',cookie:finalCookie,body:{}});
  assert.equal(result.response.status,403);
  assert.equal(result.data.permission,'history.export');

  result=await request(base,`/api/users/${tech1.id}/permissions`,{method:'PUT',cookie:managerCookie,body:{permissionKeys:['inventory.create']}});
  assert.equal(result.response.status,200);
  assert.deepEqual(result.data.specialPermissionGrants.map(grant=>grant.permissionKey),['inventory.create']);
  result=await request(base,`/api/users/${tech1.id}/permissions`,{method:'PUT',cookie:managerCookie,body:{permissionKeys:[]}});
  assert.equal(result.response.status,200);
  assert.equal(result.data.specialPermissionGrants.length,0);
  for(const [pathname,permission] of [
    ['/api/machine-library/assets','machine.create'],
    ['/api/equipment-library/assets','equipment.create'],
    ['/api/facility-info/areas','facility.create'],
    ['/api/vendors','vendors.create'],
  ]){
    result=await request(base,pathname,{method:'POST',cookie:finalCookie,body:{}});
    assert.equal(result.response.status,403,`${pathname} must reject a direct write.`);
    assert.equal(result.data.permission,permission);
  }

  result=await request(base,`/api/users/${disabled.id}/permissions`,{method:'PUT',cookie:managerCookie,body:{permissionKeys:['facility.upload']}});
  assert.equal(result.response.status,200);
  result=await request(base,'/api/users',{cookie:managerCookie});
  const disabledPublic=result.data.users.find(user=>user.id===disabled.id);
  assert.equal(disabledPublic.disabled,true);
  assert.deepEqual(disabledPublic.specialPermissionGrants.map(grant=>grant.permissionKey),['facility.upload']);

  const grant=database.prepare("SELECT id FROM user_permission_grants WHERE user_id=? AND permission_key='facility.upload' AND revoked_at IS NULL").get(disabled.id);
  database.prepare('UPDATE user_permission_grants SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z',grant.id);
  result=await request(base,'/api/users',{cookie:managerCookie});
  assert.equal(result.data.users.find(user=>user.id===disabled.id).specialPermissionGrants.length,0);

  const auditText=database.prepare("SELECT group_concat(details_json,' ') AS details FROM audit_log").get().details||'';
  assert.equal(auditText.includes(resetPassword),false);
  assert.equal(auditText.includes(finalPassword),false);
  assert.ok(database.prepare("SELECT id FROM audit_log WHERE action='password reset performed' AND target_id=?").get(String(tech1.id)));
  assert.ok(database.prepare("SELECT id FROM audit_log WHERE action='permission granted' AND target_id=?").get(String(tech1.id)));
  database.close();
  for(const secret of [resetPassword,finalPassword,ownerPassword,managerPassword,tech3Password,tech1Password])assert.equal(serverOutput.includes(secret),false);
  console.log('Password and permissions API tests passed: 40 assertions groups covering reset authorization, one-time response, session invalidation, disabled/deleted/Owner protection, forced update, grant hierarchy, effective access, direct 403 enforcement, revoke/expiration, and audit/log secrecy.');
}

try{await run();}finally{
  if(server&&server.exitCode===null){server.kill();await Promise.race([new Promise(resolve=>server.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,10000))]);}
  const resolved=path.resolve(fixture);const allowed=path.resolve(root,'tmp');
  if(resolved.startsWith(`${allowed}${path.sep}`)&&fs.existsSync(resolved)){try{fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:250});}catch{}}
}
