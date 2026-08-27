import { useId } from 'react';
import { MccFolderIcon } from './MccFolderIcon';

export type MccFileTypeIconVariant = 'pdf' | 'word' | 'excel' | 'powerpoint' | 'text' | 'image' | 'video' | 'archive' | 'generic' | 'folder';

const extensionTypes:Record<string,MccFileTypeIconVariant>={
  pdf:'pdf',
  doc:'word',docx:'word',
  xls:'excel',xlsx:'excel',csv:'excel',
  ppt:'powerpoint',pptx:'powerpoint',
  txt:'text',md:'text',
  png:'image',jpg:'image',jpeg:'image',gif:'image',webp:'image',bmp:'image',svg:'image',
  mp4:'video',webm:'video',
  zip:'archive',
};

export function fileTypeIconVariant(filename:string):MccFileTypeIconVariant{
  const cleanName=filename.trim().split(/[?#]/,1)[0];
  const match=/\.([^.\\/]+)$/.exec(cleanName);
  return match?extensionTypes[match[1].toLowerCase()]??'generic':'generic';
}

export function MccFileTypeIcon({type,open=false,className=''}:{type:MccFileTypeIconVariant;open?:boolean;className?:string}) {
  const gradientId = `mcc-file-gradient-${useId().replace(/:/g,'')}`;
  const shadeId = `mcc-file-shade-${useId().replace(/:/g,'')}`;
  if(type==='folder')return <MccFolderIcon open={open} className={className}/>;

  const label=type==='pdf'?'PDF':type==='word'?'DOC':type==='excel'?'XLS':type==='powerpoint'?'PPT':type==='text'?'TXT':type==='image'?'IMG':type==='video'?'VID':type==='archive'?'ZIP':'FILE';
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
      {type==='powerpoint'&&<path className="mcc-file-type-icon__presentation" d="M8 11.7h11.8v6.5H8zM13.9 11.7v6.5M10.2 15h3.7"/>}
      {type==='image'&&<path className="mcc-file-type-icon__image" d="M8 18.1l3.1-3.4 2.2 2.1 2.9-4 3.6 5.3H8Zm2.1-5.6a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z"/>}
      {type==='video'&&<path className="mcc-file-type-icon__video" d="M8 11.1h11.8v7.5H8zM12.7 13l3.5 1.85-3.5 1.85Z"/>}
      {type==='archive'&&<path className="mcc-file-type-icon__archive" d="M12.6 10.4h4.1v2.1h-4.1zm0 2.1h4.1v2.1h-4.1zm0 2.1h4.1v2.1h-4.1zm0 2.1h4.1v2.1h-4.1z"/>}
      {type==='generic'&&<path className="mcc-file-type-icon__lines" d="M8 12h11.8M8 15.6h11.8M8 19.2h7.4"/>}
      <path className="mcc-file-type-icon__band" fill={`url(#${shadeId})`} d="M2.15 20.1h25.7v9.2H2.15z"/>
      <path className="mcc-file-type-icon__band-highlight" d="M3.3 21.15h23.4"/>
      <text className="mcc-file-type-icon__label" x="15" y="26.75" textAnchor="middle">{label}</text>
    </svg>
  </span>;
}
