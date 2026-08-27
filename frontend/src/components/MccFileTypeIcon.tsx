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

export function fileTypeIconLabel(filename:string){
  return iconLabel(fileTypeIconVariant(filename));
}

function iconLabel(type:MccFileTypeIconVariant){
  return type==='pdf'?'PDF':type==='word'?'DOC':type==='excel'?'XLS':type==='powerpoint'?'PPT':type==='text'?'TXT':type==='image'?'IMG':type==='video'?'VID':type==='archive'?'ZIP':type==='folder'?'Folder':'FILE';
}

export function MccFileTypeIcon({type,open=false,className=''}:{type:MccFileTypeIconVariant;open?:boolean;className?:string}) {
  const gradientId = `mcc-file-gradient-${useId().replace(/:/g,'')}`;
  const shadeId = `mcc-file-shade-${useId().replace(/:/g,'')}`;
  if(type==='folder')return <MccFolderIcon open={open} className={className}/>;

  const label=iconLabel(type);
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
      {type==='word'&&<><path className="mcc-file-type-icon__word-panel" d="M7.3 10.3h7.5v8.8H7.3z"/><text className="mcc-file-type-icon__word-mark" x="11.05" y="16.7" textAnchor="middle">W</text><path className="mcc-file-type-icon__lines" d="M16.6 12h3.4m-3.4 3h3.4m-3.4 3H19"/></>}
      {type==='excel'&&<><path className="mcc-file-type-icon__excel-panel" d="M7.2 10.3h6.7v8.8H7.2z"/><text className="mcc-file-type-icon__excel-mark" x="10.55" y="16.7" textAnchor="middle">X</text><path className="mcc-file-type-icon__grid" d="M15.4 10.8h5.1v7.8h-5.1zm0 2.6h5.1m-5.1 2.6h5.1m-2.55-5.2v7.8"/></>}
      {type==='text'&&<path className="mcc-file-type-icon__lines" d="M7.6 10.9h12.2M7.6 13.8h9.8M7.6 16.7h12.2M7.6 19.6h7.2"/>}
      {type==='pdf'&&<path className="mcc-file-type-icon__pdf-detail" d="M8.1 18.6c2.1-2.25 3.5-4.9 4.2-7.9.35 3.2 1.65 5.75 3.9 7.65-2.9-.95-5.45-.9-8.1.25Zm7.9-1.5c1.7-.25 3.05-.05 4.05.55"/>}
      {type==='powerpoint'&&<><circle className="mcc-file-type-icon__presentation-disc" cx="11.2" cy="14.75" r="4.45"/><path className="mcc-file-type-icon__presentation" d="M11.2 10.3v4.45h4.45M17.2 11h3.2v7.5h-3.2"/><text className="mcc-file-type-icon__powerpoint-mark" x="10.8" y="16.5" textAnchor="middle">P</text></>}
      {type==='image'&&<><rect className="mcc-file-type-icon__image-frame" x="7.3" y="10.1" width="13.4" height="9.2" rx="1"/><path className="mcc-file-type-icon__image" d="M8.5 18.1l3.15-3.5 2.25 2.05 2.7-3.45 2.9 4.9h-11Zm2.15-5.25a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Z"/></>}
      {type==='video'&&<><rect className="mcc-file-type-icon__video-frame" x="7.1" y="10.2" width="13.8" height="9" rx="1.2"/><path className="mcc-file-type-icon__video" d="m12.25 12.25 5 2.45-5 2.55Z"/></>}
      {type==='archive'&&<><path className="mcc-file-type-icon__archive-track" d="M12.2 9.7h5.6v10.1h-5.6z"/><path className="mcc-file-type-icon__archive" d="M12.4 10h2.5v2h-2.5zm2.5 2h2.5v2h-2.5zm-2.5 2h2.5v2h-2.5zm2.5 2h2.5v2h-2.5zm-1.6 2.2h3.4v1.4h-3.4z"/></>}
      {type==='generic'&&<><path className="mcc-file-type-icon__generic-mark" d="M8 10.6h11.8v8.7H8z"/><path className="mcc-file-type-icon__lines" d="M10 12.6h7.8M10 15h7.8M10 17.4h5.4"/></>}
      <path className="mcc-file-type-icon__band" fill={`url(#${shadeId})`} d="M2.15 20.1h25.7v9.2H2.15z"/>
      <path className="mcc-file-type-icon__band-highlight" d="M3.3 21.15h23.4"/>
      <text className="mcc-file-type-icon__label" x="15" y="26.75" textAnchor="middle">{label}</text>
    </svg>
  </span>;
}
