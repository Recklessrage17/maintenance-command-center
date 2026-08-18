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

export type PmStatusCounts = Record<PmStatus,number>;
export type PmAssetGroup = {
  key:string;library:PmLibrary;assetId:number;assetNumber:string;assetName:string;brand:string;accentColor:string;
  alerts:PmAlert[];counts:PmStatusCounts;
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

function assetAccent(alert:PmAlert,library:PmLibrary) {
  const configured=safeAccent(alert.assetAccentColor);
  if(configured)return configured;
  if(library==='machine')return machineBrandAccents[alert.brand.trim().toLowerCase()]??'#44D7FF';
  return hashedAccent(alert.assetCategory?.trim()||alert.brand.trim()||alert.assetNumber);
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

export function groupPmAlerts(alerts:PmAlert[],library:PmLibrary):PmAssetGroup[] {
  const groups=new Map<string,PmAssetGroup>();
  const matching=sortedAttentionAlerts(alerts).filter(alert=>(alert.assetLibrary??'machine')===library);
  for(const alert of matching){
    const key=`${library}:${alert.assetId}`;
    const existing=groups.get(key);
    if(existing){existing.alerts.push(alert);continue;}
    groups.set(key,{key,library,assetId:alert.assetId,assetNumber:alert.assetNumber,assetName:alert.assetName,brand:alert.brand,accentColor:assetAccent(alert,library),alerts:[alert],counts:pmStatusCounts([])});
  }
  return [...groups.values()].map(group=>({...group,alerts:group.alerts.sort(compareAttentionAlerts),counts:pmStatusCounts(group.alerts)}))
    .sort((left,right)=>compareAttentionAlerts(left.alerts[0],right.alerts[0])||left.assetNumber.localeCompare(right.assetNumber,undefined,{numeric:true,sensitivity:'base'})||left.assetId-right.assetId);
}
