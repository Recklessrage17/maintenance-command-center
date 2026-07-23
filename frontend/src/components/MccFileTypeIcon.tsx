import { useId } from 'react';

export type MccFileTypeIconVariant = 'pdf' | 'word' | 'excel' | 'text' | 'folder';

export function MccFileTypeIcon({type,open=false,className=''}:{type:MccFileTypeIconVariant;open?:boolean;className?:string}) {
  const gradientId = `mcc-file-gradient-${useId().replace(/:/g,'')}`;
  const shadeId = `mcc-file-shade-${useId().replace(/:/g,'')}`;
  if(type==='folder')return <span className={`mcc-file-type-icon mcc-file-type-icon--folder${open?' is-open':''}${className?` ${className}`:''}`} data-file-type="folder" data-state={open?'open':'closed'} aria-hidden="true">
    <svg viewBox="0 0 24 24" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="4" y1="4" x2="19" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFD76A"/>
          <stop offset=".58" stopColor="#F3B72F"/>
          <stop offset="1" stopColor="#C88716"/>
        </linearGradient>
        <linearGradient id={shadeId} x1="4" y1="9" x2="18" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={open ? '#FFE28A' : '#FFD76A'}/>
          <stop offset=".64" stopColor={open ? '#F8C13E' : '#EAAA26'}/>
          <stop offset="1" stopColor="#C88716"/>
        </linearGradient>
      </defs>
      {open ? (
        <>
          <path className="mcc-file-type-icon__folder-back" fill={`url(#${gradientId})`} d="M3.2 8.8V6.7c0-1 .8-1.8 1.8-1.8h4.2l1.75 2.05H19c1 0 1.8.8 1.8 1.8v3.1H5.1c-1.05 0-1.9-.85-1.9-1.9V8.8Z"/>
          <path className="mcc-file-type-icon__folder-tab-highlight" d="M4.7 6.15h4.05l1.35 1.55"/>
          <path className="mcc-file-type-icon__folder-front" fill={`url(#${shadeId})`} d="M4.35 9.65h16.1c.8 0 1.3.85.91 1.55l-3.55 6.48a2.25 2.25 0 0 1-1.97 1.17H5.55a2.2 2.2 0 0 1-2.2-2.2v-5.99c0-.56.45-1.01 1-1.01Z"/>
          <path className="mcc-file-type-icon__folder-top-highlight" d="M5 10.8h14.4"/>
        </>
      ) : (
        <>
          <path className="mcc-file-type-icon__folder-back" fill={`url(#${gradientId})`} d="M3.2 7c0-1.05.85-1.9 1.9-1.9h4.15l1.78 2.08h7.87c1.05 0 1.9.85 1.9 1.9v7.42c0 1.05-.85 1.9-1.9 1.9H5.1a1.9 1.9 0 0 1-1.9-1.9V7Z"/>
          <path className="mcc-file-type-icon__folder-front" fill={`url(#${shadeId})`} d="M3.2 9.2h17.6v7.3c0 1.05-.85 1.9-1.9 1.9H5.1a1.9 1.9 0 0 1-1.9-1.9V9.2Z"/>
          <path className="mcc-file-type-icon__folder-tab-highlight" d="M4.75 6.3h3.95l1.3 1.5"/>
          <path className="mcc-file-type-icon__folder-top-highlight" d="M4.4 10.2h15.1"/>
        </>
      )}
      <path className="mcc-file-type-icon__folder-reflection" d={open ? 'M17.2 11.45h2.05' : 'M17.4 10.9h1.8'}/>
    </svg>
  </span>;

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
