import { type CSSProperties, type ReactNode } from 'react';

type FolderTreeStyle=CSSProperties&{'--mcc-folder-depth':number};

export function MccFolderTreeItem({depth,open,className='',children}:{depth:number;open:boolean;className?:string;children:ReactNode}){
  const safeDepth=Math.max(0,Math.min(depth,12));
  return <div className="mcc-folder-tree-item" data-depth={safeDepth} data-state={open?'open':'closed'} style={{'--mcc-folder-depth':safeDepth} as FolderTreeStyle}>
    <section className={`${className}${open?' is-open':''}`}>{children}</section>
  </div>;
}

export function MccFolderTreeChevron({open}:{open:boolean}){
  return <span className="mcc-folder-tree-chevron" data-state={open?'open':'closed'}>
    <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true"><path d="m5.25 3.5 4.5 4.5-4.5 4.5"/></svg>
  </span>;
}
