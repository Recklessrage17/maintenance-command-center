import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Application, NextFunction, Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import { ZipArchive, type Archiver } from 'archiver';

type SqlParam = string | number | bigint | Buffer | null;
type FacilityUser = { id:number; full_name:string; email:string; role:string; is_owner_admin:number };
type FacilityRequest = Request & { user?:FacilityUser };
type FacilityAreaRow = {
  id:number; name:string; description:string; building:string; location:string; department:string; status:string;
  created_at:string; updated_at:string; created_by_user_id:number|null; updated_by_user_id:number|null;
  deleted:number; deleted_at:string|null; deleted_by_user_id:number|null;
};
type FacilityFolderRow = {
  id:number; area_id:number; parent_id:number|null; name:string; description:string; created_at:string; updated_at:string;
  created_by_user_id:number|null; updated_by_user_id:number|null;
};
type FacilityItemRow = {
  id:number; area_id:number; folder_id:number; media_type:'document'|'picture'|'video'; original_filename:string;
  display_filename:string; stored_filename:string; extension:string; mime_type:string; size_bytes:number;
  description:string; caption:string; revision:string; item_date:string; duration_seconds:number|null;
  uploaded_at:string; updated_at:string; uploaded_by_user_id:number|null; updated_by_user_id:number|null;
  uploaded_by_name?:string; facility_name?:string; folder_name?:string;
};

type HistoryInput = {
  section:'facility_info'; action:string; entityType?:string; entityId?:string|number; entityLabel?:string;
  locationName?:string; oldValue?:Record<string,unknown>|null; newValue?:Record<string,unknown>|null;
  reasonNote?:string; actor?:FacilityUser|null; createdAt?:string;
};

export type FacilityInfoService = ReturnType<typeof createFacilityInfoService>;

export function createFacilityInfoService(deps:{
  app:Application;
  uploadsDir:string;
  requireAuth:RequestHandler;
  requireWrite:RequestHandler;
  all:<T>(sql:string,params?:SqlParam[])=>T[];
  one:<T>(sql:string,params?:SqlParam[])=>T|undefined;
  run:(sql:string,params?:SqlParam[])=>{lastInsertRowid:number|bigint};
  exec:(sql:string)=>void;
  recordHistory:(input:HistoryInput)=>void;
  scheduleBackup:(reason:string,actor?:FacilityUser|null)=>void;
  now:()=>string;
}) {
  const {app,all,one,run,exec,recordHistory,scheduleBackup,now}=deps;
  const root=path.join(deps.uploadsDir,'facility-info');
  const incoming=path.join(root,'.incoming');
  const configuredDocumentMb=positiveLimit(process.env.MCC_FACILITY_DOCUMENT_MAX_MB,50);
  const configuredPictureMb=positiveLimit(process.env.MCC_FACILITY_PICTURE_MAX_MB,50);
  const configuredVideoMb=positiveLimit(process.env.MCC_FACILITY_VIDEO_MAX_MB,500);
  const limits={
    documentBytes:configuredDocumentMb*1024*1024,
    pictureBytes:configuredPictureMb*1024*1024,
    videoBytes:configuredVideoMb*1024*1024,
  };
  fs.mkdirSync(incoming,{recursive:true});

  const documentTypes=new Map<string,string>([
    ['.pdf','application/pdf'],['.doc','application/msword'],
    ['.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['.xls','application/vnd.ms-excel'],['.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['.txt','text/plain'],
  ]);
  const pictureTypes=new Map<string,string>([['.jpg','image/jpeg'],['.jpeg','image/jpeg'],['.png','image/png'],['.webp','image/webp']]);
  const videoTypes=new Map<string,string>([['.mp4','video/mp4'],['.webm','video/webm']]);
  const upload=multer({
    storage:multer.diskStorage({
      destination:(_req,_file,callback)=>callback(null,incoming),
      filename:(_req,_file,callback)=>callback(null,`${crypto.randomUUID()}.upload`),
    }),
    limits:{files:20,fileSize:limits.videoBytes},
  });

  function ensureSchema() {
    exec(`CREATE TABLE IF NOT EXISTS facility_areas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      description TEXT NOT NULL DEFAULT '',
      building TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      department TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by_user_id INTEGER,
      updated_by_user_id INTEGER,
      deleted INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      deleted_by_user_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS facility_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      area_id INTEGER NOT NULL,
      parent_id INTEGER,
      name TEXT NOT NULL COLLATE NOCASE,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by_user_id INTEGER,
      updated_by_user_id INTEGER,
      FOREIGN KEY(area_id) REFERENCES facility_areas(id) ON DELETE RESTRICT,
      FOREIGN KEY(parent_id) REFERENCES facility_folders(id) ON DELETE RESTRICT
    );
    CREATE TABLE IF NOT EXISTS facility_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      area_id INTEGER NOT NULL,
      folder_id INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      display_filename TEXT NOT NULL COLLATE NOCASE,
      stored_filename TEXT NOT NULL UNIQUE,
      extension TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      caption TEXT NOT NULL DEFAULT '',
      revision TEXT NOT NULL DEFAULT '',
      item_date TEXT NOT NULL DEFAULT '',
      duration_seconds REAL,
      uploaded_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      uploaded_by_user_id INTEGER,
      updated_by_user_id INTEGER,
      FOREIGN KEY(area_id) REFERENCES facility_areas(id) ON DELETE RESTRICT,
      FOREIGN KEY(folder_id) REFERENCES facility_folders(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_facility_areas_status ON facility_areas (deleted,status,name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_facility_folders_area_parent ON facility_folders (area_id,parent_id,name COLLATE NOCASE);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_facility_folders_unique_name ON facility_folders (area_id,IFNULL(parent_id,0),name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_facility_items_area_folder ON facility_items (area_id,folder_id,updated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_facility_items_unique_name ON facility_items (folder_id,display_filename COLLATE NOCASE);`);
    seedAreas();
    fs.mkdirSync(root,{recursive:true});
  }

  function seedAreas() {
    const count=one<{count:number}>('SELECT COUNT(*) AS count FROM facility_areas')?.count??0;
    if(count)return;
    const timestamp=now();
    for(const name of ['Production','Warehouse / Shipping','Toolroom','Quality','Engineering','Front Office','Mechanical Room','Clean Room','Basement','Utility Room','Other / Custom Facility Area']){
      run('INSERT INTO facility_areas (name,created_at,updated_at) VALUES (?,?,?)',[name,timestamp,timestamp]);
    }
  }

  function receiveFiles(req:Request,res:Response,next:NextFunction) {
    upload.array('files',20)(req,res,error=>{
      if(!error)return next();
      cleanupIncoming(req);
      const message=error instanceof multer.MulterError&&error.code==='LIMIT_FILE_SIZE'
        ?`Files exceed the configured maximum of ${configuredVideoMb} MB.`
        :clientError(error,'Facility upload failed.');
      res.status(400).json({ok:false,error:message});
    });
  }

  function cleanupIncoming(req:Request) {
    for(const file of ((req.files as Express.Multer.File[]|undefined)??[])){
      if(file.path&&path.dirname(path.resolve(file.path))===path.resolve(incoming)&&fs.existsSync(file.path))fs.rmSync(file.path,{force:true});
    }
  }

  function areaById(id:number,includeDeleted=false) {
    return one<FacilityAreaRow>(`SELECT * FROM facility_areas WHERE id=?${includeDeleted?'':' AND deleted=0'}`,[id]);
  }
  function folderById(areaId:number,id:number) {
    return one<FacilityFolderRow>('SELECT * FROM facility_folders WHERE id=? AND area_id=?',[id,areaId]);
  }
  function itemById(id:number) {
    return one<FacilityItemRow>(`SELECT i.*,COALESCE(u.full_name,'Unknown user') AS uploaded_by_name,a.name AS facility_name,f.name AS folder_name
      FROM facility_items i JOIN facility_areas a ON a.id=i.area_id JOIN facility_folders f ON f.id=i.folder_id
      LEFT JOIN users u ON u.id=i.uploaded_by_user_id WHERE i.id=? AND a.deleted=0`,[id]);
  }
  function areaRoot(areaId:number) {
    if(!Number.isInteger(areaId)||areaId<=0)throw new Error('Facility is invalid.');
    const resolved=path.resolve(root,`facility-${areaId}`);
    if(path.dirname(resolved)!==path.resolve(root))throw new Error('Facility storage path is invalid.');
    return resolved;
  }
  function filesDirectory(areaId:number){return path.join(areaRoot(areaId),'files');}
  function itemPath(item:Pick<FacilityItemRow,'area_id'|'stored_filename'>) {
    const filename=path.basename(item.stored_filename);
    if(filename!==item.stored_filename||!/^[0-9a-f]{8}-[0-9a-f-]{27}\.[a-z0-9]+$/i.test(filename))throw new Error('Facility file reference is invalid.');
    const directory=filesDirectory(item.area_id);
    const resolved=path.resolve(directory,filename);
    if(path.dirname(resolved)!==path.resolve(directory))throw new Error('Facility file reference is invalid.');
    return resolved;
  }
  function cleanText(value:unknown,max=2000){return String(value??'').replace(/\r/g,'').trim().slice(0,max);}
  function safeName(value:unknown,label:string,max=120) {
    const name=String(value??'').trim().replace(/\s+/g,' ');
    if(!name)throw new Error(`${label} is required.`);
    if(name==='.'||name==='..'||name.length>max||/[\x00-\x1f\x7f<>:"/\\|?*]/.test(name))throw new Error(`${label} contains unsafe characters or is too long.`);
    return name;
  }
  function safeFilename(value:unknown,requiredExtension?:string) {
    const input=String(value??'').trim();
    if(!input||input!==path.basename(input)||/[\x00-\x1f\x7f<>:"/\\|?*]/.test(input))throw new Error('Filename is invalid.');
    const supplied=path.extname(input).toLowerCase();
    const extension=requiredExtension??supplied;
    if(!documentTypes.has(extension)&&!pictureTypes.has(extension)&&!videoTypes.has(extension))throw new Error('Supported files are PDF, Word, Excel, TXT, JPG, PNG, WEBP, MP4, or WEBM.');
    if(requiredExtension&&supplied&&supplied!==requiredExtension)throw new Error('Renaming must preserve the original file extension.');
    const base=path.basename(input,supplied).trim();
    if(!base)throw new Error('Filename is required.');
    return `${base.slice(0,Math.max(1,180-extension.length))}${extension}`;
  }
  function validateDate(value:unknown) {
    const date=String(value??'').trim();
    if(!date)return '';
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(new Date(`${date}T12:00:00Z`).getTime()))throw new Error('Date must use YYYY-MM-DD.');
    return date;
  }
  function typeForExtension(extension:string) {
    if(documentTypes.has(extension))return {mediaType:'document' as const,mimeType:documentTypes.get(extension)!,maxBytes:limits.documentBytes,maxMb:configuredDocumentMb};
    if(pictureTypes.has(extension))return {mediaType:'picture' as const,mimeType:pictureTypes.get(extension)!,maxBytes:limits.pictureBytes,maxMb:configuredPictureMb};
    if(videoTypes.has(extension))return {mediaType:'video' as const,mimeType:videoTypes.get(extension)!,maxBytes:limits.videoBytes,maxMb:configuredVideoMb};
    if(extension==='.mov')throw new Error('MOV upload is disabled because browser codec compatibility cannot be guaranteed. Use MP4 or WEBM.');
    throw new Error('Supported files are PDF, Word, Excel, TXT, JPG, PNG, WEBP, MP4, or WEBM.');
  }
  function readHeader(filePath:string,length=32) {
    const handle=fs.openSync(filePath,'r');
    try{const buffer=Buffer.alloc(length);const bytes=fs.readSync(handle,buffer,0,length,0);return buffer.subarray(0,bytes);}
    finally{fs.closeSync(handle);}
  }
  function validateUpload(file:Express.Multer.File) {
    const displayFilename=safeFilename(path.basename(file.originalname));
    const extension=path.extname(displayFilename).toLowerCase();
    const type=typeForExtension(extension);
    if(file.size>type.maxBytes)throw new Error(`${displayFilename} must be ${type.maxMb} MB or smaller.`);
    const supplied=String(file.mimetype??'').toLowerCase();
    const acceptedMime=extension==='.jpg'||extension==='.jpeg'?new Set(['image/jpeg','image/jpg']):new Set([type.mimeType]);
    if(supplied&&supplied!=='application/octet-stream'&&!acceptedMime.has(supplied))throw new Error(`${displayFilename} has a mismatched content type.`);
    const bytes=readHeader(file.path);
    const ole=bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]));
    const zip=bytes.length>=4&&bytes[0]===0x50&&bytes[1]===0x4b&&bytes[2]===0x03&&bytes[3]===0x04;
    let matches=false;
    if(extension==='.pdf')matches=bytes.subarray(0,5).toString('ascii')==='%PDF-';
    else if(extension==='.docx'||extension==='.xlsx')matches=zip;
    else if(extension==='.doc'||extension==='.xls')matches=ole;
    else if(extension==='.txt')matches=!bytes.includes(0);
    else if(extension==='.jpg'||extension==='.jpeg')matches=bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
    else if(extension==='.png')matches=bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
    else if(extension==='.webp')matches=bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP';
    else if(extension==='.mp4')matches=bytes.subarray(4,8).toString('ascii')==='ftyp';
    else if(extension==='.webm')matches=bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
    if(!matches)throw new Error(`${displayFilename} does not match its file type.`);
    return {displayFilename,extension,...type};
  }
  function duplicateItem(folderId:number,name:string,excludeId?:number) {
    return one<FacilityItemRow>(`SELECT * FROM facility_items WHERE folder_id=? AND lower(display_filename)=lower(?)${excludeId?' AND id<>?':''} LIMIT 1`,excludeId?[folderId,name,excludeId]:[folderId,name]);
  }
  function uniqueItemName(folderId:number,name:string,excludeId?:number) {
    if(!duplicateItem(folderId,name,excludeId))return name;
    const extension=path.extname(name);const base=path.basename(name,extension);
    for(let index=2;index<10000;index+=1){const candidate=`${base} (${index})${extension}`;if(!duplicateItem(folderId,candidate,excludeId))return candidate;}
    throw new Error('A unique filename could not be created.');
  }
  function folderPath(areaId:number,folderId:number) {
    const folders=all<FacilityFolderRow>('SELECT * FROM facility_folders WHERE area_id=?',[areaId]);
    const byId=new Map(folders.map(folder=>[folder.id,folder]));
    const names:string[]=[];const seen=new Set<number>();let current=byId.get(folderId);
    while(current&&!seen.has(current.id)){seen.add(current.id);names.unshift(current.name);current=current.parent_id?byId.get(current.parent_id):undefined;}
    return names.join(' / ');
  }
  function publicArea(area:FacilityAreaRow) {
    const summary=one<{folderCount:number;documentCount:number;pictureCount:number;videoCount:number;lastUpdated:string}>(`SELECT
      (SELECT COUNT(*) FROM facility_folders WHERE area_id=a.id) AS folderCount,
      SUM(CASE WHEN i.media_type='document' THEN 1 ELSE 0 END) AS documentCount,
      SUM(CASE WHEN i.media_type='picture' THEN 1 ELSE 0 END) AS pictureCount,
      SUM(CASE WHEN i.media_type='video' THEN 1 ELSE 0 END) AS videoCount,
      MAX(COALESCE(i.updated_at,a.updated_at)) AS lastUpdated
      FROM facility_areas a LEFT JOIN facility_items i ON i.area_id=a.id WHERE a.id=? GROUP BY a.id`,[area.id]);
    return {id:area.id,name:area.name,description:area.description,building:area.building,location:area.location,department:area.department,status:area.status,
      createdAt:area.created_at,updatedAt:summary?.lastUpdated??area.updated_at,summary:{folderCount:Number(summary?.folderCount??0),documentCount:Number(summary?.documentCount??0),pictureCount:Number(summary?.pictureCount??0),videoCount:Number(summary?.videoCount??0)}};
  }
  function publicFolder(folder:FacilityFolderRow) {
    const counts=one<{itemCount:number;childCount:number}>('SELECT (SELECT COUNT(*) FROM facility_items WHERE folder_id=?) AS itemCount,(SELECT COUNT(*) FROM facility_folders WHERE parent_id=?) AS childCount',[folder.id,folder.id]);
    return {id:folder.id,areaId:folder.area_id,parentId:folder.parent_id,name:folder.name,description:folder.description,path:folderPath(folder.area_id,folder.id),itemCount:Number(counts?.itemCount??0),childCount:Number(counts?.childCount??0),createdAt:folder.created_at,updatedAt:folder.updated_at};
  }
  function publicItem(item:FacilityItemRow) {
    const base=`/api/facility-info/items/${item.id}`;
    return {id:item.id,areaId:item.area_id,folderId:item.folder_id,facilityName:item.facility_name??areaById(item.area_id)?.name??'',folderName:item.folder_name??folderById(item.area_id,item.folder_id)?.name??'',folderPath:folderPath(item.area_id,item.folder_id),
      mediaType:item.media_type,originalFilename:item.original_filename,displayFilename:item.display_filename,extension:item.extension,mimeType:item.mime_type,sizeBytes:Number(item.size_bytes),
      description:item.description,caption:item.caption,revision:item.revision,date:item.item_date,durationSeconds:item.duration_seconds,uploadedAt:item.uploaded_at,updatedAt:item.updated_at,uploadedBy:item.uploaded_by_name??'Unknown user',
      contentUrl:`${base}/content`,downloadUrl:`${base}/download`,canPrint:item.media_type!=='video'&&(item.media_type==='picture'||item.extension==='.pdf')};
  }
  function record(action:string,actor:FacilityUser,area:FacilityAreaRow,entityType:string,entityId:number,label:string,value:Record<string,unknown>={}) {
    recordHistory({section:'facility_info',action,entityType,entityId,entityLabel:label,locationName:[area.building,area.location,area.department].filter(Boolean).join(' / '),newValue:{facilityId:area.id,facilityName:area.name,...value},actor});
  }
  function mutateComplete(areaId:number,reason:string,actor:FacilityUser) {
    refreshRecoveryMetadata(areaId);
    scheduleBackup(reason,actor);
  }
  function sendError(res:Response,error:unknown,fallback='Facility request failed.') {
    const message=clientError(error,fallback);
    const status=/not found/i.test(message)?404:/duplicate|already exists|not empty|contains content/i.test(message)?409:/permission|admin or manager/i.test(message)?403:400;
    res.status(status).json({ok:false,error:message});
  }

  app.get('/api/facility-info',deps.requireAuth,(req:FacilityRequest,res)=>{
    const areas=all<FacilityAreaRow>('SELECT * FROM facility_areas WHERE deleted=0 ORDER BY name COLLATE NOCASE').map(publicArea);
    const user=req.user!;const canWrite=user.is_owner_admin===1||['Maintenance Tech 3','Manager','Admin'].includes(user.role);
    res.json({ok:true,areas,permissions:{canWrite,canRecoveryExport:user.is_owner_admin===1||['Manager','Admin'].includes(user.role)},limits:{documentsMb:configuredDocumentMb,picturesMb:configuredPictureMb,videosMb:configuredVideoMb}});
  });
  app.get('/api/facility-info/permissions',deps.requireAuth,(req:FacilityRequest,res)=>{
    const user=req.user!;const canWrite=user.is_owner_admin===1||['Maintenance Tech 3','Manager','Admin'].includes(user.role);
    res.json({ok:true,canWrite,canRecoveryExport:user.is_owner_admin===1||['Manager','Admin'].includes(user.role)});
  });
  app.post('/api/facility-info/areas',deps.requireAuth,deps.requireWrite,(req:FacilityRequest,res)=>{
    try{
      const body=isRecord(req.body)?req.body:{};const name=safeName(body.name,'Facility / Area name');const timestamp=now();
      if(one('SELECT id FROM facility_areas WHERE lower(name)=lower(?) AND deleted=0',[name]))throw new Error('A Facility area with this name already exists.');
      const result=run('INSERT INTO facility_areas (name,description,building,location,department,status,created_at,updated_at,created_by_user_id,updated_by_user_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [name,cleanText(body.description),cleanText(body.building,160),cleanText(body.location,160),cleanText(body.department,160),facilityStatus(body.status),timestamp,timestamp,req.user!.id,req.user!.id]);
      const area=areaById(Number(result.lastInsertRowid))!;fs.mkdirSync(filesDirectory(area.id),{recursive:true});record('facility_created',req.user!,area,'facility_area',area.id,area.name);mutateComplete(area.id,'facility area created',req.user!);
      res.status(201).json({ok:true,area:publicArea(area)});
    }catch(error){sendError(res,error,'Facility area could not be created.');}
  });
  app.get('/api/facility-info/areas/:areaId',deps.requireAuth,(req,res)=>{
    const area=areaById(Number(req.params.areaId));if(!area)return res.status(404).json({ok:false,error:'Facility area not found.'});
    const folders=all<FacilityFolderRow>('SELECT * FROM facility_folders WHERE area_id=? ORDER BY name COLLATE NOCASE',[area.id]).map(publicFolder);
    const items=all<FacilityItemRow>(`SELECT i.*,COALESCE(u.full_name,'Unknown user') AS uploaded_by_name,a.name AS facility_name,f.name AS folder_name FROM facility_items i JOIN facility_areas a ON a.id=i.area_id JOIN facility_folders f ON f.id=i.folder_id LEFT JOIN users u ON u.id=i.uploaded_by_user_id WHERE i.area_id=? ORDER BY i.display_filename COLLATE NOCASE`,[area.id]).map(publicItem);
    res.json({ok:true,area:publicArea(area),folders,items});
  });
  app.patch('/api/facility-info/areas/:areaId',deps.requireAuth,deps.requireWrite,(req:FacilityRequest,res)=>{
    try{
      const area=areaById(Number(req.params.areaId));if(!area)throw new Error('Facility area not found.');
      const body=isRecord(req.body)?req.body:{};const name=body.name===undefined?area.name:safeName(body.name,'Facility / Area name');
      if(one('SELECT id FROM facility_areas WHERE lower(name)=lower(?) AND id<>? AND deleted=0',[name,area.id]))throw new Error('A Facility area with this name already exists.');
      const updated={name,description:body.description===undefined?area.description:cleanText(body.description),building:body.building===undefined?area.building:cleanText(body.building,160),location:body.location===undefined?area.location:cleanText(body.location,160),department:body.department===undefined?area.department:cleanText(body.department,160),status:body.status===undefined?area.status:facilityStatus(body.status)};
      run('UPDATE facility_areas SET name=?,description=?,building=?,location=?,department=?,status=?,updated_at=?,updated_by_user_id=? WHERE id=?',[updated.name,updated.description,updated.building,updated.location,updated.department,updated.status,now(),req.user!.id,area.id]);
      const saved=areaById(area.id)!;record(saved.status!==area.status?'facility_archived':'facility_edited',req.user!,saved,'facility_area',saved.id,saved.name,{previousName:area.name,status:saved.status});mutateComplete(saved.id,'facility area updated',req.user!);
      res.json({ok:true,area:publicArea(saved)});
    }catch(error){sendError(res,error,'Facility area could not be updated.');}
  });
  app.delete('/api/facility-info/areas/:areaId',deps.requireAuth,deps.requireWrite,(req:FacilityRequest,res)=>{
    try{
      const area=areaById(Number(req.params.areaId));if(!area)throw new Error('Facility area not found.');
      const itemCount=one<{count:number}>('SELECT COUNT(*) AS count FROM facility_items WHERE area_id=?',[area.id])?.count??0;
      const body=isRecord(req.body)?req.body:{};
      if(itemCount&&(body.confirmation!=='PERMANENTLY DELETE'||body.contentDisposition!=='exported_or_moved'))throw new Error('Facility contains content. Export or move it, then confirm PERMANENTLY DELETE.');
      const folderIds=all<{id:number}>('SELECT id FROM facility_folders WHERE area_id=?',[area.id]).map(row=>row.id);
      const files=all<FacilityItemRow>('SELECT * FROM facility_items WHERE area_id=?',[area.id]).map(itemPath);
      exec('BEGIN IMMEDIATE');
      try{
        run('DELETE FROM facility_items WHERE area_id=?',[area.id]);
        for(const folderId of folderIds.reverse())run('DELETE FROM facility_folders WHERE id=?',[folderId]);
        run('UPDATE facility_areas SET deleted=1,deleted_at=?,deleted_by_user_id=?,updated_at=?,updated_by_user_id=? WHERE id=?',[now(),req.user!.id,now(),req.user!.id,area.id]);
        exec('COMMIT');
      }catch(error){exec('ROLLBACK');throw error;}
      files.forEach(file=>{if(fs.existsSync(file))fs.rmSync(file,{force:true});});
      const deletedRoot=areaRoot(area.id);if(fs.existsSync(deletedRoot))fs.rmSync(deletedRoot,{recursive:true,force:true});
      record('facility_deleted',req.user!,area,'facility_area',area.id,area.name,{permanentContentDeletion:Boolean(itemCount)});refreshRecoveryMetadata();scheduleBackup('facility area deleted',req.user!);
      res.json({ok:true});
    }catch(error){sendError(res,error,'Facility area could not be deleted.');}
  });
  app.post('/api/facility-info/areas/:areaId/folders',deps.requireAuth,deps.requireWrite,(req:FacilityRequest,res)=>{
    try{
      const area=areaById(Number(req.params.areaId));if(!area)throw new Error('Facility area not found.');
      const body=isRecord(req.body)?req.body:{};const parentId=body.parentId?Number(body.parentId):null;
      if(parentId&&!folderById(area.id,parentId))throw new Error('Parent folder not found.');
      const name=safeName(body.name,'Folder Name');
      if(one('SELECT id FROM facility_folders WHERE area_id=? AND IFNULL(parent_id,0)=? AND lower(name)=lower(?)',[area.id,parentId??0,name]))throw new Error('A folder with this name already exists in this location.');
      const timestamp=now();const result=run('INSERT INTO facility_folders (area_id,parent_id,name,description,created_at,updated_at,created_by_user_id,updated_by_user_id) VALUES (?,?,?,?,?,?,?,?)',[area.id,parentId,name,cleanText(body.description),timestamp,timestamp,req.user!.id,req.user!.id]);
      const folder=folderById(area.id,Number(result.lastInsertRowid))!;record('folder_created',req.user!,area,'facility_folder',folder.id,folder.name,{folderPath:folderPath(area.id,folder.id)});mutateComplete(area.id,'facility folder created',req.user!);
      res.status(201).json({ok:true,folder:publicFolder(folder)});
    }catch(error){sendError(res,error,'Folder could not be created.');}
  });
  app.patch('/api/facility-info/areas/:areaId/folders/:folderId',deps.requireAuth,deps.requireWrite,(req:FacilityRequest,res)=>{
    try{
      const area=areaById(Number(req.params.areaId));if(!area)throw new Error('Facility area not found.');
      const folder=folderById(area.id,Number(req.params.folderId));if(!folder)throw new Error('Folder not found.');
      const body=isRecord(req.body)?req.body:{};const name=body.name===undefined?folder.name:safeName(body.name,'Folder Name');const parentId=body.parentId===undefined?folder.parent_id:body.parentId?Number(body.parentId):null;
      if(parentId===folder.id)throw new Error('A folder cannot be its own parent.');
      if(parentId&&!folderById(area.id,parentId))throw new Error('Parent folder not found.');
      if(parentId){let ancestor=folderById(area.id,parentId);const seen=new Set<number>();while(ancestor&&!seen.has(ancestor.id)){if(ancestor.id===folder.id)throw new Error('A folder cannot be moved inside one of its subfolders.');seen.add(ancestor.id);ancestor=ancestor.parent_id?folderById(area.id,ancestor.parent_id):undefined;}}
      if(one('SELECT id FROM facility_folders WHERE area_id=? AND IFNULL(parent_id,0)=? AND lower(name)=lower(?) AND id<>?',[area.id,parentId??0,name,folder.id]))throw new Error('A folder with this name already exists in this location.');
      run('UPDATE facility_folders SET parent_id=?,name=?,description=?,updated_at=?,updated_by_user_id=? WHERE id=?',[parentId,name,body.description===undefined?folder.description:cleanText(body.description),now(),req.user!.id,folder.id]);
      const saved=folderById(area.id,folder.id)!;record(name!==folder.name?'folder_renamed':'folder_edited',req.user!,area,'facility_folder',saved.id,saved.name,{previousName:folder.name,folderPath:folderPath(area.id,saved.id)});mutateComplete(area.id,'facility folder updated',req.user!);
      res.json({ok:true,folder:publicFolder(saved)});
    }catch(error){sendError(res,error,'Folder could not be updated.');}
  });
  app.delete('/api/facility-info/areas/:areaId/folders/:folderId',deps.requireAuth,deps.requireWrite,(req:FacilityRequest,res)=>{
    try{
      const area=areaById(Number(req.params.areaId));if(!area)throw new Error('Facility area not found.');
      const folder=folderById(area.id,Number(req.params.folderId));if(!folder)throw new Error('Folder not found.');
      const itemCount=one<{count:number}>('SELECT COUNT(*) AS count FROM facility_items WHERE folder_id=?',[folder.id])?.count??0;
      const childCount=one<{count:number}>('SELECT COUNT(*) AS count FROM facility_folders WHERE parent_id=?',[folder.id])?.count??0;
      if(itemCount||childCount)throw new Error('Folder is not empty. Move or delete its content first.');
      run('DELETE FROM facility_folders WHERE id=? AND area_id=?',[folder.id,area.id]);record('folder_deleted',req.user!,area,'facility_folder',folder.id,folder.name);mutateComplete(area.id,'facility folder deleted',req.user!);
      res.json({ok:true});
    }catch(error){sendError(res,error,'Folder could not be deleted.');}
  });
  app.post('/api/facility-info/areas/:areaId/folders/:folderId/items',deps.requireAuth,deps.requireWrite,receiveFiles,(req:FacilityRequest,res)=>{
    const written:string[]=[];const replaced:string[]=[];let committed=false;
    try{
      const area=areaById(Number(req.params.areaId));if(!area)throw new Error('Facility area not found.');
      const folder=folderById(area.id,Number(req.params.folderId));if(!folder)throw new Error('Folder not found.');
      const files=(req.files as Express.Multer.File[]|undefined)??[];if(!files.length)throw new Error('Select at least one file to upload.');
      const validated=files.map(file=>({file,...validateUpload(file)}));const duplicateAction=String(req.body?.duplicateAction??'').toLowerCase();const names=new Set<string>();
      const duplicates=validated.filter(item=>{const key=item.displayFilename.toLowerCase();const duplicate=names.has(key)||Boolean(duplicateItem(folder.id,item.displayFilename));names.add(key);return duplicate;});
      if(duplicates.length&&!['replace','keep_both'].includes(duplicateAction)){cleanupIncoming(req);return res.status(409).json({ok:false,code:'FACILITY_DUPLICATE',error:'A file with this name already exists.',duplicates:duplicates.map(item=>item.displayFilename)});}
      const timestamp=now();const ids:number[]=[];const events:Array<{action:string;id:number;name:string;mediaType:string}>=[];
      fs.mkdirSync(filesDirectory(area.id),{recursive:true});exec('BEGIN IMMEDIATE');
      try{
        for(const item of validated){
          let displayFilename=item.displayFilename;let existing=duplicateItem(folder.id,displayFilename);
          if(existing&&duplicateAction==='keep_both'){displayFilename=uniqueItemName(folder.id,displayFilename);existing=undefined;}
          const storedFilename=`${crypto.randomUUID()}${item.extension}`;const destination=path.join(filesDirectory(area.id),storedFilename);
          fs.renameSync(item.file.path,destination);written.push(destination);
          if(existing&&duplicateAction==='replace'){
            replaced.push(itemPath(existing));run(`UPDATE facility_items SET original_filename=?,display_filename=?,stored_filename=?,extension=?,mime_type=?,size_bytes=?,media_type=?,description=?,caption=?,revision=?,item_date=?,duration_seconds=NULL,uploaded_at=?,updated_at=?,uploaded_by_user_id=?,updated_by_user_id=? WHERE id=?`,
              [item.displayFilename,displayFilename,storedFilename,item.extension,item.mimeType,item.file.size,item.mediaType,cleanText(req.body?.description),cleanText(req.body?.caption),cleanText(req.body?.revision,80),validateDate(req.body?.date),timestamp,timestamp,req.user!.id,req.user!.id,existing.id]);
            ids.push(existing.id);events.push({action:'file_replaced',id:existing.id,name:displayFilename,mediaType:item.mediaType});
          }else{
            const result=run(`INSERT INTO facility_items (area_id,folder_id,media_type,original_filename,display_filename,stored_filename,extension,mime_type,size_bytes,description,caption,revision,item_date,uploaded_at,updated_at,uploaded_by_user_id,updated_by_user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              [area.id,folder.id,item.mediaType,item.displayFilename,displayFilename,storedFilename,item.extension,item.mimeType,item.file.size,cleanText(req.body?.description),cleanText(req.body?.caption),cleanText(req.body?.revision,80),validateDate(req.body?.date),timestamp,timestamp,req.user!.id,req.user!.id]);
            const id=Number(result.lastInsertRowid);ids.push(id);events.push({action:`${item.mediaType}_uploaded`,id,name:displayFilename,mediaType:item.mediaType});
          }
        }
        run('UPDATE facility_folders SET updated_at=?,updated_by_user_id=? WHERE id=?',[timestamp,req.user!.id,folder.id]);run('UPDATE facility_areas SET updated_at=?,updated_by_user_id=? WHERE id=?',[timestamp,req.user!.id,area.id]);exec('COMMIT');committed=true;
      }catch(error){exec('ROLLBACK');throw error;}
      replaced.forEach(file=>{if(fs.existsSync(file))fs.rmSync(file,{force:true});});events.forEach(event=>record(event.action,req.user!,area,'facility_item',event.id,event.name,{folderId:folder.id,folderPath:folderPath(area.id,folder.id),mediaType:event.mediaType}));mutateComplete(area.id,'facility files uploaded',req.user!);
      res.status(201).json({ok:true,items:ids.map(id=>publicItem(itemById(id)!))});
    }catch(error){
      cleanupIncoming(req);if(!committed)written.forEach(file=>{if(fs.existsSync(file))fs.rmSync(file,{force:true});});sendError(res,error,'Files could not be uploaded.');
    }
  });
  app.get('/api/facility-info/search',deps.requireAuth,(req,res)=>{
    const query=String(req.query.q??req.query.search??'').trim();const mediaType=String(req.query.type??'all').toLowerCase();const areaId=Number(req.query.areaId??0);const fileType=String(req.query.fileType??'').toLowerCase();const sort=String(req.query.sort??'name');
    const params:SqlParam[]=[];let where='a.deleted=0';
    if(query){const like=`%${escapeLike(query)}%`;where+=` AND (a.name LIKE ? ESCAPE '\\' COLLATE NOCASE OR f.name LIKE ? ESCAPE '\\' COLLATE NOCASE OR i.display_filename LIKE ? ESCAPE '\\' COLLATE NOCASE OR i.description LIKE ? ESCAPE '\\' COLLATE NOCASE OR i.caption LIKE ? ESCAPE '\\' COLLATE NOCASE OR i.revision LIKE ? ESCAPE '\\' COLLATE NOCASE OR COALESCE(u.full_name,'') LIKE ? ESCAPE '\\' COLLATE NOCASE OR i.extension LIKE ? ESCAPE '\\' COLLATE NOCASE)`;params.push(like,like,like,like,like,like,like,like);}
    if(['document','picture','video'].includes(mediaType)){where+=' AND i.media_type=?';params.push(mediaType);}
    if(areaId>0){where+=' AND i.area_id=?';params.push(areaId);}
    if(fileType){where+=' AND i.extension=?';params.push(fileType.startsWith('.')?fileType:`.${fileType}`);}
    const order=sort==='newest'?'i.uploaded_at DESC,i.id DESC':sort==='oldest'?'i.uploaded_at ASC,i.id ASC':sort==='file_type'?'i.extension COLLATE NOCASE,i.display_filename COLLATE NOCASE':sort==='size'?'i.size_bytes DESC,i.display_filename COLLATE NOCASE':'i.display_filename COLLATE NOCASE,i.id';
    const items=all<FacilityItemRow>(`SELECT i.*,COALESCE(u.full_name,'Unknown user') AS uploaded_by_name,a.name AS facility_name,f.name AS folder_name FROM facility_items i JOIN facility_areas a ON a.id=i.area_id JOIN facility_folders f ON f.id=i.folder_id LEFT JOIN users u ON u.id=i.uploaded_by_user_id WHERE ${where} ORDER BY ${order}`,params).map(publicItem);
    const areaLike=`%${escapeLike(query)}%`;
    const matchingAreas=query&&mediaType==='all'&&!fileType
      ?all<FacilityAreaRow>(`SELECT * FROM facility_areas WHERE deleted=0 AND (name LIKE ? ESCAPE '\\' COLLATE NOCASE OR description LIKE ? ESCAPE '\\' COLLATE NOCASE OR building LIKE ? ESCAPE '\\' COLLATE NOCASE OR location LIKE ? ESCAPE '\\' COLLATE NOCASE OR department LIKE ? ESCAPE '\\' COLLATE NOCASE) ORDER BY name COLLATE NOCASE`,[areaLike,areaLike,areaLike,areaLike,areaLike]).map(publicArea)
      :[];
    const matchingFolders=query&&mediaType==='all'&&!fileType
      ?all<FacilityFolderRow&{facility_name:string}>(`SELECT f.*,a.name AS facility_name FROM facility_folders f JOIN facility_areas a ON a.id=f.area_id WHERE a.deleted=0 AND (f.name LIKE ? ESCAPE '\\' COLLATE NOCASE OR f.description LIKE ? ESCAPE '\\' COLLATE NOCASE) ORDER BY a.name COLLATE NOCASE,f.name COLLATE NOCASE`,[areaLike,areaLike]).map(folder=>({...publicFolder(folder),facilityName:folder.facility_name}))
      :[];
    res.json({ok:true,query,areas:matchingAreas,folders:matchingFolders,items,count:matchingAreas.length+matchingFolders.length+items.length});
  });
  app.patch('/api/facility-info/items/:itemId',deps.requireAuth,deps.requireWrite,(req:FacilityRequest,res)=>{
    try{
      const item=itemById(Number(req.params.itemId));if(!item)throw new Error('Facility item not found.');const area=areaById(item.area_id)!;const body=isRecord(req.body)?req.body:{};
      const displayFilename=body.displayFilename===undefined?item.display_filename:safeFilename(body.displayFilename,item.extension);
      if(duplicateItem(item.folder_id,displayFilename,item.id))throw new Error('A file with this name already exists.');
      run('UPDATE facility_items SET display_filename=?,description=?,caption=?,revision=?,item_date=?,updated_at=?,updated_by_user_id=? WHERE id=?',[displayFilename,body.description===undefined?item.description:cleanText(body.description),body.caption===undefined?item.caption:cleanText(body.caption),body.revision===undefined?item.revision:cleanText(body.revision,80),body.date===undefined?item.item_date:validateDate(body.date),now(),req.user!.id,item.id]);
      const saved=itemById(item.id)!;record(displayFilename!==item.display_filename?'file_renamed':'file_edited',req.user!,area,'facility_item',item.id,displayFilename,{previousFilename:item.display_filename,mediaType:item.media_type});mutateComplete(area.id,'facility file updated',req.user!);
      res.json({ok:true,item:publicItem(saved)});
    }catch(error){sendError(res,error,'Facility item could not be updated.');}
  });
  app.post('/api/facility-info/items/:itemId/move',deps.requireAuth,deps.requireWrite,(req:FacilityRequest,res)=>{
    try{
      const item=itemById(Number(req.params.itemId));if(!item)throw new Error('Facility item not found.');const sourceArea=areaById(item.area_id)!;const body=isRecord(req.body)?req.body:{};const area=areaById(Number(body.areaId??item.area_id));if(!area)throw new Error('Destination Facility area not found.');const folder=folderById(area.id,Number(body.folderId));if(!folder)throw new Error('Destination folder not found.');
      if(folder.id===item.folder_id&&area.id===item.area_id)throw new Error('Choose a different destination folder.');
      const action=String(body.duplicateAction??'').toLowerCase();let displayFilename=item.display_filename;const duplicate=duplicateItem(folder.id,displayFilename,item.id);let replacedPath='';
      if(duplicate&&!['replace','keep_both'].includes(action))return res.status(409).json({ok:false,code:'FACILITY_DUPLICATE',error:'A file with this name already exists.'});
      if(duplicate&&action==='keep_both')displayFilename=uniqueItemName(folder.id,displayFilename,item.id);
      const oldPath=itemPath(item);let storedFilename=item.stored_filename;let newPath=oldPath;
      if(area.id!==item.area_id){storedFilename=`${crypto.randomUUID()}${item.extension}`;fs.mkdirSync(filesDirectory(area.id),{recursive:true});newPath=path.join(filesDirectory(area.id),storedFilename);fs.copyFileSync(oldPath,newPath,fs.constants.COPYFILE_EXCL);}
      exec('BEGIN IMMEDIATE');try{
        if(duplicate&&action==='replace'){replacedPath=itemPath(duplicate);run('DELETE FROM facility_items WHERE id=?',[duplicate.id]);}
        run('UPDATE facility_items SET area_id=?,folder_id=?,display_filename=?,stored_filename=?,updated_at=?,updated_by_user_id=? WHERE id=?',[area.id,folder.id,displayFilename,storedFilename,now(),req.user!.id,item.id]);exec('COMMIT');
      }catch(error){exec('ROLLBACK');if(newPath!==oldPath&&fs.existsSync(newPath))fs.rmSync(newPath,{force:true});throw error;}
      if(newPath!==oldPath&&fs.existsSync(oldPath))fs.rmSync(oldPath,{force:true});if(replacedPath&&fs.existsSync(replacedPath))fs.rmSync(replacedPath,{force:true});
      record('file_moved',req.user!,area,'facility_item',item.id,displayFilename,{fromFacility:sourceArea.name,toFacility:area.name,toFolderPath:folderPath(area.id,folder.id),mediaType:item.media_type});refreshRecoveryMetadata(item.area_id);mutateComplete(area.id,'facility file moved',req.user!);
      res.json({ok:true,item:publicItem(itemById(item.id)!)});
    }catch(error){sendError(res,error,'Facility item could not be moved.');}
  });
  app.delete('/api/facility-info/items/:itemId',deps.requireAuth,deps.requireWrite,(req:FacilityRequest,res)=>{
    try{
      const item=itemById(Number(req.params.itemId));if(!item)throw new Error('Facility item not found.');const area=areaById(item.area_id)!;const file=itemPath(item);
      run('DELETE FROM facility_items WHERE id=?',[item.id]);if(fs.existsSync(file))fs.rmSync(file,{force:true});record(`${item.media_type}_deleted`,req.user!,area,'facility_item',item.id,item.display_filename,{folderPath:folderPath(area.id,item.folder_id)});mutateComplete(area.id,'facility file deleted',req.user!);res.json({ok:true});
    }catch(error){sendError(res,error,'Facility item could not be deleted.');}
  });
  app.get('/api/facility-info/items/:itemId/content',deps.requireAuth,(req,res)=>sendItemFile(req,res,false));
  app.get('/api/facility-info/items/:itemId/download',deps.requireAuth,(req,res)=>sendItemFile(req,res,true));

  function sendItemFile(req:Request,res:Response,download:boolean) {
    try{
      const item=itemById(Number(req.params.itemId));if(!item)return res.status(404).json({ok:false,error:'Facility item not found.'});const file=itemPath(item);
      if(!fs.existsSync(file))return res.status(404).json({ok:false,error:'Stored Facility file is missing.'});
      const size=fs.statSync(file).size;res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','private, no-store');
      res.setHeader('Content-Disposition',`${download?'attachment':'inline'}; filename="${asciiFilename(item.display_filename)}"; filename*=UTF-8''${encodeURIComponent(item.display_filename)}`);
      if(item.media_type==='video'&&!download){
        res.setHeader('Accept-Ranges','bytes');const range=String(req.headers.range??'');
        if(range){
          const match=/^bytes=(\d*)-(\d*)$/.exec(range);if(!match)return res.status(416).setHeader('Content-Range',`bytes */${size}`).end();
          const start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2]||0));const end=match[2]?Math.min(Number(match[2]),size-1):size-1;
          if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||start>=size)return res.status(416).setHeader('Content-Range',`bytes */${size}`).end();
          res.status(206);res.setHeader('Content-Range',`bytes ${start}-${end}/${size}`);res.setHeader('Content-Length',String(end-start+1));res.type(item.mime_type);fs.createReadStream(file,{start,end}).pipe(res);return;
        }
      }
      res.type(item.mime_type);res.setHeader('Content-Length',String(size));fs.createReadStream(file).pipe(res);
    }catch(error){if(!res.headersSent)sendError(res,error,'Facility file could not be opened.');else res.destroy();}
  }

  app.get('/api/facility-info/areas/:areaId/export',deps.requireAuth,(req,res)=>{
    const area=areaById(Number(req.params.areaId));if(!area)return res.status(404).json({ok:false,error:'Facility area not found.'});const manifest=buildManifest(area);streamArchive(res,`${safeArchiveSegment(area.name,'Facility')}_${new Date().toISOString().slice(0,10)}.zip`,archive=>appendAreaArchive(archive,manifest,''));
  });
  app.get('/api/facility-info/recovery-export',deps.requireAuth,(req:FacilityRequest,res)=>{
    if(!req.user?.is_owner_admin&&!['Manager','Admin'].includes(req.user?.role??''))return res.status(403).json({ok:false,error:'Admin or Manager access is required.'});
    const recovery=refreshRecoveryMetadata();streamArchive(res,`MCC_Facility_Info_Recovery_${new Date().toISOString().slice(0,10)}.zip`,archive=>{
      archive.append(`${JSON.stringify(recovery.index,null,2)}\n`,{name:'facility-info-index.json'});archive.append(recovery.csv,{name:'facility-info-index.csv'});
      archive.append('MCC Facility Info full recovery export. Readable Facility and folder names wrap UUID-backed originals; facility-info.json retains stable mappings and SHA-256 checksums.\n',{name:'README.txt'});
      for(const manifest of recovery.manifests)appendAreaArchive(archive,manifest,`Facility-${safeArchiveSegment(manifest.facility.name,String(manifest.facility.id))}`);
    });
  });

  function buildManifest(area:FacilityAreaRow) {
    const folders=all<FacilityFolderRow>('SELECT * FROM facility_folders WHERE area_id=? ORDER BY id',[area.id]);
    const items=all<FacilityItemRow>(`SELECT i.*,COALESCE(u.full_name,'Unknown user') AS uploaded_by_name FROM facility_items i LEFT JOIN users u ON u.id=i.uploaded_by_user_id WHERE i.area_id=? ORDER BY i.id`,[area.id]);
    return {schemaVersion:1,generatedAt:now(),storageDirectory:`facility-${area.id}`,facility:{id:area.id,name:area.name,description:area.description,building:area.building,location:area.location,department:area.department,status:area.status,createdAt:area.created_at,updatedAt:area.updated_at},
      summary:{folderCount:folders.length,documentCount:items.filter(item=>item.media_type==='document').length,pictureCount:items.filter(item=>item.media_type==='picture').length,videoCount:items.filter(item=>item.media_type==='video').length,totalBytes:items.reduce((sum,item)=>sum+Number(item.size_bytes),0)},
      folders:folders.map(folder=>({id:folder.id,parentId:folder.parent_id,name:folder.name,description:folder.description,path:folderPath(area.id,folder.id),createdAt:folder.created_at,updatedAt:folder.updated_at})),
      items:items.map(item=>({id:item.id,folderId:item.folder_id,folderPath:folderPath(area.id,item.folder_id),mediaType:item.media_type,originalFilename:item.original_filename,visibleFilename:item.display_filename,storedFilename:item.stored_filename,extension:item.extension,mimeType:item.mime_type,sizeBytes:Number(item.size_bytes),description:item.description,caption:item.caption,revision:item.revision,date:item.item_date,durationSeconds:item.duration_seconds,uploadedAt:item.uploaded_at,updatedAt:item.updated_at,uploadedBy:item.uploaded_by_name??'Unknown user',checksumSha256:fs.existsSync(itemPath(item))?sha256File(itemPath(item)):''}))};
  }
  function refreshRecoveryMetadata(areaId?:number) {
    fs.mkdirSync(root,{recursive:true});const areas=all<FacilityAreaRow>(`SELECT * FROM facility_areas WHERE deleted=0${areaId?' AND id=?':''} ORDER BY name COLLATE NOCASE`,areaId?[areaId]:[]);
    for(const area of areas){const manifest=buildManifest(area);fs.mkdirSync(areaRoot(area.id),{recursive:true});atomicWrite(path.join(areaRoot(area.id),'facility-info.json'),`${JSON.stringify(manifest,null,2)}\n`);}
    const allAreas=all<FacilityAreaRow>('SELECT * FROM facility_areas WHERE deleted=0 ORDER BY name COLLATE NOCASE');const manifests=allAreas.map(buildManifest);
    const index={schemaVersion:1,generatedAt:now(),facilities:manifests.map(manifest=>({id:manifest.facility.id,name:manifest.facility.name,status:manifest.facility.status,storageDirectory:manifest.storageDirectory,...manifest.summary,manifest:`${manifest.storageDirectory}/facility-info.json`}))};
    const headers=['id','name','status','storageDirectory','folderCount','documentCount','pictureCount','videoCount','totalBytes','manifest'];const csv=`${headers.join(',')}\r\n${index.facilities.map(row=>headers.map(header=>csvCell(row[header as keyof typeof row])).join(',')).join('\r\n')}${index.facilities.length?'\r\n':''}`;
    atomicWrite(path.join(root,'facility-info-index.json'),`${JSON.stringify(index,null,2)}\n`);atomicWrite(path.join(root,'facility-info-index.csv'),csv);return {generatedAt:index.generatedAt,manifests,index,csv};
  }
  function appendAreaArchive(archive:Archiver,manifest:ReturnType<typeof buildManifest>,prefix:string) {
    const base=prefix?`${prefix.replace(/\/$/,'')}/`:'';archive.append(`${JSON.stringify(manifest,null,2)}\n`,{name:`${base}facility-info.json`});const used=new Set<string>();
    for(const item of manifest.items){const source=path.join(filesDirectory(manifest.facility.id),item.storedFilename);if(!fs.existsSync(source))throw new Error(`Stored Facility file is missing: ${item.visibleFilename}`);const candidate=`${base}${item.folderPath.split(' / ').map(segment=>safeArchiveSegment(segment,'Folder')).join('/')}/${safeArchiveSegment(item.visibleFilename,`item-${item.id}${item.extension}`)}`;archive.file(source,{name:uniqueArchivePath(candidate,used)});}
  }
  function validateStorage() {
    const missing:string[]=[];for(const item of all<FacilityItemRow>('SELECT * FROM facility_items')){try{const file=itemPath(item);if(!fs.existsSync(file)||!fs.statSync(file).isFile()||fs.statSync(file).size!==Number(item.size_bytes))missing.push(String(item.id));}catch{missing.push(String(item.id));}}
    if(missing.length)throw new Error(`Backup restore is missing ${missing.length} Facility file${missing.length===1?'':'s'}.`);
  }

  ensureSchema();
  return {ensureSchema,refreshRecoveryMetadata,validateStorage,limits,root};
}

function positiveLimit(value:string|undefined,fallback:number){const parsed=Number(value);return Number.isFinite(parsed)&&parsed>0&&parsed<=4096?Math.round(parsed):fallback;}
function isRecord(value:unknown):value is Record<string,any>{return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function facilityStatus(value:unknown){const status=String(value??'active').toLowerCase();if(!['active','archived','disabled'].includes(status))throw new Error('Facility status is invalid.');return status;}
function escapeLike(value:string){return value.replace(/[\\%_]/g,match=>`\\${match}`);}
function clientError(error:unknown,fallback:string){return error instanceof Error&&error.message?error.message:fallback;}
function sha256File(filePath:string){const hash=crypto.createHash('sha256');const handle=fs.openSync(filePath,'r');try{const buffer=Buffer.allocUnsafe(1024*1024);let count=0;do{count=fs.readSync(handle,buffer,0,buffer.length,null);if(count)hash.update(buffer.subarray(0,count));}while(count);}finally{fs.closeSync(handle);}return hash.digest('hex');}
function atomicWrite(filePath:string,content:string){fs.mkdirSync(path.dirname(filePath),{recursive:true});const temporary=`${filePath}.${crypto.randomUUID()}.tmp`;fs.writeFileSync(temporary,content,{encoding:'utf8',flag:'wx'});fs.renameSync(temporary,filePath);}
function csvCell(value:unknown){const text=String(value??'');return /[",\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;}
function safeArchiveSegment(value:unknown,fallback:string){const clean=String(value??'').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g,'_').replace(/[. ]+$/g,'').trim();return (clean||fallback).slice(0,180);}
function uniqueArchivePath(candidate:string,used:Set<string>){const normalized=candidate.split('\\').join('/');if(!used.has(normalized.toLowerCase())){used.add(normalized.toLowerCase());return normalized;}const extension=path.posix.extname(normalized);const base=normalized.slice(0,-extension.length);for(let index=2;index<10000;index+=1){const next=`${base} (${index})${extension}`;if(!used.has(next.toLowerCase())){used.add(next.toLowerCase());return next;}}throw new Error('Archive entry name could not be made unique.');}
function asciiFilename(value:string){return value.replace(/[^\x20-\x7e]/g,'_').replace(/["\\]/g,'_');}
function streamArchive(res:Response,fileName:string,build:(archive:Archiver)=>void){const archive=new ZipArchive({zlib:{level:6}});archive.on('warning',(error:Error&{code?:string})=>{if(error.code!=='ENOENT')res.destroy(error);});archive.on('error',(error:Error)=>res.destroy(error));res.setHeader('Content-Type','application/zip');res.setHeader('Content-Disposition',`attachment; filename="${asciiFilename(fileName)}"`);res.setHeader('Cache-Control','private, no-store');archive.pipe(res);build(archive);void archive.finalize();}
