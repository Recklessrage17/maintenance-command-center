import { type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';

export type MccSemanticVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'contact' | 'link';

function interactiveDescendant(target: EventTarget | null, currentTarget: HTMLElement) {
  if (!(target instanceof Element) || target === currentTarget) return false;
  const interactiveElement = target.closest('a,button,input,select,textarea,label,summary,[role="button"],[role="link"],[data-mcc-card-control]');
  return Boolean(interactiveElement && interactiveElement !== currentTarget && currentTarget.contains(interactiveElement));
}

export function MccPillCard({children,onActivate,ariaLabel,accentColor='#44D7FF',variant='neutral',className=''}:{children:ReactNode;onActivate?:()=>void;ariaLabel?:string;accentColor?:string;variant?:MccSemanticVariant;className?:string}) {
  function activateFromClick(event: MouseEvent<HTMLElement>) {
    if (!onActivate || interactiveDescendant(event.target,event.currentTarget)) return;
    onActivate();
  }

  function activateFromKeyboard(event: KeyboardEvent<HTMLElement>) {
    if (!onActivate || event.target!==event.currentTarget || (event.key!=='Enter'&&event.key!==' ')) return;
    event.preventDefault();
    onActivate();
  }

  return <article
    className={`mcc-pill-card mcc-pill-card--${variant}${onActivate?' is-interactive':''}${className?` ${className}`:''}`}
    style={{'--mcc-pill-accent':accentColor} as CSSProperties}
    role={onActivate?'button':undefined}
    tabIndex={onActivate?0:undefined}
    aria-label={ariaLabel}
    onClick={activateFromClick}
    onKeyDown={activateFromKeyboard}
  >{children}</article>;
}

export function MccStatusPill({children,variant='neutral',className='',title}:{children:ReactNode;variant?:MccSemanticVariant;className?:string;title?:string}) {
  return <span className={`mcc-status-pill mcc-status-pill--${variant}${className?` ${className}`:''}`} title={title}>{children}</span>;
}

function ExternalLinkIcon() {
  return <svg className="mcc-link-pill-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M11.5 3.5h5v5M10 10l6.25-6.25M16 11.5v4a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4" /></svg>;
}

export function MccLinkPill({href,children,className='',title,ariaLabel,external=true,leadingIcon,externalIconPosition='trailing',appearance='standard'}:{href:string;children:ReactNode;className?:string;title?:string;ariaLabel?:string;external?:boolean;leadingIcon?:ReactNode;externalIconPosition?:'leading'|'trailing';appearance?:'standard'|'technical'}) {
  const externalIcon = external ? <ExternalLinkIcon /> : null;
  const leadingExternalIcon = externalIconPosition==='leading'&&externalIcon;
  return <a
    className={`mcc-link-pill mcc-link-pill--${appearance}${className?` ${className}`:''}`}
    href={href}
    target={external?'_blank':undefined}
    rel={external?'noopener noreferrer':undefined}
    title={title}
    aria-label={ariaLabel}
    onPointerDown={event=>event.stopPropagation()}
    onClick={event=>event.stopPropagation()}
    onAuxClick={event=>event.stopPropagation()}
    onKeyDown={event=>{
      event.stopPropagation();
      if (event.key !== ' ') return;
      event.preventDefault();
      event.currentTarget.click();
    }}
  >{leadingIcon}{appearance==='technical'&&leadingExternalIcon?<span className="mcc-link-pill-icon-pod">{leadingExternalIcon}</span>:leadingExternalIcon}{children}{externalIconPosition==='trailing'&&externalIcon}</a>;
}

export function MccMetricPill({label,value,className='',variant='neutral'}:{label:string;value:ReactNode;className?:string;variant?:MccSemanticVariant}) {
  return <div className={`mcc-metric-pill mcc-metric-pill--${variant}${className?` ${className}`:''}`}><span>{label}</span><strong>{value||'-'}</strong></div>;
}

export function MccContactPill({children,className=''}:{children:ReactNode;className?:string}) {
  return <span className={`mcc-contact-pill${className?` ${className}`:''}`}>{children}</span>;
}
