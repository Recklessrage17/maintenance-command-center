const dashboardCards = [
  { title: 'Open Work Orders', value: '0', note: 'Ready for work order module setup' },
  { title: 'PM Due Soon', value: '0', note: 'Preventive maintenance tracking placeholder' },
  { title: 'Inventory Alerts', value: 'Protected', note: 'MIT3 integration will be mounted later' },
  { title: 'Critical Assets', value: '0', note: 'Asset registry placeholder' },
];

export function DashboardPage() {
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
