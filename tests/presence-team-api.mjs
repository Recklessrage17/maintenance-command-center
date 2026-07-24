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
function findUser(roster,id){return roster.users.find(user=>user.id===id);}

async function run(){
  fs.mkdirSync(fixture,{recursive:true});
  let runtime=await start(await freePort());server=runtime.child;let{base}=runtime;
  let result=await request(base,'/api/presence/team');
  equal(result.response.status,401);
  result=await request(base,'/api/auth/setup-first-admin',{method:'POST',body:{fullName:'Owner Admin',email:'owner@example.com',password:ownerPassword,confirmPassword:ownerPassword}});
  equal(result.response.status,200);
  const ownerCookie=await login(base,'owner@example.com',ownerPassword);

  result=await request(base,'/api/presence/team',{cookie:ownerCookie});
  equal(result.response.status,200);
  equal(result.data.onlineCount,1);
  equal(result.data.users[0].fullName,'Owner Admin');
  equal(result.data.users[0].rankProvenance.assignedBy,'System bootstrap');
  equal(result.data.users[0].rankProvenance.source,'system_bootstrap');
  equal(result.data.policy.onlineThresholdMs,120000);
  equal(result.data.policy.awayAfterMs,600000);

  const heartbeat=await request(base,'/api/presence/heartbeat',{method:'POST',cookie:ownerCookie,body:{active:true}});
  equal(heartbeat.response.status,200);
  equal(heartbeat.data.written,false);

  const tech=await createUser(base,ownerCookie,{fullName:'Tier One User',email:'tech@example.com',role:'Maintenance Tech 1',password:techPassword});
  const legacy=await createUser(base,ownerCookie,{fullName:'Legacy User',email:'legacy@example.com',role:'Maintenance Tech 1',password:legacyPassword});
  const disabled=await createUser(base,ownerCookie,{fullName:'Disabled User',email:'disabled@example.com',role:'Maintenance Tech 1',password:disabledPassword});
  const deleted=await createUser(base,ownerCookie,{fullName:'Deleted User',email:'deleted@example.com',role:'Maintenance Tech 1',password:deletedPassword});
  const techCookieA=await login(base,'tech@example.com',techPassword);
  const techCookieB=await login(base,'tech@example.com',techPassword);
  const disabledCookie=await login(base,'disabled@example.com',disabledPassword);
  const deletedCookie=await login(base,'deleted@example.com',deletedPassword);

  result=await request(base,`/api/users/${tech.id}/permissions`,{method:'PUT',cookie:ownerCookie,body:{permissionKeys:['inventory.create','inventory.edit']}});
  equal(result.response.status,200);
  result=await request(base,'/api/presence/team',{cookie:ownerCookie});
  equal(findUser(result.data,tech.id).presence,'Online');
  deepEqual(findUser(result.data,tech.id).specialPermissionGrants.map(grant=>grant.permissionKey),['inventory.create','inventory.edit']);
  equal(findUser(result.data,tech.id).specialPermissionGrants[0].grantedBy,'Owner Admin');
  equal(findUser(result.data,tech.id).rankProvenance.assignedBy,'Owner Admin');

  const database=new DatabaseSync(path.join(dataDir,'mcc.sqlite'));
  const techPresence=database.prepare('SELECT session_ref_hash FROM user_presence_sessions WHERE user_id=? ORDER BY created_at').all(tech.id);
  equal(techPresence.length,2);
  const staleHeartbeat='2000-01-01T00:00:00.000Z';
  const staleActivity='1999-12-31T23:50:00.000Z';
  database.prepare('UPDATE user_presence_sessions SET last_activity_at=? WHERE user_id=? AND logged_out_at IS NULL').run(staleActivity,tech.id);
  result=await request(base,'/api/presence/team',{cookie:ownerCookie});
  equal(findUser(result.data,tech.id).presence,'Away');
  equal(findUser(result.data,tech.id).lastSeenAt,staleActivity);

  database.prepare('UPDATE user_presence_sessions SET last_heartbeat_at=?,last_activity_at=? WHERE user_id=? AND logged_out_at IS NULL').run(staleHeartbeat,staleActivity,tech.id);
  result=await request(base,'/api/presence/team',{cookie:ownerCookie});
  equal(findUser(result.data,tech.id).presence,'Offline');
  result=await request(base,'/api/presence/heartbeat',{method:'POST',cookie:techCookieA,body:{active:true}});
  equal(result.response.status,200);
  result=await request(base,'/api/presence/heartbeat',{method:'POST',cookie:techCookieB,body:{active:true}});
  equal(result.response.status,200);
  result=await request(base,'/api/presence/team',{cookie:ownerCookie});
  equal(findUser(result.data,tech.id).presence,'Online');

  result=await request(base,'/api/auth/logout',{method:'POST',cookie:techCookieA});
  equal(result.response.status,200);
  result=await request(base,'/api/presence/team',{cookie:ownerCookie});
  equal(findUser(result.data,tech.id).presence,'Online');
  result=await request(base,'/api/auth/logout',{method:'POST',cookie:techCookieB});
  equal(result.response.status,200);
  result=await request(base,'/api/presence/team',{cookie:ownerCookie});
  equal(findUser(result.data,tech.id).presence,'Offline');

  const techCookieC=await login(base,'tech@example.com',techPassword);
  const techCookieD=await login(base,'tech@example.com',techPassword);
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
  deepEqual(schema,['session_ref_hash','user_id','last_heartbeat_at','last_activity_at','logged_out_at','created_at']);
  const roleSchema=database.prepare('PRAGMA table_info(user_role_assignments)').all().map(column=>column.name);
  deepEqual(roleSchema,['id','user_id','previous_role','new_role','assigned_by_user_id','assigned_at','reason']);
  const rawOwnerSession=ownerCookie.split('=')[1].split('.')[0];
  const rosterJson=JSON.stringify(result.data);
  equal(rosterJson.includes(rawOwnerSession),false);
  for(const forbidden of ['owner@example.com','legacy@example.com',ownerPassword,legacyPassword,'password_hash','session_ref_hash','ip_address','user_agent'])equal(rosterJson.includes(forbidden),false,`Roster exposed ${forbidden}`);
  database.close();

  await stop(server);
  runtime=await start(await freePort());server=runtime.child;base=runtime.base;
  result=await request(base,'/api/presence/team',{cookie:ownerCookie});
  equal(result.response.status,200);
  equal(findUser(result.data,1).presence,'Offline');
  result=await request(base,'/api/presence/heartbeat',{method:'POST',cookie:ownerCookie,body:{active:true}});
  equal(result.response.status,200);
  result=await request(base,'/api/presence/team',{cookie:ownerCookie});
  equal(findUser(result.data,1).presence,'Online');

  for(const secret of [ownerPassword,techPassword,legacyPassword,disabledPassword,deletedPassword,resetPassword])equal(serverOutput.includes(secret),false);
  console.log(`Presence and team API tests passed: ${assertions} assertions covering heartbeat throttling, Online/Away/Offline thresholds, multiple sessions, logout/reset/disable/delete invalidation, restart staleness, safe roster fields, permission badge provenance, and rank assignment history.`);
}

try{await run();}finally{
  await stop(server);
  const resolved=path.resolve(fixture);const allowed=path.resolve(root,'tmp');
  if(resolved.startsWith(`${allowed}${path.sep}`)&&fs.existsSync(resolved)){try{fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:250});}catch{}}
}
