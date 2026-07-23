import { type ReactNode } from 'react';

export type MccSummaryTokenTone =
  | 'neutral'
  | 'folder'
  | 'document'
  | 'note'
  | 'attachment'
  | 'success'
  | 'warning'
  | 'danger'
  | 'history'
  | 'record';

export function MccSummaryToken({
  tone = 'neutral',
  className = '',
  children,
}: {
  tone?: MccSummaryTokenTone;
  className?: string;
  children: ReactNode;
}) {
  return <span className={`mcc-summary-token mcc-summary-token--${tone}${className ? ` ${className}` : ''}`}>{children}</span>;
}

export function MccSummaryTokenGroup({
  className = '',
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <span className={`mcc-summary-token-group${className ? ` ${className}` : ''}`}>{children}</span>;
}
