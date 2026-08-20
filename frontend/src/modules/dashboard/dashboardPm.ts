export type PmStatus = 'Due Soon'|'Due Now'|'Past Due';
export type PmLibrary = 'machine'|'equipment';

export type PmAlert = {
  id:number;assetId:number;assetNumber:string;assetName:string;brand:string;model:string;serialNumber:string;
  assetLibrary?:PmLibrary;assetAccentColor?:string;assetCategory?:string;
  title:string;instructions:string;notes:string;intervalType:string;intervalLabel:string;intervalValue:number;
  status:PmStatus;relativeMessage:string;countdown:string;scheduleStatus:'active'|'hold'|'inactive';
  lastCompletedDate:string|null;lastCompletedMeter:number|null;currentMeter:number|null;nextDueDate:string|null;nextDueMeter:number|null;
  historyCount:number;createdAt:string;updatedAt:string;
};

export type WarningNote = {
  id:number;assetId:number;assetLibrary:PmLibrary;assetNumber:string;assetName:string;brand:string;model:string;serialNumber:string;location:string;
  assetAccentColor?:string;assetCategory?:string;title:string;noteDate:string;body:string;warning:true;workOrder?:string;status?:'active';createdBy:string;createdAt:string;updatedAt:string;
  pdfFilename:string;pdfUrl:string;pdfDownloadUrl:string;
};

export type PmStatusCounts = Record<PmStatus,number>;
export type PmAssetGroup = {
  key:string;library:PmLibrary;assetId:number;assetNumber:string;assetName:string;brand:string;accentColor:string;
  alerts:PmAlert[];warningNotes:WarningNote[];counts:PmStatusCounts;
};

export const pmStatusOrder:PmStatus[]=['Past Due','Due Now','Due Soon'];
const attentionStatuses=new Set<PmStatus>(pmStatusOrder);
const meterIntervals=new Set(['hourly','cycles']);
const statusRank:Record<PmStatus,number>={'Past Due':0,'Due Now':1,'Due Soon':2};
const equipmentAccentPalette=['#44D7FF','#38D7B3','#FFD45A','#8C7CFF','#FF7B72','#65C9FF','#F69D50'];
const machineBrandAccents:Record<string,string>={toyo:'#1E6BFF',engel:'#FFFFFF',arburg:'#38D7B3',husky:'#FFD45A',sodick:'#8C7CFF'};

function safeAccent(value:string|undefined) {
  const clean=String(value??'').trim();
  return /^#[0-9a-f]{6}$/i.test(clean)?clean:'';
}

function hashedAccent(value:string) {
  let hash=0;
  for(const character of value)hash=(hash*31+character.charCodeAt(0))>>>0;
  return equipmentAccentPalette[hash%equipmentAccentPalette.length];
}

function assetAccent(alert:Pick<PmAlert,'assetAccentColor'|'assetCategory'|'brand'|'assetNumber'>,library:PmLibrary) {
  const configured=safeAccent(alert.assetAccentColor);
  if(configured)return configured;
  if(library==='machine')return machineBrandAccents[alert.brand.trim().toLowerCase()]??'#44D7FF';
  return hashedAccent(alert.assetCategory?.trim()||alert.brand.trim()||alert.assetNumber);
}

export function relativeNoteAge(noteDate:string,createdAt:string,reference=new Date()) {
  const datePattern=/^\d{4}-\d{2}-\d{2}$/;
  let noteTime=datePattern.test(noteDate)?Date.parse(`${noteDate}T12:00:00Z`):Number.NaN;
  if(!Number.isFinite(noteTime)){const fallback=Date.parse(createdAt);noteTime=Number.isFinite(fallback)?fallback:reference.getTime();}
  const today=Date.UTC(reference.getUTCFullYear(),reference.getUTCMonth(),reference.getUTCDate(),12);
  const target=new Date(noteTime);const targetDay=Date.UTC(target.getUTCFullYear(),target.getUTCMonth(),target.getUTCDate(),12);
  const days=Math.round((today-targetDay)/86400000);
  if(days<0)return days===-1?'Tomorrow':`In ${Math.abs(days)} days`;
  if(days===0)return 'Today';
  if(days<14)return `${days} ${days===1?'day':'days'} old`;
  if(days<60){const weeks=Math.floor(days/7);return `${weeks} ${weeks===1?'week':'weeks'} old`;}
  if(days<730){const months=Math.floor(days/30);return `${months} ${months===1?'month':'months'} old`;}
  const years=Math.floor(days/365);return `${years} ${years===1?'year':'years'} old`;
}

export function pmSortDistance(alert:PmAlert) {
  if(meterIntervals.has(alert.intervalType)&&alert.nextDueMeter!==null&&alert.currentMeter!==null)return alert.nextDueMeter-alert.currentMeter;
  if(alert.nextDueDate)return Date.parse(`${alert.nextDueDate}T12:00:00Z`);
  return Number.MAX_SAFE_INTEGER;
}

export function compareAttentionAlerts(left:PmAlert,right:PmAlert) {
  return statusRank[left.status]-statusRank[right.status]
    ||pmSortDistance(left)-pmSortDistance(right)
    ||left.title.localeCompare(right.title,undefined,{numeric:true,sensitivity:'base'})
    ||left.id-right.id;
}

export function sortedAttentionAlerts(alerts:PmAlert[]) {
  return alerts.filter(alert=>attentionStatuses.has(alert.status)&&alert.scheduleStatus==='active').sort(compareAttentionAlerts);
}

export function pmStatusCounts(alerts:PmAlert[]):PmStatusCounts {
  return {
    'Due Soon':alerts.filter(alert=>alert.status==='Due Soon').length,
    'Due Now':alerts.filter(alert=>alert.status==='Due Now').length,
    'Past Due':alerts.filter(alert=>alert.status==='Past Due').length,
  };
}

export function groupPmAlerts(alerts:PmAlert[],library:PmLibrary,warningNotes:WarningNote[]=[]):PmAssetGroup[] {
  const groups=new Map<string,PmAssetGroup>();
  const matching=sortedAttentionAlerts(alerts).filter(alert=>(alert.assetLibrary??'machine')===library);
  for(const alert of matching){
    const key=`${library}:${alert.assetId}`;
    const existing=groups.get(key);
    if(existing){existing.alerts.push(alert);continue;}
    groups.set(key,{key,library,assetId:alert.assetId,assetNumber:alert.assetNumber,assetName:alert.assetName,brand:alert.brand,accentColor:assetAccent(alert,library),alerts:[alert],warningNotes:[],counts:pmStatusCounts([])});
  }
  for(const note of warningNotes.filter(note=>note.assetLibrary===library)){
    const key=`${library}:${note.assetId}`;const existing=groups.get(key);
    if(existing){existing.warningNotes.push(note);continue;}
    groups.set(key,{key,library,assetId:note.assetId,assetNumber:note.assetNumber,assetName:note.assetName,brand:note.brand,accentColor:assetAccent(note,library),alerts:[],warningNotes:[note],counts:pmStatusCounts([])});
  }
  return [...groups.values()].map(group=>({...group,alerts:group.alerts.sort(compareAttentionAlerts),warningNotes:group.warningNotes.sort((left,right)=>right.noteDate.localeCompare(left.noteDate)||right.createdAt.localeCompare(left.createdAt)||right.id-left.id),counts:pmStatusCounts(group.alerts)}))
    .sort((left,right)=>left.alerts.length&&right.alerts.length?compareAttentionAlerts(left.alerts[0],right.alerts[0]):left.alerts.length?-1:right.alerts.length?1:left.assetNumber.localeCompare(right.assetNumber,undefined,{numeric:true,sensitivity:'base'})||left.assetId-right.assetId);
}
