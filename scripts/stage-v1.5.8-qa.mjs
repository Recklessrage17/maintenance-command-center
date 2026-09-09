// Local sample-data QA only. Never reads or changes the production database.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.MCC_QA_PORT||4289);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Choose an unused local QA port from 1024 to 65535.');
await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
const fixture=path.join(root,'tmp',`v1.5.8-browser-qa-${Date.now()}`);
fs.mkdirSync(fixture,{recursive:true});
const log=fs.openSync(path.join(fixture,'server.log'),'a');
const child=spawn(process.execPath,['backend/dist/server/index.js'],{
  cwd:root,detached:true,windowsHide:true,stdio:['ignore',log,log],
  env:{...process.env,NODE_ENV:'test',PORT:String(port),MCC_BIND_HOST:'127.0.0.1',SESSION_SECRET:randomBytes(32).toString('hex'),MCC_DATA_DIR:path.join(fixture,'data'),MCC_UPLOADS_DIR:path.join(fixture,'uploads'),MCC_BACKUPS_DIR:path.join(fixture,'backups'),MCC_RECOVERY_DIR:path.join(fixture,'recovery'),MCC_PM_EXCEL_DIR:path.join(fixture,'pm-excel')},
});
child.unref();fs.closeSync(log);
const base=`http://127.0.0.1:${port}`;
const email='jeff.qa@example.com';const password=`MCC-QA-${randomBytes(10).toString('hex')}!9`;
fs.writeFileSync(path.join(fixture,'QA-ACCESS.txt'),`MCC v1.5.8 — isolated sample data\nURL: ${base}\nEmail: ${email}\nPassword: ${password}\nPID: ${child.pid}\nAll data belongs to this QA fixture. Keep this folder and its backups.\n`);
let cookie='';
async function api(url,method='GET',body){
  const response=await fetch(base+url,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const data=await response.json();if(!response.ok)throw new Error(`${method} ${url}: ${response.status} ${JSON.stringify(data)}`);
  cookie=response.headers.get('set-cookie')?.split(';')[0]||cookie;return data;
}
try{
  let ready=false;
  for(let n=0;n<300;n++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  if(!ready)throw new Error(`QA server did not start. See ${fixture}`);
  await api('/api/auth/setup-first-admin','POST',{fullName:'Jeff — v1.5.8 QA',email,password,confirmPassword:password});
  await api('/api/auth/login','POST',{email,password});
  const cases=[
    ['QA-OIL','Hydraulic jack oil — needs action',0,2,true],
    ['QA-BEARING','Conveyor bearing — low stock',1,4,true],
    ['QA-STAGED','Filter element — already staged',0,2,true],
    ['QA-REQUESTED','Control relay — requested',1,3,true],
    ['QA-ORDERED','Proximity sensor — ordered',0,2,true],
    ['QA-OFF','Low-stock alert disabled by default',0,2,false],
    ['QA-HEALTHY','Healthy enabled part',8,2,true],
    ['QA-OBSOLETE','Obsolete part excluded from attention',0,2,true],
  ];
  const parts=[];
  for(const [partNumber,description,quantity,minQuantity,dashboardStockAlertEnabled] of cases){const result=await api('/api/inventory/native/parts','POST',{partNumber,description,quantity,minQuantity,dashboardStockAlertEnabled,obsolete:partNumber==='QA-OBSOLETE',location:'QA Stores',vendor:'QA Supply Company',unitCost:12.5});parts.push(result.part);}
  await api('/api/requisition-staging/bulk','POST',{items:[{inventoryPartId:Number(parts[2].id),quantityRequested:2}]});
  for(const index of [3,4]){
    const {requisition}=await api('/api/requisitions','POST',{items:[{inventoryPartId:Number(parts[index].id),quantityRequested:3}],header:{poInitiator:'Jeff QA',requisitionedByName:'Jeff QA',taxExempt:'No'}});
    if(index===4)await api(`/api/requisitions/${requisition.id}/status`,'PATCH',{status:'Ordered'});
  }
  const today=new Date();
  for(const library of ['machine','equipment'])for(let index=1;index<=12;index++){
    const assetNumber=library==='machine'?`QA Press ${String(index).padStart(2,'0')}`:`QA Equipment ${String(index).padStart(2,'0')}`;
    const assetBody=library==='machine'?{assetNumber,assetName:'Sample maintenance press',brand:index%2?'Toyo':'Engel',powerType:'Hydraulic',status:'active'}:{assetNumber,equipmentName:'Sample auxiliary equipment',category:'Dryer',equipmentType:'Desiccant Dryer',manufacturer:'Matsui',status:'active',criticality:'high',powerType:'Electric'};
    const {asset}=await api(`/api/${library}-library/assets`,'POST',assetBody);
    const completed=new Date(today);completed.setDate(completed.getDate()-(index%3===0?35:index%3===1?30:27));
    await api(`/api/${library}-library/assets/${asset.id}/preventive-maintenance`,'POST',{title:index%2?'Inspect and lubricate drive assembly':'Check interlocks and inspect filters',instructions:'QA sample: inspect components and record condition before returning the asset to service.',intervalType:'days',intervalValue:30,lastCompletedDate:completed.toISOString().slice(0,10),scheduleStatus:'active',notes:'Synthetic v1.5.8 browser review data.'});
  }
  const metadata={base,pid:child.pid,fixture,email,credentialsFile:path.join(fixture,'QA-ACCESS.txt'),createdAt:new Date().toISOString()};
  fs.writeFileSync(path.join(fixture,'qa-instance.json'),JSON.stringify(metadata,null,2));
  console.log(JSON.stringify(metadata,null,2));
}catch(error){
  // Stop only the process launched here, and preserve all QA artifacts.
  process.kill(child.pid);throw error;
}
