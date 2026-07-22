export type MccFileTypeIconVariant = 'pdf' | 'word' | 'excel' | 'text' | 'folder';

export function MccFileTypeIcon({type,open=false,className=''}:{type:MccFileTypeIconVariant;open?:boolean;className?:string}) {
  if(type==='folder')return <span className={`mcc-file-type-icon mcc-file-type-icon--folder${open?' is-open':''}${className?` ${className}`:''}`} data-file-type="folder" data-state={open?'open':'closed'} aria-hidden="true">
    <svg viewBox="0 0 24 24" focusable="false">
      {open?<><path className="mcc-file-type-icon__folder-back" d="M3.25 8.25V6.8c0-1.05.85-1.9 1.9-1.9h4.1l1.85 2.05h7.75c1.05 0 1.9.85 1.9 1.9v1.05"/><path className="mcc-file-type-icon__folder-front" d="M4.15 9.45h16.7c.75 0 1.22.8.86 1.46l-3.7 6.75c-.34.62-.99 1.01-1.7 1.01H5.55a1.9 1.9 0 0 1-1.9-1.9v-6.82c0-.28.22-.5.5-.5Z"/></>:<><path className="mcc-file-type-icon__folder-back" d="M3.25 7.25c0-1.05.85-1.9 1.9-1.9h4.2l1.85 2.1h7.65c1.05 0 1.9.85 1.9 1.9v7.25c0 1.05-.85 1.9-1.9 1.9H5.15a1.9 1.9 0 0 1-1.9-1.9V7.25Z"/><path className="mcc-file-type-icon__folder-front" d="M3.55 9.2h16.9"/></>}
    </svg>
  </span>;

  const label=type==='pdf'?'PDF':type==='word'?'DOC':type==='excel'?'XLS':'TXT';
  return <span className={`mcc-file-type-icon mcc-file-type-icon--${type}${className?` ${className}`:''}`} data-file-type={type} aria-hidden="true">
    <svg viewBox="0 0 30 36" focusable="false">
      <path className="mcc-file-type-icon__page" d="M5.25 1.75h12.6l6.9 6.9v25.6H5.25a2 2 0 0 1-2-2V3.75a2 2 0 0 1 2-2Z"/>
      <path className="mcc-file-type-icon__fold" d="M17.85 1.75v6.9h6.9"/>
      {type==='excel'&&<path className="mcc-file-type-icon__grid" d="M8 12.2h11.8M8 16h11.8M12 11v6"/>}
      {type==='text'&&<path className="mcc-file-type-icon__lines" d="M8 11.8h11.8M8 15.2h9.5"/>}
      <path className="mcc-file-type-icon__band" d="M2.15 20.1h25.7v9.2H2.15z"/>
      <text className="mcc-file-type-icon__label" x="15" y="26.7" textAnchor="middle">{label}</text>
    </svg>
  </span>;
}
