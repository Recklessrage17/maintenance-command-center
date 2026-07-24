import { type CSSProperties } from 'react';

const particles=[
  ['#4ce7a7','-34px','-28px','-18deg'],
  ['#dce7eb','-15px','-36px','24deg'],
  ['#f3c95a','6px','-38px','55deg'],
  ['#62efb5','26px','-28px','95deg'],
  ['#b9c9cf','35px','-8px','130deg'],
  ['#42d99b','28px','18px','170deg'],
  ['#f3c95a','8px','27px','205deg'],
  ['#dce7eb','-18px','24px','245deg'],
  ['#55e0aa','-34px','10px','285deg'],
] as const;

export function MccSuccessBurst({active}:{active:boolean}) {
  if(!active)return null;
  return <span className="mcc-success-burst" aria-hidden="true">{particles.map(([color,x,y,rotation],index)=><span key={index} style={{'--burst-color':color,'--burst-x':x,'--burst-y':y,'--burst-rotation':rotation} as CSSProperties}/>)}</span>;
}
