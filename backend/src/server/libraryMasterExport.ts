import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Response } from 'express';
import { ZipArchive, type Archiver } from 'archiver';

export type MasterExportSource={archivePath:string;sourcePath:string;sizeBytes:number;downloadUrl:string};
export type PreparedMasterExport={
  schemaVersion:1;
  appVersion:string;
  generatedAt:string;
  rootName:string;
  directories:string[];
  files:Array<MasterExportSource&{checksumSha256:string}>;
  summary:{fileCount:number;totalBytes:number};
};

export async function prepareMasterExport(input:{rootName:string;appVersion:string;directories:string[];files:MasterExportSource[];signal?:AbortSignal}):Promise<PreparedMasterExport>{
  const root=safeArchivePath(input.rootName);const used=new Set<string>();const directories:string[]=[];
  for(const value of input.directories){const relative=safeArchivePath(value);const full=`${root}/${relative}/`;const key=full.toLocaleLowerCase();if(!used.has(key)){used.add(key);directories.push(full);}}
  const files:Array<MasterExportSource&{checksumSha256:string}>=[];
  for(const item of input.files){
    if(input.signal?.aborted)throw new Error('Master Export was cancelled.');
    const archivePath=`${root}/${safeArchivePath(item.archivePath)}`;const key=archivePath.toLocaleLowerCase();if(used.has(key))throw new Error(`Master Export contains a duplicate path: ${item.archivePath}`);used.add(key);
    let stat:fs.Stats;try{stat=await fs.promises.stat(item.sourcePath);}catch{throw new Error(`Stored file is missing: ${item.archivePath}`);}
    if(!stat.isFile()||stat.size!==item.sizeBytes)throw new Error(`Stored file size does not match: ${item.archivePath}`);
    files.push({...item,archivePath,checksumSha256:await sha256File(item.sourcePath,input.signal)});
  }
  return{schemaVersion:1,appVersion:input.appVersion,generatedAt:new Date().toISOString(),rootName:root,directories,files,summary:{fileCount:files.length,totalBytes:files.reduce((sum,item)=>sum+item.sizeBytes,0)}};
}

export function publicMasterExportPlan(plan:PreparedMasterExport){
  return{schemaVersion:plan.schemaVersion,appVersion:plan.appVersion,generatedAt:plan.generatedAt,rootName:plan.rootName,directories:plan.directories,files:plan.files.map(({sourcePath:_,...file})=>file),summary:plan.summary};
}

function masterExportManifest(plan:PreparedMasterExport){
  return{schemaVersion:plan.schemaVersion,appVersion:plan.appVersion,generatedAt:plan.generatedAt,rootName:plan.rootName,directories:plan.directories,files:plan.files.map(({sourcePath:_,downloadUrl:__,...file})=>file),summary:plan.summary};
}

export function streamMasterExport(res:Response,fileName:string,plan:PreparedMasterExport){
  const archive:Archiver=new ZipArchive({store:true});let complete=false;let failed=false;
  const abort=()=>{if(!complete)void archive.abort();};const fail=(error:Error)=>{if(failed||complete)return;failed=true;void archive.abort();res.destroy(error);};
  res.once('close',abort);archive.once('end',()=>{complete=true;res.off('close',abort);});archive.on('warning',fail);archive.on('error',fail);
  res.setHeader('Content-Type','application/zip');res.setHeader('Content-Disposition',`attachment; filename="${asciiFilename(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-MCC-Export-Bytes',String(plan.summary.totalBytes));archive.pipe(res);
  for(const directory of plan.directories)archive.append('',{name:directory});
  for(const file of plan.files)archive.file(file.sourcePath,{name:file.archivePath});
  const manifest=masterExportManifest(plan);archive.append(`${JSON.stringify(manifest,null,2)}\n`,{name:`${plan.rootName}/MCC_ASSET_LIBRARY_MANIFEST.json`});
  archive.append(`MCC Asset Library Master Export\nMCC version: ${plan.appVersion}\nGenerated: ${plan.generatedAt}\nFiles: ${plan.summary.fileCount}\nBytes: ${plan.summary.totalBytes}\n\nThe JSON manifest contains the relative path, size, and SHA-256 checksum for every exported file.\n`,{name:`${plan.rootName}/MCC_EXPORT_INFO.txt`});
  void archive.finalize();
}

async function sha256File(filePath:string,signal?:AbortSignal){
  return new Promise<string>((resolve,reject)=>{const hash=crypto.createHash('sha256');const stream=fs.createReadStream(filePath,{highWaterMark:1024*1024});const cancel=()=>stream.destroy(new Error('Master Export was cancelled.'));signal?.addEventListener('abort',cancel,{once:true});stream.on('data',chunk=>hash.update(chunk));stream.once('error',reject);stream.once('end',()=>resolve(hash.digest('hex')));stream.once('close',()=>signal?.removeEventListener('abort',cancel));});
}
function safeArchivePath(value:string){const normalized=path.posix.normalize(String(value??'').replace(/\\/g,'/')).replace(/^\/+|\/+$/g,'');if(!normalized||normalized==='.'||normalized==='..'||normalized.startsWith('../')||normalized.includes('/../')||/\x00/.test(normalized))throw new Error('Master Export path is unsafe.');return normalized.split('/').map(segment=>segment.replace(/[\x00-\x1f\x7f<>:"\\|?*]/g,'_').replace(/[. ]+$/g,'').trim().slice(0,180)||'Unnamed').join('/');}
function asciiFilename(value:string){return value.replace(/[^\x20-\x7e]/g,'_').replace(/["\\]/g,'_');}
