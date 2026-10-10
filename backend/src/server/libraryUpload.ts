import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';

export const LIBRARY_LIMITS_MB={documents:500,pictures:500,videos:1024} as const;
export const LIBRARY_LIMITS_BYTES={
  documents:LIBRARY_LIMITS_MB.documents*1024*1024,
  pictures:LIBRARY_LIMITS_MB.pictures*1024*1024,
  videos:LIBRARY_LIMITS_MB.videos*1024*1024,
} as const;

export type LibraryMediaType='document'|'picture'|'video'|'file';
export type ValidatedLibraryFile={displayFilename:string;extension:string;mimeType:string;mediaType:LibraryMediaType};

const MAX_CONCURRENT_LIBRARY_UPLOADS=2;
export const MAX_WAITING_LIBRARY_UPLOADS=16;
let activeLibraryUploads=0;
const libraryUploadWaiters:Array<{grant:()=>void}>=[];

export class LibraryUploadQueueFullError extends Error {
  constructor(){super('Upload queue is full. Try again shortly.');this.name='LibraryUploadQueueFullError';}
}

export function acquireLibraryUploadSlot(signal?:AbortSignal):Promise<()=>void>{
  return new Promise((resolve,reject)=>{
    let release:(()=>void)|undefined;
    let waiting=false;
    const cancelled=()=>{
      if(release){release();return;}
      if(waiting){const index=libraryUploadWaiters.indexOf(waiter);if(index!==-1)libraryUploadWaiters.splice(index,1);waiting=false;}
      signal?.removeEventListener('abort',cancelled);
      reject(new DOMException('Upload connection closed.','AbortError'));
    };
    const waiter={grant:()=>{
      waiting=false;
      activeLibraryUploads+=1;
      let released=false;
      release=()=>{
        if(released)return;
        released=true;
        signal?.removeEventListener('abort',cancelled);
        activeLibraryUploads-=1;
        libraryUploadWaiters.shift()?.grant();
      };
      resolve(release);
    }};
    if(signal?.aborted){cancelled();return;}
    signal?.addEventListener('abort',cancelled,{once:true});
    if(activeLibraryUploads<MAX_CONCURRENT_LIBRARY_UPLOADS){waiter.grant();return;}
    if(libraryUploadWaiters.length>=MAX_WAITING_LIBRARY_UPLOADS){
      signal?.removeEventListener('abort',cancelled);
      reject(new LibraryUploadQueueFullError());return;
    }
    waiting=true;
    libraryUploadWaiters.push(waiter);
  });
}

// Request "close" also occurs after an ordinary completed body. Only an
// incomplete/aborted request, or a closed response, cancels upload ownership.
export async function acquireRequestLibraryUploadSlot(req:Request,res:Response){
  const controller=new AbortController();
  let release:(()=>void)|undefined;
  const dispose=()=>{
    req.off('aborted',stop);req.off('close',requestClosed);
    res.off('finish',stop);res.off('close',stop);
  };
  const stop=()=>{controller.abort();release?.();dispose();};
  const requestClosed=()=>{if(req.aborted||!req.complete)stop();};
  req.once('aborted',stop);req.once('close',requestClosed);
  res.once('finish',stop);res.once('close',stop);
  if(req.aborted||res.destroyed||res.writableFinished){stop();return undefined;}
  try{
    release=await acquireLibraryUploadSlot(controller.signal);
    if(controller.signal.aborted){release();dispose();return undefined;}
    return release;
  }catch(error){
    dispose();
    if(controller.signal.aborted)return undefined;
    if(error instanceof LibraryUploadQueueFullError){
      res.setHeader('Retry-After','1');
      res.status(503).json({ok:false,error:error.message,code:'UPLOAD_QUEUE_FULL'});
      return undefined;
    }
    throw error;
  }
}

export function cleanupStagingDirectory(directory:string){
  fs.mkdirSync(directory,{recursive:true});
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    const target=path.join(directory,entry.name);
    try{fs.rmSync(target,{recursive:entry.isDirectory(),force:true});}catch{}
  }
}

export const libraryMimeTypes=new Map<string,{mimeType:string;mediaType:LibraryMediaType}>([
  ['.pdf',{mimeType:'application/pdf',mediaType:'document'}],
  ['.doc',{mimeType:'application/msword',mediaType:'document'}],
  ['.docx',{mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',mediaType:'document'}],
  ['.xls',{mimeType:'application/vnd.ms-excel',mediaType:'document'}],
  ['.xlsx',{mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',mediaType:'document'}],
  ['.txt',{mimeType:'text/plain',mediaType:'document'}],
  ['.jpg',{mimeType:'image/jpeg',mediaType:'picture'}],
  ['.jpeg',{mimeType:'image/jpeg',mediaType:'picture'}],
  ['.png',{mimeType:'image/png',mediaType:'picture'}],
  ['.webp',{mimeType:'image/webp',mediaType:'picture'}],
  ['.mp4',{mimeType:'video/mp4',mediaType:'video'}],
  ['.webm',{mimeType:'video/webm',mediaType:'video'}],
  ['.mov',{mimeType:'video/quicktime',mediaType:'video'}],
]);

const genericLibraryFileType={mimeType:'application/octet-stream',mediaType:'file'} as const;

export function libraryFileType(extension:unknown){
  return libraryMimeTypes.get(String(extension??'').toLowerCase())??genericLibraryFileType;
}

export function safeLibraryFilename(value:unknown,requiredExtension?:string){
  const input=String(value??'').trim();
  if(!input||input!==path.basename(input)||/[\x00-\x1f\x7f<>:"/\\|?*]/.test(input))throw new Error('File name is invalid.');
  if(/[. ]$/.test(input))throw new Error('File name cannot end with a period or space.');

  const suppliedExtension=path.extname(input);
  const normalizedExtension=suppliedExtension.toLowerCase();
  const normalizedRequiredExtension=requiredExtension===undefined?undefined:String(requiredExtension).toLowerCase();

  if(suppliedExtension.length>=180)throw new Error('File extension is too long.');
    if(normalizedRequiredExtension!==undefined){
    if(normalizedRequiredExtension){
      if(normalizedExtension&&normalizedExtension!==normalizedRequiredExtension)throw new Error('Renaming must preserve the original file extension.');
    }else if(normalizedExtension){
      throw new Error('Renaming must preserve the original file extension.');
    }
  }

  const outputExtension=suppliedExtension||requiredExtension||'';
  const base=path.basename(input,suppliedExtension).trim();

  if(!base)throw new Error('File name is required.');

  return `${base.slice(0,Math.max(1,180-outputExtension.length))}${outputExtension}`;
}
export function safeUploadPath(value:unknown){
  const raw=String(value??'');
  if(!raw||raw.includes('\\')||raw.startsWith('/')||raw.startsWith('//')||/^[A-Za-z]:/.test(raw)||/[\x00-\x1f\x7f]/.test(raw))throw new Error('Folder upload path is invalid.');
  const segments=raw.split('/');
  if(segments.some(segment=>!segment||segment==='.'||segment==='..'||segment.trim()!==segment||segment.length>120||/[<>:"|?*]/.test(segment)||/[. ]$/.test(segment)))throw new Error('Folder upload path contains an unsafe segment.');
  if(segments.length<2||segments.length>32)throw new Error('Folder upload path must include a root folder and may be at most 32 levels deep.');
  safeLibraryFilename(segments.at(-1));
  return segments;
}

export async function validateStagedLibraryFile(input:{path:string;originalName:string;mimeType?:string;sizeBytes:number;maxBytes?:number|null;maxMb?:number|null}):Promise<ValidatedLibraryFile>{
  const displayFilename=safeLibraryFilename(path.basename(input.originalName));
  const extension=path.extname(displayFilename).toLowerCase();
  const type=libraryFileType(extension);

  const legacyMaxBytes=type.mediaType==='video'
    ?LIBRARY_LIMITS_BYTES.videos
    :type.mediaType==='picture'
      ?LIBRARY_LIMITS_BYTES.pictures
      :LIBRARY_LIMITS_BYTES.documents;
  const legacyMaxMb=type.mediaType==='video'
    ?LIBRARY_LIMITS_MB.videos
    :type.mediaType==='picture'
      ?LIBRARY_LIMITS_MB.pictures
      :LIBRARY_LIMITS_MB.documents;
  const maxBytes=input.maxBytes===undefined?legacyMaxBytes:input.maxBytes;
  const maxMb=input.maxMb===undefined?legacyMaxMb:input.maxMb;

  if(!Number.isFinite(input.sizeBytes)||input.sizeBytes<=0)throw new Error(`${displayFilename} is empty or has an invalid size.`);
  if(maxBytes!==null&&input.sizeBytes>maxBytes)throw new Error(`${displayFilename} must be ${maxMb} MB or smaller.`);

  const stat=await fs.promises.lstat(input.path);
  if(!stat.isFile()||stat.size!==input.sizeBytes)throw new Error(`${displayFilename} staged upload is invalid.`);

  const knownType=libraryMimeTypes.get(extension);

  if(!knownType){
    return {
      displayFilename,
      extension,
      mimeType:'application/octet-stream',
      mediaType:'file',
    };
  }

  const supplied=String(input.mimeType??'').toLowerCase();
  const suppliedMatches=
    supplied===type.mimeType||
    (extension==='.mov'&&['video/mov','video/x-quicktime'].includes(supplied));

  if(supplied&&supplied!=='application/octet-stream'&&!suppliedMatches)throw new Error(`${displayFilename} has a mismatched content type.`);

  const handle=await fs.promises.open(input.path,'r');

  try{
    const header=Buffer.alloc(64);
    const {bytesRead}=await handle.read(header,0,header.length,0);
    const bytes=header.subarray(0,bytesRead);

    const ole=bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]));
    const zip=bytes.length>=4&&bytes.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04]));

    let matches=false;

    if(extension==='.pdf')matches=bytes.subarray(0,5).toString('ascii')==='%PDF-';
    else if(extension==='.docx'||extension==='.xlsx')matches=zip;
    else if(extension==='.doc'||extension==='.xls')matches=ole;
    else if(extension==='.jpg'||extension==='.jpeg')matches=bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
    else if(extension==='.png')matches=bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
    else if(extension==='.webp')matches=bytes.length>=12&&bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP';
    else if(extension==='.mp4'||extension==='.mov')matches=bytes.length>=12&&bytes.subarray(4,8).toString('ascii')==='ftyp';
    else if(extension==='.webm')matches=bytes.length>=4&&bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
    else if(extension==='.txt'){
      matches=true;
      const chunk=Buffer.alloc(64*1024);
      let position=0;

      while(position<input.sizeBytes){
        const read=await handle.read(
          chunk,
          0,
          Math.min(chunk.length,input.sizeBytes-position),
          position
        );

        if(!read.bytesRead)break;

        if(chunk.subarray(0,read.bytesRead).includes(0)){
          matches=false;
          break;
        }

        position+=read.bytesRead;
      }
    }

    if(!matches)throw new Error(`${displayFilename} does not match its file type.`);

    return {
      displayFilename,
      extension,
      mimeType:type.mimeType,
      mediaType:type.mediaType,
    };
  }finally{
    await handle.close();
  }
}
export async function promoteStagedFile(stagedPath:string,finalPath:string){
  await fs.promises.mkdir(path.dirname(finalPath),{recursive:true});
  try{await fs.promises.rename(stagedPath,finalPath);}
  catch(error){if((error as NodeJS.ErrnoException).code!=='EXDEV')throw error;await pipeline(fs.createReadStream(stagedPath),fs.createWriteStream(finalPath,{flags:'wx'}));await fs.promises.unlink(stagedPath);}
}

export function cleanupStagedFiles(files:Express.Multer.File[]|undefined){
  for(const file of files??[]){if(file.path){try{fs.rmSync(file.path,{force:true});}catch{}}}
}
