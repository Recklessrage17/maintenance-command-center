const assetCards = ['Machines', 'Auxiliary Equipment', 'Linked PMs', 'Linked Documents'];

export function AssetsPage() {
  return (
    <div className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">Assets</p>
        <h2>Asset command center</h2>
      </div>
      <div className="card-grid">
        {assetCards.map((card) => (
          <article className="mcc-card" key={card}>
            <span>{card}</span>
            <strong>Ready</strong>
            <p>Ready for future asset records and maintenance links.</p>
          </article>
        ))}
      </div>
    </div>
  );
}
