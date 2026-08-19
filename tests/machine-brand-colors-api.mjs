import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=path.join(root,'tmp',`machine-brand-colors-${Date.now()}-${process.pid}`);
const password='Brand-Colors-Test!9';
let server;
async function freePort(){return new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const address=probe.address();probe.close(error=>error?reject(error):resolve(address.port));});});}
async function start(port){const child=spawn(process.execPath,['backend/dist/server/index.js'],{cwd:root,env:{...process.env,PORT:String(port),NODE_ENV:'test',SESSION_SECRET:'machine-brand-color-api-test',MCC_DATA_DIR:path.join(fixture,'data'),MCC_UPLOADS_DIR:path.join(fixture,'uploads'),MCC_BACKUPS_DIR:path.join(fixture,'backups')},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);const base=`http://127.0.0.1:${port}`;for(let attempt=0;attempt<400;attempt+=1){if(child.exitCode!==null)throw new Error(`Backend exited.\n${output}`);try{if((await fetch(`${base}/api/health`)).ok)return{child,base};}catch{}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(`Backend did not start.\n${output}`);}
async function request(base,pathname,{method='GET',cookie='',body}={}){const response=await fetch(`${base}${pathname}`,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();return{response,data,cookie:response.headers.get('set-cookie')?.split(';')[0]||''};}
async function run(){
  fs.mkdirSync(fixture,{recursive:true});const runtime=await start(await freePort());server=runtime.child;const {base}=runtime;
  let result=await request(base,'/api/auth/setup-first-admin',{method:'POST',body:{fullName:'Brand Owner',email:'brand-owner@example.com',password,confirmPassword:password}});assert.equal(result.response.status,200);
  result=await request(base,'/api/auth/login',{method:'POST',body:{email:'brand-owner@example.com',password}});assert.equal(result.response.status,200);const cookie=result.cookie;
  result=await request(base,'/api/machine-library/brand-settings',{cookie});assert.equal(result.response.status,200);const defaults=Object.fromEntries(result.data.brandSettings.map(setting=>[setting.brandName,setting.colorHex]));assert.equal(defaults.Toyo,'#1E6BFF');assert.equal(defaults.Arburg,'#38D7B3');assert.equal(defaults.Engel,'#FFFFFF');assert.equal(defaults.Husky,'#FFD45A');assert.equal(defaults.Netstal,'#EB5E41');
  result=await request(base,'/api/machine-library/assets',{method:'POST',cookie,body:{assetNumber:'NETSTAL-1',assetName:'Netstal test press',brand:'Netstal',status:'active'}});assert.equal(result.response.status,201);
  result=await request(base,'/api/machine-library/assets',{cookie});assert.equal(result.data.assets.find(asset=>asset.assetNumber==='NETSTAL-1').brandColorHex,'#EB5E41');
  result=await request(base,'/api/machine-library/brand-settings/Netstal',{method:'PUT',cookie,body:{colorHex:'#1aB2c3'}});assert.equal(result.response.status,200);assert.equal(result.data.brandSetting.colorHex,'#1AB2C3');
  result=await request(base,'/api/machine-library/assets',{cookie});assert.equal(result.data.assets.find(asset=>asset.assetNumber==='NETSTAL-1').brandColorHex,'#1AB2C3');
  result=await request(base,'/api/machine-library/brand-settings/Netstal',{method:'PUT',cookie,body:{colorHex:'#BROKEN'}});assert.equal(result.response.status,400);
  result=await request(base,'/api/machine-library/brand-settings',{cookie});assert.equal(result.data.brandSettings.find(setting=>setting.brandName==='Netstal').colorHex,'#1AB2C3');
  console.log('Machine brand color API tests passed: presets, Netstal rendering, normalized persistence, and invalid-value protection.');
}
try{await run();}finally{if(server&&server.exitCode===null){server.kill();await Promise.race([new Promise(resolve=>server.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);}const resolved=path.resolve(fixture);const allowed=path.resolve(root,'tmp');if(resolved.startsWith(`${allowed}${path.sep}`)&&fs.existsSync(resolved))fs.rmSync(resolved,{recursive:true,force:true});}
