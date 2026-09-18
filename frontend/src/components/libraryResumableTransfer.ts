export type ResumableTransferProgress={transferredBytes:number;totalBytes:number;percent:number;speedBytesPerSecond:number|null;etaSeconds:number|null};
type UploadStatus={id:string;sizeBytes:number;receivedBytes:number;complete:boolean;chunkBytes:number};
type ApiError=Error&{status?:number;code?:string};

const sessions=new WeakMap<File,Map<string,string>>();

export async function uploadLibraryFile(input:{baseUrl:string;file:File;fields?:Record<string,string>;signal?:AbortSignal;onProgress?:(progress:ResumableTransferProgress)=>void}){
  const fieldIdentity=JSON.stringify(Object.entries(input.fields??{}).sort(([left],[right])=>left.localeCompare(right)));const key=`${input.baseUrl}|${fieldIdentity}`;const sessionMap=sessions.get(input.file)??new Map<string,string>();sessions.set(input.file,sessionMap);let uploadId=sessionMap.get(key);let status:UploadStatus|null=null;const started=performance.now();
  try{
    if(uploadId){try{status=(await requestJson<{upload:UploadStatus}>(`${input.baseUrl}/upload-sessions/${uploadId}`,{credentials:'include',signal:input.signal})).upload;}catch(error){if((error as ApiError).status!==404)throw error;sessionMap.delete(key);uploadId=undefined;}}
    if(!status){const created=await requestJson<{upload:UploadStatus}>(`${input.baseUrl}/upload-sessions`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:input.file.name,mimeType:input.file.type||'application/octet-stream',sizeBytes:input.file.size,...input.fields}),signal:input.signal});status=created.upload;uploadId=status.id;sessionMap.set(key,uploadId);}
    if(status.sizeBytes!==input.file.size)throw apiError('The saved upload session does not match this file.',409,'UPLOAD_SIZE_MISMATCH');
    report(input,status.receivedBytes,started);
    while(status.receivedBytes<input.file.size){
      if(input.signal?.aborted)throw new DOMException('The upload was cancelled.','AbortError');const end:number=Math.min(input.file.size,status.receivedBytes+status.chunkBytes);const offset:number=status.receivedBytes;
      try{status=(await patchChunk(`${input.baseUrl}/upload-sessions/${uploadId}`,input.file.slice(offset,end),offset,input.signal,loaded=>report(input,offset+loaded,started))).upload;}
      catch(error){if((error as ApiError).code!=='UPLOAD_OFFSET_MISMATCH')throw error;status=(await requestJson<{upload:UploadStatus}>(`${input.baseUrl}/upload-sessions/${uploadId}`,{credentials:'include',signal:input.signal})).upload;}
      report(input,status.receivedBytes,started);
    }
    const completed=await requestJson(`${input.baseUrl}/upload-sessions/${uploadId}/complete`,{method:'POST',credentials:'include',signal:input.signal});sessionMap.delete(key);report(input,input.file.size,started);return completed;
  }catch(error){
    if(isAbort(error)&&uploadId){try{await fetch(`${input.baseUrl}/upload-sessions/${uploadId}`,{method:'DELETE',credentials:'include'});}catch{/* best-effort server cleanup */}sessionMap.delete(key);}
    throw error;
  }
}

function report(input:{file:File;onProgress?:(progress:ResumableTransferProgress)=>void},transferredBytes:number,started:number){const elapsed=Math.max(0,(performance.now()-started)/1000);const speed=elapsed>=.5&&transferredBytes>0?transferredBytes/elapsed:null;input.onProgress?.({transferredBytes,totalBytes:input.file.size,percent:input.file.size?transferredBytes/input.file.size*100:100,speedBytesPerSecond:speed,etaSeconds:speed&&transferredBytes<input.file.size?(input.file.size-transferredBytes)/speed:0});}
function patchChunk(url:string,body:Blob,offset:number,signal:AbortSignal|undefined,onProgress:(loaded:number)=>void):Promise<{upload:UploadStatus}>{return new Promise((resolve,reject)=>{const request=new XMLHttpRequest();request.open('PATCH',url);request.withCredentials=true;request.setRequestHeader('Content-Type','application/offset+octet-stream');request.setRequestHeader('Upload-Offset',String(offset));const abort=()=>request.abort();signal?.addEventListener('abort',abort,{once:true});request.upload.addEventListener('progress',event=>onProgress(event.loaded));request.addEventListener('load',()=>{signal?.removeEventListener('abort',abort);let data:any={};try{data=JSON.parse(request.responseText||'{}');}catch{/* handled below */}if(request.status>=200&&request.status<300){resolve(data);return;}reject(apiError(String(data.error??`Request failed (${request.status}).`),request.status,String(data.code??'')));});request.addEventListener('error',()=>{signal?.removeEventListener('abort',abort);reject(apiError('The upload connection was interrupted.',0,'UPLOAD_INTERRUPTED'));});request.addEventListener('abort',()=>{signal?.removeEventListener('abort',abort);reject(new DOMException('The upload was cancelled.','AbortError'));});request.send(body);});}
async function requestJson<T=unknown>(url:string,init:RequestInit):Promise<T>{const response=await fetch(url,init);const data=await response.json().catch(()=>({})) as T&{error?:string;code?:string};if(!response.ok)throw apiError(String(data.error??`Request failed (${response.status}).`),response.status,String(data.code??''));return data;}
function apiError(message:string,status:number,code:string){const error=new Error(message) as ApiError;error.status=status;error.code=code;return error;}
function isAbort(error:unknown){return error instanceof DOMException&&error.name==='AbortError'||error instanceof Error&&/cancelled|aborted/i.test(error.message);}
