import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=path.join(root,'tmp',`user-management-api-${Date.now()}-${process.pid}`);
const dataDir=path.join(fixture,'data');
const uploadsDir=path.join(fixture,'uploads');
const backupsDir=path.join(fixture,'backups');
const ownerPassword='Owner-Setup!9A';
const validTemporaryPassword='Valid-Temporary!9';
const passwordError={
  error:'Temporary password must be at least 10 characters and include an uppercase letter, lowercase letter, number, and symbol.',
  code:'PASSWORD_COMPLEXITY',
  field:'temporaryPassword',
  requirements:{minLength:10,uppercase:true,lowercase:true,number:true,symbol:true},
};
let server;
let serverOutput='';

async function freePort(){return new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const address=probe.address();probe.close(error=>error?reject(error):resolve(address.port));});});}
async function start(port){
  const child=spawn(process.execPath,['backend/dist/server/index.js'],{cwd:root,env:{...process.env,PORT:String(port),NODE_ENV:'test',SESSION_SECRET:'user-management-api-test',MCC_DATA_DIR:dataDir,MCC_UPLOADS_DIR:uploadsDir,MCC_BACKUPS_DIR:backupsDir},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',chunk=>serverOutput+=chunk);
  child.stderr.on('data',chunk=>serverOutput+=chunk);
  const base=`http://127.0.0.1:${port}`;
  for(let attempt=0;attempt<100;attempt+=1){
    if(child.exitCode!==null)throw new Error(`Backend exited.\n${serverOutput}`);
    try{if((await fetch(`${base}/api/health`)).ok)return {child,base};}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error(`Backend did not start.\n${serverOutput}`);
}
async function request(base,pathname,{method='GET',cookie='',body}={}){
  const response=await fetch(`${base}${pathname}`,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  return {response,data,cookie:response.headers.get('set-cookie')?.split(';')[0]||''};
}
async function login(base,email,password){
  const result=await request(base,'/api/auth/login',{method:'POST',body:{email,password}});
  assert.equal(result.response.status,200);
  return result.cookie;
}

async function run(){
  fs.mkdirSync(fixture,{recursive:true});
  const runtime=await start(await freePort());
  server=runtime.child;
  const {base}=runtime;
  let result=await request(base,'/api/auth/setup-first-admin',{method:'POST',body:{fullName:'Owner Admin',email:'owner@example.com',password:ownerPassword,confirmPassword:ownerPassword}});
  assert.equal(result.response.status,200);
  const ownerCookie=await login(base,'owner@example.com',ownerPassword);

  const invalidPasswords=[
    ['fewer than 10 characters','Aa1!short'],
    ['missing uppercase','lowercase1!long'],
    ['missing lowercase','UPPERCASE1!LONG'],
    ['missing number','NoNumbers!Here'],
    ['missing symbol','NoSymbols123A'],
  ];
  for(const [label,temporaryPassword] of invalidPasswords){
    result=await request(base,'/api/users',{method:'POST',cookie:ownerCookie,body:{fullName:'Rejected User',email:'rejected@example.com',role:'Maintenance Tech 1',temporaryPassword}});
    assert.equal(result.response.status,400,`${label} must be rejected.`);
    assert.deepEqual(result.data,passwordError,`${label} must return the actionable password response.`);
  }

  result=await request(base,'/api/users',{method:'POST',cookie:ownerCookie,body:{fullName:'',email:'new@example.com',role:'Maintenance Tech 1',temporaryPassword:validTemporaryPassword}});
  assert.equal(result.response.status,400);
  assert.deepEqual(result.data,{error:'Full name is required.',code:'FULL_NAME_REQUIRED',field:'fullName'});
  result=await request(base,'/api/users',{method:'POST',cookie:ownerCookie,body:{fullName:'New User',email:'not-an-email',role:'Maintenance Tech 1',temporaryPassword:validTemporaryPassword}});
  assert.equal(result.response.status,400);
  assert.deepEqual(result.data,{error:'Enter a valid email address.',code:'EMAIL_INVALID',field:'email'});

  result=await request(base,'/api/users',{method:'POST',cookie:ownerCookie,body:{fullName:'Created User',email:'created@example.com',role:'Maintenance Tech 2',temporaryPassword:validTemporaryPassword}});
  assert.equal(result.response.status,201);
  assert.equal(result.data.user.fullName,'Created User');
  assert.equal(result.data.user.forcePasswordChange,true);
  assert.equal(result.data.user.role,'Maintenance Tech 2');
  const creationBody=JSON.stringify(result.data);
  assert.equal(creationBody.includes(validTemporaryPassword),false);
  assert.equal(Object.hasOwn(result.data.user,'temporaryPassword'),false);
  assert.equal(Object.hasOwn(result.data.user,'passwordHash'),false);
  assert.equal(Object.hasOwn(result.data.user,'password_hash'),false);
  const createdId=result.data.user.id;

  result=await request(base,'/api/users',{method:'POST',cookie:ownerCookie,body:{fullName:'Duplicate User',email:'CREATED@example.com',role:'Maintenance Tech 1',temporaryPassword:validTemporaryPassword}});
  assert.equal(result.response.status,409);
  assert.deepEqual(result.data,{error:'A user with this email already exists.',code:'EMAIL_EXISTS',field:'email'});

  result=await request(base,'/api/users',{cookie:ownerCookie});
  assert.equal(result.response.status,200);
  const owner=result.data.users.find(user=>user.isOwnerAdmin);
  assert.ok(owner);
  assert.equal(owner.canDisable,false);
  assert.equal(owner.canDelete,false);
  assert.equal(JSON.stringify(result.data).includes(validTemporaryPassword),false);
  result=await request(base,`/api/users/${owner.id}/disable`,{method:'POST',cookie:ownerCookie});
  assert.equal(result.response.status,403);
  result=await request(base,`/api/users/${owner.id}`,{method:'DELETE',cookie:ownerCookie});
  assert.equal(result.response.status,403);

  result=await request(base,'/api/audit',{cookie:ownerCookie});
  assert.equal(result.response.status,200);
  assert.equal(JSON.stringify(result.data).includes(validTemporaryPassword),false);
  const creationAudit=result.data.audit.find(item=>item.action==='user create'&&Number(item.target_id)===createdId);
  assert.ok(creationAudit);
  assert.deepEqual(JSON.parse(creationAudit.details_json),{role:'Maintenance Tech 2'});

  const database=new DatabaseSync(path.join(dataDir,'mcc.sqlite'),{readOnly:true});
  const rejectedCount=database.prepare("SELECT COUNT(*) AS count FROM users WHERE email='rejected@example.com'").get().count;
  assert.equal(rejectedCount,0);
  const row=database.prepare('SELECT password_hash,force_password_change,temp_password_expires_at FROM users WHERE id=?').get(createdId);
  assert.notEqual(row.password_hash,validTemporaryPassword);
  assert.equal(row.force_password_change,1);
  assert.ok(Date.parse(row.temp_password_expires_at)>Date.now());
  const auditJson=database.prepare('SELECT details_json FROM audit_log WHERE action=? AND target_id=?').get('user create',String(createdId)).details_json;
  assert.equal(auditJson.includes(validTemporaryPassword),false);
  database.close();
  assert.equal(serverOutput.includes(validTemporaryPassword),false);
  assert.equal(serverOutput.includes(ownerPassword),false);
  console.log('User-management API tests passed: 5 password rejection cases, structured errors, valid creation, forced change/expiration, response and audit secrecy, duplicate email handling, and Owner Admin protection.');
}

try{await run();}finally{
  if(server&&server.exitCode===null){server.kill();await Promise.race([new Promise(resolve=>server.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);}
  const resolved=path.resolve(fixture);
  const allowed=path.resolve(root,'tmp');
  if(resolved.startsWith(`${allowed}${path.sep}`)&&fs.existsSync(resolved))fs.rmSync(resolved,{recursive:true,force:true});
}
