const facilityCards = [
  { title: 'Building Prints', detail: 'Building drawings, prints, and controlled facility references.' },
  { title: 'Facility Documents', detail: 'Maintenance department facility files and shared documents.' },
  { title: 'Utility Information', detail: 'Utility references and plant service information.' },
  { title: 'Plant Reference', detail: 'Plant layout and reference documents for later expansion.' },
];

export function FacilityInfoPage() {
  return (
    <div className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">Facility Info</p>
        <h2>Facility Info</h2>
        <p>Building prints, facility documents, and plant reference information.</p>
      </div>
      <div className="card-grid module-card-grid">
        {facilityCards.map((card) => (
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
