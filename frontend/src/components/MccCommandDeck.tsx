import { type CSSProperties } from 'react';
import { type MccSection } from '../layout/pageMetadata';
import { MaintenanceTeamControl } from './MaintenanceTeamRoster';
import { RoleBadge } from './RoleBadge';

export type MccCommandModule = {
  id: MccSection;
  label: string;
  microLabel: string;
};

const moduleAccents: Record<MccSection, { color: string; rgb: string }> = {
  dashboard: { color: '#44d7ff', rgb: '68, 215, 255' },
  inventory: { color: '#36c8ff', rgb: '54, 200, 255' },
  vendors: { color: '#8fb8d6', rgb: '143, 184, 214' },
  requisitions: { color: '#f0b354', rgb: '240, 179, 84' },
  history: { color: '#9b90c9', rgb: '155, 144, 201' },
  'machine-library': { color: '#a879ff', rgb: '168, 121, 255' },
  'equipment-library': { color: '#36d9a4', rgb: '54, 217, 164' },
  'facility-info': { color: '#db8752', rgb: '219, 135, 82' },
  users: { color: '#d56ab7', rgb: '213, 106, 183' },
  settings: { color: '#c8e2ed', rgb: '200, 226, 237' },
};

const moduleIconPaths: Record<MccSection, string[]> = {
  dashboard: ['M4 13a8 8 0 0 1 16 0', 'M12 13l4-4', 'M5 19h14'],
  inventory: ['M4 8l8-4 8 4-8 4-8-4z', 'M4 8v8l8 4 8-4V8', 'M12 12v8'],
  vendors: ['M5 8h6v11H5z', 'M13 5h6v14h-6z', 'M7 11h2', 'M15 9h2', 'M15 13h2'],
  requisitions: ['M7 3h7l4 4v14H7z', 'M14 3v5h5', 'M9 14l2 2 4-5'],
  history: ['M12 4a8 8 0 1 0 0 16a8 8 0 0 0 0-16z', 'M12 8v5l3 2'],
  'machine-library': ['M5 16h14', 'M7 16V9h10v7', 'M9 9V6h6v3', 'M9 12h2', 'M13 12h2'],
  'equipment-library': ['M5 9h14v9H5z', 'M9 9V7h6v2', 'M8 13h8'],
  'facility-info': ['M5 19V7l7-3 7 3v12', 'M9 19v-5h6v5', 'M8 10h1', 'M15 10h1'],
  users: ['M12 4l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V7z', 'M12 10a2 2 0 1 0 0-4a2 2 0 0 0 0 4z', 'M8.5 15a3.5 3.5 0 0 1 7 0'],
  settings: ['M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8z', 'M12 3v3', 'M12 18v3', 'M3 12h3', 'M18 12h3', 'M5.6 5.6l2.1 2.1', 'M16.3 16.3l2.1 2.1', 'M18.4 5.6l-2.1 2.1', 'M7.7 16.3l-2.1 2.1'],
};

function ModuleIcon({ section }: { section: MccSection }) {
  return (
    <svg className="mcc-command-module-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {moduleIconPaths[section].map(path=><path d={path} key={path} />)}
    </svg>
  );
}

export function MccIndustrialActionButton({
  children,
  tone,
  onClick,
}: {
  children: string;
  tone: 'password' | 'logout';
  onClick: () => void;
}) {
  return <button className={`mcc-industrial-action mcc-industrial-action--${tone}`} type="button" onClick={onClick}>{children}</button>;
}

export function MccUserCommandConsole({
  user,
  onTeamsOpenChange,
  onUpdatePassword,
  onLogout,
}: {
  user: { fullName: string; role: string; isOwnerAdmin?: boolean };
  onTeamsOpenChange: (open: boolean) => void;
  onUpdatePassword: () => void;
  onLogout: () => void;
}) {
  return (
    <section className="mcc-user-command-console command-menu-user" aria-label="Signed-in user command console">
      <div className="mcc-user-console-identity">
        <strong>{user.fullName}</strong>
        <span className="mcc-user-console-presence"><span aria-hidden="true">●</span> Online</span>
      </div>
      <div className="mcc-user-console-actions command-menu-user-actions">
        <RoleBadge role={user.role} isOwnerAdmin={user.isOwnerAdmin} compact />
        <MaintenanceTeamControl onOpenChange={onTeamsOpenChange} />
        <MccIndustrialActionButton tone="password" onClick={onUpdatePassword}>Update Password</MccIndustrialActionButton>
        <MccIndustrialActionButton tone="logout" onClick={onLogout}>Logout</MccIndustrialActionButton>
      </div>
    </section>
  );
}

export function MccCommandModuleTile({
  module,
  active,
  warping,
  onSelect,
  onPrefetch,
}: {
  module: MccCommandModule;
  active: boolean;
  warping: boolean;
  onSelect: () => void;
  onPrefetch?: () => void;
}) {
  const accent=moduleAccents[module.id];
  const style={
    '--mcc-module-accent':accent.color,
    '--mcc-module-accent-rgb':accent.rgb,
  } as CSSProperties;
  return (
    <button
      className={`mcc-command-module-tile${active?' is-active':''}${warping?' is-warping':''}`}
      style={style}
      onClick={onSelect}
      onPointerEnter={onPrefetch}
      onFocus={onPrefetch}
      type="button"
      role="menuitem"
      aria-current={active?'page':undefined}
      aria-busy={warping}
    >
      <span className="mcc-command-module-rail" aria-hidden="true" />
      <span className="mcc-command-module-icon-housing" aria-hidden="true"><ModuleIcon section={module.id} /></span>
      <span className="mcc-command-module-copy">
        <span className="mcc-command-module-name">{module.label}</span>
        <span className="mcc-command-module-label">{module.microLabel}</span>
      </span>
      {active
        ? <span className="mcc-command-module-active-marker"><span>Active</span><i aria-hidden="true" /></span>
        : <span className="mcc-command-module-chevron" aria-hidden="true">›</span>}
    </button>
  );
}

export function MccCommandDeck({
  id,
  modules,
  activeSection,
  warpingSection,
  user,
  onTeamsOpenChange,
  onUpdatePassword,
  onLogout,
  onSelect,
  onPrefetch,
}: {
  id: string;
  modules: MccCommandModule[];
  activeSection: MccSection;
  warpingSection: MccSection | null;
  user: { fullName: string; role: string; isOwnerAdmin?: boolean };
  onTeamsOpenChange: (open: boolean) => void;
  onUpdatePassword: () => void;
  onLogout: () => void;
  onSelect: (section: MccSection) => void;
  onPrefetch?: (section: MccSection) => void;
}) {
  const titleId=`${id}-title`;
  return (
    <nav className="mcc-command-deck command-menu" id={id} aria-labelledby={titleId}>
      <header className="mcc-command-deck-header command-menu-heading">
        <div className="mcc-command-deck-title command-menu-title">
          <span>COMMAND DECK</span>
          <h2 id={titleId}>Maintenance Command Center</h2>
        </div>
        <MccUserCommandConsole
          user={user}
          onTeamsOpenChange={onTeamsOpenChange}
          onUpdatePassword={onUpdatePassword}
          onLogout={onLogout}
        />
      </header>
      <div className="mcc-command-module-grid" role="menu">
        {modules.map(module=>(
          <MccCommandModuleTile
            key={module.id}
            module={module}
            active={module.id===activeSection}
            warping={module.id===warpingSection}
            onSelect={()=>onSelect(module.id)}
            onPrefetch={()=>onPrefetch?.(module.id)}
          />
        ))}
      </div>
    </nav>
  );
}
