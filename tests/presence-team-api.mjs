import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=path.join(root,'tmp',`presence-team-${Date.now()}-${process.pid}`);
const dataDir=path.join(fixture,'data');
const ownerPassword='Owner-Presence!7';
const techPassword='Tech-Presence!7';
const legacyPassword='Legacy-Presence!7';
const disabledPassword='Disabled-Presence!7';
const deletedPassword='Deleted-Presence!7';
const resetPassword='Reset-Presence!8';
const clients={
  owner:'11111111-1111-4111-8111-111111111111',
  techTabA:'22222222-2222-4222-8222-222222222222',
  techTabB:'33333333-3333-4333-8333-333333333333',
  techDeviceB:'44444444-4444-4444-8444-444444444444',
  disabled:'55555555-5555-4555-8555-555555555555',
  deleted:'66666666-6666-4666-8666-666666666666',
};
let server;
let serverOutput='';
let assertions=0;

function equal(actual,expected,message){assertions+=1;assert.equal(actual,expected,message);}
function ok(value,message){assertions+=1;assert.ok(value,message);}
function deepEqual(actual,expected,message){assertions+=1;assert.deepEqual(actual,expected,message);}
async function freePort(){return new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const address=probe.address();probe.close(error=>error?reject(error):resolve(address.port));});});}
async function start(port){
  const child=spawn(process.execPath,['backend/dist/server/index.js'],{cwd:root,env:{...process.env,PORT:String(port),NODE_ENV:'test',SESSION_SECRET:'presence-team-test',MCC_DATA_DIR:dataDir,MCC_UPLOADS_DIR:path.join(fixture,'uploads'),MCC_BACKUPS_DIR:path.join(fixture,'backups')},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',chunk=>serverOutput+=chunk);child.stderr.on('data',chunk=>serverOutput+=chunk);
  const base=`http://127.0.0.1:${port}`;
  for(let attempt=0;attempt<100;attempt+=1){if(child.exitCode!==null)throw new Error(`Backend exited.\n${serverOutput}`);try{if((await fetch(`${base}/api/health`)).ok)return{child,base};}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  throw new Error(`Backend did not start.\n${serverOutput}`);
}
async function stop(child){
  if(child&&child.exitCode===null){child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,10000))]);}
}
async function request(base,pathname,{method='GET',cookie='',body}={}){
  const response=await fetch(`${base}${pathname}`,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  return{response,data,cookie:response.headers.get('set-cookie')?.split(';')[0]||''};
}
async function login(base,email,password){
  const result=await request(base,'/api/auth/login',{method:'POST',body:{email,password}});
  equal(result.response.status,200,`Login failed for ${email}: ${JSON.stringify(result.data)}`);
  return result.cookie;
}
async function createUser(base,cookie,{fullName,email,role,password}){
  const result=await request(base,'/api/users',{method:'POST',cookie,body:{fullName,email,role,temporaryPassword:password}});
  equal(result.response.status,201,JSON.stringify(result.data));
  return result.data.user;
}
async function heartbeat(base,cookie,clientInstanceId,{visibility='visible',activity=true,lastActivityAt=new Date().toISOString(),extra={}}={}){
  return request(base,'/api/presence/heartbeat',{method:'POST',cookie,body:{clientInstanceId,visibility,activitySinceLastHeartbeat:activity,lastActivityAt,...extra}});
}
async function disconnect(base,cookie,clientInstanceId){
  return request(base,'/api/presence/disconnect',{method:'POST',cookie,body:{clientInstanceId}});
}
function findUser(roster,id){return roster.users.find(user=>user.id===id);}

async function run(){
  fs.mkdirSync(fixture,{recursive:true});
  let runtime=await start(await freePort());server=runtime.child;let{base}=runtime;
  let result=await heartbeat(base,'',clients.owner);
  equal(result.response.status,401);
  result=await disconnect(base,'',clients.owner);
  equal(result.response.status,401);
  result=await request(base,'/api/presence/team');
  equal(result.response.status,401);

  result=await request(base,'/api/auth/setup-first-admin',{method:'POST',body:{fullName:'Owner Admin',email:'owner@example.com',password:ownerPassword,confirmPassword:ownerPassword}});
  equal(result.response.status,200);
  const ownerCookie=await login(base,'owner@example.com',ownerPassword);
  result=await heartbeat(base,ownerCookie,clients.owner);
  equal(result.response.status,200);
  equal(result.data.written,true);

  result=await request(base,'/api/presence/team',{cookie:ownerCookie});
  equal(result.response.status,200);
  equal(result.data.onlineCount,1);
  equal(result.data.users[0].fullName,'Owner Admin');
  equal(result.data.users[0].rankProvenance.assignedBy,'System bootstrap');
  equal(result.data.users[0].rankProvenance.source,'system_bootstrap');
  equal(result.data.policy.heartbeatIntervalMs,25000);
  equal(result.data.policy.rosterRefreshIntervalMs,25000);
  equal(result.data.policy.onlineTimeoutMs,90000);
  equal(result.data.policy.awayAfterMs,300000);

  result=await heartbeat(base,ownerCookie,clients.owner,{activity:false});
  equal(result.response.status,200);
  equal(result.data.written,false);
  result=await heartbeat(base,ownerCookie,clients.owner,{extra:{userId:999}});
  equal(result.response.status,400);
  equal(result.data.code,'INVALID_PRESENCE_HEARTBEAT');
  result=await heartbeat(base,ownerCookie,clients.owner,{lastActivityAt:'not-a-date'});
  equal(result.response.status,400);

  const tech=await createUser(base,ownerCookie,{fullName:'Tier One User',email:'tech@example.com',role:'Maintenance Tech 1',password:techPassword});
  const legacy=await createUser(base,ownerCookie,{fullName:'Legacy User',email:'legacy@example.com',role:'Maintenance Tech 1',password:legacyPassword});
  const disabled=await createUser(base,ownerCookie,{fullName:'Disabled User',email:'disabled@example.com',role:'Maintenance Tech 1',password:disabledPassword});
  const deleted=await createUser(base,ownerCookie,{fullName:'Deleted User',email:'deleted@example.com',role:'Maintenance Tech 1',password:deletedPassword});
  const techCookieA=await login(base,'tech@example.com',techPassword);
  const techCookieB=await login(base,'tech@example.com',techPassword);
  const disabledCookie=await login(base,'disabled@example.com',disabledPassword);
  const deletedCookie=await login(base,'deleted@example.com',deletedPassword);
  equal((await heartbeat(base,techCookieA,clients.techTabA)).response.status,200);
  equal((await heartbeat(base,techCookieA,clients.techTabB)).response.status,200);
  equal((await heartbeat(base,techCookieB,clients.techDeviceB)).response.status,200);
  equal((await heartbeat(base,disabledCookie,clients.disabled)).response.status,200);
  equal((await heartbeat(base,deletedCookie,clients.deleted)).response.status,200);

  result=await request(base,`/api/users/${tech.id}/permissions`,{method:'PUT',cookie:ownerCookie,body:{permissionKeys:['inventory.create','inventory.edit']}});
  equal(result.response.status,200);
  result=await request(base,'/api/presence/team',{cookie:ownerCookie});
  equal(findUser(result.data,tech.id).presence,'Online');
  deepEqual(findUser(result.data,tech.id).specialPermissionGrants.map(grant=>grant.permissionKey),['inventory.create','inventory.edit']);
  equal(findUser(result.data,tech.id).specialPermissionGrants[0].grantedBy,'Owner Admin');
  equal(findUser(result.data,tech.id).rankProvenance.assignedBy,'Owner Admin');
  result=await request(base,'/api/users',{cookie:ownerCookie});
  equal(result.response.status,200);
  equal(findUser(result.data,tech.id).presence,'Online');
  equal(findUser(result.data,tech.id).disabled,false);
  equal(result.data.presencePolicy.onlineTimeoutMs,90000);

  const database=new DatabaseSync(path.join(dataDir,'mcc.sqlite'));
  let techPresence=database.prepare('SELECT * FROM user_presence_sessions WHERE user_id=? ORDER BY created_at').all(tech.id);
  equal(techPresence.length,3);
  equal(new Set(techPresence.map(row=>row.auth_session_ref_hash)).size,2);
  // Keep the heartbeat safely inside the live window without relying on two
  // Node processes observing the exact same millisecond under a loaded suite.
  const recentHeartbeat=new Date(Date.now()-1_000).toISOString();
  const awayActivity=new Date(Date.now()-301_000).toISOString();
  database.prepare("UPDATE user_presence_sessions SET last_heartbeat_at=?,last_activity_at=?,visibility='visible',logged_out_at=NULL,disconnected_at=NULL WHERE user_id=?").run(recentHeartbeat,awayActivity,tech.id);
  result=await request(base,'/api/presence/team',{cookie:ownerCookie});
  equal(findUser(result.data,tech.id).presence,'Away');
  equal(findUser(result.data,tech.id).lastSeenAt,awayActivity);

  const staleHeartbeat=new Date(Date.now()-91_000).toISOString();
  database.prepare('UPDATE user_presence_sessions SET last_heartbeat_at=? WHERE user_id=? AND logged_out_at IS NULL').run(staleHeartbeat,tech.id);
  result=await request(base,'/api/presence/team',{cookie:ownerCookie});
  equal(findUser(result.data,tech.id).presence,'Offline');

  equal((await heartbeat(base,techCookieA,clients.techTabA)).response.status,200);
  equal((await heartbeat(base,techCookieA,clients.techTabB)).response.status,200);
  equal((await heartbeat(base,techCookieB,clients.techDeviceB)).response.status,200);
  result=await disconnect(base,techCookieA,clients.techTabA);
  equal(result.response.status,200);
  equal(result.data.disconnected,true);
  result=await request(base,'/api/presence/team',{cookie:ownerCookie});
  equal(findUser(result.data,tech.id).presence,'Online');
  result=await disconnect(base,techCookieA,clients.techTabB);
  equal(result.response.status,200);
  result=await request(base,'/api/presence/team',{cookie:ownerCookie});
  equal(findUser(result.data,tech.id).presence,'Online');
  result=await request(base,'/api/auth/logout',{method:'POST',cookie:techCookieB});
  equal(result.response.status,200);
  result=await request(base,'/api/presence/team',{cookie:ownerCookie});
  equal(findUser(result.data,tech.id).presence,'Offline');

  equal((await heartbeat(base,techCookieA,clients.techTabA)).response.status,200);
  result=await request(base,'/api/auth/logout',{method:'POST',cookie:techCookieA});
  equal(result.response.status,200);
  result=await request(base,'/api/presence/team',{cookie:ownerCookie});
  equal(findUser(result.data,tech.id).presence,'Offline');

  const techCookieC=await login(base,'tech@example.com',techPassword);
  const techCookieD=await login(base,'tech@example.com',techPassword);
  equal((await heartbeat(base,techCookieC,clients.techTabA)).response.status,200);
  equal((await heartbeat(base,techCookieD,clients.techDeviceB)).response.status,200);
  result=await request(base,`/api/users/${tech.id}/reset-password`,{method:'POST',cookie:ownerCookie,body:{temporaryPassword:resetPassword,confirmTemporaryPassword:resetPassword}});
  equal(result.response.status,200);
  ok(result.data.sessionsInvalidated>=2);
  result=await request(base,'/api/auth/status',{cookie:techCookieC});
  equal(result.data.user,null);
  result=await request(base,'/api/auth/status',{cookie:techCookieD});
  equal(result.data.user,null);
  result=await request(base,'/api/presence/team',{cookie:ownerCookie});
  equal(findUser(result.data,tech.id).presence,'Offline');

  result=await request(base,`/api/users/${disabled.id}/disable`,{method:'POST',cookie:ownerCookie});
  equal(result.response.status,200);
  result=await request(base,'/api/auth/status',{cookie:disabledCookie});
  equal(result.data.user,null);
  result=await request(base,'/api/presence/team',{cookie:ownerCookie});
  equal(findUser(result.data,disabled.id).disabled,true);
  equal(findUser(result.data,disabled.id).presence,'Offline');
  equal(result.data.disabledCount,1);
  result=await request(base,'/api/users',{cookie:ownerCookie});
  equal(findUser(result.data,disabled.id).disabled,true);
  equal(findUser(result.data,disabled.id).presence,'Offline');

  result=await request(base,`/api/users/${deleted.id}`,{method:'DELETE',cookie:ownerCookie});
  equal(result.response.status,200);
  result=await request(base,'/api/auth/status',{cookie:deletedCookie});
  equal(result.data.user,null);
  result=await request(base,'/api/presence/team',{cookie:ownerCookie});
  equal(findUser(result.data,deleted.id),undefined);

  database.prepare('DELETE FROM user_role_assignments WHERE user_id=?').run(legacy.id);
  result=await request(base,'/api/presence/team',{cookie:ownerCookie});
  equal(findUser(result.data,legacy.id).rankProvenance.assignmentSourceAvailable,false);
  equal(findUser(result.data,legacy.id).rankProvenance.assignedBy,null);
  result=await request(base,`/api/users/${legacy.id}`,{method:'PATCH',cookie:ownerCookie,body:{role:'Maintenance Tech 2',roleChangeReason:'Training completed'}});
  equal(result.response.status,200);
  result=await request(base,'/api/presence/team',{cookie:ownerCookie});
  const changed=findUser(result.data,legacy.id);
  equal(changed.rankProvenance.assignedBy,'Owner Admin');
  equal(changed.rankProvenance.previousRank,'Maintenance Tech 1');
  equal(changed.rankProvenance.reason,'Training completed');
  ok(database.prepare("SELECT id FROM audit_log WHERE action='user update' AND target_id=? AND details_json LIKE '%Maintenance Tech 2%'").get(String(legacy.id)));

  const schema=database.prepare('PRAGMA table_info(user_presence_sessions)').all().map(column=>column.name);
  deepEqual(schema,['session_ref_hash','user_id','last_heartbeat_at','last_activity_at','logged_out_at','created_at','auth_session_ref_hash','visibility','disconnected_at']);
  const roleSchema=database.prepare('PRAGMA table_info(user_role_assignments)').all().map(column=>column.name);
  deepEqual(roleSchema,['id','user_id','previous_role','new_role','assigned_by_user_id','assigned_at','reason']);
  const rawOwnerSession=ownerCookie.split('=')[1].split('.')[0];
  const rosterJson=JSON.stringify(result.data);
  equal(rosterJson.includes(rawOwnerSession),false);
  for(const forbidden of ['owner@example.com','legacy@example.com',ownerPassword,legacyPassword,'password_hash','session_ref_hash','auth_session_ref_hash','ip_address','user_agent'])equal(rosterJson.includes(forbidden),false,`Roster exposed ${forbidden}`);
  database.close();

  await stop(server);
  runtime=await start(await freePort());server=runtime.child;base=runtime.base;
  result=await request(base,'/api/presence/team',{cookie:ownerCookie});
  equal(result.response.status,200);
  equal(findUser(result.data,1).presence,'Offline');
  result=await heartbeat(base,ownerCookie,clients.owner);
  equal(result.response.status,200);
  result=await request(base,'/api/presence/team',{cookie:ownerCookie});
  equal(findUser(result.data,1).presence,'Online');

  for(const secret of [ownerPassword,techPassword,legacyPassword,disabledPassword,deletedPassword,resetPassword])equal(serverOutput.includes(secret),false);
  console.log(`Presence and team API tests passed: ${assertions} assertions covering per-tab and multi-device aggregation, 90-second timeout, Away boundaries, disconnect/logout, reset/disable/delete revocation, spoof rejection, restart safety, and schema migration.`);
}

try{await run();}finally{
  await stop(server);
  const resolved=path.resolve(fixture);const allowed=path.resolve(root,'tmp');
  if(resolved.startsWith(`${allowed}${path.sep}`)&&fs.existsSync(resolved)){try{fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:250});}catch{}}
}
