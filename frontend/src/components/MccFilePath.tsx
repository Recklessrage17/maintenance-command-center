type FilePathValue=string|string[]|null|undefined;

export function filePathSegments(path:FilePathValue,rootLabel='Root'){
  const pathSegments=(Array.isArray(path)?path:path?.split(/\s*(?:>|\/|\\)\s*/u)??[])
    .map(segment=>segment.trim())
    .filter(Boolean);
  const root=rootLabel.trim()||'Root';
  return pathSegments[0]?.localeCompare(root,undefined,{sensitivity:'accent'})===0
    ? pathSegments
    : [root,...pathSegments];
}

export function MccFilePath({path,rootLabel='Root',className=''}:{path?:FilePathValue;rootLabel?:string;className?:string}){
  const segments=filePathSegments(path,rootLabel);
  const label=segments.join(' > ');
  return <span className={`mcc-file-path${className?` ${className}`:''}`} aria-label={`Folder path: ${label}`} title={label}>
    <svg className="mcc-file-path__branch" viewBox="0 0 16 16" focusable="false" aria-hidden="true"><path d="M3.25 2.25v6.5a3 3 0 0 0 3 3h6.5"/><circle cx="12.75" cy="11.75" r="1.25"/></svg>
    <span className="mcc-file-path__segments" aria-hidden="true">{segments.map((segment,index)=><span className="mcc-file-path__part" key={`${segment}-${index}`}>{index>0&&<span className="mcc-file-path__separator">{'\u203a'}</span>}<span className="mcc-file-path__segment">{segment}</span></span>)}</span>
  </span>;
}
