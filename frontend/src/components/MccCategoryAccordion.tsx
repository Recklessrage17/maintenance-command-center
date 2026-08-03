import { type ReactNode } from 'react';

export type MccCategoryAccent =
  | 'basic'
  | 'electrical'
  | 'screw'
  | 'screw-secondary'
  | 'barrel'
  | 'barrel-secondary'
  | 'plunger'
  | 'pm'
  | 'library'
  | 'notes'
  | 'inspection'
  | 'neutral';

export function mccCategoryAccentClass(accent: MccCategoryAccent) {
  return `mcc-category-accent mcc-category-accent--${accent}`;
}

export function MccCategoryAccordion({
  accent,
  expanded,
  editing = false,
  className = '',
  children,
}: {
  accent: MccCategoryAccent;
  expanded: boolean;
  editing?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <article
      className={`${mccCategoryAccentClass(accent)} machine-detail-accordion-card${expanded ? ' is-open' : ''}${editing ? ' is-editing' : ''}${className ? ` ${className}` : ''}`}
      data-category-accent={accent}
    >
      {children}
    </article>
  );
}

export function MccAccordionHeader({
  title,
  summary,
  status,
  expanded,
  controls,
  onToggle,
  actions,
  className = '',
}: {
  title: ReactNode;
  summary?: ReactNode;
  status?: ReactNode;
  expanded: boolean;
  controls?: string;
  onToggle?: () => void;
  actions?: ReactNode;
  className?: string;
}) {
  const content = (
    <>
      <span className="mcc-accordion-header-main">
        <span className="machine-detail-section-title">{title}</span>
        {summary !== undefined && <span className="machine-detail-section-summary">{summary}</span>}
      </span>
      {status}
      {onToggle && <span className="machine-accordion-chevron" aria-hidden="true">v</span>}
    </>
  );

  return (
    <div className={`machine-detail-accordion-header${className ? ` ${className}` : ''}`}>
      {onToggle ? (
        <button className="machine-detail-accordion-toggle" type="button" aria-expanded={expanded} aria-controls={controls} onClick={onToggle}>
          {content}
        </button>
      ) : (
        <div className="machine-detail-accordion-toggle">{content}</div>
      )}
      {actions && <div className="machine-detail-section-actions">{actions}</div>}
    </div>
  );
}
