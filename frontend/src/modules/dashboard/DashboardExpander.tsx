/** Shared visual indicator; the surrounding summary button owns interaction. */
export function DashboardExpander({className=''}:{className?:string}) {
  return <span className={`dashboard-round-expander ${className}`} aria-hidden="true"><svg viewBox="0 0 20 20"><path d="m5.5 7.5 4.5 4.5 4.5-4.5"/></svg></span>;
}
