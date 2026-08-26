import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath=path.resolve('backend/dist/server/libraryUpload.js');
const upload=await import(pathToFileURL(modulePath));
assert.deepEqual(upload.LIBRARY_LIMITS_MB,{documents:500,pictures:500,videos:1024});

for(const unsafe of ['../manual.pdf','C:/manual.pdf','/manual.pdf','Root//manual.pdf','Root/../manual.pdf','Root/./manual.pdf','Root/bad\u0000/manual.pdf','Root/bad\\manual.pdf']){
  assert.throws(()=>upload.safeUploadPath(unsafe),/invalid|unsafe/i,unsafe);
}
assert.deepEqual(upload.safeUploadPath('Toyo Manuals/Electrical/schematic.pdf'),['Toyo Manuals','Electrical','schematic.pdf']);

const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'mcc-issue111-upload-'));
try{
  const sparse=path.join(fixture,'large.txt');const descriptor=fs.openSync(sparse,'w');fs.writeSync(descriptor,Buffer.from('bounded text fixture'));fs.ftruncateSync(descriptor,64*1024*1024);fs.closeSync(descriptor);
  const originalReadFileSync=fs.readFileSync;fs.readFileSync=function(filename,...args){if(path.resolve(String(filename))===path.resolve(sparse))throw new Error('full-file buffering is forbidden');return originalReadFileSync.call(fs,filename,...args);};
  try{await assert.rejects(upload.validateStagedLibraryFile({path:sparse,originalName:'large.txt',mimeType:'text/plain',sizeBytes:fs.statSync(sparse).size}),/does not match its file type/i,'Chunked TXT scanning must find sparse-file NUL bytes without readFileSync.');}finally{fs.readFileSync=originalReadFileSync;}
  const oversized=path.join(fixture,'oversized.pdf');fs.writeFileSync(oversized,Buffer.from('%PDF-1.7'));fs.truncateSync(oversized,upload.LIBRARY_LIMITS_BYTES.documents+1);await assert.rejects(upload.validateStagedLibraryFile({path:oversized,originalName:'oversized.pdf',mimeType:'application/pdf',sizeBytes:fs.statSync(oversized).size}),/500 MB or smaller/i,'The document ceiling must be enforced before content scanning.');
  const video=path.join(fixture,'video.mp4');fs.writeFileSync(video,Buffer.concat([Buffer.from([0,0,0,20]),Buffer.from('ftypisom'),Buffer.from('payload')]));const validated=await upload.validateStagedLibraryFile({path:video,originalName:'training.mp4',mimeType:'video/mp4',sizeBytes:fs.statSync(video).size});assert.equal(validated.mediaType,'video');
  const incoming=path.join(fixture,'incoming.upload');const final=path.join(fixture,'stored','file.mp4');fs.copyFileSync(video,incoming);await upload.promoteStagedFile(incoming,final);assert.equal(fs.existsSync(incoming),false);assert.deepEqual(fs.readFileSync(final),fs.readFileSync(video));
}finally{fs.rmSync(fixture,{recursive:true,force:true});}
console.log('Issue #111 bounded upload validation tests passed.');
