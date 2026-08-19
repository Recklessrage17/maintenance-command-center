type MccAppLoadingProps = {
  progress: number;
  stage: string;
  error?: string;
  onRetry?: () => void;
};

export function MccAppLoading({ progress, stage, error = '', onRetry }: MccAppLoadingProps) {
  const percentage = Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <main className={`mcc-app-loading${error ? ' mcc-app-loading--error' : ''}`} aria-labelledby="mcc-app-loading-title">
      <div className="mcc-app-loading__atmosphere" aria-hidden="true">
        <span className="mcc-app-loading__grid" />
        <span className="mcc-app-loading__scan" />
      </div>
      <section className="mcc-app-loading__panel" aria-busy={!error}>
        <div className="mcc-app-loading__brand" aria-hidden="true">
          <span>MCC</span>
          <small>NODE / 01</small>
        </div>
        <p className="mcc-app-loading__eyebrow">Maintenance Command Center</p>
        <h1 id="mcc-app-loading-title">{error ? 'MCC initialization paused' : 'Loading MCC'}</h1>
        <p className="mcc-app-loading__stage" role={error ? 'alert' : 'status'} aria-live="polite">
          {error || stage}
        </p>
        <div
          className="mcc-app-loading__progress"
          role="progressbar"
          aria-label="MCC application readiness"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentage}
          aria-valuetext={error ? `Initialization stopped at ${percentage}%` : `${percentage}% ready`}
        >
          <span className="mcc-app-loading__progress-fill" style={{ width: `${percentage}%` }} />
        </div>
        <div className="mcc-app-loading__readout">
          <span>{error ? 'READINESS INTERRUPTED' : percentage === 100 ? 'SYSTEM READY' : 'INITIALIZING WORKSPACE'}</span>
          <strong>{percentage}%</strong>
        </div>
        {error && onRetry && <button className="mcc-app-loading__retry" type="button" onClick={onRetry}>Retry initialization</button>}
      </section>
    </main>
  );
}
