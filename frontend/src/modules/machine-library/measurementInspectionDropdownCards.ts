export {};

const PANEL_SELECTOR = '.measurement-log-panel';
const READY_ATTR = 'data-measurement-action-menu-ready';
const RECORDS_ICON = `
  <svg class="measurement-records-svg" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <rect x="10" y="11" width="24" height="30" rx="4" fill="none" stroke="currentColor" stroke-width="2.6" />
    <rect x="15" y="7" width="24" height="30" rx="4" fill="rgba(68, 215, 255, .12)" stroke="currentColor" stroke-width="2.6" />
    <path d="M21 16H33M21 22H33M21 28H30" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" />
    <path d="M15 13H10V41H31V37" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity=".55" />
  </svg>
`;

function triggerClick(panel: HTMLElement, selector: string) {
  const button = panel.querySelector<HTMLButtonElement>(selector);
  if (!button) {
    window.alert('This action is still loading. Try again in a second.');
    return;
  }
  button.click();
}

function closeAllMenus() {
  document.querySelectorAll<HTMLElement>('.measurement-action-menu-open').forEach(menu => {
    menu.classList.remove('measurement-action-menu-open');
  });
}

function setMenuOpen(menu: HTMLElement, open: boolean) {
  closeAllMenus();
  if (open) menu.classList.add('measurement-action-menu-open');
}

function buildActionMenu(panel: HTMLElement) {
  const importCard = panel.querySelector<HTMLElement>('.measurement-log-import-card');
  if (!importCard || importCard.getAttribute(READY_ATTR) === 'true') return;

  const uploadButton = importCard.querySelector<HTMLButtonElement>('[data-measurement-upload]');
  const backupButton = importCard.querySelector<HTMLButtonElement>('[data-backup-measurement-data]');
  const printBlankButton = importCard.querySelector<HTMLButtonElement>('[data-print-blank-form]');
  const updateFormButton = importCard.querySelector<HTMLButtonElement>('[data-update-blank-form]');
  if (!uploadButton || !backupButton || !printBlankButton || !updateFormButton) return;

  importCard.setAttribute(READY_ATTR, 'true');
  importCard.insertAdjacentHTML('beforeend', `
    <div class="measurement-action-launcher-wrap">
      <button class="measurement-action-launcher" type="button" aria-expanded="false" aria-label="Open measurement inspection record actions">
        <span class="measurement-action-launcher-icon">${RECORDS_ICON}</span>
        <span class="measurement-action-launcher-text">
          <strong>Records</strong>
          <small>Upload • Backup • Blank Form</small>
        </span>
        <span class="measurement-action-launcher-chevron">v</span>
      </button>
      <div class="measurement-action-popover" role="menu" aria-label="Measurement inspection actions">
        <div class="measurement-action-popover-heading">
          <span>${RECORDS_ICON}</span>
          <div>
            <strong>Measurement Records</strong>
            <small>Screw & Barrel files and blank form</small>
          </div>
        </div>
        <div class="measurement-action-grid">
          <button type="button" class="measurement-action-item" data-menu-upload><span>＋</span><strong>Upload File</strong><small>Add completed record</small></button>
          <button type="button" class="measurement-action-item backup" data-menu-backup><span>⬇</span><strong>Backup Data</strong><small>Export saved records</small></button>
          <button type="button" class="measurement-action-item" data-menu-print-blank><span>⎙</span><strong>Print Blank Form</strong><small>Open blank sheet</small></button>
          <button type="button" class="measurement-action-item" data-menu-update-form><span>↻</span><strong>Update Form</strong><small>Replace blank sheet</small></button>
        </div>
      </div>
    </div>
  `);

  const wrap = importCard.querySelector<HTMLElement>('.measurement-action-launcher-wrap');
  const launcher = importCard.querySelector<HTMLButtonElement>('.measurement-action-launcher');
  if (!wrap || !launcher) return;

  launcher.addEventListener('click', event => {
    event.stopPropagation();
    const isOpen = wrap.classList.contains('measurement-action-menu-open');
    setMenuOpen(wrap, !isOpen);
    launcher.setAttribute('aria-expanded', String(!isOpen));
  });

  importCard.querySelector<HTMLButtonElement>('[data-menu-upload]')?.addEventListener('click', () => triggerClick(panel, '[data-measurement-upload]'));
  importCard.querySelector<HTMLButtonElement>('[data-menu-backup]')?.addEventListener('click', () => triggerClick(panel, '[data-backup-measurement-data]'));
  importCard.querySelector<HTMLButtonElement>('[data-menu-print-blank]')?.addEventListener('click', () => triggerClick(panel, '[data-print-blank-form]'));
  importCard.querySelector<HTMLButtonElement>('[data-menu-update-form]')?.addEventListener('click', () => triggerClick(panel, '[data-update-blank-form]'));
}

function refreshActionMenus() {
  document.querySelectorAll<HTMLElement>(PANEL_SELECTOR).forEach(buildActionMenu);
}

function injectStyles() {
  if (document.getElementById('measurement-action-menu-styles')) return;
  const style = document.createElement('style');
  style.id = 'measurement-action-menu-styles';
  style.textContent = `
    .measurement-log-panel .measurement-log-shell {
      grid-template-columns: 132px minmax(420px, 1fr) !important;
      align-items: start;
    }
    .measurement-log-import-card {
      align-items: center !important;
      display: flex !important;
      justify-content: center !important;
      min-height: 142px !important;
      overflow: visible !important;
      padding: 12px !important;
      position: relative;
    }
    .measurement-log-import-card > *:not(.measurement-action-launcher-wrap),
    .measurement-log-import-card .measurement-mini-card,
    .measurement-log-import-card .measurement-template-card,
    .measurement-log-import-card .measurement-records-mini-section {
      display: none !important;
    }
    .measurement-action-launcher-wrap {
      position: relative;
      width: 100%;
      z-index: 4;
    }
    .measurement-action-launcher {
      align-items: center;
      background: linear-gradient(145deg, rgba(6, 35, 48, .96), rgba(3, 13, 24, .98));
      border: 1px solid rgba(68, 215, 255, .34);
      border-radius: 18px;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.04), 0 12px 28px rgba(0,0,0,.22);
      color: #f3fbff;
      cursor: pointer;
      display: grid;
      gap: 8px;
      justify-items: center;
      min-height: 116px;
      padding: 12px 8px;
      text-align: center;
      width: 100%;
    }
    .measurement-action-launcher:hover {
      border-color: #44d7ff;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.04), 0 0 20px rgba(68,215,255,.16);
    }
    .measurement-action-launcher-icon {
      align-items: center;
      background: radial-gradient(circle at 30% 20%, rgba(134, 241, 255, .2), rgba(68, 215, 255, .1));
      border: 1px solid rgba(68, 215, 255, .44);
      border-radius: 16px;
      color: #86f1ff;
      display: inline-flex;
      height: 48px;
      justify-content: center;
      width: 48px;
    }
    .measurement-records-svg {
      display: block;
      height: 31px;
      width: 31px;
      filter: drop-shadow(0 0 6px rgba(68, 215, 255, .22));
    }
    .measurement-action-launcher-text strong {
      color: #f3fbff;
      display: block;
      font-size: .86rem;
      font-weight: 950;
      line-height: 1;
      text-transform: uppercase;
    }
    .measurement-action-launcher-text small {
      color: #a8c7d5;
      display: block;
      font-size: .58rem;
      font-weight: 850;
      line-height: 1.1;
      margin-top: 5px;
    }
    .measurement-action-launcher-chevron {
      color: #8ff1ff;
      font-size: .76rem;
      font-weight: 950;
    }
    .measurement-action-popover {
      background: linear-gradient(145deg, rgba(3, 17, 29, .98), rgba(1, 7, 14, .98));
      border: 1px solid rgba(68, 215, 255, .34);
      border-radius: 18px;
      box-shadow: 0 22px 60px rgba(0,0,0,.44), 0 0 26px rgba(68,215,255,.12);
      display: none;
      left: calc(100% + 12px);
      min-width: 345px;
      padding: 14px;
      position: absolute;
      top: 0;
      z-index: 50;
    }
    .measurement-action-menu-open .measurement-action-popover {
      display: block;
    }
    .measurement-action-popover-heading {
      align-items: center;
      border-bottom: 1px solid rgba(68, 215, 255, .16);
      display: grid;
      gap: 10px;
      grid-template-columns: auto 1fr;
      padding-bottom: 10px;
    }
    .measurement-action-popover-heading > span {
      align-items: center;
      background: rgba(68, 215, 255, .14);
      border: 1px solid rgba(68, 215, 255, .38);
      border-radius: 13px;
      color: #86f1ff;
      display: inline-flex;
      height: 40px;
      justify-content: center;
      width: 40px;
    }
    .measurement-action-popover-heading .measurement-records-svg {
      height: 26px;
      width: 26px;
    }
    .measurement-action-popover-heading strong {
      color: #f3fbff;
      display: block;
      font-size: .9rem;
      font-weight: 950;
    }
    .measurement-action-popover-heading small {
      color: #a8c7d5;
      display: block;
      font-size: .68rem;
      font-weight: 850;
      margin-top: 3px;
    }
    .measurement-action-grid {
      display: grid;
      gap: 9px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      padding-top: 12px;
    }
    .measurement-action-item {
      align-items: start;
      background: rgba(4, 18, 34, .78);
      border: 1px solid rgba(68, 215, 255, .22);
      border-radius: 13px;
      color: #f3fbff;
      cursor: pointer;
      display: grid;
      gap: 4px;
      min-height: 86px;
      padding: 11px;
      text-align: left;
    }
    .measurement-action-item:hover {
      border-color: #44d7ff;
      background: rgba(7, 35, 50, .92);
    }
    .measurement-action-item span {
      color: #86f1ff;
      font-size: 1rem;
      font-weight: 950;
    }
    .measurement-action-item strong {
      font-size: .78rem;
      font-weight: 950;
    }
    .measurement-action-item small {
      color: #a8c7d5;
      font-size: .62rem;
      font-weight: 850;
      line-height: 1.1;
    }
    .measurement-action-item.backup {
      border-color: rgba(255,210,94,.32);
    }
    .measurement-action-item.backup span,
    .measurement-action-item.backup strong {
      color: #ffd25e;
    }
    @media (max-width: 980px) {
      .measurement-log-panel .measurement-log-shell { grid-template-columns: 1fr !important; }
      .measurement-action-popover { left: 0; min-width: 280px; top: calc(100% + 10px); width: min(86vw, 380px); }
    }
  `;
  document.head.appendChild(style);
}

if (typeof window !== 'undefined') {
  injectStyles();
  document.addEventListener('click', event => {
    if (!(event.target as HTMLElement | null)?.closest?.('.measurement-action-launcher-wrap')) closeAllMenus();
  });
  window.requestAnimationFrame(refreshActionMenus);
  const interval = window.setInterval(refreshActionMenus, 900);
  window.setTimeout(() => window.clearInterval(interval), 18000);
}
