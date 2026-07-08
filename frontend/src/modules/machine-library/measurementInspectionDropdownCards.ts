export {};

const PANEL_SELECTOR = '.measurement-log-panel';
const READY_ATTR = 'data-measurement-dropdown-ready';

function setCardOpen(card: HTMLElement, open: boolean) {
  card.classList.toggle('measurement-mini-card-open', open);
  card.classList.toggle('measurement-mini-card-closed', !open);
  card.dataset.cardOpen = open ? 'true' : 'false';
}

function makeDropdownCard(section: HTMLElement, icon: string, title: string, subtitle: string, defaultOpen: boolean) {
  if (section.getAttribute(READY_ATTR) === 'true') return;
  section.setAttribute(READY_ATTR, 'true');
  section.classList.add('measurement-mini-card');
  const body = Array.from(section.childNodes);
  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'measurement-mini-card-body';
  body.forEach(node => bodyWrap.appendChild(node));

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'measurement-mini-card-header';
  header.innerHTML = `
    <span class="measurement-mini-card-icon">${icon}</span>
    <span class="measurement-mini-card-title-wrap">
      <strong>${title}</strong>
      <small>${subtitle}</small>
    </span>
    <span class="measurement-mini-card-chevron">v</span>
  `;
  header.addEventListener('click', () => setCardOpen(section, section.dataset.cardOpen !== 'true'));
  section.appendChild(header);
  section.appendChild(bodyWrap);
  setCardOpen(section, defaultOpen);
}

function splitImportCard(panel: HTMLElement) {
  const importCard = panel.querySelector<HTMLElement>('.measurement-log-import-card');
  if (!importCard || importCard.dataset.dropdownCards === 'true') return;
  importCard.dataset.dropdownCards = 'true';

  const templateCard = importCard.querySelector<HTMLElement>('.measurement-template-card');
  const uploadSection = document.createElement('section');
  uploadSection.className = 'measurement-records-mini-section';

  const uploadNodes: Node[] = [];
  Array.from(importCard.childNodes).forEach(node => {
    if (templateCard && node === templateCard) return;
    uploadNodes.push(node);
  });
  uploadNodes.forEach(node => uploadSection.appendChild(node));
  importCard.appendChild(uploadSection);
  if (templateCard) importCard.appendChild(templateCard);

  makeDropdownCard(
    uploadSection,
    '▤',
    'Screw & Barrel Inspection Records',
    'Upload records and backup data',
    true,
  );

  if (templateCard) {
    makeDropdownCard(
      templateCard,
      '▧',
      'Screw & Barrel Measurement Sheet',
      'Print blank form or update template',
      false,
    );
  }
}

function refreshDropdownCards() {
  document.querySelectorAll<HTMLElement>(PANEL_SELECTOR).forEach(splitImportCard);
}

function injectStyles() {
  if (document.getElementById('measurement-dropdown-card-styles')) return;
  const style = document.createElement('style');
  style.id = 'measurement-dropdown-card-styles';
  style.textContent = `
    .measurement-log-import-card {
      display: grid;
      gap: 10px;
    }
    .measurement-log-import-card > span,
    .measurement-log-import-card > strong,
    .measurement-log-import-card > small,
    .measurement-log-import-card > .measurement-log-actions,
    .measurement-log-import-card > input[type="file"] {
      display: none !important;
    }
    .measurement-mini-card {
      border: 1px solid rgba(68, 215, 255, .22);
      border-radius: 13px;
      background: linear-gradient(145deg, rgba(3, 19, 32, .78), rgba(2, 9, 18, .78));
      overflow: hidden;
    }
    .measurement-mini-card-header {
      align-items: center;
      background: transparent;
      border: 0;
      color: #f3fbff;
      cursor: pointer;
      display: grid;
      gap: 10px;
      grid-template-columns: auto minmax(0, 1fr) auto;
      padding: 11px 12px;
      text-align: left;
      width: 100%;
    }
    .measurement-mini-card-header:hover {
      background: rgba(68, 215, 255, .065);
    }
    .measurement-mini-card-icon {
      align-items: center;
      background: rgba(68, 215, 255, .14);
      border: 1px solid rgba(68, 215, 255, .36);
      border-radius: 11px;
      color: #86f1ff;
      display: inline-flex;
      font-size: 1rem;
      font-weight: 950;
      height: 34px;
      justify-content: center;
      width: 34px;
    }
    .measurement-mini-card-title-wrap strong {
      color: #f3fbff;
      display: block;
      font-size: .9rem;
      font-weight: 950;
      line-height: 1.12;
      margin: 0;
    }
    .measurement-mini-card-title-wrap small {
      color: #a8c7d5;
      display: block;
      font-size: .68rem;
      font-weight: 850;
      line-height: 1.1;
      margin-top: 4px;
    }
    .measurement-mini-card-chevron {
      color: #8ff1ff;
      font-size: .8rem;
      font-weight: 950;
      transition: transform .16s ease;
    }
    .measurement-mini-card-body {
      border-top: 1px solid rgba(68, 215, 255, .13);
      padding: 12px;
    }
    .measurement-mini-card-body > span:first-child,
    .measurement-mini-card-body > strong:first-of-type {
      display: none !important;
    }
    .measurement-mini-card-body small {
      color: #a8c7d5;
      display: block;
      font-weight: 850;
      line-height: 1.25;
      margin-bottom: 10px;
    }
    .measurement-mini-card-body .measurement-log-actions {
      border-top: 1px solid rgba(68, 215, 255, .13) !important;
      margin-top: 10px;
      padding-top: 10px !important;
    }
    .measurement-mini-card-closed .measurement-mini-card-body {
      display: none;
    }
    .measurement-mini-card-closed .measurement-mini-card-chevron {
      transform: rotate(-90deg);
    }
    .measurement-template-card {
      border-top: 0 !important;
      margin-top: 0 !important;
      padding-top: 0 !important;
    }
  `;
  document.head.appendChild(style);
}

if (typeof window !== 'undefined') {
  injectStyles();
  window.requestAnimationFrame(refreshDropdownCards);
  const interval = window.setInterval(refreshDropdownCards, 900);
  window.setTimeout(() => window.clearInterval(interval), 18000);
}
