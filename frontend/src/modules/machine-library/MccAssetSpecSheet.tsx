import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { downloadAssetSpecPdf, formatMachineAge, formatServiceAge } from './assetSpecHelpers';

export type MccAssetSpecCondition = 'new' | 'used' | 'worn' | 'rebuilt_repaired';
export type MccAssetSpecAsset = {
  id: number;
  assetNumber: string;
  assetName: string;
  brand: string;
  model: string;
  serialNumber: string;
  machineYear: string;
  machineType: string;
  powerType: string;
  setupType: string;
  shotSizeOz: number;
  tonnage: number;
  barrelDiameter: string;
  location: string;
  status: string;
  voltageValue: string;
  voltageType: string;
  fullLoadAmp: string;
  machineLength: string;
  machineWidth: string;
  machineHeight: string;
  fullDieHeightLength: string;
  screwType: string;
  screwTipType: string;
  screwTipInstalledDate: string;
  screwInstalledDate: string;
  screwLength: string;
  screwRebuildRepaired: boolean;
  screwConditionStatus: MccAssetSpecCondition;
  barrelInstalledDate: string;
  barrelEndCapInstalledDate: string;
  barrelLength: string;
  barrelRebuildRepaired: boolean;
  barrelConditionStatus: MccAssetSpecCondition;
  hasDoubleShotInjection: boolean;
  screw2Type: string;
  screw2TipType: string;
  screw2InstalledDate: string;
  screw2TipInstalledDate: string;
  screw2Length: string;
  screw2RebuildRepaired: boolean;
  screw2ConditionStatus: MccAssetSpecCondition;
  barrel2Diameter: string;
  barrel2InstalledDate: string;
  barrel2EndCapInstalledDate: string;
  barrel2Length: string;
  barrel2RebuildRepaired: boolean;
  barrel2ConditionStatus: MccAssetSpecCondition;
  hasPlungerInjection: boolean;
  plungerType: string;
  plungerInstalledDate: string;
  plungerLength: string;
  plungerDiameter: string;
  plungerRebuildRepaired: boolean;
  plungerConditionStatus: MccAssetSpecCondition;
  plungerBarrelType: string;
  plungerBarrelInstalledDate: string;
  plungerBarrelEndCapInstalledDate: string;
  plungerBarrelLength: string;
  plungerBarrelDiameter: string;
  plungerBarrelRebuildRepaired: boolean;
  plungerBarrelConditionStatus: MccAssetSpecCondition;
};

export type MccAssetSpecPmTask = {
  id: number;
  title: string;
  intervalType: string;
  intervalLabel?: string;
  intervalValue: number;
  nextDueDate: string | null;
  nextDueMeter: number | null;
  scheduleStatus: 'active' | 'hold' | 'inactive';
  active: boolean;
  status: string;
};

const conditionLabels: Record<MccAssetSpecCondition, string> = {
  new: 'New',
  used: 'Used',
  worn: 'Worn',
  rebuilt_repaired: 'Rebuilt / Repaired',
};

function display(value: unknown, fallback = 'Not recorded') {
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0 ? value.toLocaleString() : fallback;
  const clean = String(value ?? '').trim();
  return clean || fallback;
}

function statusLabel(value: string) {
  return value.trim().replace(/[_-]+/g, ' ').replace(/\b\w/g, letter=>letter.toUpperCase()) || 'Not recorded';
}

function componentCondition(rebuilt: boolean, condition: MccAssetSpecCondition) {
  return rebuilt ? conditionLabels.rebuilt_repaired : conditionLabels[condition] ?? 'Not recorded';
}

function installedValue(value: string, generatedAt: Date) {
  const date = display(value);
  const age = formatServiceAge(value, generatedAt);
  return age ? `${date} (${age} in service)` : date;
}

function pmInterval(task: MccAssetSpecPmTask) {
  const fixed: Record<string, string> = { bi_weekly: 'Bi-weekly', quarterly: 'Quarterly', bi_annual: 'Bi-annual', annual: 'Annual' };
  if (fixed[task.intervalType]) return fixed[task.intervalType];
  const amount = Number(task.intervalValue);
  const units: Record<string, [string,string]> = {
    hourly: ['hour','hours'],
    days: ['day','days'],
    weekly: ['week','weeks'],
    monthly: ['month','months'],
    cycles: ['cycle','cycles'],
  };
  const unit = units[task.intervalType];
  if (unit && Number.isFinite(amount)) return `Every ${amount.toLocaleString()} ${amount === 1 ? unit[0] : unit[1]}`;
  return task.intervalLabel || statusLabel(task.intervalType);
}

function pmNextDue(task: MccAssetSpecPmTask) {
  if (task.nextDueDate) return task.nextDueDate;
  if (task.nextDueMeter !== null && Number.isFinite(Number(task.nextDueMeter))) {
    const unit = task.intervalType === 'hourly' ? 'hours' : 'cycles';
    return `${Number(task.nextDueMeter).toLocaleString()} ${unit}`;
  }
  return 'Not calculated';
}

function SpecField({label,value}:{label:string;value:ReactNode}) {
  return <div className="mcc-asset-spec-field"><span>{label}</span><strong>{value}</strong></div>;
}

export function MccSpecSection({title,accent='blue',children}:{title:string;accent?:'blue'|'gold'|'violet'|'orange'|'green';children:ReactNode}) {
  return <section className={`mcc-spec-section mcc-spec-section--${accent}`}>
    <h2>{title}</h2>
    {children}
  </section>;
}

function ComponentRow({name,condition,type,length,diameter,installedAt,generatedAt}:{name:string;condition?:string;type?:string;length?:string;diameter?:string;installedAt:string;generatedAt:Date}) {
  return <div className="mcc-asset-spec-component-row">
    <strong>{name}</strong>
    <span>{condition ? `Condition: ${condition}` : type ? `Type: ${display(type)}` : 'Component information'}</span>
    {condition && type && <span>Type: {display(type)}</span>}
    {length && <span>Length: {display(length)}</span>}
    {diameter && <span>Diameter: {display(diameter)}</span>}
    <span>Installed: {installedValue(installedAt,generatedAt)}</span>
  </div>;
}

export function MccAssetSpecSheet({asset,tasks,generatedAt=new Date(),showInjectionComponents=true}:{asset:MccAssetSpecAsset;tasks:MccAssetSpecPmTask[];generatedAt?:Date;showInjectionComponents?:boolean}) {
  const activeTasks = tasks.filter(task=>task.scheduleStatus !== 'inactive' && task.active !== false);
  const setupType = display(asset.setupType,asset.hasDoubleShotInjection ? 'Two-Shot / 2K Injection' : asset.hasPlungerInjection ? 'Plunger Injection' : 'Standard Injection');
  return <article className="mcc-asset-spec-sheet" data-testid="machine-asset-spec-sheet">
    <header className="mcc-asset-spec-header">
      <div><p>MCC maintenance reference</p><h1>Machine Asset Specification</h1></div>
      <div className="mcc-asset-spec-wo"><span>WO# / Reference</span><strong aria-label="Blank work order or reference line">&nbsp;</strong></div>
    </header>

    <div className="mcc-asset-spec-identity">
      <div><span>Asset</span><strong>{display(asset.assetName,asset.assetNumber)}</strong></div>
      <div><span>Asset Number</span><strong>{display(asset.assetNumber)}</strong></div>
    </div>

    <MccSpecSection title="Asset Information" accent="blue">
      <div className="mcc-asset-spec-grid">
        <SpecField label="Brand" value={display(asset.brand)} />
        <SpecField label="Model" value={display(asset.model)} />
        <SpecField label="Serial Number" value={display(asset.serialNumber)} />
        <SpecField label="Machine Year / Age" value={`${display(asset.machineYear)} / ${formatMachineAge(asset.machineYear,generatedAt)}`} />
        <SpecField label="Setup Type" value={setupType} />
        <SpecField label="Machine Type" value={display(asset.machineType)} />
        <SpecField label="Location" value={display(asset.location)} />
        <SpecField label="Status" value={statusLabel(asset.status)} />
      </div>
    </MccSpecSection>

    <MccSpecSection title="Electrical / Dimensions" accent="gold">
      <div className="mcc-asset-spec-grid mcc-asset-spec-grid--three">
        <SpecField label="Power Type" value={display(asset.powerType)} />
        <SpecField label="Voltage" value={asset.voltageValue ? `${asset.voltageValue} ${asset.voltageType}`.trim() : 'Not recorded'} />
        <SpecField label="Full Load Amp" value={display(asset.fullLoadAmp)} />
        <SpecField label="Tonnage" value={display(asset.tonnage)} />
        <SpecField label="Shot Size" value={asset.shotSizeOz ? `${asset.shotSizeOz.toLocaleString()} oz` : 'Not recorded'} />
        <SpecField label="Barrel / Screw Diameter" value={display(asset.barrelDiameter)} />
        <SpecField label="Machine Length" value={display(asset.machineLength)} />
        <SpecField label="Machine Width" value={display(asset.machineWidth)} />
        <SpecField label="Machine Height" value={display(asset.machineHeight)} />
        <SpecField label="Full Die Height / Range" value={display(asset.fullDieHeightLength)} />
      </div>
    </MccSpecSection>

    {showInjectionComponents && <MccSpecSection title="Injection Components" accent="violet">
      <div className="mcc-asset-spec-components">
        <ComponentRow name="Screw" condition={componentCondition(asset.screwRebuildRepaired,asset.screwConditionStatus)} type={asset.screwType} length={asset.screwLength} installedAt={asset.screwInstalledDate} generatedAt={generatedAt} />
        <ComponentRow name="Screw Tip" type={asset.screwTipType} installedAt={asset.screwTipInstalledDate} generatedAt={generatedAt} />
        <ComponentRow name="Barrel" condition={componentCondition(asset.barrelRebuildRepaired,asset.barrelConditionStatus)} diameter={asset.barrelDiameter} length={asset.barrelLength} installedAt={asset.barrelInstalledDate} generatedAt={generatedAt} />
        <ComponentRow name="Barrel End Cap" installedAt={asset.barrelEndCapInstalledDate} generatedAt={generatedAt} />
        {asset.hasDoubleShotInjection && <>
          <ComponentRow name="Screw 2" condition={componentCondition(asset.screw2RebuildRepaired,asset.screw2ConditionStatus)} type={asset.screw2Type} length={asset.screw2Length} installedAt={asset.screw2InstalledDate} generatedAt={generatedAt} />
          <ComponentRow name="Screw 2 Tip" type={asset.screw2TipType} installedAt={asset.screw2TipInstalledDate} generatedAt={generatedAt} />
          <ComponentRow name="Barrel 2" condition={componentCondition(asset.barrel2RebuildRepaired,asset.barrel2ConditionStatus)} diameter={asset.barrel2Diameter} length={asset.barrel2Length} installedAt={asset.barrel2InstalledDate} generatedAt={generatedAt} />
          <ComponentRow name="Barrel 2 End Cap" installedAt={asset.barrel2EndCapInstalledDate} generatedAt={generatedAt} />
        </>}
        {asset.hasPlungerInjection && <>
          <ComponentRow name="Plunger" condition={componentCondition(asset.plungerRebuildRepaired,asset.plungerConditionStatus)} type={asset.plungerType} diameter={asset.plungerDiameter} length={asset.plungerLength} installedAt={asset.plungerInstalledDate} generatedAt={generatedAt} />
          <ComponentRow name="Plunger Barrel" condition={componentCondition(asset.plungerBarrelRebuildRepaired,asset.plungerBarrelConditionStatus)} type={asset.plungerBarrelType} diameter={asset.plungerBarrelDiameter} length={asset.plungerBarrelLength} installedAt={asset.plungerBarrelInstalledDate} generatedAt={generatedAt} />
          <ComponentRow name="Plunger Barrel End Cap" installedAt={asset.plungerBarrelEndCapInstalledDate} generatedAt={generatedAt} />
        </>}
      </div>
    </MccSpecSection>}

    <MccSpecSection title="Preventive Maintenance" accent="green">
      {!activeTasks.length && <p className="mcc-asset-spec-empty">No active preventive maintenance schedules.</p>}
      {activeTasks.length > 0 && <div className="mcc-asset-spec-pm">
        <div className="mcc-asset-spec-pm-head"><span>Schedule</span><span>Interval</span><span>Next Due</span><span>Status</span></div>
        {activeTasks.map(task=><div className="mcc-asset-spec-pm-row" key={task.id}><strong>{display(task.title,'Untitled PM')}</strong><span>{pmInterval(task)}</span><span>{pmNextDue(task)}</span><span>{display(task.status,'Current')}</span></div>)}
      </div>}
    </MccSpecSection>

    <section className="mcc-asset-spec-notes">
      <div><span>Technician Notes</span><i /><i /></div>
      <div><span>Technician Signature</span><i /></div>
      <div><span>Date</span><i /></div>
    </section>

    <footer className="mcc-asset-spec-footer">
      <span>Generated {generatedAt.toLocaleString()}</span>
      <span>Page 1</span>
    </footer>
  </article>;
}

export function MachineAssetSpecPreview({asset,onClose}:{asset:MccAssetSpecAsset;onClose:()=>void}) {
  const [tasks,setTasks]=useState<MccAssetSpecPmTask[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [generatedAt,setGeneratedAt]=useState(()=>new Date());
  const titleId = `machine-asset-spec-title-${asset.id}`;
  useEffect(()=>{
    let current = true;
    setLoading(true);
    fetch(`/api/machine-library/assets/${asset.id}/preventive-maintenance`,{credentials:'include'})
      .then(async response=>{
        if (!response.ok) throw new Error((await response.json().catch(()=>({})) as {error?:string}).error || 'PM schedules could not be loaded.');
        return response.json() as Promise<MccAssetSpecPmTask[]>;
      })
      .then(data=>{if(current)setTasks(Array.isArray(data)?data:[]);})
      .catch(value=>{if(current)setError((value as Error).message||'PM schedules could not be loaded.');})
      .finally(()=>{if(current)setLoading(false);});
    return ()=>{current=false;};
  },[asset.id]);
  useEffect(()=>{
    function onKeyDown(event:KeyboardEvent){if(event.key==='Escape')onClose();}
    document.addEventListener('keydown',onKeyDown);
    return ()=>document.removeEventListener('keydown',onKeyDown);
  },[onClose]);
  const activeCount = useMemo(()=>tasks.filter(task=>task.scheduleStatus!=='inactive'&&task.active!==false).length,[tasks]);
  async function download() {
    setError('');
    try { await downloadAssetSpecPdf(asset.id,asset.assetNumber); }
    catch (value) { setError((value as Error).message); }
  }
  function print() {
    setGeneratedAt(new Date());
    window.setTimeout(()=>window.print(),0);
  }
  return createPortal(<div className="asset-spec-print-backdrop" role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <div className="mcc-asset-spec-preview-toolbar">
      <div><strong id={titleId}>Machine Asset Specification</strong><span>{asset.assetNumber} - {loading?'Loading PM schedules...':`${activeCount} active PM schedule${activeCount===1?'':'s'}`}</span></div>
      <div className="glass-button-group">
        <button className="primary-button compact-button glass-button glass-button--primary" type="button" onClick={print}>Print / Save as PDF</button>
        <button className="secondary-button compact-button glass-button glass-button--secondary" type="button" onClick={()=>void download()}>Download Spec PDF</button>
        <button className="link-button compact-button glass-button glass-button--secondary" type="button" onClick={onClose}>Close</button>
      </div>
      {error&&<p className="form-message error" role="alert">{error}</p>}
    </div>
    <div className="mcc-asset-spec-preview-scroll">
      <MccAssetSpecSheet asset={asset} tasks={tasks} generatedAt={generatedAt} />
    </div>
  </div>,document.body);
}
