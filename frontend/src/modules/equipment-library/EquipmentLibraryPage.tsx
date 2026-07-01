const equipmentCards = [
  { title: 'Equipment Assets', detail: 'Auxiliary and support equipment assets and records.' },
  { title: 'Preventive Maintenance', detail: 'Equipment PM schedules, tasks, and completed history.' },
  { title: 'Linked Inventory Parts', detail: 'Parts tied back to equipment records.' },
  { title: 'Equipment Documents', detail: 'Manuals, reference files, and equipment documents.' },
];

// Future equipment create/edit/remove and PM completion flows should call the backend history helper for this section.
export function EquipmentLibraryPage() {
  return (
    <div className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">Equipment Library</p>
        <h2>Equipment Library</h2>
        <p>Auxiliary and support equipment records, PMs, parts, and documents.</p>
      </div>
      <div className="card-grid module-card-grid">
        {equipmentCards.map((card) => (
          <article className="mcc-card module-shell-card" key={card.title}>
            <span>{card.title}</span>
            <strong>Ready</strong>
            <p>{card.detail}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
