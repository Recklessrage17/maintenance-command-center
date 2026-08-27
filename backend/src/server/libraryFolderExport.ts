import fs from 'node:fs';
import path from 'node:path';
import type { Response } from 'express';
import { ZipArchive, type Archiver } from 'archiver';

export type ShareableFolder = { id:number; parentId:number|null; name:string };
export type ShareableFile = { folderId:number; displayFilename:string; sourcePath:string; sizeBytes:number };

export type PreparedShareableFolderArchive = {
  rootName:string;
  directories:string[];
  files:Array<{sourcePath:string;archivePath:string;sizeBytes:number}>;
};

/**
 * Preflights an entire selected subtree before response headers are written.
 * Archive names are derived only from visible names; physical UUID filenames
 * never enter the ZIP namespace.
 */
export function prepareShareableFolderArchive(
  selectedFolderId:number,
  folders:ShareableFolder[],
  files:ShareableFile[],
):PreparedShareableFolderArchive {
  const folderById=new Map(folders.map(folder=>[folder.id,folder]));
  const selected=folderById.get(selectedFolderId);
  if(!selected)throw new Error('Selected folder was not found.');

  const children=new Map<number,ShareableFolder[]>();
  for(const folder of folders){
    if(folder.parentId===null)continue;
    const siblings=children.get(folder.parentId)??[];
    siblings.push(folder);children.set(folder.parentId,siblings);
  }
  for(const siblings of children.values())siblings.sort((left,right)=>left.name.localeCompare(right.name,undefined,{sensitivity:'base'})||left.id-right.id);

  const directoryById=new Map<number,string>();
  const directories:string[]=[];
  const active=new Set<number>();
  const visited=new Set<number>();
  function visit(folder:ShareableFolder,parentPath:string) {
    if(active.has(folder.id)||visited.has(folder.id))throw new Error('Folder hierarchy contains a cycle.');
    active.add(folder.id);visited.add(folder.id);
    const segment=safeShareableSegment(folder.name,'Folder');
    const archivePath=parentPath?`${parentPath}/${segment}`:segment;
    directoryById.set(folder.id,archivePath);directories.push(`${archivePath}/`);
    for(const child of children.get(folder.id)??[])visit(child,archivePath);
    active.delete(folder.id);
  }
  visit(selected,'');

  const used=new Set(directories.map(directory=>directory.toLocaleLowerCase()));
  const preparedFiles:Array<{sourcePath:string;archivePath:string;sizeBytes:number}>=[];
  for(const file of files){
    const directory=directoryById.get(file.folderId);
    if(!directory)continue;
    const sizeBytes=Number(file.sizeBytes);
    if(!Number.isSafeInteger(sizeBytes)||sizeBytes<0)throw new Error(`Stored file size is invalid: ${file.displayFilename}`);
    let stat:fs.Stats;
    try{stat=fs.statSync(file.sourcePath);}catch{throw new Error(`Stored file is missing: ${file.displayFilename}`);}
    if(!stat.isFile())throw new Error(`Stored file is not a regular file: ${file.displayFilename}`);
    if(stat.size!==sizeBytes)throw new Error(`Stored file size does not match: ${file.displayFilename}`);
    const candidate=`${directory}/${safeShareableSegment(file.displayFilename,'File')}`;
    const archivePath=uniqueShareablePath(candidate,used);
    preparedFiles.push({sourcePath:file.sourcePath,archivePath,sizeBytes});
  }
  return {rootName:safeShareableSegment(selected.name,'Folder'),directories,files:preparedFiles};
}

export function streamShareableFolderArchive(res:Response,fileName:string,prepared:PreparedShareableFolderArchive) {
  // STORE avoids re-buffering already-compressed media and still streams each
  // source through Archiver with a small, bounded high-water mark.
  const archive:Archiver=new ZipArchive({store:true});
  let complete=false;
  const abort=()=>{if(!complete)void archive.abort();};
  res.once('close',abort);
  archive.once('end',()=>{complete=true;res.off('close',abort);});
  archive.on('warning',(error:Error&{code?:string})=>{if(error.code!=='ENOENT')res.destroy(error);});
  archive.on('error',(error:Error)=>res.destroy(error));
  res.setHeader('Content-Type','application/zip');
  res.setHeader('Content-Disposition',`attachment; filename="${asciiFilename(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  archive.pipe(res);
  for(const directory of prepared.directories)archive.append('',{name:directory});
  for(const file of prepared.files)archive.file(file.sourcePath,{name:file.archivePath});
  void archive.finalize();
}

export function safeShareableSegment(value:unknown,fallback:string) {
  const clean=String(value??'').normalize('NFC').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g,'_').replace(/[. ]+$/g,'').trim();
  const safe=(clean==='.'||clean==='..'?'':clean)||fallback;
  return safe.slice(0,180).replace(/[. ]+$/g,'')||fallback;
}

function uniqueShareablePath(candidate:string,used:Set<string>) {
  const normalized=path.posix.normalize(candidate.replace(/\\/g,'/'));
  if(normalized.startsWith('/')||normalized==='..'||normalized.startsWith('../')||normalized.includes('/../'))throw new Error('Archive path is unsafe.');
  let next=normalized;let suffix=2;
  while(used.has(next.toLocaleLowerCase())){
    const extension=path.posix.extname(normalized);const base=normalized.slice(0,-extension.length);
    next=`${base} (${suffix})${extension}`;suffix+=1;
    if(suffix>10000)throw new Error('Archive entry name could not be made unique.');
  }
  used.add(next.toLocaleLowerCase());return next;
}

function asciiFilename(value:string){return value.replace(/[^\x20-\x7e]/g,'_').replace(/["\\]/g,'_');}
