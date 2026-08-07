import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PM_WORK_ORDER_DIRECTORY_NAME = 'PDF - Work orders';
export const PM_WORK_ORDER_MIME = 'application/pdf';
export const DEFAULT_PM_WORK_ORDER_MAX_BYTES = 12 * 1024 * 1024;

export type PmWorkOrderUpload = {
  originalname:string;
  mimetype:string;
  size:number;
  buffer:Buffer;
};

export type StagedPmWorkOrder = {
  stagedPath:string;
  originalFilename:string;
  mimeType:typeof PM_WORK_ORDER_MIME;
  sizeBytes:number;
  sha256:string;
};

export type StoredPmWorkOrder = StagedPmWorkOrder & {
  absolutePath:string;
  relativePath:string;
  storedFilename:string;
  assetFolder:string;
};

const windowsReservedName=/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const unsafeFilenameCharacter=/[<>:"/\\|?*\u0000-\u001f\u007f]/;

function normalizeVisibleText(value:unknown,maxLength:number) {
  return String(value??'').normalize('NFKC').replace(/\r/g,'').trim().slice(0,maxLength);
}

function dangerousPathName(value:string) {
  return !value||value==='.'||value==='..'||value.endsWith('.')||value.endsWith(' ')||windowsReservedName.test(value);
}

export function validatePmWorkOrderNumber(value:unknown) {
  const workOrderNumber=normalizeVisibleText(value,120);
  if(!workOrderNumber)throw new Error('Work Order Number is required. Enter N/A when no work order exists.');
  if(/^n\s*\/\s*a$/i.test(workOrderNumber))return {workOrderNumber:'N/A',notApplicable:true};
  if(/[\u0000-\u001f\u007f]/.test(workOrderNumber))throw new Error('Work Order Number contains unsupported control characters.');
  return {workOrderNumber,notApplicable:false};
}

export function validatePmFollowUp(requiredValue:unknown,reasonValue:unknown) {
  const normalized=String(requiredValue??'no').trim().toLowerCase();
  const followUpRequired=requiredValue===true||requiredValue===1||normalized==='true'||normalized==='1'||normalized==='yes';
  if(!followUpRequired&&!['','false','0','no'].includes(normalized))throw new Error('Follow-up Required must be Yes or No.');
  const followUpReason=normalizeVisibleText(reasonValue,2000);
  if(followUpRequired&&(followUpReason.length<5||!/[A-Za-z0-9]/.test(followUpReason)))throw new Error('Enter a meaningful Follow-up Reason when follow-up is required.');
  return {followUpRequired,followUpReason:followUpRequired?followUpReason:''};
}

export function validatePmPdfFilename(value:unknown) {
  const originalFilename=normalizeVisibleText(value,240);
  if(dangerousPathName(originalFilename))throw new Error('Work-order PDF filename is empty or reserved.');
  if(originalFilename!==path.basename(originalFilename)||originalFilename.includes('..')||unsafeFilenameCharacter.test(originalFilename))throw new Error('Work-order PDF filename contains an unsafe path or character.');
  if(path.extname(originalFilename).toLowerCase()!=='.pdf')throw new Error('Work-order attachment must use the .pdf extension.');
  return originalFilename;
}

function validatePdfContent(buffer:Buffer) {
  if(buffer.length<12||buffer.subarray(0,5).toString('ascii')!=='%PDF-')throw new Error('Work-order attachment does not contain a valid PDF signature.');
  const tail=buffer.subarray(Math.max(0,buffer.length-2048)).toString('latin1');
  if(!tail.includes('%%EOF'))throw new Error('Work-order attachment is incomplete or does not contain a valid PDF ending.');
}

function storageSegment(value:string,fallback:string,maxLength=100) {
  const normalized=value.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g,'-').replace(/\s+/g,' ').replace(/[. ]+$/g,'').trim().slice(0,maxLength);
  const safe=dangerousPathName(normalized)?fallback:normalized;
  return safe.replace(/[^A-Za-z0-9 _().-]/g,'-').replace(/-+/g,'-').replace(/\s+/g,' ').trim()||fallback;
}

function filenameSegment(value:string,fallback:string,maxLength=90) {
  return storageSegment(value,fallback,maxLength).replace(/\s+/g,'-');
}

export function pmWorkOrderAbsolutePath(rootPath:string,relativePath:string) {
  const portable=String(relativePath??'').replace(/\\/g,'/');
  if(!portable.startsWith(`${PM_WORK_ORDER_DIRECTORY_NAME}/`)||portable.includes('/../')||portable.endsWith('/..'))throw new Error('Stored work-order PDF reference is invalid.');
  const nested=portable.slice(PM_WORK_ORDER_DIRECTORY_NAME.length+1).split('/');
  if(nested.length!==2||nested.some(segment=>dangerousPathName(segment)||unsafeFilenameCharacter.test(segment)))throw new Error('Stored work-order PDF reference is invalid.');
  const root=path.resolve(rootPath);
  const resolved=path.resolve(root,...nested);
  if(!resolved.startsWith(`${root}${path.sep}`))throw new Error('Stored work-order PDF reference is invalid.');
  return resolved;
}

export function createPmWorkOrderStorage(rootPath:string,maxBytes=DEFAULT_PM_WORK_ORDER_MAX_BYTES) {
  const root=path.resolve(rootPath);
  const stagingRoot=path.join(root,'.staging');
  if(!Number.isInteger(maxBytes)||maxBytes<=0)throw new Error('PM work-order PDF size limit is invalid.');
  fs.mkdirSync(stagingRoot,{recursive:true});

  function stage(upload:PmWorkOrderUpload|undefined):StagedPmWorkOrder|null {
    if(!upload)return null;
    fs.mkdirSync(stagingRoot,{recursive:true});
    const originalFilename=validatePmPdfFilename(upload.originalname);
    if(upload.mimetype.toLowerCase()!==PM_WORK_ORDER_MIME)throw new Error('Work-order attachment browser MIME type must be application/pdf.');
    if(!Buffer.isBuffer(upload.buffer)||upload.size!==upload.buffer.length||upload.size<=0)throw new Error('Work-order PDF is empty or unreadable.');
    if(upload.size>maxBytes)throw new Error(`Work-order PDF must be ${Math.floor(maxBytes/1024/1024)} MB or smaller.`);
    validatePdfContent(upload.buffer);
    const stagedPath=path.join(stagingRoot,`.pm-work-order-${crypto.randomUUID()}.pdf`);
    fs.writeFileSync(stagedPath,upload.buffer,{flag:'wx',mode:0o600});
    return {stagedPath,originalFilename,mimeType:PM_WORK_ORDER_MIME,sizeBytes:upload.size,sha256:crypto.createHash('sha256').update(upload.buffer).digest('hex')};
  }

  function finalize(staged:StagedPmWorkOrder,assetDisplayName:string,assetId:number,workOrderNumber:string,beforeFinalize?:()=>void):StoredPmWorkOrder {
    if(!fs.existsSync(staged.stagedPath)||path.dirname(path.resolve(staged.stagedPath))!==stagingRoot)throw new Error('Staged work-order PDF is unavailable.');
    beforeFinalize?.();
    const assetFolder=storageSegment(assetDisplayName,`Asset-${assetId}`);
    const destinationDir=path.join(root,assetFolder);
    fs.mkdirSync(destinationDir,{recursive:true});
    const originalBase=path.basename(staged.originalFilename,path.extname(staged.originalFilename));
    const base=`${filenameSegment(workOrderNumber,'Work-Order')}_${filenameSegment(originalBase,'Work-Order')}`.slice(0,190);
    for(let collision=1;collision<=9999;collision+=1){
      const storedFilename=`${base}${collision===1?'':`_${collision}`}.pdf`;
      const absolutePath=path.join(destinationDir,storedFilename);
      try{
        fs.linkSync(staged.stagedPath,absolutePath);
        fs.rmSync(staged.stagedPath,{force:true});
        return {...staged,absolutePath,storedFilename,assetFolder,relativePath:[PM_WORK_ORDER_DIRECTORY_NAME,assetFolder,storedFilename].join('/')};
      }catch(error){
        if((error as NodeJS.ErrnoException).code==='EEXIST')continue;
        throw new Error(`Work-order PDF could not be finalized: ${error instanceof Error?error.message:String(error)}`);
      }
    }
    throw new Error('Work-order PDF filename collision limit was reached.');
  }

  function discard(staged:StagedPmWorkOrder|null|undefined) {
    if(staged&&path.dirname(path.resolve(staged.stagedPath))===stagingRoot&&fs.existsSync(staged.stagedPath))fs.rmSync(staged.stagedPath,{force:true});
  }

  return {root,stagingRoot,maxBytes,stage,finalize,discard,absolutePath:(relativePath:string)=>pmWorkOrderAbsolutePath(root,relativePath)};
}
