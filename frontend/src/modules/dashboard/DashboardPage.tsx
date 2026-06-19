import { useEffect, useState } from 'react';

type HealthResponse = {
  ok: boolean;
  app: string;
  port: number;
};

type VersionResponse = {
  app: string;
  version: string;
  environment: string;
};

type BackendStatus = {
  health?: HealthResponse;
  version?: VersionResponse;
  isOnline: boolean;
  isLoading: boolean;
};

const dashboardCards = [
  { title: 'Open Work Orders', value: '0', note: 'Ready for work order module setup' },
  { title: 'PM Due Soon', value: '0', note: 'Preventive maintenance tracking placeholder' },
  { title: 'Inventory Alerts', value: 'Protected', note: 'MIT3 integration will be mounted later' },
  { title: 'Critical Assets', value: '0', note: 'Asset registry placeholder' },
];

const inventoryProtectionMessage = 'MIT3 protected. Inventory integration not mounted yet.';

export function DashboardPage() {
  const [backendStatus, setBackendStatus] = useState<BackendStatus>({
    isOnline: false,
    isLoading: true,
  });

  useEffect(() => {
    let isMounted = true;

    async function loadBackendStatus() {
      try {
        const [healthResponse, versionResponse] = await Promise.all([
          fetch('/api/health'),
          fetch('/api/version'),
        ]);

        if (!healthResponse.ok || !versionResponse.ok) {
          throw new Error('Backend status request failed.');
        }

        const [health, version] = (await Promise.all([
          healthResponse.json(),
          versionResponse.json(),
        ])) as [HealthResponse, VersionResponse];

        if (!isMounted) {
          return;
        }

        setBackendStatus({
          health,
          version,
          isOnline: Boolean(health.ok),
          isLoading: false,
        });
      } catch {
        if (!isMounted) {
          return;
        }

        setBackendStatus({
          isOnline: false,
          isLoading: false,
        });
      }
    }

    loadBackendStatus();

    return () => {
      isMounted = false;
    };
  }, []);

  const statusLabel = backendStatus.isLoading ? 'Checking...' : backendStatus.isOnline ? 'Online' : 'Offline';

  const liveStatusCards = [
    {
      title: 'MCC Backend Status',
      value: statusLabel,
      note: backendStatus.isOnline ? 'Backend health endpoint is reachable.' : 'Offline / Check backend.',
      isOnlineIndicator: true,
    },
    {
      title: 'MCC Version',
      value: backendStatus.version?.version ?? 'Unavailable',
      note: backendStatus.version?.app ?? 'Version endpoint is not reachable yet.',
    },
    {
      title: 'Local Port',
      value: String(backendStatus.health?.port ?? 4273),
      note: 'MCC website remains assigned to local port 4273.',
    },
    {
      title: 'Inventory Protection Status',
      value: 'Protected',
      note: inventoryProtectionMessage,
    },
  ];

  return (
    <div className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">Dashboard</p>
        <h2>Maintenance overview shell</h2>
        <p>Use this landing page as the future control room for plant maintenance activity.</p>
      </div>

      <section className="dashboard-section" aria-labelledby="live-backend-status-heading">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Live MCC Status</p>
            <h3 id="live-backend-status-heading">Backend connection</h3>
          </div>
          <span className={backendStatus.isOnline ? 'status-dot online' : 'status-dot offline'}>
            {statusLabel}
          </span>
        </div>
        <div className="card-grid">
          {liveStatusCards.map((card) => (
            <article className="mcc-card" key={card.title}>
              <span>{card.title}</span>
              <strong className={card.isOnlineIndicator && backendStatus.isOnline ? 'status-online' : undefined}>
                {card.value}
              </strong>
              <p>{card.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="dashboard-section" aria-labelledby="maintenance-snapshot-heading">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Maintenance Snapshot</p>
            <h3 id="maintenance-snapshot-heading">Module placeholders</h3>
          </div>
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
      </section>
    </div>
  );
}
