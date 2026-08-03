import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=path.join(root,'tmp',`authentication-password-change-${Date.now()}-${process.pid}`);
const dataDir=path.join(fixture,'data');
const temporaryPassword='Temporary-Login!9';
const newPassword='Changed-Secure!8A';
const ownerPassword='Owner-Auth!7Test';
let server;
let output='';

async function freePort(){return new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const address=probe.address();probe.close(error=>error?reject(error):resolve(address.port));});});}
async function start(port){
  const child=spawn(process.execPath,['backend/dist/server/index.js'],{cwd:root,env:{...process.env,PORT:String(port),NODE_ENV:'test',SESSION_SECRET:'authentication-password-change-test',MCC_DATA_DIR:dataDir,MCC_UPLOADS_DIR:path.join(fixture,'uploads'),MCC_BACKUPS_DIR:path.join(fixture,'backups')},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const base=`http://127.0.0.1:${port}`;
  for(let attempt=0;attempt<100;attempt+=1){if(child.exitCode!==null)throw new Error(`Backend exited.\n${output}`);try{if((await fetch(`${base}/api/health`)).ok)return {child,base};}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  throw new Error(`Backend did not start.\n${output}`);
}
async function request(base,pathname,{method='GET',cookie='',body}={}){
  const response=await fetch(`${base}${pathname}`,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  return {response,data,cookie:response.headers.get('set-cookie')?.split(';')[0]||''};
}

async function run(){
  fs.mkdirSync(fixture,{recursive:true});
  const runtime=await start(await freePort());server=runtime.child;const {base}=runtime;
  let result=await request(base,'/api/auth/setup-first-admin',{method:'POST',body:{fullName:'Auth Owner',email:'owner@example.com',password:ownerPassword,confirmPassword:ownerPassword}});
  assert.equal(result.response.status,200);
  result=await request(base,'/api/auth/login',{method:'POST',body:{email:'owner@example.com',password:ownerPassword}});
  assert.equal(result.response.status,200);const ownerCookie=result.cookie;
  result=await request(base,'/api/users',{method:'POST',cookie:ownerCookie,body:{fullName:'Password Change User',email:'change@example.com',role:'Maintenance Tech 1',temporaryPassword}});
  assert.equal(result.response.status,201);const userId=result.data.user.id;

  result=await request(base,'/api/auth/login',{method:'POST',body:{email:'change@example.com',password:temporaryPassword}});
  assert.equal(result.response.status,200);
  assert.equal(result.data.user.forcePasswordChange,true);
  assert.equal(JSON.stringify(result.data).includes(temporaryPassword),false);
  const userCookie=result.cookie;
  result=await request(base,'/api/auth/change-password',{method:'POST',cookie:userCookie,body:{currentPassword:'Wrong-Current!8',newPassword,confirmPassword:newPassword}});
  assert.equal(result.response.status,400);
  assert.match(result.data.error,/Current password is incorrect/);
  result=await request(base,'/api/auth/change-password',{method:'POST',cookie:userCookie,body:{currentPassword:temporaryPassword,newPassword:'weak',confirmPassword:'weak'}});
  assert.equal(result.response.status,400);
  assert.match(result.data.error,/complexity rules/);
  result=await request(base,'/api/auth/change-password',{method:'POST',cookie:userCookie,body:{currentPassword:temporaryPassword,newPassword,confirmPassword:newPassword}});
  assert.equal(result.response.status,200);

  const database=new DatabaseSync(path.join(dataDir,'mcc.sqlite'));
  let row=database.prepare('SELECT force_password_change,temp_password_expires_at FROM users WHERE id=?').get(userId);
  assert.equal(row.force_password_change,0);
  assert.equal(row.temp_password_expires_at,null);
  const auditDetails=database.prepare("SELECT details_json FROM audit_log WHERE action='password change' AND target_id=?").get(String(userId)).details_json;
  assert.equal(auditDetails.includes(temporaryPassword),false);
  assert.equal(auditDetails.includes(newPassword),false);
  result=await request(base,'/api/auth/login',{method:'POST',body:{email:'change@example.com',password:temporaryPassword}});
  assert.equal(result.response.status,401);
  result=await request(base,'/api/auth/login',{method:'POST',body:{email:'change@example.com',password:newPassword}});
  assert.equal(result.response.status,200);
  assert.equal(result.data.user.forcePasswordChange,false);
  assert.equal(JSON.stringify(result.data).includes(newPassword),false);

  result=await request(base,'/api/users',{method:'POST',cookie:ownerCookie,body:{fullName:'Expired User',email:'expired@example.com',role:'Maintenance Tech 1',temporaryPassword}});
  assert.equal(result.response.status,201);
  database.prepare('UPDATE users SET temp_password_expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z',result.data.user.id);
  result=await request(base,'/api/auth/login',{method:'POST',body:{email:'expired@example.com',password:temporaryPassword}});
  assert.equal(result.response.status,401);
  assert.match(result.data.error,/Temporary password expired/);
  database.close();
  assert.equal(output.includes(temporaryPassword),false);
  assert.equal(output.includes(newPassword),false);
  console.log('Authentication/password-change regression tests passed: forced change, complexity enforcement, credential rotation, expiration, response secrecy, and audit/log secrecy.');
}

try{await run();}finally{
  if(server&&server.exitCode===null){server.kill();await Promise.race([new Promise(resolve=>server.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);}
  const resolved=path.resolve(fixture);const allowed=path.resolve(root,'tmp');
  if(resolved.startsWith(`${allowed}${path.sep}`)&&fs.existsSync(resolved))fs.rmSync(resolved,{recursive:true,force:true});
}
