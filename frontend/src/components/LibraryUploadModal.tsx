import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MccFileTypeIcon, type MccFileTypeIconVariant } from './MccFileTypeIcon';

export type LibraryUploadLimits={documentsMb:number;picturesMb:number;videosMb:number};

type Props={
  eyebrow:string;
  title:string;
  destination:string[];
  files:File[];
  limits:LibraryUploadLimits;
  busy:boolean;
  error?:string;
  progress?:number|null;
  completedCount?:number;
  currentFile?:string;
  allowLooseFiles?:boolean;
  metadata?:ReactNode;
  conflictActions?:ReactNode;
  onPickFiles:(files:File[])=>void;
  onPickFolder:(files:File[])=>void;
  onRemove:(index:number)=>void;
  onUpload:()=>void;
  onClose:()=>void;
};

const accept='.pdf,.doc,.docx,.xls,.xlsx,.txt,.jpg,.jpeg,.png,.webp,.mp4,.webm';

export function LibraryUploadModal({eyebrow,title,destination,files,limits,busy,error='',progress=null,completedCount=0,currentFile='',allowLooseFiles=true,metadata,conflictActions,onPickFiles,onPickFolder,onRemove,onUpload,onClose}:Props){
  const dialogRef=useRef<HTMLElement>(null);const fileRef=useRef<HTMLInputElement>(null);const folderRef=useRef<HTMLInputElement>(null);const closeRef=useRef(onClose);const busyRef=useRef(busy);const headingId=useId();const [folderSupported,setFolderSupported]=useState(true);
  closeRef.current=onClose;busyRef.current=busy;
  const totalBytes=files.reduce((sum,file)=>sum+file.size,0);
  useEffect(()=>{setFolderSupported(Boolean(folderRef.current&&'webkitdirectory' in folderRef.current));const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;const dialog=dialogRef.current;const first=dialog?.querySelector<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled])');first?.focus();const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){if(!busyRef.current)closeRef.current();return;}if(event.key!=='Tab'||!dialog)return;const focusable=[...dialog.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(item=>item.offsetParent!==null);if(!focusable.length)return;const firstItem=focusable[0];const lastItem=focusable.at(-1)!;if(event.shiftKey&&document.activeElement===firstItem){event.preventDefault();lastItem.focus();}else if(!event.shiftKey&&document.activeElement===lastItem){event.preventDefault();firstItem.focus();}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus();};},[]);
  return createPortal(<div className="modal-backdrop glass-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}><section ref={dialogRef} className="mcc-card glass-modal-shell mcc-wide-modal library-upload-modal" role="dialog" aria-modal="true" aria-labelledby={headingId} aria-busy={busy}>
    <div className="modal-heading"><div><p className="eyebrow">{eyebrow}</p><h3 id={headingId}>{title}</h3></div><button className="link-button compact-button glass-button glass-button--secondary" type="button" onClick={onClose} disabled={busy}>Close</button></div>
    <div className="library-upload-body">
      <nav className="library-upload-destination" aria-label="Upload destination"><span>Destination</span><ol>{destination.map((segment,index)=><li key={`${segment}-${index}`}>{segment}</li>)}</ol></nav>
      <section className="library-upload-selector glass-card glass-card--nested" aria-label="Select upload files"><div><strong>Add files to the queue</strong><small>Documents up to {limits.documentsMb} MB · pictures up to {limits.picturesMb} MB · videos up to {limits.videosMb} MB. PDF, Word, Excel, TXT, JPG, PNG, WEBP, MP4, and WEBM. Individual-file batches support up to 20 files; folder imports may contain more.</small></div><div className="library-upload-selector__actions"><button className="primary-button compact-button glass-button glass-button--primary" type="button" disabled={busy||!allowLooseFiles} onClick={()=>fileRef.current?.click()}>Choose Files</button><button className="secondary-button compact-button glass-button glass-button--secondary" type="button" disabled={busy||!folderSupported} onClick={()=>folderRef.current?.click()}>Upload Folder</button></div><input ref={fileRef} aria-label="Choose files" hidden multiple type="file" accept={accept} onChange={event=>{onPickFiles(Array.from(event.target.files??[]));event.currentTarget.value='';}}/><input ref={folderRef} aria-label="Choose folder" hidden multiple type="file" {...{webkitdirectory:'',directory:''}} onChange={event=>{onPickFolder(Array.from(event.target.files??[]));event.currentTarget.value='';}}/>{!allowLooseFiles&&<small className="library-upload-hint">Choose Upload Folder when the destination is the library root.</small>}{!folderSupported&&<small className="library-upload-hint">Folder selection is unavailable in this browser. Choose individual files instead.</small>}</section>
      <div className="library-upload-summary" aria-live="polite"><strong>{files.length} file{files.length===1?'':'s'}</strong><span>{formatBytes(totalBytes)} selected</span></div>
      <div className="library-upload-queue" role="list" aria-label="Selected files">{files.length===0?<div className="library-upload-empty">No files selected.</div>:files.map((file,index)=>{const relative=relativeDirectory(file);const active=busy&&Boolean(currentFile)&&(currentFile===file.name||currentFile===relativePath(file));const complete=busy&&index<completedCount;return <div className={`library-upload-row glass-attachment${active?' is-active':''}`} role="listitem" key={`${relativePath(file)}-${file.size}-${index}`}><MccFileTypeIcon type={iconType(file.name)}/><div className="library-upload-row__main"><strong title={file.name}>{file.name}</strong><div className="library-upload-row__meta"><span>{formatBytes(file.size)}</span><span>{fileCategory(file.name)}</span>{relative&&<span title={relative}>{relative}</span>}</div></div><span className="library-upload-row__status" aria-live="polite">{complete?'Uploaded':active?'Uploading…':'Ready'}</span><button className="link-button compact-button glass-button glass-button--secondary library-upload-row__remove" type="button" onClick={()=>onRemove(index)} disabled={busy} aria-label={`Remove ${file.name}`}>Remove</button></div>;})}</div>
      {metadata&&<div className="library-upload-metadata">{metadata}</div>}
      {busy&&<div className="library-upload-progress" role="status" aria-live="polite"><div><strong>{currentFile?`Uploading ${currentFile}`:'Uploading selected files'}</strong><span>{Math.round(Math.max(0,Math.min(100,progress??0)))}%</span></div><progress max="100" value={Math.max(0,Math.min(100,progress??0))}/><small>{completedCount} of {files.length} files complete</small></div>}
      {error&&<p className="form-message error" role="alert">{error}</p>}
      {conflictActions??<div className="modal-actions glass-modal__actions library-upload-footer"><button className="secondary-button glass-button glass-button--secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="primary-button glass-button glass-button--primary" type="button" onClick={onUpload} disabled={busy||!files.length}>{busy?'Uploading…':'Upload'}</button></div>}
    </div>
  </section></div>,document.body);
}

export function uploadFormDataWithProgress<T=unknown>(url:string,body:FormData,onProgress:(percent:number)=>void):Promise<T>{return new Promise((resolve,reject)=>{const request=new XMLHttpRequest();request.open('POST',url);request.withCredentials=true;request.upload.addEventListener('progress',event=>{if(event.lengthComputable)onProgress(event.total?event.loaded/event.total*100:0);});request.addEventListener('load',()=>{let data:Record<string,unknown>={};try{data=JSON.parse(request.responseText||'{}') as Record<string,unknown>;}catch{/* handled below */}if(request.status>=200&&request.status<300){onProgress(100);resolve(data as T);return;}const error=new Error(String(data.error??`Request failed (${request.status}).`)) as Error&{status?:number;code?:string};error.status=request.status;error.code=String(data.code??'');reject(error);});request.addEventListener('error',()=>reject(new Error('The upload connection was interrupted.')));request.addEventListener('abort',()=>reject(new Error('The upload was cancelled.')));request.send(body);});}

function relativePath(file:File){return String((file as File&{webkitRelativePath?:string}).webkitRelativePath??file.name)||file.name;}
function relativeDirectory(file:File){const value=relativePath(file).replace(/\\/g,'/');const index=value.lastIndexOf('/');return index>0?value.slice(0,index):'';}
function extension(value:string){return value.split('.').pop()?.toLowerCase()??'';}
function iconType(value:string):MccFileTypeIconVariant{const type=extension(value);return type==='pdf'?'pdf':['doc','docx'].includes(type)?'word':['xls','xlsx'].includes(type)?'excel':'text';}
function fileCategory(value:string){const type=extension(value);return ['jpg','jpeg','png','webp'].includes(type)?'Picture':['mp4','webm'].includes(type)?'Video':['pdf','doc','docx','xls','xlsx','txt'].includes(type)?'Document':type.toUpperCase()||'File';}
function formatBytes(value:number){if(value<1024)return `${value} B`;if(value<1024**2)return `${(value/1024).toFixed(value<10240?1:0)} KB`;if(value<1024**3)return `${(value/1024**2).toFixed(1)} MB`;return `${(value/1024**3).toFixed(1)} GB`;}
