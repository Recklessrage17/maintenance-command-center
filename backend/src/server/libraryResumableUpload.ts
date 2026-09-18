import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { libraryFileType, safeLibraryFilename } from './libraryUpload.js';

const DEFAULT_CHUNK_MB=8;
const DEFAULT_RESERVE_MB=256;
const DEFAULT_SESSION_HOURS=24;

export type LibraryUploadPolicy={
  documentsMb:number|null;
  picturesMb:number|null;
  videosMb:number|null;
  chunkBytes:number;
  storageReserveBytes:number;
  sessionTtlMs:number;
};

type SessionMetadata={
  schemaVersion:1;
  id:string;
  scope:string;
  ownerUserId:number;
  originalName:string;
  mimeType:string;
  sizeBytes:number;
  receivedBytes:number;
  context:Record<string,string|number|null>;
  fields:Record<string,string>;
  createdAt:string;
  updatedAt:string;
};

export class LibraryUploadError extends Error{
  status:number;
  code:string;
  constructor(message:string,status=400,code='UPLOAD_INVALID'){super(message);this.name='LibraryUploadError';this.status=status;this.code=code;}
}

export function libraryUploadPolicy(overrides:{documents?:string;pictures?:string;videos?:string}={}):LibraryUploadPolicy{
  return {
    documentsMb:optionalLimit(overrides.documents??process.env.MCC_LIBRARY_DOCUMENT_MAX_MB),
    picturesMb:optionalLimit(overrides.pictures??process.env.MCC_LIBRARY_PICTURE_MAX_MB),
    videosMb:optionalLimit(overrides.videos??process.env.MCC_LIBRARY_VIDEO_MAX_MB),
    chunkBytes:boundedPositive(process.env.MCC_LIBRARY_UPLOAD_CHUNK_MB,DEFAULT_CHUNK_MB,1,64)*1024*1024,
    storageReserveBytes:boundedPositive(process.env.MCC_LIBRARY_STORAGE_RESERVE_MB,DEFAULT_RESERVE_MB,0,1024*1024)*1024*1024,
    sessionTtlMs:boundedPositive(process.env.MCC_LIBRARY_UPLOAD_SESSION_HOURS,DEFAULT_SESSION_HOURS,1,168)*60*60*1000,
  };
}

export function publicLibraryUploadLimits(policy:LibraryUploadPolicy){
  return {
    documentsMb:policy.documentsMb,
    picturesMb:policy.picturesMb,
    videosMb:policy.videosMb,
    resumable:true,
    chunkBytes:policy.chunkBytes,
    storageReserveBytes:policy.storageReserveBytes,
  };
}

export function configuredLibraryLimit(policy:LibraryUploadPolicy,filename:string){
  const mediaType=libraryFileType(path.extname(filename).toLowerCase()).mediaType;
  const maxMb=mediaType==='video'?policy.videosMb:mediaType==='picture'?policy.picturesMb:policy.documentsMb;
  return {mediaType,maxMb,maxBytes:maxMb===null?null:maxMb*1024*1024};
}

export function receiveLibraryChunk(policy:LibraryUploadPolicy):RequestHandler{
  const parser=express.raw({type:['application/octet-stream','application/offset+octet-stream'],limit:policy.chunkBytes});
  return (req:Request,res:Response,next:NextFunction)=>parser(req,res,error=>{
    if(!error){next();return;}
    const tooLarge=Boolean(error&&typeof error==='object'&&'type' in error&&(error as {type?:string}).type==='entity.too.large');
    res.status(tooLarge?413:400).json({ok:false,code:tooLarge?'CHUNK_TOO_LARGE':'UPLOAD_INVALID',error:tooLarge?`Upload chunks must be ${formatBytes(policy.chunkBytes)} or smaller.`:'Upload chunk could not be read.'});
  });
}

export class ResumableLibraryUploadStore{
  readonly directory:string;
  readonly scope:string;
  readonly policy:LibraryUploadPolicy;

  constructor(input:{directory:string;scope:string;policy:LibraryUploadPolicy}){
    this.directory=path.resolve(input.directory);this.scope=input.scope;this.policy=input.policy;
    fs.mkdirSync(this.directory,{recursive:true});this.cleanupExpired();
  }

  create(input:{ownerUserId:number;originalName:unknown;mimeType?:unknown;sizeBytes:unknown;context:Record<string,string|number|null>;fields?:Record<string,unknown>}){
    this.cleanupExpired();
    const ownerUserId=Number(input.ownerUserId);if(!Number.isInteger(ownerUserId)||ownerUserId<=0)throw new LibraryUploadError('Upload owner is invalid.',403,'UPLOAD_FORBIDDEN');
    const originalName=safeLibraryFilename(input.originalName);const sizeBytes=Number(input.sizeBytes);
    if(!Number.isSafeInteger(sizeBytes)||sizeBytes<=0)throw new LibraryUploadError('Upload size must be a positive safe integer.');
    const limit=configuredLibraryLimit(this.policy,originalName);
    if(limit.maxBytes!==null&&sizeBytes>limit.maxBytes)throw new LibraryUploadError(`${originalName} exceeds the configured ${limit.maxMb} MB server limit.`,413,'FILE_TOO_LARGE');
    this.assertCapacity(sizeBytes);
    const id=crypto.randomUUID();const timestamp=new Date().toISOString();
    const metadata:SessionMetadata={schemaVersion:1,id,scope:this.scope,ownerUserId,originalName,mimeType:String(input.mimeType??'application/octet-stream').slice(0,200),sizeBytes,receivedBytes:0,context:normalizedContext(input.context),fields:normalizedFields(input.fields),createdAt:timestamp,updatedAt:timestamp};
    const part=this.partPath(id);const handle=fs.openSync(part,'wx');fs.closeSync(handle);try{this.writeMetadata(metadata);}catch(error){fs.rmSync(part,{force:true});throw error;}
    return this.publicStatus(metadata);
  }

  status(id:unknown,ownerUserId:number,context?:Record<string,string|number|null>){return this.publicStatus(this.loadOwned(id,ownerUserId,context));}

  append(id:unknown,ownerUserId:number,context:Record<string,string|number|null>,offset:unknown,bytes:Buffer){
    const metadata=this.loadOwned(id,ownerUserId,context);const suppliedOffset=Number(offset);
    if(!Number.isSafeInteger(suppliedOffset)||suppliedOffset<0)throw new LibraryUploadError('Upload offset is invalid.',400,'UPLOAD_OFFSET_INVALID');
    if(suppliedOffset!==metadata.receivedBytes)throw new LibraryUploadError(`Upload offset does not match the stored offset (${metadata.receivedBytes}).`,409,'UPLOAD_OFFSET_MISMATCH');
    if(!Buffer.isBuffer(bytes)||!bytes.length)throw new LibraryUploadError('Upload chunk is empty.');
    if(bytes.length>this.policy.chunkBytes)throw new LibraryUploadError(`Upload chunks must be ${formatBytes(this.policy.chunkBytes)} or smaller.`,413,'CHUNK_TOO_LARGE');
    if(metadata.receivedBytes+bytes.length>metadata.sizeBytes)throw new LibraryUploadError('Upload chunk exceeds the declared file size.',400,'UPLOAD_SIZE_MISMATCH');
    this.assertCapacity(bytes.length,metadata.id);
    const part=this.partPath(metadata.id);const handle=fs.openSync(part,'r+');
    try{let written=0;while(written<bytes.length)written+=fs.writeSync(handle,bytes,written,bytes.length-written,suppliedOffset+written);fs.fsyncSync(handle);}finally{fs.closeSync(handle);}
    metadata.receivedBytes+=bytes.length;metadata.updatedAt=new Date().toISOString();this.writeMetadata(metadata);
    return this.publicStatus(metadata);
  }

  stagedFile(id:unknown,ownerUserId:number,context:Record<string,string|number|null>){
    const metadata=this.loadOwned(id,ownerUserId,context);const part=this.partPath(metadata.id);let stat:fs.Stats;
    try{stat=fs.statSync(part);}catch{throw new LibraryUploadError('The resumable upload payload is missing.',410,'UPLOAD_EXPIRED');}
    if(metadata.receivedBytes!==metadata.sizeBytes||stat.size!==metadata.sizeBytes)throw new LibraryUploadError(`Upload is incomplete at ${metadata.receivedBytes} of ${metadata.sizeBytes} bytes.`,409,'UPLOAD_INCOMPLETE');
    const file:Express.Multer.File={fieldname:'files',originalname:metadata.originalName,encoding:'7bit',mimetype:metadata.mimeType,size:metadata.sizeBytes,destination:this.directory,filename:path.basename(part),path:part,buffer:Buffer.alloc(0),stream:Readable.from([])};
    return {metadata,file};
  }

  complete(id:unknown){const sessionId=this.safeId(id);try{fs.rmSync(this.metadataPath(sessionId),{force:true});}catch{}}

  cancel(id:unknown,ownerUserId?:number){
    const sessionId=this.safeId(id);if(ownerUserId!==undefined){const metadata=this.readMetadata(sessionId);if(metadata&&metadata.ownerUserId!==ownerUserId)throw new LibraryUploadError('Upload session is not available.',404,'UPLOAD_NOT_FOUND');}
    fs.rmSync(this.partPath(sessionId),{force:true});fs.rmSync(this.metadataPath(sessionId),{force:true});
  }

  cleanupExpired(){
    fs.mkdirSync(this.directory,{recursive:true});const cutoff=Date.now()-this.policy.sessionTtlMs;const referenced=new Set<string>();
    for(const entry of fs.readdirSync(this.directory,{withFileTypes:true})){
      if(!entry.isFile()||!entry.name.endsWith('.json'))continue;const id=entry.name.slice(0,-5);const metadata=this.readMetadata(id);
      if(!metadata||Date.parse(metadata.updatedAt)<cutoff){try{this.cancel(id);}catch{}continue;}referenced.add(`${id}.part`);
    }
    for(const entry of fs.readdirSync(this.directory,{withFileTypes:true}))if(entry.isFile()&&entry.name.endsWith('.part')&&!referenced.has(entry.name)){const target=path.join(this.directory,entry.name);try{if(fs.statSync(target).mtimeMs<cutoff)fs.rmSync(target,{force:true});}catch{}}
  }

  private loadOwned(id:unknown,ownerUserId:number,context?:Record<string,string|number|null>){
    const sessionId=this.safeId(id);const metadata=this.readMetadata(sessionId);
    if(!metadata||metadata.scope!==this.scope||metadata.ownerUserId!==Number(ownerUserId))throw new LibraryUploadError('Upload session was not found or has expired.',404,'UPLOAD_NOT_FOUND');
    if(Date.parse(metadata.updatedAt)<Date.now()-this.policy.sessionTtlMs){this.cancel(sessionId);throw new LibraryUploadError('Upload session has expired.',410,'UPLOAD_EXPIRED');}
    if(context&&JSON.stringify(metadata.context)!==JSON.stringify(normalizedContext(context)))throw new LibraryUploadError('Upload session does not match this library destination.',409,'UPLOAD_DESTINATION_MISMATCH');
    return metadata;
  }

  private publicStatus(metadata:SessionMetadata){return{id:metadata.id,filename:metadata.originalName,sizeBytes:metadata.sizeBytes,receivedBytes:metadata.receivedBytes,complete:metadata.receivedBytes===metadata.sizeBytes,chunkBytes:this.policy.chunkBytes,expiresAt:new Date(Date.parse(metadata.updatedAt)+this.policy.sessionTtlMs).toISOString()};}
  private safeId(value:unknown){const id=String(value??'');if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))throw new LibraryUploadError('Upload session identifier is invalid.',404,'UPLOAD_NOT_FOUND');return id;}
  private partPath(id:string){return path.join(this.directory,`${id}.part`);}
  private metadataPath(id:string){return path.join(this.directory,`${id}.json`);}
  private readMetadata(id:string){try{const value=JSON.parse(fs.readFileSync(this.metadataPath(id),'utf8')) as SessionMetadata;return value?.schemaVersion===1?value:null;}catch{return null;}}
  private writeMetadata(metadata:SessionMetadata){const target=this.metadataPath(metadata.id);const temporary=`${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;try{fs.writeFileSync(temporary,`${JSON.stringify(metadata)}\n`,{encoding:'utf8',flag:'wx'});fs.renameSync(temporary,target);}catch(error){fs.rmSync(temporary,{force:true});throw error;}}
  private assertCapacity(requiredBytes:number,excludeId?:string){
    let reserved=0;for(const entry of fs.readdirSync(this.directory,{withFileTypes:true})){if(!entry.isFile()||!entry.name.endsWith('.json')||entry.name===`${excludeId}.json`)continue;const metadata=this.readMetadata(entry.name.slice(0,-5));if(metadata)reserved+=Math.max(0,metadata.sizeBytes-metadata.receivedBytes);}
    let available=Number.POSITIVE_INFINITY;try{const stats=fs.statfsSync(this.directory);available=Number(stats.bavail)*Number(stats.bsize);}catch{}
    if(available<requiredBytes+reserved+this.policy.storageReserveBytes)throw new LibraryUploadError(`Insufficient server storage for this upload (${formatBytes(Math.max(0,available))} available; ${formatBytes(this.policy.storageReserveBytes)} reserved).`,507,'INSUFFICIENT_STORAGE');
  }
}

export function sendLibraryUploadError(res:Response,error:unknown,fallback='Upload request failed.'){
  const value=error instanceof LibraryUploadError?error:new LibraryUploadError(error instanceof Error&&error.message?error.message:fallback);
  res.status(value.status).json({ok:false,code:value.code,error:value.message});
}

function optionalLimit(value:string|undefined){if(value===undefined||value.trim()===''||value.trim()==='0')return null;const parsed=Number(value);if(!Number.isFinite(parsed)||parsed<=0||parsed>8*1024*1024)throw new Error('Library upload limits must be positive megabyte values or 0 for storage-limited uploads.');return Math.round(parsed);}
function boundedPositive(value:string|undefined,fallback:number,min:number,max:number){if(value===undefined||value.trim()==='')return fallback;const parsed=Number(value);return Number.isFinite(parsed)&&parsed>=min&&parsed<=max?Math.round(parsed):fallback;}
function normalizedContext(value:Record<string,string|number|null>){return Object.fromEntries(Object.entries(value).sort(([left],[right])=>left.localeCompare(right)).map(([key,item])=>[key,typeof item==='number'?Number(item):item===null?null:String(item)]));}
function normalizedFields(value:Record<string,unknown>|undefined){const output:Record<string,string>={};for(const [key,item] of Object.entries(value??{}))output[key.slice(0,80)]=String(item??'').slice(0,4000);return output;}
function formatBytes(value:number){if(value<1024)return `${Math.round(value)} B`;if(value<1024**2)return `${(value/1024).toFixed(1)} KB`;if(value<1024**3)return `${(value/1024**2).toFixed(1)} MB`;return `${(value/1024**3).toFixed(1)} GB`;}
