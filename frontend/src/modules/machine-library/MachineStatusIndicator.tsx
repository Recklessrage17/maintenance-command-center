export function MachineStatusIndicator({ status }: { status: string }) {
  const active = status === 'active';
  const label = `Machine status: ${status ? status.toUpperCase() : 'UNKNOWN'}`;
  return <span className={`machine-detail-status${active ? ' is-active' : ''}`} role="status" aria-label={label} aria-atomic="true" title={label}>
    <span className="machine-detail-status-dot" aria-hidden="true" />
    <span className="sr-only">{label}</span>
  </span>;
}
