import { useId } from 'react';
import { MccFolderIcon } from './MccFolderIcon';

export type MccFileTypeIconVariant = 'pdf' | 'word' | 'excel' | 'text' | 'folder';

export function MccFileTypeIcon({type,open=false,className=''}:{type:MccFileTypeIconVariant;open?:boolean;className?:string}) {
  const gradientId = `mcc-file-gradient-${useId().replace(/:/g,'')}`;
  const shadeId = `mcc-file-shade-${useId().replace(/:/g,'')}`;
  if(type==='folder')return <MccFolderIcon open={open} className={className}/>;

  const label=type==='pdf'?'PDF':type==='word'?'DOC':type==='excel'?'XLS':'TXT';
  return <span className={`mcc-file-type-icon mcc-file-type-icon--${type}${className?` ${className}`:''}`} data-file-type={type} aria-hidden="true">
    <svg viewBox="0 0 30 36" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="4" y1="2" x2="25" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--mcc-file-highlight)"/>
          <stop offset=".56" stopColor="var(--mcc-file-accent)"/>
          <stop offset="1" stopColor="var(--mcc-file-deep)"/>
        </linearGradient>
        <linearGradient id={shadeId} x1="3" y1="19" x2="27" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--mcc-file-accent)"/>
          <stop offset="1" stopColor="var(--mcc-file-deep)"/>
        </linearGradient>
      </defs>
      <path className="mcc-file-type-icon__page" fill={`url(#${gradientId})`} d="M5.25 1.75h12.6l6.9 6.9v25.6H5.25a2 2 0 0 1-2-2V3.75a2 2 0 0 1 2-2Z"/>
      <path className="mcc-file-type-icon__page-highlight" d="M5.9 3.7h10.3"/>
      <path className="mcc-file-type-icon__fold" d="M17.85 1.75v6.9h6.9Z"/>
      {type==='word'&&<path className="mcc-file-type-icon__lines" d="M8 12h11.8M8 15.6h9.6"/>}
      {type==='excel'&&<path className="mcc-file-type-icon__grid" d="M8 11.7h11.8v5.7H8zM12 11.7v5.7M16 11.7v5.7M8 14.55h11.8"/>}
      {type==='text'&&<path className="mcc-file-type-icon__lines" d="M8 11.7h11.8M8 15.1h9.5M8 18.5h11.1"/>}
      {type==='pdf'&&<path className="mcc-file-type-icon__pdf-detail" d="M8 12.1h11.8M8 15.7h7.8"/>}
      <path className="mcc-file-type-icon__band" fill={`url(#${shadeId})`} d="M2.15 20.1h25.7v9.2H2.15z"/>
      <path className="mcc-file-type-icon__band-highlight" d="M3.3 21.15h23.4"/>
      <text className="mcc-file-type-icon__label" x="15" y="26.75" textAnchor="middle">{label}</text>
    </svg>
  </span>;
}
