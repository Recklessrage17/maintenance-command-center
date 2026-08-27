import {expect,test} from '@playwright/test';
import {folderImportFailureMessage,LibraryFolderImportError,runLibraryFolderImport,type LibraryImportFolder} from '../frontend/src/components/libraryFolderImport';

function localFile(relativePath:string,body='file bytes'){
  const name=relativePath.split('/').at(-1)!;const file=new File([body],name,{type:name.endsWith('.mp4')?'video/mp4':name.endsWith('.png')?'image/png':'text/plain'});Object.defineProperty(file,'webkitRelativePath',{value:relativePath});return file;
}

test('folder import preserves a new root and multiple levels while reusing same-run folder IDs for children and files',async()=>{
  const serverFolders:LibraryImportFolder[]=[];const creates:Array<{name:string;parentId:number|null;id:number}>=[];const uploads:Array<{path:string;folderId:number}>=[];let nextId=100;
  const files=[localFile('Vendor Set/Manuals/Guide.txt'),localFile('Vendor Set/Manuals/Electrical/Panel.txt')];
  const result=await runLibraryFolderImport({files,baseFolderId:null,validateFile:()=>'',listFolders:async()=>serverFolders.map(folder=>({...folder})),createFolder:async(name,parentId)=>{const folder={id:nextId++,parentId,name};serverFolders.push(folder);creates.push({...folder});return folder;},uploadFile:async(entry,folderId,onProgress)=>{onProgress(100);uploads.push({path:entry.relativePath,folderId});}});
  expect(creates).toEqual([{name:'Vendor Set',parentId:null,id:100},{name:'Manuals',parentId:100,id:101},{name:'Electrical',parentId:101,id:102}]);
  expect(uploads).toEqual([{path:'Vendor Set/Manuals/Guide.txt',folderId:101},{path:'Vendor Set/Manuals/Electrical/Panel.txt',folderId:102}]);
  expect(result).toMatchObject({completedFiles:2,totalFiles:2,createdFolders:['Vendor Set','Vendor Set/Manuals','Vendor Set/Manuals/Electrical'],reusedFolders:[]});
});

test('folder import reuses an existing destination hierarchy without recreating or overwriting it',async()=>{
  const serverFolders:LibraryImportFolder[]=[{id:40,parentId:null,name:'Vendor Set'},{id:41,parentId:40,name:'Manuals'}];const uploads:Array<{path:string;folderId:number}>=[];
  const result=await runLibraryFolderImport({files:[localFile('Vendor Set/Existing.txt'),localFile('Vendor Set/Manuals/New.txt')],baseFolderId:null,validateFile:()=>'',listFolders:async()=>serverFolders.map(folder=>({...folder})),createFolder:async()=>{throw new Error('Existing folders must not be recreated.');},uploadFile:async(entry,folderId)=>{uploads.push({path:entry.relativePath,folderId});}});
  expect(result.createdFolders).toEqual([]);expect(result.reusedFolders).toEqual(['Vendor Set','Vendor Set/Manuals']);expect(uploads).toEqual([{path:'Vendor Set/Existing.txt',folderId:40},{path:'Vendor Set/Manuals/New.txt',folderId:41}]);
});

test('folder import recovers a folder created despite a failed create response and reports later file failures by path',async()=>{
  const serverFolders:LibraryImportFolder[]=[];let nextId=70;let createCalls=0;let uploadCalls=0;
  let failure:unknown;
  try{await runLibraryFolderImport({files:[localFile('Recovered/One.txt'),localFile('Recovered/Nested/Two.txt')],baseFolderId:null,validateFile:()=>'',listFolders:async()=>serverFolders.map(folder=>({...folder})),createFolder:async(name,parentId)=>{createCalls+=1;const folder={id:nextId++,parentId,name};serverFolders.push(folder);if(name==='Recovered')throw Object.assign(new Error('A folder with this name already exists in this location.'),{code:'DUPLICATE_FOLDER'});return folder;},uploadFile:async entry=>{uploadCalls+=1;if(entry.relativePath.endsWith('Two.txt'))throw Object.assign(new Error('File validation failed.'),{code:'UPLOAD_INVALID'});}});}catch(error){failure=error;}
  expect(createCalls).toBe(2);expect(uploadCalls).toBe(2);expect(failure).toBeInstanceOf(LibraryFolderImportError);const detail=failure as LibraryFolderImportError;expect(detail.failedPath).toBe('Recovered/Nested/Two.txt');expect(detail.completedFiles).toBe(1);expect(detail.remainingFiles.map(file=>file.name)).toEqual(['Two.txt']);expect(detail.reusedFolders).toContain('Recovered');expect(folderImportFailureMessage(detail)).toContain('1 of 2 files uploaded before the failure.');expect(folderImportFailureMessage(detail)).toContain('Successful items were preserved and the library was refreshed.');
});
