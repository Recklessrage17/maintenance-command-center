import {
  cloneElement,
  createElement,
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  type RefObject,
  type TableHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

type MccIndustrialContainerElement = 'article' | 'aside' | 'div' | 'nav' | 'section';
export type MccIndustrialSurface = 'default' | 'strong' | 'nested' | 'dense';
export type MccIndustrialPadding = 'none' | 'compact' | 'default' | 'spacious';

export type MccIndustrialPanelProps = HTMLAttributes<HTMLElement> & {
  as?: MccIndustrialContainerElement;
  surface?: MccIndustrialSurface;
  padding?: MccIndustrialPadding;
};

export function MccIndustrialPanel({
  as = 'section',
  surface = 'default',
  padding = 'default',
  className,
  children,
  ...props
}: MccIndustrialPanelProps) {
  return createElement(
    as,
    {
      ...props,
      className: classNames(
        'mcc-industrial-panel',
        `mcc-industrial-panel--${surface}`,
        `mcc-industrial-padding--${padding}`,
        className,
      ),
    },
    children,
  );
}

export type MccIndustrialCardTone = 'neutral' | 'maintenance' | 'workflow' | 'danger' | 'info';

export type MccIndustrialCardProps = HTMLAttributes<HTMLElement> & {
  as?: MccIndustrialContainerElement;
  surface?: Exclude<MccIndustrialSurface, 'strong'>;
  padding?: MccIndustrialPadding;
  tone?: MccIndustrialCardTone;
};

export function MccIndustrialCard({
  as = 'article',
  surface = 'default',
  padding = 'default',
  tone = 'neutral',
  className,
  children,
  ...props
}: MccIndustrialCardProps) {
  return createElement(
    as,
    {
      ...props,
      className: classNames(
        'mcc-industrial-card',
        `mcc-industrial-card--${surface}`,
        `mcc-industrial-card--${tone}`,
        `mcc-industrial-padding--${padding}`,
        className,
      ),
      'data-mcc-tone': tone,
    },
    children,
  );
}

export type MccIndustrialButtonVariant =
  | 'neutral'
  | 'maintenance'
  | 'workflow'
  | 'danger'
  | 'info'
  | 'primary'
  | 'secondary'
  | 'success'
  | 'warning';

export type MccIndustrialButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: MccIndustrialButtonVariant;
  size?: 'compact' | 'default';
  loading?: boolean;
  loadingLabel?: ReactNode;
};

function normalizeButtonVariant(variant: MccIndustrialButtonVariant) {
  if (variant === 'primary' || variant === 'success') return 'maintenance';
  if (variant === 'warning') return 'workflow';
  if (variant === 'secondary') return 'neutral';
  return variant;
}

export const MccIndustrialButton = forwardRef<HTMLButtonElement, MccIndustrialButtonProps>(
  function MccIndustrialButton(
    {
      variant = 'neutral',
      size = 'default',
      loading = false,
      loadingLabel = 'Working…',
      disabled,
      type = 'button',
      className,
      children,
      ...props
    },
    ref,
  ) {
    const normalizedVariant = normalizeButtonVariant(variant);
    return (
      <button
        {...props}
        ref={ref}
        type={type}
        className={classNames(
          'mcc-industrial-button',
          `mcc-industrial-button--${normalizedVariant}`,
          `mcc-industrial-button--${size}`,
          className,
        )}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        data-mcc-tone={normalizedVariant}
      >
        {loading && <span className="mcc-industrial-button__activity" aria-hidden="true" />}
        <span className="mcc-industrial-button__label">{loading ? loadingLabel : children}</span>
      </button>
    );
  },
);

export type MccIndustrialTabProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'role'> & {
  selected: boolean;
  panelId: string;
};

export const MccIndustrialTab = forwardRef<HTMLButtonElement, MccIndustrialTabProps>(
  function MccIndustrialTab(
    { selected, panelId, id, className, type = 'button', children, ...props },
    ref,
  ) {
    return (
      <button
        {...props}
        ref={ref}
        id={id}
        type={type}
        role="tab"
        className={classNames('mcc-industrial-tab', selected && 'is-selected', className)}
        aria-selected={selected}
        aria-controls={panelId}
        tabIndex={selected ? 0 : -1}
      >
        {children}
      </button>
    );
  },
);

export type MccIndustrialTableProps = TableHTMLAttributes<HTMLTableElement> & {
  caption?: ReactNode;
  containerClassName?: string;
  scrollLabel?: string;
  compact?: boolean;
};

export const MccIndustrialTable = forwardRef<HTMLTableElement, MccIndustrialTableProps>(
  function MccIndustrialTable(
    {
      caption,
      containerClassName,
      scrollLabel,
      compact = true,
      className,
      children,
      'aria-label': ariaLabel,
      ...props
    },
    ref,
  ) {
    const regionLabel =
      scrollLabel ??
      (typeof caption === 'string' ? caption : undefined) ??
      ariaLabel ??
      'Data table';

    return (
      <div
        className={classNames('mcc-industrial-table-frame', containerClassName)}
        role="region"
        aria-label={regionLabel}
        tabIndex={0}
      >
        <table
          {...props}
          ref={ref}
          className={classNames('mcc-industrial-table', compact && 'is-compact', className)}
          aria-label={ariaLabel}
        >
          {caption !== undefined && <caption>{caption}</caption>}
          {children}
        </table>
      </div>
    );
  },
);

type MccFieldControlProps = {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'false' | 'true';
};

export type MccIndustrialFieldProps = {
  label: ReactNode;
  children: ReactElement<MccFieldControlProps>;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
};

export function MccIndustrialField({
  label,
  children,
  hint,
  error,
  required = false,
  className,
}: MccIndustrialFieldProps) {
  const generatedId = useId().replace(/:/g, '');
  const controlId = children.props.id ?? `mcc-industrial-field-${generatedId}`;
  const hintId = hint !== undefined ? `${controlId}-hint` : undefined;
  const errorId = error !== undefined ? `${controlId}-error` : undefined;
  const describedBy = [
    children.props['aria-describedby'],
    hintId,
    errorId,
  ].filter(Boolean).join(' ') || undefined;
  const control = cloneElement(children, {
    id: controlId,
    'aria-describedby': describedBy,
    'aria-invalid': error !== undefined ? true : children.props['aria-invalid'],
  });

  return (
    <div className={classNames('mcc-industrial-field', error !== undefined && 'has-error', className)}>
      <label className="mcc-industrial-field__label" htmlFor={controlId}>
        {label}
        {required && (
          <>
            <span className="mcc-industrial-field__required" aria-hidden="true"> *</span>
            <span className="mcc-industrial-sr-only"> required</span>
          </>
        )}
      </label>
      {control}
      {hint !== undefined && (
        <span className="mcc-industrial-field__hint" id={hintId}>{hint}</span>
      )}
      {error !== undefined && (
        <span className="mcc-industrial-field__error" id={errorId} role="alert">{error}</span>
      )}
    </div>
  );
}

export type MccIndustrialNoticeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export type MccIndustrialNoticeProps = Omit<HTMLAttributes<HTMLDivElement>, 'role' | 'title'> & {
  tone?: MccIndustrialNoticeTone;
  title?: ReactNode;
  role?: 'alert' | 'status';
  onDismiss?: () => void;
  dismissLabel?: string;
};

export function MccIndustrialNotice({
  tone = 'info',
  title,
  role,
  onDismiss,
  dismissLabel = 'Dismiss notice',
  className,
  children,
  ...props
}: MccIndustrialNoticeProps) {
  const resolvedRole = role ?? (tone === 'danger' ? 'alert' : 'status');
  return (
    <div
      {...props}
      className={classNames('mcc-industrial-notice', `mcc-industrial-notice--${tone}`, className)}
      role={resolvedRole}
      data-mcc-tone={tone}
    >
      <span className="mcc-industrial-notice__rail" aria-hidden="true" />
      <div className="mcc-industrial-notice__content">
        {title !== undefined && <strong className="mcc-industrial-notice__title">{title}</strong>}
        <div className="mcc-industrial-notice__body">{children}</div>
      </div>
      {onDismiss && (
        <button
          className="mcc-industrial-notice__dismiss"
          type="button"
          aria-label={dismissLabel}
          onClick={onDismiss}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  );
}

const modalStack: symbol[] = [];
let documentScrollLocks = 0;
let bodyOverflowBeforeModal = '';

function topModalIs(token: symbol) {
  return modalStack[modalStack.length - 1] === token;
}

function lockDocumentScroll() {
  if (documentScrollLocks === 0) {
    bodyOverflowBeforeModal = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  documentScrollLocks += 1;
}

function unlockDocumentScroll() {
  documentScrollLocks = Math.max(0, documentScrollLocks - 1);
  if (documentScrollLocks === 0) {
    document.body.style.overflow = bodyOverflowBeforeModal;
  }
}

const focusableSelector = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
    .filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
}

export type MccIndustrialModalProps = {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  description?: ReactNode;
  footer?: ReactNode;
  size?: 'default' | 'wide' | 'full';
  role?: 'alertdialog' | 'dialog';
  className?: string;
  contentClassName?: string;
  closeLabel?: string;
  closeOnEscape?: boolean;
  closeOnOutsideClick?: boolean;
  showCloseButton?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  ariaDescribedBy?: string;
  busy?: boolean;
};

export function MccIndustrialModal({
  open,
  title,
  children,
  onClose,
  description,
  footer,
  size = 'default',
  role = 'dialog',
  className,
  contentClassName,
  closeLabel = 'Close dialog',
  closeOnEscape = true,
  closeOnOutsideClick = true,
  showCloseButton = true,
  initialFocusRef,
  returnFocusRef,
  ariaDescribedBy,
  busy = false,
}: MccIndustrialModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const modalTokenRef = useRef(Symbol('mcc-industrial-modal'));
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const generatedId = useId().replace(/:/g, '');
  const titleId = `mcc-industrial-modal-${generatedId}-title`;
  const descriptionId = description !== undefined
    ? `mcc-industrial-modal-${generatedId}-description`
    : undefined;
  const describedBy = [ariaDescribedBy, descriptionId].filter(Boolean).join(' ') || undefined;

  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const token = modalTokenRef.current;
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    modalStack.push(token);
    lockDocumentScroll();

    const animationFrame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog || !topModalIs(token)) return;
      const focusTarget = initialFocusRef?.current ?? focusableElements(dialog)[0] ?? dialog;
      focusTarget.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      const dialog = dialogRef.current;
      if (!dialog || !topModalIs(token)) return;

      if (event.key === 'Escape' && closeOnEscape) {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = focusableElements(dialog);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    function keepFocusInside(event: FocusEvent) {
      const dialog = dialogRef.current;
      if (!dialog || !topModalIs(token) || dialog.contains(event.target as Node)) return;
      const focusTarget = initialFocusRef?.current ?? focusableElements(dialog)[0] ?? dialog;
      focusTarget.focus();
    }

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('focusin', keepFocusInside);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('focusin', keepFocusInside);
      const wasTopModal = topModalIs(token);
      const stackIndex = modalStack.lastIndexOf(token);
      if (stackIndex >= 0) modalStack.splice(stackIndex, 1);
      unlockDocumentScroll();

      if (wasTopModal) {
        const returnTarget = returnFocusRef?.current ?? previousFocusRef.current;
        window.requestAnimationFrame(() => {
          if (returnTarget?.isConnected) returnTarget.focus();
        });
      }
    };
  }, [closeOnEscape, initialFocusRef, open, returnFocusRef]);

  if (!open || typeof document === 'undefined') return null;
  const token = modalTokenRef.current;

  return createPortal(
    <div
      className="mcc-industrial-modal-backdrop"
      role="presentation"
      onPointerDown={event => {
        if (
          event.target === event.currentTarget &&
          closeOnOutsideClick &&
          topModalIs(token)
        ) {
          onCloseRef.current();
        }
      }}
    >
      <div
        ref={dialogRef}
        className={classNames(
          'mcc-industrial-modal',
          `mcc-industrial-modal--${size}`,
          className,
        )}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        aria-busy={busy || undefined}
        tabIndex={-1}
        data-mcc-modal=""
        onPointerDown={event => event.stopPropagation()}
      >
        <header className="mcc-industrial-modal__header">
          <div className="mcc-industrial-modal__heading">
            <h2 id={titleId}>{title}</h2>
            {description !== undefined && <p id={descriptionId}>{description}</p>}
          </div>
          {showCloseButton && (
            <button
              className="mcc-industrial-modal__close"
              type="button"
              aria-label={closeLabel}
              onClick={() => onCloseRef.current()}
            >
              <span aria-hidden="true">×</span>
            </button>
          )}
        </header>
        <div className={classNames('mcc-industrial-modal__content', contentClassName)}>
          {children}
        </div>
        {footer !== undefined && (
          <footer className="mcc-industrial-modal__footer">{footer}</footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
