import { type ReactNode, useEffect, useRef, useState } from 'react';

export type MccOverflowMenuItem = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
};

type ResourceRowProps = {
  icon: ReactNode;
  title: ReactNode;
  titleText?: string;
  metadata?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  trailingContent?: ReactNode;
  className?: string;
  onActivate?: () => void;
  activateLabel?: string;
  expanded?: boolean;
  controls?: string;
};

/*
 * MCC resource-row guardrail:
 * - expose no more than two visible primary actions; put remaining actions in More
 * - verify desktop, tablet, and 390px mobile layouts
 * - action groups wrap horizontally; vertical action towers are not acceptable
 */
export function MccResourceRow({icon,title,titleText,metadata,description,actions,trailingContent,className='',onActivate,activateLabel,expanded,controls}:ResourceRowProps) {
  const content=<><span className="mcc-resource-row__icon">{icon}</span><span className="mcc-resource-row__copy"><strong className="mcc-resource-row__title" title={titleText}>{title}</strong>{metadata&&<span className="mcc-resource-row__metadata">{metadata}</span>}{description&&<span className="mcc-resource-row__description">{description}</span>}</span>{trailingContent&&<span className="mcc-resource-row__trailing" aria-hidden="true">{trailingContent}</span>}</>;
  return <div className={`mcc-resource-row${onActivate?' is-activatable':''}${className?` ${className}`:''}`}>
    {onActivate?<button className="mcc-resource-row__content" type="button" onClick={onActivate} aria-label={activateLabel} aria-expanded={expanded} aria-controls={controls}>{content}</button>:<div className="mcc-resource-row__content">{content}</div>}
    {actions&&<div className="mcc-resource-row__actions">{actions}</div>}
  </div>;
}

export function MccActionGroup({children,className='',align='end'}:{children:ReactNode;className?:string;align?:'start'|'end'}) {
  return <div className={`mcc-action-group mcc-action-group--${align}${className?` ${className}`:''}`}>{children}</div>;
}

export function MccOverflowMenu({items,label='More',ariaLabel,className=''}:{items:MccOverflowMenuItem[];label?:string;ariaLabel?:string;className?:string}) {
  const [open,setOpen]=useState(false);
  const rootRef=useRef<HTMLDivElement>(null);
  const triggerRef=useRef<HTMLButtonElement>(null);

  useEffect(()=>{
    if(!open)return;
    function onPointerDown(event:PointerEvent){if(!rootRef.current?.contains(event.target as Node))setOpen(false);}
    function onKeyDown(event:KeyboardEvent){if(event.key!=='Escape')return;setOpen(false);triggerRef.current?.focus();}
    document.addEventListener('pointerdown',onPointerDown);
    document.addEventListener('keydown',onKeyDown);
    return()=>{document.removeEventListener('pointerdown',onPointerDown);document.removeEventListener('keydown',onKeyDown);};
  },[open]);

  if(!items.length)return null;
  return <div className={`mcc-overflow-menu${open?' is-open':''}${className?` ${className}`:''}`} ref={rootRef} onClick={event=>event.stopPropagation()} onPointerDown={event=>event.stopPropagation()}>
    <button ref={triggerRef} className="secondary-button compact-button glass-button glass-button--secondary mcc-overflow-menu__trigger" type="button" aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel??label} onClick={()=>setOpen(current=>!current)}>{label}<span aria-hidden="true">&#9662;</span></button>
    {open&&<div className="mcc-overflow-menu__panel" role="menu" aria-label={ariaLabel??label}>{items.map(item=><button className={`mcc-overflow-menu__item${item.danger?' is-danger':''}`} type="button" role="menuitem" disabled={item.disabled} key={item.label} onClick={()=>{setOpen(false);item.onSelect();}}>{item.label}</button>)}</div>}
  </div>;
}

export function MccResponsiveToolbar({children,className=''}:{children:ReactNode;className?:string}) {
  return <div className={`mcc-responsive-toolbar${className?` ${className}`:''}`}>{children}</div>;
}
