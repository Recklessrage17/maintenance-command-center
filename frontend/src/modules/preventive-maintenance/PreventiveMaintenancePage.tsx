const pmCards = ['Due Soon', 'Overdue', 'Completed History', 'PM Tasks'];

export function PreventiveMaintenancePage() {
  return (
    <div className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">Preventive Maintenance</p>
        <h2>PM planning</h2>
      </div>
      <div className="card-grid">
        {pmCards.map((card) => (
          <article className="mcc-card" key={card}>
            <span>{card}</span>
            <strong>Not configured</strong>
            <p>This section is reserved for future preventive maintenance workflows.</p>
          </article>
        ))}
      </div>
    </div>
  );
}
