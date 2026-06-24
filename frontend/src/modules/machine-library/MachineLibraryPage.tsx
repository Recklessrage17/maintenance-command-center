const machineCards = [
  { title: 'Machine Assets', detail: 'Production machine assets and core machine records.' },
  { title: 'Preventive Maintenance', detail: 'Machine PM schedules, tasks, and completed history.' },
  { title: 'Linked Inventory Parts', detail: 'Parts tied back to production machine records.' },
  { title: 'Machine Documents', detail: 'Manuals, reference files, and machine documents.' },
];

// Future machine create/edit/remove and PM completion flows should call the backend history helper for this section.
export function MachineLibraryPage() {
  return (
    <div className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">Machine Library</p>
        <h2>Machine Library</h2>
        <p>Production machine records, PMs, parts, and documents.</p>
      </div>
      <div className="card-grid module-card-grid">
        {machineCards.map((card) => (
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
