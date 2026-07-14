import { type DragEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type MachineComponentImageType = 'screw' | 'screw-tip';

type ComponentImage = {
  id: number;
  assetId: number;
  componentType: MachineComponentImageType;
  filename: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: string;
  contentUrl: string;
  downloadUrl: string;
};

const acceptedImageTypes = new Set(['image/jpeg','image/png','image/webp']);
const acceptedExtensions = new Set(['jpg','jpeg','png','webp']);
const maxImageBytes = 10 * 1024 * 1024;

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g,character=>({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[character] ?? character);
}

function downloadImage(image: ComponentImage) {
  const link = document.createElement('a');
  link.href = image.downloadUrl;
  link.download = image.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function MachineComponentImageCard({assetId,assetNumber,assetName,componentType,componentName,canEdit}:{assetId:number;assetNumber:string;assetName:string;componentType:MachineComponentImageType;componentName:string;canEdit:boolean}) {
  const fileInputRef = useRef<HTMLInputElement|null>(null);
  const [image,setImage]=useState<ComponentImage|null>(null);
  const [loading,setLoading]=useState(true);
  const [uploading,setUploading]=useState(false);
  const [draggingOver,setDraggingOver]=useState(false);
  const [viewerOpen,setViewerOpen]=useState(false);
  const [replacePromptOpen,setReplacePromptOpen]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');

  useEffect(()=>{
    let cancelled=false;
    setLoading(true);
    setError('');
    fetch(`/api/machine-library/assets/${assetId}/component-images`,{credentials:'include'})
      .then(async response=>{
        const data=await response.json().catch(()=>({}));
        if(!response.ok) throw new Error(data.error||'Component images could not be loaded.');
        return (data.images as ComponentImage[]|undefined)?.find(item=>item.componentType===componentType) ?? null;
      })
      .then(next=>{if(!cancelled)setImage(next);})
      .catch(loadError=>{if(!cancelled)setError((loadError as Error).message);})
      .finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[assetId,componentType]);

  useEffect(()=>{
    if(!viewerOpen&&!replacePromptOpen) return;
    function onKeyDown(event:KeyboardEvent) {
      if(event.key!=='Escape') return;
      if(replacePromptOpen) setReplacePromptOpen(false);
      else setViewerOpen(false);
    }
    document.addEventListener('keydown',onKeyDown);
    return()=>document.removeEventListener('keydown',onKeyDown);
  },[viewerOpen,replacePromptOpen]);

  function chooseFile() {
    if(canEdit&&!uploading) fileInputRef.current?.click();
  }

  function validateFile(file:File) {
    const extension=file.name.split('.').pop()?.toLowerCase() ?? '';
    if(!acceptedImageTypes.has(file.type.toLowerCase())||!acceptedExtensions.has(extension)) throw new Error('Choose a JPG, JPEG, PNG, or WEBP image.');
    if(file.size>maxImageBytes) throw new Error('Component image must be 10 MB or smaller.');
    if(file.size===0) throw new Error('The selected image is empty.');
  }

  async function uploadImage(file:File) {
    if(!canEdit||uploading) return;
    try {
      validateFile(file);
      setUploading(true);
      setError('');
      setMessage('');
      const formData=new FormData();
      formData.append('image',file);
      const response=await fetch(`/api/machine-library/assets/${assetId}/component-images/${encodeURIComponent(componentType)}`,{method:'PUT',credentials:'include',body:formData});
      const data=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(data.error||'Component image upload failed.');
      setImage(data.image as ComponentImage);
      setMessage(data.replaced?'Current image replaced.':'Component image uploaded.');
    } catch(uploadError) {
      setError((uploadError as Error).message);
    } finally {
      setUploading(false);
      if(fileInputRef.current) fileInputRef.current.value='';
    }
  }

  function handleDrop(event:DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDraggingOver(false);
    const file=event.dataTransfer.files[0];
    if(file) void uploadImage(file);
  }

  function printImage() {
    if(!image) return;
    const printWindow=window.open('','_blank','width=1000,height=800');
    if(!printWindow) {
      setError('Allow pop-ups to open the printable image page.');
      return;
    }
    printWindow.opener=null;
    const generatedDate=new Intl.DateTimeFormat(undefined,{dateStyle:'long',timeStyle:'short'}).format(new Date());
    printWindow.document.write(`<!doctype html><html><head><title>${escapeHtml(assetNumber)} - ${escapeHtml(componentName)}</title><style>body{margin:0;padding:32px;font-family:Arial,sans-serif;color:#111;background:#fff}header{border-bottom:2px solid #222;padding-bottom:14px;margin-bottom:24px}h1{margin:0 0 6px;font-size:24px}p{margin:4px 0;color:#444}.image-wrap{display:flex;align-items:center;justify-content:center;min-height:520px;border:1px solid #ccc;padding:18px}img{display:block;max-width:100%;max-height:70vh;object-fit:contain}.generated{margin-top:18px;font-size:12px;color:#666}@media print{body{padding:16px}.image-wrap{min-height:0;break-inside:avoid}img{max-height:72vh}}</style></head><body><header><h1>${escapeHtml(assetNumber)}${assetName?` — ${escapeHtml(assetName)}`:''}</h1><p>Component: <strong>${escapeHtml(componentName)}</strong></p></header><div class="image-wrap"><img id="component-print-image" src="${escapeHtml(`${window.location.origin}${image.contentUrl}`)}" alt="${escapeHtml(componentName)}"></div><p class="generated">Generated / printed: ${escapeHtml(generatedDate)}</p></body></html>`);
    printWindow.document.close();
    const printableImage=printWindow.document.getElementById('component-print-image') as HTMLImageElement|null;
    const openPrintDialog=()=>{printWindow.focus();printWindow.print();};
    if(printableImage?.complete) window.setTimeout(openPrintDialog,100);
    else printableImage?.addEventListener('load',openPrintDialog,{once:true});
  }

  const fileInput=<input ref={fileInputRef} className="component-image-file-input" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={event=>{const file=event.target.files?.[0];if(file)void uploadImage(file);}} />;

  return <>
    <div className={`machine-component-image-card${draggingOver?' is-drag-over':''}${image?' has-image':''}`} onDragEnter={event=>{if(canEdit){event.preventDefault();setDraggingOver(true);}}} onDragOver={event=>{if(canEdit)event.preventDefault();}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setDraggingOver(false);}} onDrop={handleDrop}>
      {fileInput}
      {loading?<div className="component-image-loading">Loading image…</div>:image?<>
        <button className="component-image-thumbnail" type="button" onClick={()=>setViewerOpen(true)} aria-label={`Open full-size ${componentName} image`}><img src={image.contentUrl} alt={`${assetNumber} ${componentName}`} /></button>
        <div className="component-image-meta"><strong>{componentName}</strong><small title={image.filename}>{image.filename||componentName}</small></div>
        {canEdit&&<button className="secondary-button compact-button component-image-replace" type="button" onClick={()=>setReplacePromptOpen(true)} disabled={uploading}>{uploading?'Uploading…':'Replace Image'}</button>}
      </>:<div className="component-image-empty" onClick={chooseFile}>
        <svg className="component-image-placeholder-icon" viewBox="0 0 96 76" aria-hidden="true"><rect x="5" y="8" width="86" height="60" rx="10"/><circle cx="69" cy="27" r="8"/><path d="M14 58l20-20 14 13 10-9 24 16"/><path d="M29 8l5-5h28l5 5"/></svg>
        <strong>No component image uploaded</strong>
        <small>{canEdit?'Drop an image here or click to browse.':'No current reference image.'}</small>
        {canEdit&&<button className="primary-button compact-button" type="button" onClick={event=>{event.stopPropagation();chooseFile();}} disabled={uploading}>{uploading?'Uploading…':'Upload Image'}</button>}
      </div>}
      {draggingOver&&<div className="component-image-drop-message">Drop image to upload</div>}
      {message&&<p className="component-image-message" role="status">{message}</p>}
      {error&&<p className="component-image-message error" role="alert">{error}</p>}
    </div>
    {viewerOpen&&image&&createPortal(<div className="modal-backdrop component-image-viewer-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setViewerOpen(false);}}><section className="mcc-card component-image-viewer" role="dialog" aria-modal="true" aria-label={`${componentName} full-size image`}>
      <div className="modal-heading"><div><p className="eyebrow">{assetNumber}{assetName?` · ${assetName}`:''}</p><h3>{componentName} Image</h3></div><button className="link-button compact-button" type="button" onClick={()=>setViewerOpen(false)}>Close</button></div>
      <div className="component-image-viewer-canvas"><img src={image.contentUrl} alt={`${assetNumber} ${componentName}`} /></div>
      <small className="component-image-viewer-filename">{image.filename||componentName}</small>
      <div className="modal-actions component-image-viewer-actions"><button className="secondary-button" type="button" onClick={()=>downloadImage(image)}>Download Image</button><button className="secondary-button" type="button" onClick={printImage}>Print / Save as PDF</button>{canEdit&&<button className="primary-button" type="button" onClick={()=>setReplacePromptOpen(true)}>Replace Image</button>}<button className="link-button" type="button" onClick={()=>setViewerOpen(false)}>Close</button></div>
    </section></div>,document.body)}
    {replacePromptOpen&&image&&createPortal(<div className="modal-backdrop component-image-replace-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setReplacePromptOpen(false);}}><section className="mcc-card component-image-replace-dialog" role="dialog" aria-modal="true" aria-labelledby={`replace-${assetId}-${componentType}`}><p className="eyebrow">Replace {componentName} Image</p><h3 id={`replace-${assetId}-${componentType}`}>Do you want to save the current image before replacing it?</h3><div className="component-image-replace-actions"><button className="secondary-button" type="button" onClick={()=>{downloadImage(image);setReplacePromptOpen(false);}}>Save Image</button><button className="secondary-button" type="button" onClick={()=>{printImage();setReplacePromptOpen(false);}}>Save as PDF</button><button className="primary-button" type="button" onClick={()=>{setReplacePromptOpen(false);chooseFile();}}>Replace Without Saving</button><button className="link-button" type="button" onClick={()=>setReplacePromptOpen(false)}>Cancel</button></div></section></div>,document.body)}
  </>;
}
