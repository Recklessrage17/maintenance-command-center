import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Writable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {prepareShareableFolderArchive,streamShareableFolderArchive} from '../backend/dist/server/libraryFolderExport.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=path.join(root,'tmp',`library-folder-export-${Date.now()}-${process.pid}`);

class FileResponse extends Writable{
  constructor(output){super();this.fd=fs.openSync(output,'w');this.headers=new Map();}
  setHeader(name,value){this.headers.set(String(name).toLowerCase(),String(value));return this;}
  _write(chunk,_encoding,callback){fs.write(this.fd,chunk,callback);}
  _final(callback){const descriptor=this.fd;this.fd=null;fs.close(descriptor,callback);}
  _destroy(error,callback){if(this.fd===null){callback(error);return;}const descriptor=this.fd;this.fd=null;fs.close(descriptor,closeError=>callback(error??closeError));}
}

try{
  fs.mkdirSync(fixture,{recursive:true});
  const first=path.join(fixture,'uuid-a.bin');const second=path.join(fixture,'uuid-b.bin');const large=path.join(fixture,'uuid-large.bin');
  fs.writeFileSync(first,Buffer.from([0,1,2,3,255]));fs.writeFileSync(second,Buffer.from('exact nested bytes'));
  const largeBytes=64*1024*1024;const handle=fs.openSync(large,'w');fs.ftruncateSync(handle,largeBytes);fs.closeSync(handle);
  const prepared=prepareShareableFolderArchive(1,[{id:1,parentId:null,name:'Vendor Share'},{id:2,parentId:1,name:'Nested'},{id:3,parentId:1,name:'Other'},{id:4,parentId:2,name:'Empty'}],[{folderId:2,displayFilename:'duplicate.bin',sourcePath:first,sizeBytes:5},{folderId:3,displayFilename:'duplicate.bin',sourcePath:second,sizeBytes:18},{folderId:2,displayFilename:'large-video.mp4',sourcePath:large,sizeBytes:largeBytes}]);
  assert.deepEqual(prepared.directories,['Vendor Share/','Vendor Share/Nested/','Vendor Share/Nested/Empty/','Vendor Share/Other/']);
  assert.ok(prepared.files.some(file=>file.archivePath==='Vendor Share/Nested/duplicate.bin'));
  assert.ok(prepared.files.some(file=>file.archivePath==='Vendor Share/Other/duplicate.bin'));
  assert.doesNotMatch(JSON.stringify({directories:prepared.directories,archivePaths:prepared.files.map(file=>file.archivePath)}),/uuid-[ab]|uuid-large/,'Internal physical names must not appear in archive paths.');
  assert.throws(()=>prepareShareableFolderArchive(1,[{id:1,parentId:null,name:'Root'}],[{folderId:1,displayFilename:'bad.bin',sourcePath:first,sizeBytes:6}]),/size does not match/i);
  const sanitized=prepareShareableFolderArchive(1,[{id:1,parentId:null,name:'..\\Unsafe/Root'}],[{folderId:1,displayFilename:'..\\file?.bin',sourcePath:first,sizeBytes:5}]);
  assert.ok(sanitized.directories.every(name=>!name.startsWith('../')&&!name.includes('/../')&&!name.includes('\\')));assert.ok(sanitized.files.every(file=>!file.archivePath.startsWith('../')&&!file.archivePath.includes('/../')&&!file.archivePath.includes('\\')));
  const collision=prepareShareableFolderArchive(1,[{id:1,parentId:null,name:'Root'},{id:5,parentId:1,name:'Foo'}],[{folderId:1,displayFilename:'Foo',sourcePath:first,sizeBytes:5}]);
  assert.deepEqual(collision.directories,['Root/','Root/Foo/']);assert.equal(collision.files[0].archivePath,'Root/Foo (2)');assert.ok(!collision.files[0].archivePath.includes('uuid-'),'Physical storage names must not leak while resolving file/folder collisions.');

  const output=path.join(fixture,'streamed.zip');const response=new FileResponse(output);const baseline=process.memoryUsage().rss;let peak=baseline;const monitor=setInterval(()=>{peak=Math.max(peak,process.memoryUsage().rss);},5);
  streamShareableFolderArchive(response,'Vendor Share.zip',prepared);
  await new Promise((resolve,reject)=>{response.once('finish',resolve);response.once('error',reject);});clearInterval(monitor);
  assert.match(response.headers.get('content-type'),/application\/zip/);assert.ok(fs.statSync(output).size>=largeBytes,'Stored ZIP must contain the large file without truncation.');assert.ok(peak-baseline<96*1024*1024,`Streaming memory growth must remain bounded; observed ${Math.round((peak-baseline)/1024/1024)} MB.`);
  const disappearing=path.join(fixture,'disappearing.bin');fs.writeFileSync(disappearing,Buffer.from('expected bytes'));const missingPrepared=prepareShareableFolderArchive(1,[{id:1,parentId:null,name:'Root'}],[{folderId:1,displayFilename:'Expected.bin',sourcePath:disappearing,sizeBytes:14}]);fs.rmSync(disappearing);const failedOutput=path.join(fixture,'failed.zip');const failedResponse=new FileResponse(failedOutput);let finished=false;failedResponse.once('finish',()=>{finished=true;});const failure=new Promise((resolve,reject)=>{failedResponse.once('finish',resolve);failedResponse.once('error',reject);});streamShareableFolderArchive(failedResponse,'Root.zip',missingPrepared);await assert.rejects(failure,/ENOENT|not found/i);assert.equal(finished,false,'A ZIP with a missing post-preflight source must not finish successfully.');
  console.log('Shareable folder ZIP helper tests passed for nesting, empty folders, duplicate and file/folder name collisions, safe paths, fatal post-preflight source loss, exact preflight sizes, and 64 MB bounded streaming.');
}finally{
  const resolved=path.resolve(fixture);const allowed=path.resolve(root,'tmp');if(resolved.startsWith(`${allowed}${path.sep}`)&&fs.existsSync(resolved))fs.rmSync(resolved,{recursive:true,force:true});
}
