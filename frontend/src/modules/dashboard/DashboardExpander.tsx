/** Visual indicators only; the surrounding row or summary button owns interaction. */
function DashboardRoundControl({className,path}:{className:string;path:string}) {
  return <span className={`dashboard-round-control ${className}`} aria-hidden="true"><svg viewBox="0 0 20 20"><path d={path}/></svg></span>;
}

export function DashboardExpander({className=''}:{className?:string}) {
  return <DashboardRoundControl className={`dashboard-round-expander ${className}`} path="m5.5 7.5 4.5 4.5 4.5-4.5"/>;
}

export function DashboardTaskArrow() {
  return <DashboardRoundControl className="dashboard-pm-task-open" path="M5 10h9m-3.5-3.5L14 10l-3.5 3.5"/>;
}
