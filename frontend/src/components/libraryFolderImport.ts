export type LibraryImportFolder={id:number;parentId:number|null;name:string};
export type LibraryImportEntry={file:File;relativePath:string;directoryPath:string};
export type LibraryFolderImportResult={completedFiles:number;totalFiles:number;createdFolders:string[];reusedFolders:string[];resolvedFolderIds:number[]};

type ImportErrorShape=Error&{code?:string};

export class LibraryFolderImportError extends Error{
  code:string;
  failedPath:string;
  completedFiles:number;
  totalFiles:number;
  createdFolders:string[];
  reusedFolders:string[];
  resolvedFolderIds:number[];
  remainingFiles:File[];
  constructor(message:string,input:{code?:string;failedPath:string;completedFiles:number;totalFiles:number;createdFolders:string[];reusedFolders:string[];resolvedFolderIds:number[];remainingFiles:File[]}){
    super(message);this.name='LibraryFolderImportError';this.code=input.code??'';this.failedPath=input.failedPath;this.completedFiles=input.completedFiles;this.totalFiles=input.totalFiles;this.createdFolders=[...input.createdFolders];this.reusedFolders=[...input.reusedFolders];this.resolvedFolderIds=[...input.resolvedFolderIds];this.remainingFiles=[...input.remainingFiles];
  }
}

export async function runLibraryFolderImport(input:{
  files:File[];
  baseFolderId:number|null;
  validateFile:(file:File)=>string;
  listFolders:()=>Promise<LibraryImportFolder[]>;
  createFolder:(name:string,parentId:number|null)=>Promise<LibraryImportFolder>;
  uploadFile:(entry:LibraryImportEntry,folderId:number,onProgress:(percent:number)=>void)=>Promise<void>;
  onCurrent?:(stage:'folder'|'file',path:string)=>void;
  onProgress?:(percent:number)=>void;
  onFileComplete?:(completed:number,total:number)=>void;
}):Promise<LibraryFolderImportResult>{
  const entries=prepareEntries(input.files,input.validateFile);
  const totalFiles=entries.length;
  const totalBytes=entries.reduce((sum,entry)=>sum+entry.file.size,0)||1;
  const directoryByKey=new Map<string,string>();
  for(const entry of entries){const segments=entry.directoryPath.split('/');for(let depth=1;depth<=segments.length;depth+=1){const directoryPath=segments.slice(0,depth).join('/');const key=folderPathKey(directoryPath);if(!directoryByKey.has(key))directoryByKey.set(key,directoryPath);}}
  const directoryPaths=[...directoryByKey.values()].sort((left,right)=>left.split('/').length-right.split('/').length||left.localeCompare(right,undefined,{sensitivity:'base'}));
  let folders:LibraryImportFolder[];
  try{folders=await input.listFolders();}catch(error){throw failure(error,'destination library',0,entries,[],[],[]);}
  if(input.baseFolderId!==null&&!folders.some(folder=>folder.id===input.baseFolderId))throw failure(new Error('The destination folder is no longer available.'),'destination library',0,entries,[],[],[]);

  const ids=new Map<string,number>();
  const createdFolders:string[]=[];const reusedFolders:string[]=[];const resolvedFolderIds:number[]=[];
  for(const directoryPath of directoryPaths){
    const segments=directoryPath.split('/');const name=segments.at(-1)!;const parentPath=segments.slice(0,-1).join('/');const parentId=parentPath?ids.get(folderPathKey(parentPath)):input.baseFolderId;
    if(parentPath&&parentId===undefined)throw failure(new Error('The parent folder could not be resolved.'),directoryPath,0,entries,createdFolders,reusedFolders,resolvedFolderIds);
    input.onCurrent?.('folder',directoryPath);
    let folder=findFolder(folders,parentId??null,name);
    if(folder){reusedFolders.push(directoryPath);}else{
      try{folder=await input.createFolder(name,parentId??null);createdFolders.push(directoryPath);folders.push(folder);}catch(error){
        try{folders=await input.listFolders();folder=findFolder(folders,parentId??null,name);}catch{/* preserve the original create error */}
        if(!folder)throw failure(error,directoryPath,0,entries,createdFolders,reusedFolders,resolvedFolderIds);
        reusedFolders.push(directoryPath);
      }
    }
    ids.set(folderPathKey(directoryPath),folder.id);if(!resolvedFolderIds.includes(folder.id))resolvedFolderIds.push(folder.id);
  }

  let completedFiles=0;let completedBytes=0;
  for(const entry of entries){
    const folderId=ids.get(folderPathKey(entry.directoryPath));
    if(folderId===undefined)throw failure(new Error('The upload destination could not be resolved.'),entry.relativePath,completedFiles,entries,createdFolders,reusedFolders,resolvedFolderIds);
    input.onCurrent?.('file',entry.relativePath);
    try{await input.uploadFile(entry,folderId,percent=>input.onProgress?.((completedBytes+entry.file.size*Math.max(0,Math.min(100,percent))/100)/totalBytes*100));}
    catch(error){throw failure(error,entry.relativePath,completedFiles,entries,createdFolders,reusedFolders,resolvedFolderIds);}
    completedFiles+=1;completedBytes+=entry.file.size;input.onFileComplete?.(completedFiles,totalFiles);input.onProgress?.(completedBytes/totalBytes*100);
  }
  return{completedFiles,totalFiles,createdFolders,reusedFolders,resolvedFolderIds};
}

export function folderImportFailureMessage(error:unknown){
  if(!(error instanceof LibraryFolderImportError))return `Folder import failed: ${(error as Error)?.message||'Unknown error.'}`;
  const fileProgress=error.completedFiles?`${error.completedFiles} of ${error.totalFiles} files uploaded before the failure.`:'No files were uploaded.';
  const folderProgress=`${error.createdFolders.length} folder${error.createdFolders.length===1?' was':'s were'} created and ${error.reusedFolders.length} existing folder${error.reusedFolders.length===1?' was':'s were'} reused.`;
  return `Folder import stopped at “${error.failedPath}”: ${error.message} ${fileProgress} ${folderProgress} Successful items were preserved and the library was refreshed.`;
}

function prepareEntries(files:File[],validateFile:(file:File)=>string){
  if(!files.length)throw failure(new Error('Select a folder containing at least one supported file.'),'selected folder',0,[],[],[],[]);
  const entries:LibraryImportEntry[]=[];const roots=new Set<string>();
  for(const file of files){
    const relativePath=String((file as File&{webkitRelativePath?:string}).webkitRelativePath??'').normalize('NFC');const segments=relativePath.split('/');
    if(!relativePath||relativePath.includes('\\')||relativePath.startsWith('/')||/^[A-Za-z]:/.test(relativePath)||segments.length<2||segments.some(segment=>!segment||segment==='.'||segment==='..'||/[\x00-\x1f\x7f]/.test(segment)))throw failure(new Error('The selected folder contains an unsafe relative path.'),relativePath||file.name,0,files.map(item=>({file:item,relativePath:'',directoryPath:''})),[],[],[]);
    const issue=validateFile(file);if(issue)throw failure(new Error(issue),relativePath,0,files.map(item=>({file:item,relativePath:'',directoryPath:''})),[],[],[]);
    roots.add(normalizedName(segments[0]));entries.push({file,relativePath,directoryPath:segments.slice(0,-1).join('/')});
  }
  if(roots.size!==1)throw failure(new Error('Select one local root folder at a time.'),'selected folder',0,entries,[],[],[]);
  return entries;
}

function findFolder(folders:LibraryImportFolder[],parentId:number|null,name:string){const key=normalizedName(name);return folders.find(folder=>(folder.parentId??null)===parentId&&normalizedName(folder.name)===key);}
function folderPathKey(value:string){return value.split('/').map(normalizedName).join('/');}
function normalizedName(value:string){return value.normalize('NFC').trim().toLocaleLowerCase();}
function failure(error:unknown,failedPath:string,completedFiles:number,entries:LibraryImportEntry[],createdFolders:string[],reusedFolders:string[],resolvedFolderIds:number[]){const value=error as ImportErrorShape;return new LibraryFolderImportError(value?.message||'The item could not be imported.',{code:value?.code,failedPath,completedFiles,totalFiles:entries.length,createdFolders,reusedFolders,resolvedFolderIds,remainingFiles:entries.slice(completedFiles).map(entry=>entry.file)});}
