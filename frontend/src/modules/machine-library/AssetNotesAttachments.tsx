import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MccAccordionHeader, MccCategoryAccordion } from '../../components/MccCategoryAccordion';
import { MccDateInput, isValidMccDateValue, localIsoDate } from '../../components/MccDateInput';
import { MccActionGroup, MccOverflowMenu, MccResourceRow } from '../../components/MccResourceRow';
import { MccSummaryToken, MccSummaryTokenGroup } from '../../components/MccSummaryToken';

type AssetIdentity = { id:number; assetNumber:string; assetName:string; brand:string; model:string; serialNumber:string };
type AssetNoteAttachment = { id:number; noteId:number; filename:string; mimeType:string; fileSize:number; createdAt:string; contentUrl:string; downloadUrl:string };
type AssetNote = { id:number; assetId:number; title:string; noteDate:string; body:string; createdBy:string; createdAt:string; updatedAt:string; pdfFilename:string; pdfUrl:string; pdfDownloadUrl:string; attachments:AssetNoteAttachment[] };
type NoteDraft = { title:string; noteDate:string; body:string };
type ViewerFile = { filename:string; mimeType:string; contentUrl:string; downloadUrl:string; label:string };

const attachmentAccept='.pdf,.doc,.docx,.jpg,.jpeg,.png,.webp';
const maxAttachmentBytes=50*1024*1024;

async function responseJson<T>(response:Response) {
  const data=await response.json().catch(()=>({})) as T & {error?:string};
  if(!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function formatDate(value:string) {
  const date=new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}
function formatDateTime(value:string) {
  const date=new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
function formatFileSize(size:number) {
  if(!Number.isFinite(size)||size<=0) return '';
  if(size<1024) return `${size} B`;
  if(size<1024*1024) return `${(size/1024).toFixed(size<10240?1:0)} KB`;
  return `${(size/(1024*1024)).toFixed(1)} MB`;
}
function fileKind(file:{filename:string;mimeType:string}) {
  const extension=file.filename.split('.').pop()?.toLowerCase() ?? '';
  if(file.mimeType==='application/pdf'||extension==='pdf') return 'pdf';
  if(file.mimeType.startsWith('image/')||['jpg','jpeg','png','webp'].includes(extension)) return 'image';
  if(['doc','docx'].includes(extension)||/word/.test(file.mimeType)) return 'word';
  return 'file';
}
function fileKindLabel(file:{filename:string;mimeType:string}) {
  const extension=file.filename.split('.').pop()?.toUpperCase();
  return extension || (fileKind(file)==='image'?'IMAGE':'FILE');
}
function triggerDownload(url:string,filename:string) {
  const link=document.createElement('a');
  link.href=url;
  link.download=filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
function escapePrintHtml(value:string) { return value.replace(/[&<>'"]/g,character=>({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[character] ?? character); }

export function AssetNotesAttachments({asset,canEdit}:{asset:AssetIdentity;canEdit:boolean}) {
  const [expanded,setExpanded]=useState(false);
  const [notes,setNotes]=useState<AssetNote[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [editing,setEditing]=useState<AssetNote|null>(null);
  const [adding,setAdding]=useState(false);
  const [draft,setDraft]=useState<NoteDraft>({title:'',noteDate:localIsoDate(new Date()),body:''});
  const [pendingAttachments,setPendingAttachments]=useState<File[]>([]);
  const [saving,setSaving]=useState(false);
  const [viewer,setViewer]=useState<ViewerFile|null>(null);
  const fileInputRef=useRef<HTMLInputElement|null>(null);

  async function loadNotes() {
    setLoading(true);
    setError('');
    try {
      const data=await responseJson<{ok:boolean;notes:AssetNote[]}>(await fetch(`/api/machine-library/assets/${asset.id}/notes`,{credentials:'include'}));
      setNotes(data.notes);
    } catch(loadError) {
      setError((loadError as Error).message || 'Asset notes could not be loaded.');
    } finally { setLoading(false); }
  }
  useEffect(()=>{ setExpanded(false); setAdding(false); setEditing(null); setPendingAttachments([]); void loadNotes(); },[asset.id]);

  const attachmentCount=useMemo(()=>notes.reduce((count,note)=>count+note.attachments.length,0),[notes]);
  const summary=loading?'Loading notes...':<MccSummaryTokenGroup><MccSummaryToken tone="note">{notes.length} note{notes.length===1?'':'s'}</MccSummaryToken><MccSummaryToken tone="attachment">{attachmentCount} attachment{attachmentCount===1?'':'s'}</MccSummaryToken></MccSummaryTokenGroup>;

  function beginAdd() {
    setEditing(null);
    setAdding(true);
    setPendingAttachments([]);
    setDraft({title:'',noteDate:localIsoDate(new Date()),body:''});
    setError('');
  }
  function beginEdit(note:AssetNote) {
    setEditing(note);
    setAdding(false);
    setPendingAttachments([]);
    setDraft({title:note.title,noteDate:note.noteDate,body:note.body});
    setError('');
  }
  function cancelForm() {
    setAdding(false);
    setEditing(null);
    setPendingAttachments([]);
  }
  function addPending(files:File[]) {
    setError('');
    const supported=files.filter(file=>['pdf','image','word'].includes(fileKind({filename:file.name,mimeType:file.type})));
    const accepted=supported.filter(file=>file.size<=maxAttachmentBytes);
    if(supported.some(file=>file.size>maxAttachmentBytes)) setError('Each attachment must be 50 MB or smaller.');
    else if(supported.length!==files.length) setError('Attachments must be PDF, Word, JPG, JPEG, PNG, or WEBP files.');
    setPendingAttachments(current=>[...current,...accepted].slice(0,10));
  }
  async function saveNote(event:FormEvent) {
    event.preventDefault();
    const title=draft.title.trim();
    const body=draft.body.trim();
    if(!title||!body) { setError('Note Title and Note Body are required.'); return; }
    if(!isValidMccDateValue(draft.noteDate,true)) { setError('Enter a valid note date.'); return; }
    setSaving(true);
    setError('');
    try {
      const formData=new FormData();
      formData.append('title',title);
      formData.append('noteDate',draft.noteDate);
      formData.append('body',body);
      pendingAttachments.forEach(file=>formData.append('attachments',file,file.name));
      const url=editing?`/api/machine-library/asset-notes/${editing.id}`:`/api/machine-library/assets/${asset.id}/notes`;
      await responseJson(await fetch(url,{method:editing?'PUT':'POST',credentials:'include',body:formData}));
      cancelForm();
      await loadNotes();
    } catch(saveError) {
      setError((saveError as Error).message || 'Asset note could not be saved.');
    } finally { setSaving(false); }
  }
  async function deleteNote(note:AssetNote) {
    if(!window.confirm(`Delete asset note “${note.title}” and all of its attachments?`)) return;
    setError('');
    try {
      await responseJson(await fetch(`/api/machine-library/asset-notes/${note.id}`,{method:'DELETE',credentials:'include'}));
      if(editing?.id===note.id) cancelForm();
      await loadNotes();
    } catch(deleteError) { setError((deleteError as Error).message || 'Asset note could not be deleted.'); }
  }
  async function deleteAttachment(note:AssetNote,attachment:AssetNoteAttachment) {
    if(!window.confirm(`Delete attachment “${attachment.filename}” from ${note.title}?`)) return;
    setError('');
    try {
      await responseJson(await fetch(`/api/machine-library/asset-note-attachments/${attachment.id}`,{method:'DELETE',credentials:'include'}));
      await loadNotes();
    } catch(deleteError) { setError((deleteError as Error).message || 'Attachment could not be deleted.'); }
  }
  function openAttachment(attachment:AssetNoteAttachment) {
    const kind=fileKind(attachment);
    if(kind==='word') { triggerDownload(attachment.downloadUrl,attachment.filename); return; }
    setViewer({filename:attachment.filename,mimeType:attachment.mimeType,contentUrl:attachment.contentUrl,downloadUrl:attachment.downloadUrl,label:`${asset.assetNumber} attachment`});
  }

  return <MccCategoryAccordion accent="notes" expanded={expanded} className="asset-notes-card glass-panel glass-panel--nested">
    <MccAccordionHeader title={<>Asset Notes &amp; Attachments</>} summary={summary} expanded={expanded} controls={`asset-notes-panel-${asset.id}`} onToggle={()=>setExpanded(current=>!current)} />
    <div className="machine-detail-accordion-panel asset-notes-panel" id={`asset-notes-panel-${asset.id}`} aria-hidden={!expanded}>
      <div className="asset-notes-toolbar glass-toolbar"><div><strong>Working asset notes</strong><small>Saved notes automatically create a maintenance-style PDF.</small></div>{canEdit&&<button className="primary-button compact-button glass-button glass-button--primary" type="button" onClick={beginAdd}>Add Note</button>}</div>
      {error&&<p className="form-message error">{error}</p>}
      {(adding||editing)&&<form className="asset-note-form glass-card glass-card--nested" onSubmit={saveNote}>
        <label className="form-field"><span>Note Title *</span><input className="glass-input" value={draft.title} maxLength={180} onChange={event=>setDraft(current=>({...current,title:event.target.value}))} required /></label>
        <MccDateInput label="Note Date *" value={draft.noteDate} onChange={value=>setDraft(current=>({...current,noteDate:value}))} required />
        <label className="form-field asset-note-body-field"><span>Note Body *</span><textarea className="glass-input" value={draft.body} maxLength={30000} rows={7} onChange={event=>setDraft(current=>({...current,body:event.target.value}))} required /></label>
        <div className="asset-note-attachment-picker glass-card glass-card--nested"><div><strong>Optional attachments</strong><small>PDF, Word, JPG, JPEG, PNG, or WEBP · up to 50 MB each</small></div><button className="secondary-button compact-button glass-button glass-button--secondary" type="button" onClick={()=>fileInputRef.current?.click()}>Add Attachments</button><input ref={fileInputRef} hidden multiple type="file" accept={attachmentAccept} onChange={event=>{addPending(Array.from(event.target.files??[]));event.currentTarget.value='';}} /></div>
        {pendingAttachments.length>0&&<div className="asset-attachment-grid glass-attachments">{pendingAttachments.map((file,index)=><PendingAttachmentChip key={`${file.name}-${file.size}-${index}`} file={file} onRemove={()=>setPendingAttachments(current=>current.filter((_,itemIndex)=>itemIndex!==index))} />)}</div>}
        <div className="modal-actions glass-modal__actions"><button className="secondary-button glass-button glass-button--secondary" type="button" onClick={cancelForm} disabled={saving}>Cancel</button><button className="primary-button glass-button glass-button--primary" type="submit" disabled={saving}>{saving?'Saving & generating PDF...':'Save Note'}</button></div>
      </form>}
      {!adding&&!editing&&loading&&<div className="machine-record-newest-empty glass-empty-state">Loading asset notes...</div>}
      {!adding&&!editing&&!loading&&notes.length===0&&<div className="machine-record-newest-empty glass-empty-state"><strong>No notes</strong><span>Add a working maintenance note and optional supporting files.</span></div>}
      {!adding&&!editing&&notes.length>0&&<div className="asset-note-list">{notes.map(note=><section className="asset-note-entry glass-card glass-card--nested" key={note.id}>
        <div className="asset-note-entry-heading"><div><span className="asset-note-date-pill glass-pill glass-pill--cyan">{formatDate(note.noteDate)}</span><h5>{note.title}</h5><small>Created by {note.createdBy} · {formatDateTime(note.createdAt)}{note.updatedAt!==note.createdAt?' · edited':''}</small></div><MccActionGroup className="asset-note-actions"><button className="secondary-button compact-button glass-button glass-button--secondary" type="button" onClick={()=>setViewer({filename:note.pdfFilename,mimeType:'application/pdf',contentUrl:note.pdfUrl,downloadUrl:note.pdfDownloadUrl,label:`${asset.assetNumber} asset note`})}>Open Note PDF</button><button className="secondary-button compact-button glass-button glass-button--secondary" type="button" onClick={()=>triggerDownload(note.pdfDownloadUrl,note.pdfFilename)}>Download Note PDF</button><MccOverflowMenu ariaLabel={`More actions for ${note.title}`} items={[{label:'Print Note PDF',onSelect:()=>window.open(note.pdfUrl,'_blank','noopener,noreferrer')},...(canEdit?[{label:'Edit Note',onSelect:()=>beginEdit(note)},{label:'Delete Note',onSelect:()=>void deleteNote(note),danger:true}]:[])]} /></MccActionGroup></div>
        <p className="asset-note-body-preview">{note.body}</p>
        {note.attachments.length>0&&<div className="asset-attachment-grid glass-attachments">{note.attachments.map(attachment=><AttachmentChip key={attachment.id} attachment={attachment} canDelete={canEdit} onOpen={()=>openAttachment(attachment)} onDownload={()=>triggerDownload(attachment.downloadUrl,attachment.filename)} onDelete={()=>void deleteAttachment(note,attachment)} />)}</div>}
      </section>)}</div>}
    </div>
    {viewer&&<AssetFileViewer asset={asset} file={viewer} onClose={()=>setViewer(null)} />}
  </MccCategoryAccordion>;
}

function PendingAttachmentChip({file,onRemove}:{file:File;onRemove:()=>void}) {
  const kind=fileKind({filename:file.name,mimeType:file.type});
  return <div className={`asset-attachment-chip glass-attachment kind-${kind}`}><span className={`asset-file-icon glass-file-icon glass-file-icon--${kind==='word'?'docx':kind}`} aria-hidden="true">{kind==='pdf'?'PDF':kind==='word'?'W':'IMG'}</span><span className="glass-attachment__copy"><strong>{file.name}</strong><small>{fileKindLabel({filename:file.name,mimeType:file.type})}{file.size?` · ${formatFileSize(file.size)}`:''}</small></span><button className="link-button compact-button glass-button glass-button--secondary" type="button" onClick={onRemove}>Remove</button></div>;
}
function AttachmentChip({attachment,canDelete,onOpen,onDownload,onDelete}:{attachment:AssetNoteAttachment;canDelete:boolean;onOpen:()=>void;onDownload:()=>void;onDelete:()=>void}) {
  const kind=fileKind(attachment);
  return <MccResourceRow className={`asset-attachment-chip glass-attachment kind-${kind}`} icon={<span className={`asset-file-icon glass-file-icon glass-file-icon--${kind==='word'?'docx':kind}`} aria-hidden="true">{kind==='pdf'?'PDF':kind==='word'?'W':'IMG'}</span>} title={attachment.filename} titleText={attachment.filename} metadata={<>{fileKindLabel(attachment)}{attachment.fileSize?` · ${formatFileSize(attachment.fileSize)}`:''}</>} onActivate={onOpen} activateLabel={`Open ${attachment.filename}`} actions={<MccActionGroup className="asset-attachment-actions"><button className="link-button compact-button glass-button glass-button--secondary" type="button" onClick={onDownload}>Download</button>{canDelete&&<MccOverflowMenu ariaLabel={`More actions for ${attachment.filename}`} items={[{label:'Delete',onSelect:onDelete,danger:true}]} />}</MccActionGroup>} />;
}
function AssetFileViewer({asset,file,onClose}:{asset:AssetIdentity;file:ViewerFile;onClose:()=>void}) {
  const kind=fileKind(file);
  const [fit,setFit]=useState(true);
  useEffect(()=>{function onKeyDown(event:KeyboardEvent){if(event.key==='Escape')onClose();}document.addEventListener('keydown',onKeyDown);return()=>document.removeEventListener('keydown',onKeyDown);},[onClose]);
  function printFile() {
    if(kind==='pdf') { window.open(file.contentUrl,'_blank','noopener,noreferrer'); return; }
    const printWindow=window.open('','_blank','width=1100,height=850');
    if(!printWindow) return;
    printWindow.document.write(`<!doctype html><html><head><title>${escapePrintHtml(file.filename)}</title><style>body{padding:28px;font-family:Arial,sans-serif;color:#10233a}header{border-bottom:3px solid #0b69b7;margin-bottom:20px;padding-bottom:12px}h1{font-size:22px;margin:0 0 5px}p{margin:4px 0}.image{display:flex;justify-content:center}.image img{max-width:100%;max-height:72vh;object-fit:contain}@media print{body{padding:10mm}}</style></head><body><header><h1>${escapePrintHtml(asset.assetNumber)}${asset.assetName?` - ${escapePrintHtml(asset.assetName)}`:''}</h1><p>${escapePrintHtml(file.filename)}</p><p>Generated ${escapePrintHtml(new Date().toLocaleString())}</p></header><div class="image"><img id="asset-note-print-image" src="${escapePrintHtml(file.contentUrl)}"></div></body></html>`);
    printWindow.document.close();
    const image=printWindow.document.getElementById('asset-note-print-image') as HTMLImageElement|null;
    const print=()=>{printWindow.focus();printWindow.print();};
    if(image?.complete)setTimeout(print,100);else image?.addEventListener('load',print,{once:true});
  }
  return createPortal(<div className="modal-backdrop inspection-record-viewer-backdrop glass-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><section className="mcc-card inspection-record-viewer glass-modal-shell mcc-full-view-dialog" role="dialog" aria-modal="true" aria-label={`${file.filename} viewer`}>
    <div className="modal-heading"><div><p className="eyebrow">{file.label}</p><h3>{file.filename}</h3></div><button className="link-button compact-button glass-button glass-button--secondary" type="button" onClick={onClose}>Close</button></div>
    <div className={`inspection-record-viewer-canvas${fit?' is-fit':' is-zoom'}`}>{kind==='image'?<img src={file.contentUrl} alt={file.filename} />:<object data={file.contentUrl} type="application/pdf" aria-label={file.filename}><p>Use Open Original to view this PDF.</p></object>}</div>
    <div className="modal-actions inspection-record-viewer-actions glass-modal__actions">{kind==='image'&&<button className="secondary-button glass-button glass-button--secondary" type="button" onClick={()=>setFit(current=>!current)}>{fit?'Zoom':'Fit Image'}</button>}<button className="secondary-button glass-button glass-button--secondary" type="button" onClick={()=>triggerDownload(file.downloadUrl,file.filename)}>Download</button><button className="secondary-button glass-button glass-button--secondary" type="button" onClick={printFile}>{kind==='image'?'Print / Save as PDF':'Print'}</button>{kind==='pdf'&&<button className="secondary-button glass-button glass-button--secondary" type="button" onClick={()=>window.open(file.contentUrl,'_blank','noopener,noreferrer')}>Open Original</button>}<button className="link-button glass-button glass-button--secondary" type="button" onClick={onClose}>Close</button></div>
  </section></div>,document.body);
}
