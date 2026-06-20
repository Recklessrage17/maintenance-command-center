import { useEffect, useMemo, useState } from 'react';

type RequisitionSummary = {
  requestedCount: number;
  orderedCount: number;
  receivedCount: number;
  canceledCount: number;
  activeCount: number;
};

const emptyRequisitionSummary: RequisitionSummary = {
  requestedCount: 0,
  orderedCount: 0,
  receivedCount: 0,
  canceledCount: 0,
  activeCount: 0,
};

const baseDashboardCards = [
  { title: 'Open Work Orders', value: '0', note: 'Ready for work order module setup' },
  { title: 'PM Due Soon', value: '0', note: 'Preventive maintenance tracking placeholder' },
  { title: 'Inventory Alerts', value: 'Native', note: 'MCC Native Inventory is daily-use now' },
  { title: 'Critical Assets', value: '0', note: 'Asset registry placeholder' },
];

export function DashboardPage() {
  const [requisitionSummary,setRequisitionSummary]=useState<RequisitionSummary>(emptyRequisitionSummary);

  useEffect(()=>{
    let mounted = true;
    fetch('/api/requisitions/summary',{credentials:'include'})
      .then(response=>response.ok ? response.json() : Promise.reject(new Error('Summary unavailable')))
      .then(data=>{
        if (!mounted) return;
        setRequisitionSummary({
          requestedCount: Number(data.requestedCount ?? 0),
          orderedCount: Number(data.orderedCount ?? 0),
          receivedCount: Number(data.receivedCount ?? 0),
          canceledCount: Number(data.canceledCount ?? 0),
          activeCount: Number(data.activeCount ?? 0),
        });
      })
      .catch(()=>{
        if (mounted) setRequisitionSummary(emptyRequisitionSummary);
      });
    return ()=>{ mounted = false; };
  },[]);

  const dashboardCards = useMemo(()=>[
    ...baseDashboardCards,
    { title: 'Active Requisitions', value: String(requisitionSummary.activeCount), note: 'Requested plus ordered native requisitions' },
    { title: 'Requested', value: String(requisitionSummary.requestedCount), note: 'Native requisitions waiting for order action' },
    { title: 'Ordered', value: String(requisitionSummary.orderedCount), note: 'Native requisitions ordered, not yet received' },
  ],[requisitionSummary]);

  return (
    <div className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">Dashboard</p>
        <h2>Maintenance overview shell</h2>
        <p>Use this landing page as the future control room for plant maintenance activity.</p>
      </div>
      <div className="card-grid">
        {dashboardCards.map((card) => (
          <article className="mcc-card" key={card.title}>
            <span>{card.title}</span>
            <strong>{card.value}</strong>
            <p>{card.note}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
