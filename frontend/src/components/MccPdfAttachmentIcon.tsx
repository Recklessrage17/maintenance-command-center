/** Original MCC document geometry; decorative and shared by every Asset Notes PDF card. */
export function MccPdfAttachmentIcon() {
  return <span className="asset-file-icon glass-file-icon glass-file-icon--pdf asset-pdf-document-icon" aria-hidden="true">
    <svg viewBox="0 0 42 42" focusable="false">
      <path className="asset-pdf-document-page" d="M10.5 4.5H24l10 10V35a2.5 2.5 0 0 1-2.5 2.5h-21A2.5 2.5 0 0 1 8 35V7a2.5 2.5 0 0 1 2.5-2.5Z"/>
      <path className="asset-pdf-document-fold" d="M24 4.5v7.5a2.5 2.5 0 0 0 2.5 2.5H34Z"/>
      <path className="asset-pdf-document-lines" d="M14 18h15M14 21.5h10"/>
      <rect className="asset-pdf-document-badge" x="11.5" y="26" width="19" height="8" rx="2"/>
      <text className="asset-pdf-document-label" x="21" y="31.8" textAnchor="middle">PDF</text>
    </svg>
  </span>;
}
