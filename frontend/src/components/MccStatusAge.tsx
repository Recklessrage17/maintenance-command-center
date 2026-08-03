type WaitingRequisitionStatus = 'Requested' | 'Ordered';

function localDay(value:Date) {
  return new Date(value.getFullYear(),value.getMonth(),value.getDate());
}

function addCalendarMonths(value:Date,months:number) {
  const target=new Date(value.getFullYear(),value.getMonth()+months,1);
  const finalDay=new Date(target.getFullYear(),target.getMonth()+1,0).getDate();
  target.setDate(Math.min(value.getDate(),finalDay));
  return target;
}

function calendarDayDifference(start:Date,end:Date) {
  const startUtc=Date.UTC(start.getFullYear(),start.getMonth(),start.getDate());
  const endUtc=Date.UTC(end.getFullYear(),end.getMonth(),end.getDate());
  return Math.max(0,Math.floor((endUtc-startUtc)/86_400_000));
}

export function formatElapsedStatusAge(timestamp:string|null|undefined,now=new Date()) {
  if(!timestamp)return 'date unavailable';
  const parsed=new Date(timestamp);
  if(Number.isNaN(parsed.getTime())||Number.isNaN(now.getTime()))return 'date unavailable';
  const start=localDay(parsed);
  const end=localDay(now);
  if(start>end)return 'date unavailable';
  if(start.getTime()===end.getTime())return 'today';

  let totalMonths=(end.getFullYear()-start.getFullYear())*12+(end.getMonth()-start.getMonth());
  let monthAnchor=addCalendarMonths(start,totalMonths);
  if(monthAnchor>end){
    totalMonths-=1;
    monthAnchor=addCalendarMonths(start,totalMonths);
  }
  const years=Math.floor(totalMonths/12);
  const months=totalMonths%12;
  const days=calendarDayDifference(monthAnchor,end);
  if(years>0){
    const yearText=`${years} ${years===1?'yr':'yrs'}`;
    return months>0?`${yearText} ${months} ${months===1?'mo':'mos'} ago`:`${yearText} ago`;
  }
  if(months>0){
    const monthText=`${months} ${months===1?'mo':'mos'}`;
    return days>0?`${monthText} ${days} ${days===1?'day':'days'} ago`:`${monthText} ago`;
  }
  return `${days} ${days===1?'day':'days'} ago`;
}

export function MccStatusAge({status,timestamp,className=''}:{status:WaitingRequisitionStatus;timestamp:string|null|undefined;className?:string}) {
  return <span className={`mcc-status-age mcc-status-age--${status.toLowerCase()}${className?` ${className}`:''}`}>{status} {formatElapsedStatusAge(timestamp)}</span>;
}
