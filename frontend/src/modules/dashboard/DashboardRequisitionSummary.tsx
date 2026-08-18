import { MccPillCard } from '../../components/MccPills';

export type DashboardRequisitionView = 'active'|'requested'|'ordered';
type DashboardMetric = {view:DashboardRequisitionView;label:string;value:number;note:string;accentColor:string;variant:'info'|'warning'|'brand'};

export function DashboardRequisitionSummary({activeCount,requestedCount,orderedCount,onOpen}:{activeCount:number;requestedCount:number;orderedCount:number;onOpen:(view:DashboardRequisitionView)=>void}) {
  const metrics:DashboardMetric[]=[
    {view:'active',label:'Active Requisitions',value:activeCount,note:'Requested + ordered',accentColor:'#36e5d0',variant:'info'},
    {view:'requested',label:'Requested',value:requestedCount,note:'Waiting for order action',accentColor:'#f6be3f',variant:'warning'},
    {view:'ordered',label:'Ordered',value:orderedCount,note:'Ordered, not yet received',accentColor:'#7d8cff',variant:'brand'},
  ];
  return <div className="dashboard-metric-grid" aria-label="Requisition summary">{metrics.map(metric=><MccPillCard key={metric.view} className={`dashboard-metric-pill dashboard-metric-pill--${metric.view}`} variant={metric.variant} accentColor={metric.accentColor} onActivate={()=>onOpen(metric.view)} ariaLabel={`${metric.label}: ${metric.value}. Open ${metric.label.toLowerCase()} view`}>
    <span className="dashboard-metric-heading"><span className="dashboard-metric-label"><i aria-hidden="true"/>{metric.label}</span><span className="dashboard-metric-arrow" aria-hidden="true">&rarr;</span></span>
    <span className="dashboard-metric-value-row"><strong>{metric.value.toLocaleString()}</strong><span className="dashboard-metric-note">{metric.note}</span></span>
  </MccPillCard>)}</div>;
}
