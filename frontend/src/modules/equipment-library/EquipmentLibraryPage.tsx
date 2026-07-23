import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MccAccordionHeader, MccCategoryAccordion, type MccCategoryAccent } from '../../components/MccCategoryAccordion';
import { MccPillCard, MccStatusPill } from '../../components/MccPills';
import { MccSearchableCombobox } from '../../components/MccSearchableCombobox';
import { MccSummaryToken, MccSummaryTokenGroup } from '../../components/MccSummaryToken';
import { AssetDocumentLibrary } from '../machine-library/AssetDocumentLibrary';
import { AssetNotesAttachments } from '../machine-library/AssetNotesAttachments';
import { PreventiveMaintenanceTracking } from '../machine-library/PreventiveMaintenanceTracking';

type EquipmentStatus='active'|'down'|'disabled'|'removed';
type HistoryRecord={id:number;action:string;entityLabel:string;reasonNote:string;userName:string;createdAt:string;newValue?:Record<string,unknown>|null};
type PmSummary={total:number;status:string;label:string}|null;
type EquipmentAsset={
  id:number;assetNumber:string;equipmentName:string;assetName:string;category:string;equipmentType:string;manufacturer:string;brand:string;model:string;serialNumber:string;equipmentYear:string;year:string;location:string;department:string;status:EquipmentStatus;criticality:string;
  powerType:string;voltage:string;phase:string;amperage:string;airRequirement:string;waterRequirement:string;capacityRating:string;dimensions:string;weight:string;specificationNotes:string;createdAt:string;updatedAt:string;pmSummary?:PmSummary;latestHistory?:HistoryRecord|null;
};
type EquipmentDraft=Omit<EquipmentAsset,'id'|'assetName'|'brand'|'year'|'createdAt'|'updatedAt'|'pmSummary'|'latestHistory'> & {customCategory:string};
type EquipmentSection='basic'|'utilities'|'capacity';
type EquipmentResponse={ok:boolean;assets:EquipmentAsset[];categories:string[];permissions:{canEdit:boolean;canDelete:boolean}};

const categories=[
  'Dryer','Chiller','Air Compressor','Vacuum Pump','Blender','Material Loader','Granulator / Grinder','Mold Temperature Controller','Cooling Tower','Robot / Picker','Conveyor','Vision System','Leak Tester','Welder','Packaging Equipment','Water Treatment / Filtration','Electrical Panel / Transformer','HVAC','Toolroom Equipment','Forklift / Material Handling','Other / Custom',
] as const;
const standardCategories=new Set<string>(categories.filter(category=>category!=='Other / Custom'));
const emptyDraft:EquipmentDraft={assetNumber:'',equipmentName:'',category:'',customCategory:'',equipmentType:'',manufacturer:'',model:'',serialNumber:'',equipmentYear:'',location:'',department:'',status:'active',criticality:'',powerType:'',voltage:'',phase:'',amperage:'',airRequirement:'',waterRequirement:'',capacityRating:'',dimensions:'',weight:'',specificationNotes:''};

async function api<T>(url:string,options:RequestInit={}){
  const response=await fetch(url,{credentials:'include',headers:{...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),...(options.headers??{})},...options});
  const data=await response.json().catch(()=>({})) as T&{error?:string};
  if(!response.ok)throw new Error(data.error||'Request failed.');
  return data;
}
function assetToDraft(asset:EquipmentAsset):EquipmentDraft{
  const custom=!standardCategories.has(asset.category as typeof categories[number]);
  return {...emptyDraft,assetNumber:asset.assetNumber,equipmentName:asset.equipmentName,category:custom?'Other / Custom':asset.category,customCategory:custom?asset.category:'',equipmentType:asset.equipmentType,manufacturer:asset.manufacturer,model:asset.model,serialNumber:asset.serialNumber,equipmentYear:asset.equipmentYear,location:asset.location,department:asset.department,status:asset.status,criticality:asset.criticality,powerType:asset.powerType,voltage:asset.voltage,phase:asset.phase,amperage:asset.amperage,airRequirement:asset.airRequirement,waterRequirement:asset.waterRequirement,capacityRating:asset.capacityRating,dimensions:asset.dimensions,weight:asset.weight,specificationNotes:asset.specificationNotes};
}
function statusLabel(value:string){return value.replace(/[_-]+/g,' ').replace(/\b\w/g,letter=>letter.toUpperCase())||'Not Set';}
function display(value:unknown){const text=String(value??'').trim();return text||'Not Set';}
function equipmentAge(year:string){if(!/^\d{4}$/.test(year.trim()))return 'Not Set';const age=new Date().getFullYear()-Number(year);return age>=0&&age<250?`${age} ${age===1?'yr':'yrs'}`:'Not Set';}
function categoryAccent(category:string){const palette=['#44D7FF','#38D7B3','#FFD45A','#8C7CFF','#FF7B72','#65C9FF','#F69D50'];let hash=0;for(const character of category)hash=(hash*31+character.charCodeAt(0))>>>0;return palette[hash%palette.length];}
function historyAction(value:string){return value.replace(/_/g,' ').replace(/\b\w/g,letter=>letter.toUpperCase());}
function formatDateTime(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?value:date.toLocaleString();}

export function EquipmentLibraryPage(){
  const [assets,setAssets]=useState<EquipmentAsset[]>([]);
  const [permissions,setPermissions]=useState({canEdit:false,canDelete:false});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [search,setSearch]=useState('');
  const [categoryFilter,setCategoryFilter]=useState('');
  const [statusFilter,setStatusFilter]=useState('');
  const [detailAsset,setDetailAsset]=useState<EquipmentAsset|null>(null);
  const [createOpen,setCreateOpen]=useState(false);
  const [importMode,setImportMode]=useState<'add_new_only'|'upsert'>('add_new_only');
  const [importing,setImporting]=useState(false);
  const fileRef=useRef<HTMLInputElement>(null);

  async function load(){
    setLoading(true);setError('');
    try{const data=await api<EquipmentResponse>('/api/equipment-library/assets');setAssets(data.assets);setPermissions(data.permissions);if(detailAsset){const refreshed=data.assets.find(item=>item.id===detailAsset.id);if(refreshed)setDetailAsset(refreshed);}}
    catch(value){setError((value as Error).message||'Equipment Library could not be loaded.');}
    finally{setLoading(false);}
  }
  useEffect(()=>{void load();},[]);
  const filtered=useMemo(()=>{const query=search.trim().toLowerCase();return assets.filter(asset=>(!query||[asset.assetNumber,asset.equipmentName,asset.category,asset.equipmentType,asset.manufacturer,asset.model,asset.serialNumber,asset.location].some(value=>value.toLowerCase().includes(query)))&&(!categoryFilter||asset.category===categoryFilter)&&(!statusFilter||asset.status===statusFilter));},[assets,categoryFilter,search,statusFilter]);
  async function importFile(file:File){setImporting(true);setError('');setNotice('');try{const body=new FormData();body.append('file',file,file.name);body.append('importMode',importMode);const result=await api<{addedCount:number;updatedCount:number;skippedCount:number}>('/api/equipment-library/import',{method:'POST',body});setNotice(`Import complete: ${result.addedCount} added, ${result.updatedCount} updated, ${result.skippedCount} skipped.`);await load();}catch(value){setError((value as Error).message);}finally{setImporting(false);}}
  async function saved(asset:EquipmentAsset,message:string){setNotice(message);setCreateOpen(false);await load();setDetailAsset(asset);}

  if(detailAsset)return <EquipmentDetail asset={detailAsset} canEdit={permissions.canEdit} canDelete={permissions.canDelete} onBack={()=>{setDetailAsset(null);setNotice('');}} onUpdated={asset=>{setDetailAsset(asset);setAssets(current=>current.map(item=>item.id===asset.id?asset:item));}} onRemoved={async()=>{setDetailAsset(null);await load();}} />;
  return <div className="page-stack equipment-library-page mcc-glass-page">
    <section className="mcc-card glass-panel equipment-library-toolbar">
      <div className="equipment-library-search-row">
        <label className="form-field"><span>Search Equipment Library</span><input className="glass-input" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Asset #, name, category, brand, model, serial, location" /></label>
        <label className="form-field"><span>Category</span><select className="glass-input" value={categoryFilter} onChange={event=>setCategoryFilter(event.target.value)}><option value="">All categories</option>{[...new Set(assets.map(asset=>asset.category))].sort().map(category=><option key={category}>{category}</option>)}</select></label>
        <label className="form-field"><span>Status</span><select className="glass-input" value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="down">Down</option><option value="disabled">Disabled</option></select></label>
      </div>
      <div className="equipment-library-actions glass-button-group">
        <a className="secondary-button compact-button glass-button glass-button--secondary" href="/api/equipment-library/export" download>Export CSV</a>
        {permissions.canEdit&&<><a className="secondary-button compact-button glass-button glass-button--secondary" href="/api/equipment-library/export/template" download>Download Template</a><label className="equipment-import-mode">Import mode <select className="glass-input" value={importMode} onChange={event=>setImportMode(event.target.value as typeof importMode)}><option value="add_new_only">Add New Only</option><option value="upsert">Add + Update</option></select></label><button className="secondary-button compact-button glass-button glass-button--secondary" type="button" disabled={importing} onClick={()=>fileRef.current?.click()}>{importing?'Importing...':'Import CSV / XLSX'}</button><input ref={fileRef} hidden type="file" accept=".csv,.xlsx" onChange={event=>{const file=event.target.files?.[0];event.currentTarget.value='';if(file)void importFile(file);}}/><button className="primary-button compact-button glass-button glass-button--primary" type="button" onClick={()=>setCreateOpen(true)}>Add Equipment</button></>}
      </div>
    </section>
    {error&&<p className="form-message error" role="alert">{error}</p>}{notice&&<p className="form-message" role="status">{notice}</p>}
    <div className="equipment-library-count"><MccSummaryTokenGroup><MccSummaryToken tone="success">{filtered.length} equipment asset{filtered.length===1?'':'s'}</MccSummaryToken><MccSummaryToken>{assets.filter(asset=>asset.status==='active').length} active</MccSummaryToken></MccSummaryTokenGroup></div>
    {loading&&<div className="glass-empty-state">Loading Equipment Library...</div>}
    {!loading&&!filtered.length&&<div className="glass-empty-state"><strong>No equipment assets found.</strong><span>{assets.length?'Adjust the search or filters.':'Add the first general equipment asset.'}</span></div>}
    <div className="equipment-asset-grid">{filtered.map(asset=><EquipmentCard key={asset.id} asset={asset} onOpen={()=>setDetailAsset(asset)}/>)}</div>
    {createOpen&&<EquipmentFormModal title="Add Equipment Asset" draft={emptyDraft} onClose={()=>setCreateOpen(false)} onSaved={asset=>void saved(asset,`Equipment created: ${asset.assetNumber}`)} />}
  </div>;
}

function EquipmentCard({asset,onOpen}:{asset:EquipmentAsset;onOpen:()=>void}){
  const statusVariant=asset.status==='active'?'success':asset.status==='down'?'danger':'muted';
  return <MccPillCard className="equipment-asset-card" accentColor={categoryAccent(asset.category||asset.manufacturer)} variant={statusVariant} onActivate={onOpen} ariaLabel={`Open Equipment ${asset.assetNumber}, ${asset.equipmentName}`}>
    <div className="equipment-card-heading"><span className="equipment-card-number">{asset.assetNumber}</span><MccStatusPill variant={statusVariant}>{statusLabel(asset.status)}</MccStatusPill></div>
    <h3>{asset.equipmentName}</h3><p className="equipment-card-category">{display(asset.category)}{asset.equipmentType?` · ${asset.equipmentType}`:''}</p>
    <dl className="equipment-card-facts"><div><dt>Brand / Manufacturer</dt><dd>{display(asset.manufacturer)}</dd></div><div><dt>Model</dt><dd>{display(asset.model)}</dd></div><div><dt>Serial Number</dt><dd>{display(asset.serialNumber)}</dd></div><div><dt>Year / Age</dt><dd>{display(asset.equipmentYear)} / {equipmentAge(asset.equipmentYear)}</dd></div><div><dt>Location</dt><dd>{display(asset.location)}</dd></div></dl>
    {asset.pmSummary&&<span className={`equipment-card-pm pm-${asset.pmSummary.status}`}>{asset.pmSummary.label}</span>}
    <div className="equipment-card-history"><span>Newest history</span>{asset.latestHistory?<><strong>{historyAction(asset.latestHistory.action)}</strong><small>{formatDateTime(asset.latestHistory.createdAt)} · {asset.latestHistory.userName||'System'}</small></>:<small>No history recorded.</small>}</div>
  </MccPillCard>;
}

function EquipmentDetail({asset,canEdit,canDelete,onBack,onUpdated,onRemoved}:{asset:EquipmentAsset;canEdit:boolean;canDelete:boolean;onBack:()=>void;onUpdated:(asset:EquipmentAsset)=>void;onRemoved:()=>void}){
  const [current,setCurrent]=useState(asset);const [open,setOpen]=useState<EquipmentSection|null>('basic');const [editing,setEditing]=useState<EquipmentSection|null>(null);const [draft,setDraft]=useState(()=>assetToDraft(asset));const [saving,setSaving]=useState(false);const [error,setError]=useState('');const [history,setHistory]=useState<HistoryRecord[]>([]);const [historyOpen,setHistoryOpen]=useState(false);
  useEffect(()=>{setCurrent(asset);setDraft(assetToDraft(asset));},[asset]);
  useEffect(()=>{void api<{records:HistoryRecord[]}>(`/api/equipment-library/assets/${asset.id}/history`).then(data=>setHistory(data.records)).catch(()=>setHistory([]));},[asset.id]);
  function begin(section:EquipmentSection){setEditing(section);setOpen(section);setDraft(assetToDraft(current));setError('');}
  async function save(section:EquipmentSection){setSaving(true);setError('');try{const data=await api<{asset:EquipmentAsset}>(`/api/equipment-library/assets/${current.id}`,{method:'PUT',body:JSON.stringify(draft)});setCurrent(data.asset);setEditing(null);onUpdated(data.asset);}catch(value){setError((value as Error).message);}finally{setSaving(false);}}
  async function toggleDisabled(){const action=current.status==='disabled'?'enable':'disable';if(!window.confirm(`${action==='disable'?'Disable':'Enable'} ${current.assetNumber}?`))return;try{const data=await api<{asset:EquipmentAsset}>(`/api/equipment-library/assets/${current.id}/${action}`,{method:'POST',body:'{}'});setCurrent(data.asset);onUpdated(data.asset);}catch(value){setError((value as Error).message);}}
  async function remove(){const reason=window.prompt('Reason for removing this equipment asset:')?.trim();if(!reason)return;try{await api(`/api/equipment-library/assets/${current.id}`,{method:'DELETE',body:JSON.stringify({reasonNote:reason})});onRemoved();}catch(value){setError((value as Error).message);}}
  const sections:Array<{key:EquipmentSection;title:string;summary:string;accent:MccCategoryAccent;view:ReactNode;edit:ReactNode}>=[
    {key:'basic',title:'Basic Information',summary:`${display(current.category)} · ${display(current.manufacturer)} · ${display(current.location)}`,accent:'basic',view:<DetailGrid entries={[['Equipment Name',current.equipmentName],['Equipment Asset #',current.assetNumber],['Category',current.category],['Equipment Type',current.equipmentType],['Manufacturer / Brand',current.manufacturer],['Model',current.model],['Serial Number',current.serialNumber],['Year / Dynamic Age',`${display(current.equipmentYear)} / ${equipmentAge(current.equipmentYear)}`],['Location',current.location],['Department / Area',current.department],['Status',statusLabel(current.status)],['Criticality',statusLabel(current.criticality)]]}/>,edit:<BasicFields draft={draft} setDraft={setDraft}/>},
    {key:'utilities',title:'Electrical / Utility Requirements',summary:`${display(current.powerType)} · ${display(current.voltage)} · ${display(current.phase)}`,accent:'electrical',view:<DetailGrid entries={[['Power Type',current.powerType],['Voltage',current.voltage],['Phase',current.phase],['Amperage',current.amperage],['Air Requirement',current.airRequirement],['Water Requirement',current.waterRequirement]]}/>,edit:<UtilityFields draft={draft} setDraft={setDraft}/>},
    {key:'capacity',title:'Capacity / Dimensions',summary:`${display(current.capacityRating)} · ${display(current.dimensions)} · ${display(current.weight)}`,accent:'neutral',view:<DetailGrid entries={[['Capacity / Rating',current.capacityRating],['Dimensions',current.dimensions],['Weight',current.weight],['Equipment-Specific Specification Notes',current.specificationNotes]]}/>,edit:<CapacityFields draft={draft} setDraft={setDraft}/>},
  ];
  return <div className="page-stack equipment-detail-page machine-library-page is-detail-view">
    <header className="mcc-card glass-panel equipment-detail-header"><button className="secondary-button compact-button glass-button glass-button--secondary" type="button" onClick={onBack}>← Equipment Library</button><div><p className="eyebrow">Equipment Asset {current.assetNumber}</p><h2>{current.equipmentName}</h2><p>{display(current.category)} · {display(current.manufacturer)} · {display(current.location)}</p></div><div className="equipment-detail-actions"><a className="primary-button compact-button glass-button glass-button--primary" href={`/api/equipment-library/assets/${current.id}/specification.pdf?download=true`} download>Equipment Specification PDF</a>{canEdit&&<button className="secondary-button compact-button" type="button" onClick={()=>void toggleDisabled()}>{current.status==='disabled'?'Enable Equipment':'Disable Equipment'}</button>}{canDelete&&<button className="danger-button compact-button" type="button" onClick={()=>void remove()}>Remove</button>}</div></header>
    {error&&<p className="form-message error" role="alert">{error}</p>}
    <div className="machine-detail-accordion-list">{sections.map(section=>{const expanded=open===section.key;const isEditing=editing===section.key;return <MccCategoryAccordion key={section.key} accent={section.accent} expanded={expanded} editing={isEditing}><MccAccordionHeader title={section.title} summary={section.summary} expanded={expanded} controls={`equipment-${section.key}`} onToggle={()=>{if(!editing)setOpen(value=>value===section.key?null:section.key);}} actions={canEdit&&(isEditing?<div className="glass-button-group"><button className="secondary-button compact-button" type="button" disabled={saving} onClick={()=>{setEditing(null);setDraft(assetToDraft(current));}}>Cancel</button><button className="primary-button compact-button" type="button" disabled={saving} onClick={()=>void save(section.key)}>{saving?'Saving...':'Save'}</button></div>:<button className="secondary-button compact-button" type="button" onClick={()=>begin(section.key)}>Edit Mode</button>)}/><div className="machine-detail-accordion-panel" id={`equipment-${section.key}`} aria-hidden={!expanded}>{isEditing?<div className="equipment-edit-grid">{section.edit}</div>:section.view}</div></MccCategoryAccordion>;})}</div>
    <PreventiveMaintenanceTracking asset={{id:current.id,assetNumber:current.assetNumber,assetName:current.equipmentName}} canEdit={canEdit} library="equipment"/>
    <AssetDocumentLibrary asset={{id:current.id,assetNumber:current.assetNumber,assetName:current.equipmentName}} canEdit={canEdit} library="equipment"/>
    <AssetNotesAttachments asset={{id:current.id,assetNumber:current.assetNumber,assetName:current.equipmentName,brand:current.manufacturer,model:current.model,serialNumber:current.serialNumber}} canEdit={canEdit} library="equipment"/>
    <MccCategoryAccordion accent="inspection" expanded className="equipment-history-preview glass-panel glass-panel--nested"><MccAccordionHeader title="History Preview" summary={history.length?`${history.length} recorded action${history.length===1?'':'s'}`:'No history'} expanded actions={history.length>1?<button className="secondary-button compact-button" type="button" onClick={()=>setHistoryOpen(true)}>View Full History</button>:undefined}/><div className="machine-detail-accordion-panel">{history[0]?<HistoryItem item={history[0]}/>:<div className="glass-empty-state">No equipment history has been recorded.</div>}</div></MccCategoryAccordion>
    {historyOpen&&<HistoryModal records={history} onClose={()=>setHistoryOpen(false)}/>}
  </div>;
}

function DetailGrid({entries}:{entries:Array<[string,unknown]>}){return <dl className="equipment-detail-grid">{entries.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{display(value)}</dd></div>)}</dl>;}
function Field({label,value,onChange,required=false,wide=false}:{label:string;value:string;onChange:(value:string)=>void;required?:boolean;wide?:boolean}){return <label className={`form-field${wide?' equipment-field-wide':''}`}><span>{label}{required?' *':''}</span><input className="glass-input" value={value} onChange={event=>onChange(event.target.value)} required={required}/></label>;}
function SelectField({label,value,onChange,options}:{label:string;value:string;onChange:(value:string)=>void;options:Array<[string,string]>}){return <label className="form-field"><span>{label}</span><select className="glass-input" value={value} onChange={event=>onChange(event.target.value)}>{options.map(([key,text])=><option key={key} value={key}>{text}</option>)}</select></label>;}
function BasicFields({draft,setDraft}:{draft:EquipmentDraft;setDraft:(value:EquipmentDraft)=>void}){const set=<K extends keyof EquipmentDraft>(key:K,value:EquipmentDraft[K])=>setDraft({...draft,[key]:value});return <><Field label="Equipment Name" value={draft.equipmentName} onChange={value=>set('equipmentName',value)} required/><Field label="Equipment Asset #" value={draft.assetNumber} onChange={value=>set('assetNumber',value)} required/><MccSearchableCombobox label="Category *" value={draft.category} options={categories} onChange={value=>set('category',value)} required/>{draft.category==='Other / Custom'&&<Field label="Custom Category" value={draft.customCategory} onChange={value=>set('customCategory',value)} required/>}<Field label="Equipment Type" value={draft.equipmentType} onChange={value=>set('equipmentType',value)}/><Field label="Manufacturer / Brand" value={draft.manufacturer} onChange={value=>set('manufacturer',value)}/><Field label="Model" value={draft.model} onChange={value=>set('model',value)}/><Field label="Serial Number" value={draft.serialNumber} onChange={value=>set('serialNumber',value)}/><Field label="Year" value={draft.equipmentYear} onChange={value=>set('equipmentYear',value)}/><Field label="Location" value={draft.location} onChange={value=>set('location',value)}/><Field label="Department / Area" value={draft.department} onChange={value=>set('department',value)}/><SelectField label="Status" value={draft.status} onChange={value=>set('status',value as EquipmentStatus)} options={[['active','Active'],['down','Down'],['disabled','Disabled']]}/><SelectField label="Criticality" value={draft.criticality} onChange={value=>set('criticality',value)} options={[['','Not Set'],['low','Low'],['medium','Medium'],['high','High'],['critical','Critical']]}/></>;}
function UtilityFields({draft,setDraft}:{draft:EquipmentDraft;setDraft:(value:EquipmentDraft)=>void}){const set=(key:keyof EquipmentDraft,value:string)=>setDraft({...draft,[key]:value});return <><Field label="Power Type" value={draft.powerType} onChange={value=>set('powerType',value)}/><Field label="Voltage" value={draft.voltage} onChange={value=>set('voltage',value)}/><Field label="Phase" value={draft.phase} onChange={value=>set('phase',value)}/><Field label="Amperage" value={draft.amperage} onChange={value=>set('amperage',value)}/><Field label="Air Requirement" value={draft.airRequirement} onChange={value=>set('airRequirement',value)} wide/><Field label="Water Requirement" value={draft.waterRequirement} onChange={value=>set('waterRequirement',value)} wide/></>;}
function CapacityFields({draft,setDraft}:{draft:EquipmentDraft;setDraft:(value:EquipmentDraft)=>void}){const set=(key:keyof EquipmentDraft,value:string)=>setDraft({...draft,[key]:value});return <><Field label="Capacity / Rating" value={draft.capacityRating} onChange={value=>set('capacityRating',value)}/><Field label="Dimensions" value={draft.dimensions} onChange={value=>set('dimensions',value)}/><Field label="Weight" value={draft.weight} onChange={value=>set('weight',value)}/><label className="form-field equipment-field-wide"><span>Equipment-Specific Specification Notes</span><textarea className="glass-input" rows={5} value={draft.specificationNotes} onChange={event=>set('specificationNotes',event.target.value)}/></label></>;}

function EquipmentFormModal({title,draft:initial,onClose,onSaved}:{title:string;draft:EquipmentDraft;onClose:()=>void;onSaved:(asset:EquipmentAsset)=>void}){
  const [draft,setDraft]=useState(initial);const [saving,setSaving]=useState(false);const [error,setError]=useState('');
  async function submit(event:FormEvent){event.preventDefault();if(draft.category==='Other / Custom'&&!draft.customCategory.trim()){setError('Custom Category is required.');return;}setSaving(true);setError('');try{const data=await api<{asset:EquipmentAsset}>('/api/equipment-library/assets',{method:'POST',body:JSON.stringify(draft)});onSaved(data.asset);}catch(value){setError((value as Error).message);}finally{setSaving(false);}}
  return createPortal(<div className="modal-backdrop glass-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!saving)onClose();}}><section className="mcc-card glass-modal-shell equipment-form-modal mcc-wide-modal" role="dialog" aria-modal="true" aria-labelledby="equipment-form-title"><form onSubmit={submit}><div className="modal-heading"><div><p className="eyebrow">Equipment Library</p><h3 id="equipment-form-title">{title}</h3></div><button className="link-button compact-button" type="button" onClick={onClose} disabled={saving}>Close</button></div><div className="equipment-edit-grid"><BasicFields draft={draft} setDraft={setDraft}/><UtilityFields draft={draft} setDraft={setDraft}/><CapacityFields draft={draft} setDraft={setDraft}/></div>{error&&<p className="form-message error" role="alert">{error}</p>}<div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving?'Saving...':'Create Equipment'}</button></div></form></section></div>,document.body);
}
function HistoryItem({item}:{item:HistoryRecord}){return <article className="equipment-history-item"><div><strong>{historyAction(item.action)}</strong><span>{formatDateTime(item.createdAt)}</span></div><p>{item.reasonNote||'No reason note provided.'}</p><small>{item.userName||'System'}</small></article>;}
function HistoryModal({records,onClose}:{records:HistoryRecord[];onClose:()=>void}){return createPortal(<div className="modal-backdrop glass-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><section className="mcc-card glass-modal-shell mcc-wide-modal equipment-history-modal" role="dialog" aria-modal="true" aria-label="Full Equipment History"><div className="modal-heading"><div><p className="eyebrow">Equipment Library</p><h3>Full History</h3></div><button className="link-button compact-button" type="button" onClick={onClose}>Close</button></div><div className="equipment-history-list">{records.map(item=><HistoryItem key={item.id} item={item}/>)}</div></section></div>,document.body);}
