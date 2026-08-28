import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=path.join(root,'tmp',`issue-115-arbitrary-library-files-${Date.now()}-${process.pid}`);

const runtime={
  root:fixture,
  data:path.join(fixture,'data'),
  uploads:path.join(fixture,'uploads'),
  backups:path.join(fixture,'backups'),
};

const password='Issue-115-Arbitrary!9a';

let server=null;
let serverOutput='';

function digest(value){
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fileDigest(filename){
  const hash=crypto.createHash('sha256');
  const descriptor=fs.openSync(filename,'r');

  try{
    const buffer=Buffer.allocUnsafe(64*1024);

    while(true){
      const count=fs.readSync(descriptor,buffer,0,buffer.length,null);

      if(!count)break;

      hash.update(buffer.subarray(0,count));
    }

    return hash.digest('hex');
  }finally{
    fs.closeSync(descriptor);
  }
}

async function freePort(){
  return new Promise((resolve,reject)=>{
    const probe=net.createServer();

    probe.once('error',reject);

    probe.listen(0,'127.0.0.1',()=>{
      const address=probe.address();
      const port=typeof address==='object'&&address?address.port:0;

      probe.close(error=>error?reject(error):resolve(port));
    });
  });
}

async function startServer(){
  const port=await freePort();

  const child=spawn(
    process.execPath,
    ['backend/dist/server/index.js'],
    {
      cwd:root,
      env:{
        ...process.env,
        PORT:String(port),
        NODE_ENV:'test',
        SESSION_SECRET:'issue-115-arbitrary-library-files',
        MCC_DATA_DIR:runtime.data,
        MCC_UPLOADS_DIR:runtime.uploads,
        MCC_BACKUPS_DIR:runtime.backups,
        MCC_PORTABLE_BACKUP_MAX_MB:'128',
      },
      stdio:['ignore','pipe','pipe'],
    }
  );

  child.stdout.on('data',chunk=>serverOutput+=chunk);
  child.stderr.on('data',chunk=>serverOutput+=chunk);

  const base=`http://127.0.0.1:${port}`;

  for(let attempt=0;attempt<400;attempt+=1){
    if(child.exitCode!==null){
      throw new Error(`Backend exited early.\n${serverOutput}`);
    }

    try{
      const response=await fetch(`${base}/api/health`,{signal:AbortSignal.timeout(2000)});

      if(response.ok){
        return {child,base};
      }
    }catch{}

    await new Promise(resolve=>setTimeout(resolve,100));
  }

  child.kill();
  throw new Error(`Backend did not become healthy after 40 seconds.\n${serverOutput}`);
}

async function stopServer(){
  if(!server||server.exitCode!==null)return;

  server.kill();

  await Promise.race([
    new Promise(resolve=>server.once('exit',resolve)),
    new Promise(resolve=>setTimeout(resolve,3000)),
  ]);
}

async function request(base,pathname,{method='GET',cookie='',body,headers={}}={}){
  const multipart=body instanceof FormData;

  const response=await fetch(
    `${base}${pathname}`,
    {
      method,
      headers:{
        ...(cookie?{Cookie:cookie}:{}),
        ...(body!==undefined&&!multipart?{'Content-Type':'application/json'}:{}),
        ...headers,
      },
      body:
        body===undefined
          ?undefined
          :multipart
            ?body
            :JSON.stringify(body),
    }
  );

  const data=await response.json().catch(()=>({}));

  return {
    response,
    data,
    cookie:response.headers.get('set-cookie')?.split(';')[0]??'',
  };
}

async function login(base,email){
  const result=await request(
    base,
    '/api/auth/login',
    {
      method:'POST',
      body:{email,password},
    }
  );

  assert.equal(result.response.status,200,result.data.error);
  assert.ok(result.cookie);

  return result.cookie;
}

function uploadForm(field,files,extra={}){
  const form=new FormData();

  for(const file of files){
    form.append(
      field,
      new Blob([file.bytes],{type:file.type}),
      file.name
    );
  }

  for(const [key,value] of Object.entries(extra)){
    form.append(key,String(value));
  }

  return form;
}

function equipmentPayload(){
  return {
    assetNumber:'ISSUE115-EQ',
    equipmentName:'Issue 115 Equipment',
    category:'Dryer',
    equipmentType:'Desiccant Dryer',
    manufacturer:'FixtureCo',
    model:'Issue115',
    serialNumber:'ISSUE115-SN',
    equipmentYear:'2026',
    location:'Regression Cell',
    department:'Maintenance',
    status:'active',
    criticality:'medium',
    powerType:'Electric',
    voltage:'480 VAC',
    phase:'3 phase',
    amperage:'20 A',
    airRequirement:'90 PSI',
    waterRequirement:'N/A',
    capacityRating:'100 lb',
    dimensions:'24 x 24 x 48 in',
    weight:'100 lb',
    specificationNotes:'Issue #115 arbitrary-file regression fixture.',
  };
}

function rowById(table,id){
  const database=new DatabaseSync(
    path.join(runtime.data,'mcc.sqlite'),
    {readOnly:true}
  );

  try{
    return database
      .prepare(`SELECT * FROM ${table} WHERE id=?`)
      .get(id);
  }finally{
    database.close();
  }
}

function storageRelative(kind,row){
  if(kind==='machine'){
    return `machine-library/asset-${row.asset_id}/documents/${row.stored_filename}`;
  }

  if(kind==='equipment'){
    return `equipment-library/asset-${row.asset_id}/${row.stored_filename}`;
  }

  return `facility-info/facility-${row.area_id}/files/${row.stored_filename}`;
}

function snapshot(kind,table,item){
  const row=rowById(table,item.id);

  assert.ok(row,`${kind} database row must exist`);

  const relative=storageRelative(kind,row);
  const filename=path.join(runtime.uploads,...relative.split('/'));

  assert.ok(
    fs.existsSync(filename),
    `${kind} physical file must exist before backup`
  );

  return {
    kind,
    table,
    id:Number(row.id),
    associationId:Number(
      kind==='facility'
        ?row.area_id
        :row.asset_id
    ),
    folderId:Number(row.folder_id),
    originalFilename:String(row.original_filename),
    displayFilename:String(row.display_filename),
    storedFilename:String(row.stored_filename),
    extension:String(row.extension),
    mimeType:String(row.mime_type),
    sizeBytes:Number(row.size_bytes),
    folderPath:String(item.folderPath),
    mediaType:String(item.mediaType),
    relative,
    sha256:fileDigest(filename),
  };
}

function assertRestoredSnapshot(snapshotValue,item){
  const row=rowById(snapshotValue.table,snapshotValue.id);

  assert.ok(row,`${snapshotValue.kind} database row must be restored`);

  assert.equal(
    Number(
      snapshotValue.kind==='facility'
        ?row.area_id
        :row.asset_id
    ),
    snapshotValue.associationId,
    `${snapshotValue.kind} association must survive restore`
  );

  assert.equal(
    Number(row.folder_id),
    snapshotValue.folderId,
    `${snapshotValue.kind} folder association must survive restore`
  );

  assert.equal(
    String(row.original_filename),
    snapshotValue.originalFilename,
    `${snapshotValue.kind} original filename must survive restore`
  );

  assert.equal(
    String(row.display_filename),
    snapshotValue.displayFilename,
    `${snapshotValue.kind} display filename must survive restore`
  );

  assert.equal(
    String(row.stored_filename),
    snapshotValue.storedFilename,
    `${snapshotValue.kind} stored filename must survive restore`
  );

  assert.equal(
    String(row.extension),
    snapshotValue.extension,
    `${snapshotValue.kind} extension must survive restore`
  );

  assert.equal(
    Number(row.size_bytes),
    snapshotValue.sizeBytes,
    `${snapshotValue.kind} size metadata must survive restore`
  );

  assert.equal(
    item.originalFilename,
    snapshotValue.originalFilename,
    `${snapshotValue.kind} API original filename must survive restore`
  );

  assert.equal(
    item.displayFilename,
    snapshotValue.displayFilename,
    `${snapshotValue.kind} API display filename must survive restore`
  );

  assert.equal(
    item.extension,
    snapshotValue.extension,
    `${snapshotValue.kind} API extension must survive restore`
  );

  assert.equal(
    item.folderId,
    snapshotValue.folderId,
    `${snapshotValue.kind} API folder association must survive restore`
  );

  assert.equal(
    item.folderPath,
    snapshotValue.folderPath,
    `${snapshotValue.kind} hierarchy must survive restore`
  );

  assert.equal(
    item.sizeBytes,
    snapshotValue.sizeBytes,
    `${snapshotValue.kind} API size must survive restore`
  );

  assert.equal(
    item.mediaType,
    snapshotValue.mediaType,
    `${snapshotValue.kind} media type must survive restore`
  );

  const relative=storageRelative(snapshotValue.kind,row);
  const filename=path.join(runtime.uploads,...relative.split('/'));

  assert.equal(
    relative,
    snapshotValue.relative,
    `${snapshotValue.kind} physical storage path must survive restore`
  );

  assert.ok(
    fs.existsSync(filename),
    `${snapshotValue.kind} physical file must be restored`
  );

  assert.equal(
    fs.statSync(filename).size,
    snapshotValue.sizeBytes,
    `${snapshotValue.kind} physical size must survive restore`
  );

  assert.equal(
    fileDigest(filename),
    snapshotValue.sha256,
    `${snapshotValue.kind} SHA-256 must survive restore`
  );
}

async function assertOpaqueResponse(response,expectedBytes,label){
  assert.equal(response.status,200,`${label} open/content request must succeed`);

  assert.match(
    response.headers.get('content-type')??'',
    /^application\/octet-stream(?:;|$)/i,
    `${label} must use application/octet-stream`
  );

  assert.match(
    response.headers.get('content-disposition')??'',
    /^attachment;/i,
    `${label} must force attachment`
  );

  assert.equal(
    response.headers.get('x-content-type-options'),
    'nosniff',
    `${label} must send nosniff`
  );

  const actual=Buffer.from(await response.arrayBuffer());

  assert.deepEqual(
    actual,
    expectedBytes,
    `${label} bytes must remain exact`
  );
}

async function assertMovResponse(response,label){
  assert.equal(response.status,206,`${label} MOV range request must return 206`);

  assert.match(
    response.headers.get('content-type')??'',
    /^video\/quicktime(?:;|$)/i,
    `${label} must use video/quicktime`
  );

  assert.match(
    response.headers.get('content-disposition')??'',
    /^inline;/i,
    `${label} recognized MOV may use inline video behavior`
  );

  assert.equal(
    response.headers.get('x-content-type-options'),
    'nosniff',
    `${label} MOV must send nosniff`
  );

  assert.equal(
    response.headers.get('accept-ranges'),
    'bytes',
    `${label} MOV must support byte ranges`
  );

  assert.equal(
    Buffer.from(await response.arrayBuffer()).toString(),
    'ftypqt  ',
    `${label} MOV range must return exact source bytes`
  );
}

async function createMasterBackup(base,cookie){
  let result;

  for(let attempt=0;attempt<30;attempt+=1){
    result=await request(
      base,
      '/api/backup/create',
      {
        method:'POST',
        cookie,
        body:{category:'master'},
      }
    );

    if(result.response.status===201){
      return result.data.backup;
    }

    await new Promise(resolve=>setTimeout(resolve,200));
  }

  assert.fail(
    `Master Backup could not be created: ${JSON.stringify(result?.data??{})}`
  );
}

async function run(){
  fs.mkdirSync(fixture,{recursive:true});

  const started=await startServer();
  server=started.child;
  const {base}=started;

  let result=await request(
    base,
    '/api/auth/setup-first-admin',
    {
      method:'POST',
      body:{
        fullName:'Issue 115 Owner',
        email:'owner@example.com',
        password,
        confirmPassword:password,
      },
    }
  );

  assert.equal(result.response.status,200,result.data.error);

  const ownerCookie=await login(base,'owner@example.com');

  // ----------------------------------------------------------
  // Machine Library
  // ----------------------------------------------------------

  result=await request(
    base,
    '/api/machine-library/assets',
    {
      method:'POST',
      cookie:ownerCookie,
      body:{
        assetNumber:'ISSUE115-M',
        assetName:'Issue 115 Machine',
        brand:'FixtureCo',
        model:'M115',
        serialNumber:'M115-SN',
        location:'Regression Cell',
        status:'active',
      },
    }
  );

  assert.equal(result.response.status,201,result.data.error);

  const machineAssetId=result.data.asset.id;

  result=await request(
    base,
    `/api/machine-library/assets/${machineAssetId}/document-folders`,
    {
      method:'POST',
      cookie:ownerCookie,
      body:{name:'Vendor Files'},
    }
  );

  assert.equal(result.response.status,201,result.data.error);

  const machineRootFolderId=result.data.folder.id;

  result=await request(
    base,
    `/api/machine-library/assets/${machineAssetId}/document-folders`,
    {
      method:'POST',
      cookie:ownerCookie,
      body:{
        name:'Models',
        parentId:machineRootFolderId,
      },
    }
  );

  assert.equal(result.response.status,201,result.data.error);

  const machineFolderId=result.data.folder.id;

  // ----------------------------------------------------------
  // Equipment Library
  // ----------------------------------------------------------

  result=await request(
    base,
    '/api/equipment-library/assets',
    {
      method:'POST',
      cookie:ownerCookie,
      body:equipmentPayload(),
    }
  );

  assert.equal(result.response.status,201,result.data.error);

  const equipmentAssetId=result.data.asset.id;

  result=await request(
    base,
    `/api/equipment-library/assets/${equipmentAssetId}/document-folders`,
    {
      method:'POST',
      cookie:ownerCookie,
      body:{name:'Vendor Files'},
    }
  );

  assert.equal(result.response.status,201,result.data.error);

  const equipmentRootFolderId=result.data.folder.id;

  result=await request(
    base,
    `/api/equipment-library/assets/${equipmentAssetId}/document-folders`,
    {
      method:'POST',
      cookie:ownerCookie,
      body:{
        name:'Models',
        parentId:equipmentRootFolderId,
      },
    }
  );

  assert.equal(result.response.status,201,result.data.error);

  const equipmentFolderId=result.data.folder.id;

  // ----------------------------------------------------------
  // Facility Library
  // ----------------------------------------------------------

  result=await request(
    base,
    '/api/facility-info/areas',
    {
      method:'POST',
      cookie:ownerCookie,
      body:{
        name:'Issue 115 Facility',
        description:'Arbitrary file regression',
      },
    }
  );

  assert.equal(result.response.status,201,result.data.error);

  const facilityAreaId=result.data.area.id;

  result=await request(
    base,
    `/api/facility-info/areas/${facilityAreaId}/folders`,
    {
      method:'POST',
      cookie:ownerCookie,
      body:{name:'Vendor Files'},
    }
  );

  assert.equal(result.response.status,201,result.data.error);

  const facilityRootFolderId=result.data.folder.id;

  result=await request(
    base,
    `/api/facility-info/areas/${facilityAreaId}/folders`,
    {
      method:'POST',
      cookie:ownerCookie,
      body:{
        name:'Models',
        parentId:facilityRootFolderId,
      },
    }
  );

  assert.equal(result.response.status,201,result.data.error);

  const facilityFolderId=result.data.folder.id;

  // ----------------------------------------------------------
  // Payloads
  // ----------------------------------------------------------

  const machineStepBytes=Buffer.from(
    'ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((\'ISSUE115 MACHINE\'),\'2;1\');\nENDSEC;\nEND-ISO-10303-21;\n'
  );

  const equipmentStepBytes=Buffer.from(
    'ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((\'ISSUE115 EQUIPMENT\'),\'2;1\');\nENDSEC;\nEND-ISO-10303-21;\n'
  );

  const facilityStepBytes=Buffer.from(
    'ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((\'ISSUE115 FACILITY\'),\'2;1\');\nENDSEC;\nEND-ISO-10303-21;\n'
  );

  const movBytes=Buffer.concat([
    Buffer.from([0,0,0,24]),
    Buffer.from('ftypqt  '),
    Buffer.from('issue-115-original-mov-payload'),
  ]);

  const extensionlessScriptBytes=Buffer.from(
    '<script>throw new Error("must never render inline")</script>'
  );

  // ----------------------------------------------------------
  // Machine arbitrary file + MOV
  // ----------------------------------------------------------

  let response=await fetch(
    `${base}/api/machine-library/assets/${machineAssetId}/document-folders/${machineFolderId}/documents`,
    {
      method:'POST',
      headers:{Cookie:ownerCookie},
      body:uploadForm(
        'documents',
        [
          {
            name:'Machine Fixture.STEP',
            type:'model/step',
            bytes:machineStepBytes,
          },
          {
            name:'20260729_144614000_iOS.MOV',
            type:'video/quicktime',
            bytes:movBytes,
          },
          {
            name:'PLC_STARTUP',
            type:'text/html',
            bytes:extensionlessScriptBytes,
          },
        ],
        {description:'Issue #115 machine arbitrary files'}
      ),
    }
  );

  const machineUploadBody=await response.text();

  assert.equal(response.status,201,machineUploadBody);

  let upload=JSON.parse(machineUploadBody);

  const machineStep=upload.documents.find(
    item=>item.displayFilename==='Machine Fixture.STEP'
  );

  const machineMov=upload.documents.find(
    item=>item.displayFilename==='20260729_144614000_iOS.MOV'
  );

  const machineExtensionless=upload.documents.find(
    item=>item.displayFilename==='PLC_STARTUP'
  );

  assert.ok(machineStep&&machineMov&&machineExtensionless);

  assert.equal(machineStep.extension,'.step');
  assert.equal(machineStep.mediaType,'file');
  assert.equal(machineStep.mimeType,'application/octet-stream');
  assert.equal(machineStep.folderPath,'Vendor Files / Models');

  assert.equal(machineMov.extension,'.mov');
  assert.equal(machineMov.mediaType,'video');
  assert.equal(machineMov.mimeType,'video/quicktime');
  assert.equal(machineMov.folderPath,'Vendor Files / Models');

  assert.equal(machineExtensionless.extension,'');
  assert.equal(machineExtensionless.mediaType,'file');
  assert.equal(machineExtensionless.mimeType,'application/octet-stream');
  assert.equal(machineExtensionless.folderPath,'Vendor Files / Models');

  response=await fetch(
    `${base}${machineStep.openUrl}`,
    {headers:{Cookie:ownerCookie}}
  );

  await assertOpaqueResponse(
    response,
    machineStepBytes,
    'Machine opaque file'
  );

  response=await fetch(
    `${base}${machineExtensionless.openUrl}`,
    {headers:{Cookie:ownerCookie}}
  );

  await assertOpaqueResponse(
    response,
    extensionlessScriptBytes,
    'Machine extensionless script-content file'
  );

  response=await fetch(
    `${base}${machineMov.openUrl}`,
    {
      headers:{
        Cookie:ownerCookie,
        Range:'bytes=4-11',
      },
    }
  );

  await assertMovResponse(response,'Machine MOV');

  // Unknown duplicate behavior must remain unchanged.
  response=await fetch(
    `${base}/api/machine-library/assets/${machineAssetId}/document-folders/${machineFolderId}/documents`,
    {
      method:'POST',
      headers:{Cookie:ownerCookie},
      body:uploadForm(
        'documents',
        [{
          name:'Machine Fixture.STEP',
          type:'model/step',
          bytes:machineStepBytes,
        }]
      ),
    }
  );

  assert.equal(response.status,409);

  const machineDuplicate=await response.json();

  assert.equal(machineDuplicate.code,'DOCUMENT_DUPLICATE');

  // ----------------------------------------------------------
  // Equipment arbitrary file + MOV
  // ----------------------------------------------------------

  response=await fetch(
    `${base}/api/equipment-library/assets/${equipmentAssetId}/document-folders/${equipmentFolderId}/documents`,
    {
      method:'POST',
      headers:{Cookie:ownerCookie},
      body:uploadForm(
        'documents',
        [
          {
            name:'Equipment Fixture.STEP',
            type:'model/step',
            bytes:equipmentStepBytes,
          },
          {
            name:'Equipment Service.MOV',
            type:'video/quicktime',
            bytes:movBytes,
          },
        ],
        {description:'Issue #115 equipment arbitrary files'}
      ),
    }
  );

  const equipmentUploadBody=await response.text();

  assert.equal(response.status,201,equipmentUploadBody);

  upload=JSON.parse(equipmentUploadBody);

  const equipmentStep=upload.documents.find(
    item=>item.displayFilename==='Equipment Fixture.STEP'
  );

  const equipmentMov=upload.documents.find(
    item=>item.displayFilename==='Equipment Service.MOV'
  );

  assert.ok(equipmentStep&&equipmentMov);

  assert.equal(equipmentStep.extension,'.step');
  assert.equal(equipmentStep.mediaType,'file');
  assert.equal(equipmentStep.mimeType,'application/octet-stream');
  assert.equal(equipmentStep.folderPath,'Vendor Files / Models');

  assert.equal(equipmentMov.extension,'.mov');
  assert.equal(equipmentMov.mediaType,'video');
  assert.equal(equipmentMov.mimeType,'video/quicktime');

  response=await fetch(
    `${base}${equipmentStep.openUrl}`,
    {headers:{Cookie:ownerCookie}}
  );

  await assertOpaqueResponse(
    response,
    equipmentStepBytes,
    'Equipment opaque file'
  );

  response=await fetch(
    `${base}${equipmentMov.openUrl}`,
    {
      headers:{
        Cookie:ownerCookie,
        Range:'bytes=4-11',
      },
    }
  );

  await assertMovResponse(response,'Equipment MOV');

  // ----------------------------------------------------------
  // Facility arbitrary file + motivating MOV filename
  // ----------------------------------------------------------

  result=await request(
    base,
    `/api/facility-info/areas/${facilityAreaId}/folders/${facilityFolderId}/items`,
    {
      method:'POST',
      cookie:ownerCookie,
      body:uploadForm(
        'files',
        [
          {
            name:'Facility Fixture.STEP',
            type:'model/step',
            bytes:facilityStepBytes,
          },
          {
            name:'20260729_144614000_iOS.MOV',
            type:'video/quicktime',
            bytes:movBytes,
          },
        ],
        {
          description:'Issue #115 Facility arbitrary files',
          revision:'115',
        }
      ),
    }
  );

  assert.equal(result.response.status,201,result.data.error);

  const facilityStep=result.data.items.find(
    item=>item.displayFilename==='Facility Fixture.STEP'
  );

  const facilityMov=result.data.items.find(
    item=>item.displayFilename==='20260729_144614000_iOS.MOV'
  );

  assert.ok(facilityStep&&facilityMov);

  assert.equal(facilityStep.extension,'.step');
  assert.equal(facilityStep.mediaType,'file');
  assert.equal(facilityStep.mimeType,'application/octet-stream');
  assert.equal(facilityStep.folderPath,'Vendor Files / Models');

  assert.equal(facilityMov.extension,'.mov');
  assert.equal(facilityMov.mediaType,'video');
  assert.equal(facilityMov.mimeType,'video/quicktime');
  assert.equal(facilityMov.folderPath,'Vendor Files / Models');

  response=await fetch(
    `${base}${facilityStep.contentUrl}`,
    {headers:{Cookie:ownerCookie}}
  );

  await assertOpaqueResponse(
    response,
    facilityStepBytes,
    'Facility opaque file'
  );

  response=await fetch(
    `${base}${facilityMov.contentUrl}`,
    {
      headers:{
        Cookie:ownerCookie,
        Range:'bytes=4-11',
      },
    }
  );

  await assertMovResponse(response,'Facility MOV');

  result=await request(
    base,
    `/api/facility-info/areas/${facilityAreaId}`,
    {cookie:ownerCookie}
  );

  assert.equal(result.response.status,200,result.data.error);
  assert.equal(result.data.area.summary.fileCount,1);
  assert.equal(result.data.area.summary.videoCount,1);

  result=await request(
    base,
    `/api/facility-info/search?areaId=${facilityAreaId}&type=file`,
    {cookie:ownerCookie}
  );

  assert.equal(result.response.status,200,result.data.error);
  assert.ok(
    result.data.items.some(item=>item.id===facilityStep.id),
    'Facility Other Files filter must return the opaque STEP file'
  );

  // ----------------------------------------------------------
  // Capture required pre-backup metadata + SHA-256
  // ----------------------------------------------------------

  const snapshots=[
    snapshot('machine','machine_documents',machineStep),
    snapshot('machine','machine_documents',machineMov),
    snapshot('machine','machine_documents',machineExtensionless),
    snapshot('equipment','equipment_documents',equipmentStep),
    snapshot('equipment','equipment_documents',equipmentMov),
    snapshot('facility','facility_items',facilityStep),
    snapshot('facility','facility_items',facilityMov),
  ];

  for(const item of snapshots){
    assert.match(item.sha256,/^[0-9a-f]{64}$/);
    assert.ok(item.sizeBytes>0);
    assert.ok(item.folderPath.includes('Vendor Files / Models'));
  }

  // ----------------------------------------------------------
  // Master Backup must package every extension byte-for-byte
  // ----------------------------------------------------------

  const backup=await createMasterBackup(base,ownerCookie);

  assert.equal(backup.type,'master_manual');

  const packageDir=path.join(
    runtime.backups,
    'MCC Master back up',
    backup.id
  );

  const manifest=JSON.parse(
    fs.readFileSync(
      path.join(packageDir,'manifest.json'),
      'utf8'
    )
  );

  for(const item of snapshots){
    const manifestPath=`files/uploads/${item.relative}`;
    const packaged=path.join(
      packageDir,
      'files',
      'uploads',
      ...item.relative.split('/')
    );

    assert.ok(
      fs.existsSync(packaged),
      `Master Backup missing arbitrary file: ${manifestPath}`
    );

    assert.equal(
      fs.statSync(packaged).size,
      item.sizeBytes,
      `Master Backup changed size for ${item.displayFilename}`
    );

    assert.equal(
      fileDigest(packaged),
      item.sha256,
      `Master Backup changed SHA-256 for ${item.displayFilename}`
    );

    assert.equal(
      manifest.fileChecksums[manifestPath],
      item.sha256,
      `Master Backup manifest checksum mismatch for ${item.displayFilename}`
    );
  }

  // ----------------------------------------------------------
  // Remove live files to prove restore really recreates them
  // ----------------------------------------------------------

  for(const item of [machineStep,machineMov,machineExtensionless]){
    result=await request(
      base,
      `/api/machine-library/assets/${machineAssetId}/documents/${item.id}`,
      {
        method:'DELETE',
        cookie:ownerCookie,
      }
    );

    assert.equal(result.response.status,200,result.data.error);
  }

  for(const item of [equipmentStep,equipmentMov]){
    result=await request(
      base,
      `/api/equipment-library/assets/${equipmentAssetId}/documents/${item.id}`,
      {
        method:'DELETE',
        cookie:ownerCookie,
      }
    );

    assert.equal(result.response.status,200,result.data.error);
  }

  for(const item of [facilityStep,facilityMov]){
    result=await request(
      base,
      `/api/facility-info/items/${item.id}`,
      {
        method:'DELETE',
        cookie:ownerCookie,
      }
    );

    assert.equal(result.response.status,200,result.data.error);
  }

  for(const item of snapshots){
    const filename=path.join(
      runtime.uploads,
      ...item.relative.split('/')
    );

    assert.equal(
      fs.existsSync(filename),
      false,
      `${item.displayFilename} must be absent before restore`
    );
  }

  // ----------------------------------------------------------
  // Master Restore
  // ----------------------------------------------------------

  result=await request(
    base,
    '/api/backup/restore',
    {
      method:'POST',
      cookie:ownerCookie,
      body:{
        category:'master',
        backupId:backup.id,
        confirmation:'RESTORE MCC',
      },
    }
  );

  assert.equal(result.response.status,200,result.data.error);

  // ----------------------------------------------------------
  // Verify restored Machine metadata + SHA + HTTP behavior
  // ----------------------------------------------------------

  result=await request(
    base,
    `/api/machine-library/assets/${machineAssetId}/documents`,
    {cookie:ownerCookie}
  );

  assert.equal(result.response.status,200,result.data.error);

  const restoredMachineStep=result.data.documents.find(
    item=>item.id===machineStep.id
  );

  const restoredMachineMov=result.data.documents.find(
    item=>item.id===machineMov.id
  );

  const restoredMachineExtensionless=result.data.documents.find(
    item=>item.id===machineExtensionless.id
  );

  assert.ok(
    restoredMachineStep&&
    restoredMachineMov&&
    restoredMachineExtensionless
  );

  assertRestoredSnapshot(
    snapshots.find(item=>item.kind==='machine'&&item.id===machineStep.id),
    restoredMachineStep
  );

  assertRestoredSnapshot(
    snapshots.find(item=>item.kind==='machine'&&item.id===machineMov.id),
    restoredMachineMov
  );

  assertRestoredSnapshot(
    snapshots.find(
      item=>item.kind==='machine'&&item.id===machineExtensionless.id
    ),
    restoredMachineExtensionless
  );

  response=await fetch(
    `${base}${restoredMachineStep.openUrl}`,
    {headers:{Cookie:ownerCookie}}
  );

  await assertOpaqueResponse(
    response,
    machineStepBytes,
    'Restored Machine opaque file'
  );

  response=await fetch(
    `${base}${restoredMachineExtensionless.openUrl}`,
    {headers:{Cookie:ownerCookie}}
  );

  await assertOpaqueResponse(
    response,
    extensionlessScriptBytes,
    'Restored Machine extensionless script-content file'
  );

  response=await fetch(
    `${base}${restoredMachineMov.openUrl}`,
    {
      headers:{
        Cookie:ownerCookie,
        Range:'bytes=4-11',
      },
    }
  );

  await assertMovResponse(
    response,
    'Restored Machine MOV'
  );

  // ----------------------------------------------------------
  // Verify restored Equipment metadata + SHA + HTTP behavior
  // ----------------------------------------------------------

  result=await request(
    base,
    `/api/equipment-library/assets/${equipmentAssetId}/documents`,
    {cookie:ownerCookie}
  );

  assert.equal(result.response.status,200,result.data.error);

  const restoredEquipmentStep=result.data.documents.find(
    item=>item.id===equipmentStep.id
  );

  const restoredEquipmentMov=result.data.documents.find(
    item=>item.id===equipmentMov.id
  );

  assert.ok(restoredEquipmentStep&&restoredEquipmentMov);

  assertRestoredSnapshot(
    snapshots.find(item=>item.kind==='equipment'&&item.id===equipmentStep.id),
    restoredEquipmentStep
  );

  assertRestoredSnapshot(
    snapshots.find(item=>item.kind==='equipment'&&item.id===equipmentMov.id),
    restoredEquipmentMov
  );

  response=await fetch(
    `${base}${restoredEquipmentStep.openUrl}`,
    {headers:{Cookie:ownerCookie}}
  );

  await assertOpaqueResponse(
    response,
    equipmentStepBytes,
    'Restored Equipment opaque file'
  );

  response=await fetch(
    `${base}${restoredEquipmentMov.openUrl}`,
    {
      headers:{
        Cookie:ownerCookie,
        Range:'bytes=4-11',
      },
    }
  );

  await assertMovResponse(
    response,
    'Restored Equipment MOV'
  );

  // ----------------------------------------------------------
  // Verify restored Facility metadata + SHA + HTTP behavior
  // ----------------------------------------------------------

  result=await request(
    base,
    `/api/facility-info/areas/${facilityAreaId}`,
    {cookie:ownerCookie}
  );

  assert.equal(result.response.status,200,result.data.error);

  const restoredFacilityStep=result.data.items.find(
    item=>item.id===facilityStep.id
  );

  const restoredFacilityMov=result.data.items.find(
    item=>item.id===facilityMov.id
  );

  assert.ok(restoredFacilityStep&&restoredFacilityMov);

  assertRestoredSnapshot(
    snapshots.find(item=>item.kind==='facility'&&item.id===facilityStep.id),
    restoredFacilityStep
  );

  assertRestoredSnapshot(
    snapshots.find(item=>item.kind==='facility'&&item.id===facilityMov.id),
    restoredFacilityMov
  );

  assert.equal(
    result.data.area.summary.fileCount,
    1,
    'Facility opaque-file count must survive restore'
  );

  response=await fetch(
    `${base}${restoredFacilityStep.contentUrl}`,
    {headers:{Cookie:ownerCookie}}
  );

  await assertOpaqueResponse(
    response,
    facilityStepBytes,
    'Restored Facility opaque file'
  );

  response=await fetch(
    `${base}${restoredFacilityMov.contentUrl}`,
    {
      headers:{
        Cookie:ownerCookie,
        Range:'bytes=4-11',
      },
    }
  );

  await assertMovResponse(
    response,
    'Restored Facility MOV'
  );

  console.log(
    'Issue #115 arbitrary Shared Library regression passed: Machine, Equipment, and Facility accept opaque STEP + MOV files plus extensionless script content; opaque content is octet-stream attachment with nosniff; MOV retains safe video range behavior; nested folder associations, filenames, extensions, sizes, stored references, and SHA-256 values survive Master Backup and Master Restore exactly.'
  );
}

try{
  await run();
}catch(error){
  console.error(error);
  console.error(serverOutput);
  process.exitCode=1;
}finally{
  await stopServer();

  if(fs.existsSync(fixture)){
    fs.rmSync(fixture,{recursive:true,force:true});
  }
}
