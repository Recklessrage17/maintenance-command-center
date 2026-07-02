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

type DashboardCard = { title: string; value: string; note: string };

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

  const dashboardCards = useMemo(()=>{
    const cards: DashboardCard[] = [];
    const openWorkOrders = 0;
    const pmDueSoon = 0;
    if (openWorkOrders > 0) cards.push({ title: 'Open Work Orders', value: String(openWorkOrders), note: 'Work orders ready for maintenance action' });
    if (pmDueSoon > 0) cards.push({ title: 'PM Due Soon', value: String(pmDueSoon), note: 'Preventive maintenance due soon' });
    if (requisitionSummary.activeCount > 0) cards.push({ title: 'Active Requisitions', value: String(requisitionSummary.activeCount), note: 'Requested plus ordered MCC requisitions' });
    if (requisitionSummary.requestedCount > 0) cards.push({ title: 'Requested', value: String(requisitionSummary.requestedCount), note: 'MCC requisitions waiting for order action' });
    if (requisitionSummary.orderedCount > 0) cards.push({ title: 'Ordered', value: String(requisitionSummary.orderedCount), note: 'MCC requisitions ordered, not yet received' });
    return cards;
  },[requisitionSummary]);

  return (
    <div className="page-stack">
      {dashboardCards.length>0 ? (
        <div className="card-grid dashboard-card-grid">
          {dashboardCards.map((card) => (
          <article className="mcc-card" key={card.title}>
            <span>{card.title}</span>
            <strong>{card.value}</strong>
            <p>{card.note}</p>
          </article>
          ))}
        </div>
      ) : (
        <article className="mcc-card dashboard-clear-card">
          <span>All clear</span>
          <strong>Maintenance dashboard is clear.</strong>
          <p>No active maintenance alerts right now.</p>
        </article>
      )}
    </div>
  );
}
