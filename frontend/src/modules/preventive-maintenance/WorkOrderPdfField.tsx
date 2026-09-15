import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { AssetIdentity } from '../machine-library/PreventiveMaintenanceTracking';
import {
  createWorkOrderPhotoPdf,
  DEFAULT_PM_WORK_ORDER_MAX_BYTES,
  formatWorkOrderFileSize,
  PM_WORK_ORDER_PHOTO_MAX_PAGES,
  validateWorkOrderPhoto,
  workOrderPhotoPdfFilename,
} from './workOrderPhotoPdf';

type CapturedPage={id:string;file:File;previewUrl:string};
type AttachmentInfo={kind:'pdf'|'photos';filename:string;size:number;pageCount?:number};
type UploadRulesResponse={rules?:{maxBytes?:number;acceptedMimeTypes?:string[]}};

function pageId(){return typeof crypto.randomUUID==='function'?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`;}

export function WorkOrderPdfField({asset,taskTitle,workOrderNumber,value,disabled,onChange,onMaxBytesChange,onProcessingChange}:{asset:AssetIdentity;taskTitle:string;workOrderNumber:string;value:File|null;disabled:boolean;onChange:(file:File|null)=>void;onMaxBytesChange:(maxBytes:number)=>void;onProcessingChange:(processing:boolean)=>void}){
  const pdfInputRef=useRef<HTMLInputElement>(null);const cameraInputRef=useRef<HTMLInputElement>(null);const choosePdfButtonRef=useRef<HTMLButtonElement>(null);const takePhotoButtonRef=useRef<HTMLButtonElement>(null);const previewRef=useRef<HTMLElement>(null);const urlsRef=useRef(new Set<string>());const abortRef=useRef<AbortController|null>(null);const cameraModeRef=useRef<'new'|'continue'>('new');
  const [maxBytes,setMaxBytes]=useState(DEFAULT_PM_WORK_ORDER_MAX_BYTES);const [rulesLoaded,setRulesLoaded]=useState(false);const [captureSupported]=useState(()=>{const input=document.createElement('input');return 'capture' in input;});
  const [pages,setPages]=useState<CapturedPage[]>([]);const [draft,setDraft]=useState<CapturedPage|null>(null);const [attachment,setAttachment]=useState<AttachmentInfo|null>(null);const [processing,setProcessing]=useState(false);const [progress,setProgress]=useState('');const [status,setStatus]=useState('');const [fieldError,setFieldError]=useState('');

  useEffect(()=>{const controller=new AbortController();fetch('/api/preventive-maintenance/work-order-upload-rules',{credentials:'include',cache:'no-store',signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error('Upload rules unavailable.');return response.json() as Promise<UploadRulesResponse>;}).then(data=>{const authoritative=Number(data.rules?.maxBytes);if(Number.isFinite(authoritative)&&authoritative>0){setMaxBytes(authoritative);onMaxBytesChange(authoritative);setRulesLoaded(true);}}).catch(error=>{if((error as Error).name!=='AbortError')setRulesLoaded(false);});return()=>controller.abort();},[onMaxBytesChange]);
  useEffect(()=>{onProcessingChange(processing);},[onProcessingChange,processing]);
  useEffect(()=>()=>onProcessingChange(false),[onProcessingChange]);
  useEffect(()=>{const input=cameraInputRef.current;if(!input)return;const canceled=()=>{setFieldError(captureSupported?'No photo was captured. Camera access may be blocked or canceled. Try again or use Choose PDF.':'Direct camera capture is unavailable in this browser. Choose an image or use Choose PDF instead.');};input.addEventListener('cancel',canceled);return()=>input.removeEventListener('cancel',canceled);},[captureSupported]);
  useEffect(()=>()=>{abortRef.current?.abort();for(const url of urlsRef.current)URL.revokeObjectURL(url);urlsRef.current.clear();},[]);
  useEffect(()=>{if(!draft)return;requestAnimationFrame(()=>previewRef.current?.focus());const close=(event:KeyboardEvent)=>{if(event.key!=='Escape'||processing)return;event.preventDefault();event.stopImmediatePropagation();cancelPreview();};document.addEventListener('keydown',close,true);return()=>document.removeEventListener('keydown',close,true);},[draft,pages.length,processing]);

  function release(page:CapturedPage|null){if(!page)return;URL.revokeObjectURL(page.previewUrl);urlsRef.current.delete(page.previewUrl);}
  function clearWorkingPages(){pages.forEach(release);release(draft);setPages([]);setDraft(null);}
  function launchCamera(mode:'new'|'continue'){
    if(disabled||processing)return;cameraModeRef.current=mode;setFieldError('');setStatus(captureSupported?'Opening the rear camera where supported…':'This browser cannot request a camera directly; an image picker will open instead.');cameraInputRef.current?.click();
  }
  function beginPhotoSeries(){
    if(pages.length||draft)clearWorkingPages();launchCamera('new');
  }
  function stageCameraFile(file:File|undefined){
    if(!file){setFieldError('No photo was captured. Try Take Photo again or use Choose PDF.');return;}
    try{validateWorkOrderPhoto(file);}catch(error){setFieldError((error as Error).message);return;}
    if(cameraModeRef.current==='new'){onChange(null);setAttachment(null);if(pdfInputRef.current)pdfInputRef.current.value='';}
    const previewUrl=URL.createObjectURL(file);urlsRef.current.add(previewUrl);setDraft({id:pageId(),file,previewUrl});setStatus(`Preview page ${pages.length+1} before adding it to the work-order PDF.`);setFieldError('');cameraModeRef.current='continue';
  }
  function choosePdf(file:File|undefined){
    if(!file)return;
    if(file.type!=='application/pdf'||!file.name.toLowerCase().endsWith('.pdf')){setFieldError('Work-order attachment must be a PDF file.');return;}
    if(file.size<=0){setFieldError('Work-order PDF is empty or unreadable.');return;}
    if(file.size>maxBytes){setFieldError(`Work-order PDF must be ${formatWorkOrderFileSize(maxBytes)} or smaller.`);return;}
    clearWorkingPages();onChange(file);setAttachment({kind:'pdf',filename:file.name,size:file.size});setFieldError('');setStatus('Selected PDF is ready for the normal PM completion workflow.');
  }
  function addPage(){
    if(!draft||pages.length+1>=PM_WORK_ORDER_PHOTO_MAX_PAGES)return;const accepted=[...pages,draft];setPages(accepted);setDraft(null);onChange(null);setAttachment(null);setStatus(`Page ${accepted.length} accepted. Capture the next page in order.`);launchCamera('continue');
  }
  function retake(){
    release(draft);setDraft(null);setStatus('Retake the current page. Previously accepted pages keep their order.');launchCamera('continue');
  }
  async function generate(files:CapturedPage[]){
    if(processing)return;const controller=new AbortController();abortRef.current=controller;setProcessing(true);setFieldError('');setProgress(`Preparing ${files.length} photographed page${files.length===1?'':'s'}…`);
    try{
      const filename=workOrderPhotoPdfFilename(workOrderNumber,asset.assetNumber,taskTitle);const pdf=await createWorkOrderPhotoPdf({files:files.map(page=>page.file),filename,maxBytes,signal:controller.signal,onProgress:({attempt,page,pageCount})=>setProgress(`${attempt===1?'Converting':'Compressing'} page ${page} of ${pageCount}…`)});onChange(pdf);setAttachment({kind:'photos',filename:pdf.name,size:pdf.size,pageCount:files.length});files.forEach(release);setPages([]);setDraft(null);if(pdfInputRef.current)pdfInputRef.current.value='';setStatus(`${files.length} photographed page${files.length===1?'':'s'} combined and attached as one PDF.`);setProgress('');requestAnimationFrame(()=>takePhotoButtonRef.current?.focus());
    }catch(error){if((error as Error).name!=='AbortError')setFieldError((error as Error).message||'Work-order photos could not be converted. Retake the photos or use Choose PDF.');}
    finally{abortRef.current=null;setProcessing(false);}
  }
  function usePhoto(){if(draft)void generate([...pages,draft]);}
  function finishAcceptedPages(){if(pages.length)void generate(pages);}
  function cancelPreview(){release(draft);setDraft(null);setStatus(pages.length?`${pages.length} page${pages.length===1?' is':'s are'} accepted. Finish the PDF or add another page.`:'Photo capture canceled. Choose PDF or take a new photo.');requestAnimationFrame(()=>takePhotoButtonRef.current?.focus());}
  function removeAttachment(){clearWorkingPages();onChange(null);setAttachment(null);setProgress('');setFieldError('');setStatus('Work-order PDF removed. Choose a PDF or take photos to replace it.');if(pdfInputRef.current)pdfInputRef.current.value='';}

  const required=Boolean(workOrderNumber.trim())&&!/^n\s*\/\s*a$/i.test(workOrderNumber.trim());const shownAttachment=attachment??(value?{kind:'pdf' as const,filename:value.name,size:value.size}:null);const limitLabel=formatWorkOrderFileSize(maxBytes);
  return <div className="form-field pm-form-wide pm-work-order-file">
    <span id="pm-work-order-pdf-label">Work-order PDF{required?' *':''}</span>
    <div className="pm-work-order-source-actions" role="group" aria-labelledby="pm-work-order-pdf-label">
      <button ref={choosePdfButtonRef} className="secondary-button glass-button glass-button--secondary" type="button" disabled={disabled||processing} onClick={()=>pdfInputRef.current?.click()}>Choose PDF</button>
      <button ref={takePhotoButtonRef} className="secondary-button glass-button glass-button--secondary pm-work-order-camera-button" type="button" disabled={disabled||processing} onClick={beginPhotoSeries}>Take Photo</button>
    </div>
    <input ref={pdfInputRef} className="pm-work-order-native-input" aria-label="Choose work-order PDF" type="file" accept=".pdf,application/pdf" required={required&&!value} onInvalid={event=>{event.preventDefault();setFieldError('Select the matching work-order PDF or use Take Photo for this Work Order Number.');requestAnimationFrame(()=>choosePdfButtonRef.current?.focus());}} onChange={event=>choosePdf(event.target.files?.[0])}/>
    <input ref={cameraInputRef} hidden aria-label="Take work-order photo" type="file" accept="image/*" capture="environment" onChange={event=>{stageCameraFile(event.target.files?.[0]);event.currentTarget.value='';}}/>
    <small>Choose an existing PDF or photograph up to {PM_WORK_ORDER_PHOTO_MAX_PAGES} pages. The rear camera is requested where supported; other browsers open an image picker. Server limit: {limitLabel}{rulesLoaded?'':' (verified again on upload)'}.</small>
    {shownAttachment&&<div className={`pm-work-order-attachment-summary${shownAttachment.kind==='photos'?' is-generated':''}`} aria-label="Attached work-order PDF">
      <span className="pm-work-order-pdf-icon" aria-hidden="true">PDF</span><span><strong title={shownAttachment.filename}>{shownAttachment.filename}</strong><small>{shownAttachment.pageCount?`${shownAttachment.pageCount} page${shownAttachment.pageCount===1?'':'s'} · `:''}{formatWorkOrderFileSize(shownAttachment.size)}{shownAttachment.kind==='photos'?' · generated from photos':' · selected PDF'}</small></span><button className="link-button compact-button glass-button glass-button--secondary" type="button" disabled={disabled||processing} onClick={removeAttachment}>Remove</button>
    </div>}
    {!draft&&!shownAttachment&&pages.length>0&&<div className="pm-work-order-pending-pages" role="status"><span><strong>{pages.length} page{pages.length===1?'':'s'} accepted</strong><small>Finish this PDF or continue capturing pages in order.</small></span><div><button className="primary-button compact-button glass-button glass-button--primary" type="button" disabled={disabled||processing} onClick={finishAcceptedPages}>Finish PDF</button><button className="secondary-button compact-button glass-button glass-button--secondary" type="button" disabled={disabled||processing||pages.length>=PM_WORK_ORDER_PHOTO_MAX_PAGES} onClick={()=>launchCamera('continue')}>Add Page</button><button className="link-button compact-button glass-button glass-button--secondary" type="button" disabled={disabled||processing} onClick={()=>{clearWorkingPages();setStatus('Captured pages discarded.');}}>Discard</button></div></div>}
    {progress&&<p className="pm-work-order-conversion-status" role="status" aria-live="polite">{progress}</p>}
    {!progress&&status&&<p className="pm-work-order-capture-status" role="status" aria-live="polite">{status}</p>}
    {fieldError&&<p className="pm-inline-error" role="alert">{fieldError}</p>}
    {draft&&createPortal(<div className="modal-backdrop glass-modal-backdrop pm-photo-preview-backdrop" role="presentation"><section ref={previewRef} tabIndex={-1} className="mcc-card glass-modal-shell pm-photo-preview-modal" role="dialog" aria-modal="true" aria-labelledby="pm-photo-preview-title">
      <div className="modal-heading"><div><p className="eyebrow">Work-order photo · page {pages.length+1}</p><h3 id="pm-photo-preview-title">Preview captured page</h3><p>Pages are combined in the order shown.</p></div><button className="link-button compact-button glass-button glass-button--secondary" type="button" disabled={processing} onClick={cancelPreview}>Cancel</button></div>
      <div className="pm-photo-preview-canvas"><img src={draft.previewUrl} alt={`Work-order page ${pages.length+1} preview`} /></div>
      <div className="pm-photo-preview-meta"><strong>{draft.file.name}</strong><span>{formatWorkOrderFileSize(draft.file.size)}</span></div>
      {pages.length>0&&<ol className="pm-photo-page-order" aria-label="Accepted work-order pages in PDF order">{pages.map((page,index)=><li key={page.id}><img src={page.previewUrl} alt=""/><span>Page {index+1}</span></li>)}<li className="is-current"><img src={draft.previewUrl} alt=""/><span>Page {pages.length+1} · preview</span></li></ol>}
      {fieldError&&<p className="pm-inline-error" role="alert">{fieldError}</p>}{progress&&<p className="pm-work-order-conversion-status" role="status" aria-live="polite">{progress}</p>}
      <div className="modal-actions pm-photo-preview-actions"><button className="secondary-button glass-button glass-button--secondary" type="button" disabled={processing} onClick={retake}>Retake</button><button className="secondary-button glass-button glass-button--secondary" type="button" disabled={processing||pages.length+1>=PM_WORK_ORDER_PHOTO_MAX_PAGES} onClick={addPage}>Add Page</button><button className="primary-button glass-button glass-button--success" type="button" disabled={processing} onClick={usePhoto}>{processing?'Creating PDF…':'Use Photo'}</button></div>
    </section></div>,document.body)}
  </div>;
}
