import path from 'node:path';

export const sharedDocumentMimeTypes=new Map<string,string>([
  ['.pdf','application/pdf'],
  ['.doc','application/msword'],
  ['.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.xls','application/vnd.ms-excel'],
  ['.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.txt','text/plain'],
]);

export function safeDocumentDisplayName(value:unknown,requiredExtension?:string) {
  const input=String(value??'').trim();
  if(!input||input!==path.basename(input)||/[\x00-\x1f\x7f<>:"/\\|?*]/.test(input))throw new Error('Document filename is invalid.');
  const suppliedExtension=path.extname(input).toLowerCase();
  const extension=requiredExtension??suppliedExtension;
  if(!sharedDocumentMimeTypes.has(extension))throw new Error('Documents must be PDF, Word, Excel, or TXT files.');
  if(requiredExtension&&suppliedExtension&&suppliedExtension!==requiredExtension)throw new Error('Renaming must preserve the original file extension.');
  const base=path.basename(input,suppliedExtension).trim();
  if(!base)throw new Error('Document filename is required.');
  return `${base.slice(0,Math.max(1,180-extension.length))}${extension}`;
}

export function validateDocumentFile(input:{originalName:string;mimeType?:string;sizeBytes:number;bytes:Buffer;maxBytes:number;maxMb:number}) {
  if(input.sizeBytes>input.maxBytes)throw new Error(`Each document must be ${input.maxMb} MB or smaller.`);
  const displayFilename=safeDocumentDisplayName(path.basename(input.originalName));
  const extension=path.extname(displayFilename).toLowerCase();
  const mimeType=sharedDocumentMimeTypes.get(extension)!;
  const bytes=input.bytes;
  const ole=bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]));
  const zip=bytes.length>=4&&bytes[0]===0x50&&bytes[1]===0x4b&&bytes[2]===0x03&&bytes[3]===0x04;
  let matches=false;
  if(extension==='.pdf')matches=bytes.subarray(0,5).toString('ascii')==='%PDF-';
  else if(extension==='.docx'||extension==='.xlsx')matches=zip;
  else if(extension==='.doc'||extension==='.xls')matches=ole;
  else if(extension==='.txt')matches=!bytes.includes(0);
  if(!matches)throw new Error(`${displayFilename} does not match its file type.`);
  const suppliedMime=String(input.mimeType??'').toLowerCase();
  if(suppliedMime&&suppliedMime!=='application/octet-stream'&&suppliedMime!==mimeType)throw new Error(`${displayFilename} has a mismatched content type.`);
  return {displayFilename,extension,mimeType};
}
