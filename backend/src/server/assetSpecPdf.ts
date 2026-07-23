import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from 'pdf-lib';

export type AssetSpecCondition = 'new' | 'used' | 'worn' | 'rebuilt_repaired';
export type AssetSpecMachine = {
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
  screwConditionStatus: AssetSpecCondition;
  barrelInstalledDate: string;
  barrelEndCapInstalledDate: string;
  barrelLength: string;
  barrelRebuildRepaired: boolean;
  barrelConditionStatus: AssetSpecCondition;
  hasDoubleShotInjection: boolean;
  screw2Type: string;
  screw2TipType: string;
  screw2InstalledDate: string;
  screw2TipInstalledDate: string;
  screw2Length: string;
  screw2RebuildRepaired: boolean;
  screw2ConditionStatus: AssetSpecCondition;
  barrel2Diameter: string;
  barrel2InstalledDate: string;
  barrel2EndCapInstalledDate: string;
  barrel2Length: string;
  barrel2RebuildRepaired: boolean;
  barrel2ConditionStatus: AssetSpecCondition;
  hasPlungerInjection: boolean;
  plungerType: string;
  plungerInstalledDate: string;
  plungerLength: string;
  plungerDiameter: string;
  plungerRebuildRepaired: boolean;
  plungerConditionStatus: AssetSpecCondition;
  plungerBarrelType: string;
  plungerBarrelInstalledDate: string;
  plungerBarrelEndCapInstalledDate: string;
  plungerBarrelLength: string;
  plungerBarrelDiameter: string;
  plungerBarrelRebuildRepaired: boolean;
  plungerBarrelConditionStatus: AssetSpecCondition;
};

export type AssetSpecPmTask = {
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

type PdfEntry = { label: string; value: string };
type PdfColors = ReturnType<typeof rgb>;

const pageWidth = 612;
const pageHeight = 792;
const margin = 27;
const footerTop = 31;
const contentWidth = pageWidth - margin * 2;
const dark = rgb(0.07,0.13,0.17);
const muted = rgb(0.28,0.38,0.43);
const border = rgb(0.47,0.58,0.63);
const pale = rgb(0.965,0.98,0.985);
const white = rgb(1,1,1);
const sectionColors = {
  blue: rgb(0.06,0.42,0.62),
  gold: rgb(0.86,0.64,0.18),
  violet: rgb(0.36,0.28,0.62),
  green: rgb(0.10,0.48,0.33),
};

function clean(value: unknown, fallback = 'Not recorded') {
  const text = String(value ?? '').replace(/\s+/g,' ').trim();
  return text || fallback;
}

function safeToken(value: string) {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,100) || 'Machine_Asset';
}

export function machineAssetSpecPdfFilename(assetNumber: string, generatedAt = new Date()) {
  const token = safeToken(assetNumber);
  const prefix = /^press/i.test(token) ? token : `Press${token}`;
  return `${prefix}_Machine_Asset_Specification_${generatedAt.toISOString().slice(0,10)}.pdf`;
}

function dateFromIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year,month - 1,day,12));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

function addMonths(value: Date, months: number) {
  const result = new Date(value.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const last = new Date(Date.UTC(result.getUTCFullYear(),result.getUTCMonth() + 1,0,12)).getUTCDate();
  result.setUTCDate(Math.min(day,last));
  return result;
}

export function assetSpecServiceAge(value: string, at = new Date()) {
  const start = dateFromIso(value);
  if (!start || Number.isNaN(at.getTime())) return '';
  const end = new Date(Date.UTC(at.getUTCFullYear(),at.getUTCMonth(),at.getUTCDate(),12));
  if (start.getTime() > end.getTime()) return '';
  let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  let cursor = addMonths(start,months);
  if (cursor.getTime() > end.getTime()) {
    months -= 1;
    cursor = addMonths(start,months);
  }
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  const days = Math.floor((end.getTime() - cursor.getTime()) / 86_400_000);
  const parts = [
    years ? `${years} ${years === 1 ? 'yr' : 'yrs'}` : '',
    remainingMonths ? `${remainingMonths} ${remainingMonths === 1 ? 'mo' : 'mos'}` : '',
    days || (!years && !remainingMonths) ? `${days} ${days === 1 ? 'day' : 'days'}` : '',
  ].filter(Boolean);
  return parts.join(' ');
}

function machineAge(value: string, at: Date) {
  if (!/^\d{4}$/.test(value.trim())) return 'Unknown';
  const age = at.getUTCFullYear() - Number(value);
  return age >= 0 && age < 300 ? `${age} ${age === 1 ? 'yr' : 'yrs'}` : 'Unknown';
}

function statusLabel(value: string) {
  return clean(value).replace(/[_-]+/g,' ').replace(/\b\w/g,letter=>letter.toUpperCase());
}

function conditionLabel(condition: AssetSpecCondition, rebuilt: boolean) {
  if (rebuilt) return 'Rebuilt / Repaired';
  return {new:'New',used:'Used',worn:'Worn',rebuilt_repaired:'Rebuilt / Repaired'}[condition] ?? 'Not recorded';
}

function installed(value: string, generatedAt: Date) {
  if (!dateFromIso(value)) return clean(value);
  const age = assetSpecServiceAge(value,generatedAt);
  return age ? `${value} (${age})` : value;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = clean(text).split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (font.widthOfTextAtSize(word,size) > maxWidth) {
      if (current) lines.push(current);
      let segment = '';
      for (const character of word) {
        const next = `${segment}${character}`;
        if (font.widthOfTextAtSize(next,size) <= maxWidth) segment = next;
        else {
          if (segment) lines.push(segment);
          segment = character;
        }
      }
      current = segment;
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next,size) <= maxWidth) current = next;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function pmInterval(task: AssetSpecPmTask) {
  const fixed: Record<string,string> = {bi_weekly:'Bi-weekly',quarterly:'Quarterly',bi_annual:'Bi-annual',annual:'Annual'};
  if (fixed[task.intervalType]) return fixed[task.intervalType];
  const units: Record<string,[string,string]> = {hourly:['hour','hours'],days:['day','days'],weekly:['week','weeks'],monthly:['month','months'],cycles:['cycle','cycles']};
  const amount = Number(task.intervalValue);
  const unit = units[task.intervalType];
  return unit && Number.isFinite(amount) ? `Every ${amount.toLocaleString()} ${amount === 1 ? unit[0] : unit[1]}` : clean(task.intervalLabel || task.intervalType);
}

function pmNextDue(task: AssetSpecPmTask) {
  if (task.nextDueDate) return task.nextDueDate;
  if (task.nextDueMeter !== null && Number.isFinite(Number(task.nextDueMeter))) return `${Number(task.nextDueMeter).toLocaleString()} ${task.intervalType === 'hourly' ? 'hours' : 'cycles'}`;
  return 'Not calculated';
}

export async function buildMachineAssetSpecPdf(asset: AssetSpecMachine, tasks: AssetSpecPmTask[], generatedAt = new Date()) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page!: PDFPage;
  let y = 0;
  let pageNumber = 0;

  const addPage = () => {
    page = pdf.addPage([pageWidth,pageHeight]);
    pageNumber += 1;
    page.drawRectangle({x:0,y:pageHeight - 55,width:pageWidth,height:55,color:rgb(0.90,0.96,0.98)});
    page.drawRectangle({x:0,y:pageHeight - 55,width:7,height:55,color:sectionColors.blue});
    page.drawText('MACHINE ASSET SPECIFICATION',{x:margin,y:pageHeight - 27,size:16,font:bold,color:dark});
    page.drawText(`${clean(asset.assetName,asset.assetNumber)}  |  Asset ${clean(asset.assetNumber)}`,{x:margin,y:pageHeight - 43,size:8,font:regular,color:muted});
    if (pageNumber > 1) page.drawText('Continued',{x:pageWidth - margin - 43,y:pageHeight - 31,size:8,font:bold,color:sectionColors.blue});
    y = pageHeight - 67;
    return page;
  };
  const ensure = (height: number) => {
    if (y - height < footerTop + 12) addPage();
  };
  const sectionHeader = (title: string, color: PdfColors, continued = false) => {
    ensure(24);
    page.drawRectangle({x:margin,y:y - 17,width:contentWidth,height:17,color});
    page.drawText(`${title}${continued ? ' (continued)' : ''}`,{x:margin + 7,y:y - 12,size:8.2,font:bold,color:white});
    y -= 20;
  };
  const drawGrid = (title: string, color: PdfColors, entries: PdfEntry[], columns: number) => {
    sectionHeader(title,color);
    const gap = 0;
    const cellWidth = (contentWidth - gap * (columns - 1)) / columns;
    for (let index = 0; index < entries.length; index += columns) {
      const row = entries.slice(index,index + columns);
      const lines = row.map(entry=>wrap(entry.value,regular,7.2,cellWidth - 12));
      const rowHeight = Math.max(25,...lines.map(value=>16 + value.length * 8));
      if (y - rowHeight < footerTop + 12) {
        addPage();
        sectionHeader(title,color,true);
      }
      row.forEach((entry,column)=>{
        const x = margin + column * (cellWidth + gap);
        page.drawRectangle({x,y:y - rowHeight,width:cellWidth,height:rowHeight,borderColor:border,borderWidth:.45,color:pale});
        page.drawText(entry.label.toUpperCase(),{x:x + 6,y:y - 9,size:5.8,font:bold,color:muted});
        lines[column].forEach((line,lineIndex)=>page.drawText(line,{x:x + 6,y:y - 19 - lineIndex * 8,size:7.2,font:regular,color:dark}));
      });
      for (let column = row.length; column < columns; column += 1) {
        const x = margin + column * (cellWidth + gap);
        page.drawRectangle({x,y:y - rowHeight,width:cellWidth,height:rowHeight,borderColor:border,borderWidth:.45,color:pale});
      }
      y -= rowHeight;
    }
    y -= 6;
  };
  const drawComponentRows = (rows: Array<{name:string;details:string}>) => {
    sectionHeader('Injection Components',sectionColors.violet);
    for (const row of rows) {
      const detailLines = wrap(row.details,regular,7,contentWidth - 108);
      const rowHeight = Math.max(23,10 + detailLines.length * 8);
      if (y - rowHeight < footerTop + 12) {
        addPage();
        sectionHeader('Injection Components',sectionColors.violet,true);
      }
      page.drawRectangle({x:margin,y:y - rowHeight,width:contentWidth,height:rowHeight,borderColor:border,borderWidth:.45,color:pale});
      page.drawText(row.name,{x:margin + 6,y:y - 14,size:7.5,font:bold,color:sectionColors.violet});
      detailLines.forEach((line,index)=>page.drawText(line,{x:margin + 102,y:y - 14 - index * 8,size:7,font:regular,color:dark}));
      y -= rowHeight;
    }
    y -= 6;
  };
  const drawPm = (activeTasks: AssetSpecPmTask[]) => {
    sectionHeader('Preventive Maintenance',sectionColors.green);
    if (!activeTasks.length) {
      ensure(23);
      page.drawRectangle({x:margin,y:y - 23,width:contentWidth,height:23,borderColor:border,borderWidth:.45,color:pale});
      page.drawText('No active preventive maintenance schedules.',{x:margin + 6,y:y - 15,size:7.2,font:regular,color:muted});
      y -= 29;
      return;
    }
    const widths = [225,112,116,105];
    const headings = ['Schedule','Interval','Next Due','Status'];
    const drawPmHeader = (continued = false) => {
      if (continued) sectionHeader('Preventive Maintenance',sectionColors.green,true);
      let x = margin;
      headings.forEach((heading,index)=>{
        page.drawRectangle({x,y:y - 16,width:widths[index],height:16,color:rgb(0.21,0.34,0.39),borderColor:border,borderWidth:.35});
        page.drawText(heading.toUpperCase(),{x:x + 5,y:y - 11,size:5.8,font:bold,color:white});
        x += widths[index];
      });
      y -= 16;
    };
    drawPmHeader();
    for (const task of activeTasks) {
      const values = [clean(task.title,'Untitled PM'),pmInterval(task),pmNextDue(task),clean(task.status,'Current')];
      const lineSets = values.map((value,index)=>wrap(value,regular,6.8,widths[index] - 10));
      const rowHeight = Math.max(22,...lineSets.map(lines=>8 + lines.length * 8));
      if (y - rowHeight < footerTop + 12) {
        addPage();
        drawPmHeader(true);
      }
      let x = margin;
      values.forEach((_value,index)=>{
        page.drawRectangle({x,y:y - rowHeight,width:widths[index],height:rowHeight,borderColor:border,borderWidth:.4,color:pale});
        lineSets[index].forEach((line,lineIndex)=>page.drawText(line,{x:x + 5,y:y - 14 - lineIndex * 8,size:6.8,font:index === 0 ? bold : regular,color:dark}));
        x += widths[index];
      });
      y -= rowHeight;
    }
    y -= 6;
  };

  addPage();
  page.drawText('WO# / Reference:',{x:margin,y:y - 12,size:7,font:bold,color:muted});
  page.drawLine({start:{x:margin + 82,y:y - 13},end:{x:pageWidth - margin,y:y - 13},thickness:.7,color:dark});
  y -= 25;

  const setup = clean(asset.setupType,asset.hasDoubleShotInjection ? 'Two-Shot / 2K Injection' : asset.hasPlungerInjection ? 'Plunger Injection' : 'Standard Injection');
  drawGrid('Asset Information',sectionColors.blue,[
    {label:'Asset Name',value:clean(asset.assetName,asset.assetNumber)},
    {label:'Asset Number',value:clean(asset.assetNumber)},
    {label:'Brand',value:clean(asset.brand)},
    {label:'Model',value:clean(asset.model)},
    {label:'Serial Number',value:clean(asset.serialNumber)},
    {label:'Machine Year / Age',value:`${clean(asset.machineYear)} / ${machineAge(asset.machineYear,generatedAt)}`},
    {label:'Setup Type',value:setup},
    {label:'Machine Type',value:clean(asset.machineType)},
    {label:'Location',value:clean(asset.location)},
    {label:'Status',value:statusLabel(asset.status)},
  ],2);
  drawGrid('Electrical / Dimensions',sectionColors.gold,[
    {label:'Power Type',value:clean(asset.powerType)},
    {label:'Voltage',value:asset.voltageValue ? `${asset.voltageValue} ${asset.voltageType}`.trim() : 'Not recorded'},
    {label:'Full Load Amp',value:clean(asset.fullLoadAmp)},
    {label:'Tonnage',value:Number(asset.tonnage) ? Number(asset.tonnage).toLocaleString() : 'Not recorded'},
    {label:'Shot Size',value:Number(asset.shotSizeOz) ? `${Number(asset.shotSizeOz).toLocaleString()} oz` : 'Not recorded'},
    {label:'Barrel / Screw Diameter',value:clean(asset.barrelDiameter)},
    {label:'Machine Length',value:clean(asset.machineLength)},
    {label:'Machine Width',value:clean(asset.machineWidth)},
    {label:'Machine Height',value:clean(asset.machineHeight)},
    {label:'Full Die Height / Range',value:clean(asset.fullDieHeightLength)},
  ],3);

  const componentRows: Array<{name:string;details:string}> = [
    {name:'Screw',details:`Condition: ${conditionLabel(asset.screwConditionStatus,asset.screwRebuildRepaired)} | Type: ${clean(asset.screwType)} | Length: ${clean(asset.screwLength)} | Installed: ${installed(asset.screwInstalledDate,generatedAt)}`},
    {name:'Screw Tip',details:`Type: ${clean(asset.screwTipType)} | Installed: ${installed(asset.screwTipInstalledDate,generatedAt)}`},
    {name:'Barrel',details:`Condition: ${conditionLabel(asset.barrelConditionStatus,asset.barrelRebuildRepaired)} | Diameter: ${clean(asset.barrelDiameter)} | Length: ${clean(asset.barrelLength)} | Installed: ${installed(asset.barrelInstalledDate,generatedAt)}`},
    {name:'Barrel End Cap',details:`Installed: ${installed(asset.barrelEndCapInstalledDate,generatedAt)}`},
  ];
  if (asset.hasDoubleShotInjection) componentRows.push(
    {name:'Screw 2',details:`Condition: ${conditionLabel(asset.screw2ConditionStatus,asset.screw2RebuildRepaired)} | Type: ${clean(asset.screw2Type)} | Length: ${clean(asset.screw2Length)} | Installed: ${installed(asset.screw2InstalledDate,generatedAt)}`},
    {name:'Screw 2 Tip',details:`Type: ${clean(asset.screw2TipType)} | Installed: ${installed(asset.screw2TipInstalledDate,generatedAt)}`},
    {name:'Barrel 2',details:`Condition: ${conditionLabel(asset.barrel2ConditionStatus,asset.barrel2RebuildRepaired)} | Diameter: ${clean(asset.barrel2Diameter)} | Length: ${clean(asset.barrel2Length)} | Installed: ${installed(asset.barrel2InstalledDate,generatedAt)}`},
    {name:'Barrel 2 End Cap',details:`Installed: ${installed(asset.barrel2EndCapInstalledDate,generatedAt)}`},
  );
  if (asset.hasPlungerInjection) componentRows.push(
    {name:'Plunger',details:`Condition: ${conditionLabel(asset.plungerConditionStatus,asset.plungerRebuildRepaired)} | Type: ${clean(asset.plungerType)} | Diameter: ${clean(asset.plungerDiameter)} | Length: ${clean(asset.plungerLength)} | Installed: ${installed(asset.plungerInstalledDate,generatedAt)}`},
    {name:'Plunger Barrel',details:`Condition: ${conditionLabel(asset.plungerBarrelConditionStatus,asset.plungerBarrelRebuildRepaired)} | Type: ${clean(asset.plungerBarrelType)} | Diameter: ${clean(asset.plungerBarrelDiameter)} | Length: ${clean(asset.plungerBarrelLength)} | Installed: ${installed(asset.plungerBarrelInstalledDate,generatedAt)}`},
    {name:'Plunger Barrel End Cap',details:`Installed: ${installed(asset.plungerBarrelEndCapInstalledDate,generatedAt)}`},
  );
  drawComponentRows(componentRows);
  drawPm(tasks.filter(task=>task.scheduleStatus !== 'inactive' && task.active !== false));

  const notesHeight = Math.min(96,y - footerTop - 18);
  if (notesHeight >= 42) {
    page.drawRectangle({x:margin,y:y - notesHeight,width:contentWidth * .55,height:notesHeight,borderColor:border,borderWidth:.55});
    page.drawText('TECHNICIAN NOTES',{x:margin + 6,y:y - 10,size:5.8,font:bold,color:muted});
    for (let lineY = y - 25; lineY > y - notesHeight + 7; lineY -= 13) {
      page.drawLine({start:{x:margin + 6,y:lineY},end:{x:margin + contentWidth * .55 - 6,y:lineY},thickness:.35,color:border});
    }
    const signatureX = margin + contentWidth * .55 + 7;
    const signatureWidth = contentWidth * .45 - 7;
    page.drawRectangle({x:signatureX,y:y - notesHeight,width:signatureWidth,height:notesHeight,borderColor:border,borderWidth:.55});
    page.drawText('TECHNICIAN SIGNATURE',{x:signatureX + 6,y:y - 10,size:5.8,font:bold,color:muted});
    page.drawLine({start:{x:signatureX + 6,y:y - 27},end:{x:signatureX + signatureWidth - 68,y:y - 27},thickness:.5,color:dark});
    page.drawText('DATE',{x:signatureX + signatureWidth - 61,y:y - 10,size:5.8,font:bold,color:muted});
    page.drawLine({start:{x:signatureX + signatureWidth - 61,y:y - 27},end:{x:signatureX + signatureWidth - 6,y:y - 27},thickness:.5,color:dark});
    if (notesHeight >= 60) {
      page.drawText('ADDITIONAL SIGN-OFF / COMMENTS',{x:signatureX + 6,y:y - 48,size:5.8,font:bold,color:muted});
      for (let lineY = y - 63; lineY > y - notesHeight + 7; lineY -= 13) {
        page.drawLine({start:{x:signatureX + 6,y:lineY},end:{x:signatureX + signatureWidth - 6,y:lineY},thickness:.35,color:border});
      }
    }
  }

  const pages = pdf.getPages();
  pages.forEach((item,index)=>{
    const generated = `Generated ${generatedAt.toLocaleString('en-US')}`;
    item.drawLine({start:{x:margin,y:footerTop},end:{x:pageWidth - margin,y:footerTop},thickness:.45,color:border});
    item.drawText(generated,{x:margin,y:18,size:6.5,font:regular,color:muted});
    const pageLabel = `Page ${index + 1} of ${pages.length}`;
    item.drawText(pageLabel,{x:pageWidth - margin - regular.widthOfTextAtSize(pageLabel,6.5),y:18,size:6.5,font:regular,color:muted});
  });
  return Buffer.from(await pdf.save());
}
