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

export type MccIndustrialSurfaceBoundaryProps = HTMLAttributes<HTMLDivElement> & {
  surface?: MccIndustrialSurface;
};

/**
 * Token-scope primitive for established layouts that must retain their exact
 * geometry. Visual surface components can key from the data attribute without
 * adding a wrapper, padding, border, or other box-model styles here.
 */
export const MccIndustrialSurfaceBoundary = forwardRef<
  HTMLDivElement,
  MccIndustrialSurfaceBoundaryProps
>(function MccIndustrialSurfaceBoundary(
  { surface = 'default', className, children, ...props },
  ref,
) {
  return (
    <div
      {...props}
      ref={ref}
      className={classNames('mcc-industrial-surface-boundary', className)}
      data-mcc-industrial-surface={surface}
    >
      {children}
    </div>
  );
});

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
  'audio[controls]',
  'video[controls]',
  'summary',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const legacyBackdropSelector = '.modal-backdrop, .mcc-modal-backdrop';
const legacySemanticDialogSelector = [
  '[role="dialog"][aria-modal="true"]',
  '[role="alertdialog"][aria-modal="true"]',
].join(',');
const legacyManagerExclusionSelector = [
  '[data-mcc-modal]',
  '.mcc-industrial-modal-backdrop',
  '[data-mcc-command-overlay]',
  '#maintenance-team-roster',
  '.maintenance-team-panel',
  '.mcc-command-deck',
].join(',');
const legacyAllowedPortalSelector = [
  '.mcc-date-popover',
  '.mcc-overflow-menu__panel',
  '.requisition-items-popover__panel',
  '[data-mcc-nested-popover]',
  '[data-mcc-legacy-dialog-portal]',
].join(',');

type LegacyDialogRecord = {
  dialog: HTMLElement;
  backdrop: HTMLElement;
  trigger: HTMLElement | null;
  roleBefore: string | null;
  ariaModalBefore: string | null;
  ariaLabelBefore: string | null;
  ariaLabelledByBefore: string | null;
  tabIndexBefore: string | null;
  heading: HTMLElement | null;
  headingIdBefore: string | null;
};

function elementIsRendered(element: HTMLElement) {
  if (!element.isConnected || element.hidden) return false;
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function legacyFocusableElements(container: HTMLElement) {
  const ownFocus = container.matches(focusableSelector) ? [container] : [];
  return [...ownFocus, ...Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))]
    .filter(element => (
      element.getAttribute('aria-disabled') !== 'true'
      && element.tabIndex >= 0
      && elementIsRendered(element)
    ));
}

function isLegacyManagerExcluded(element: Element) {
  return Boolean(element.closest(legacyManagerExclusionSelector));
}

function resolveLegacyDialog(backdrop: HTMLElement) {
  if (isLegacyManagerExcluded(backdrop)) return null;
  if (backdrop.matches('[role="dialog"], [role="alertdialog"]')) return backdrop;

  const semanticDialog = Array.from(
    backdrop.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]'),
  ).find(element => !isLegacyManagerExcluded(element));
  if (semanticDialog) return semanticDialog;

  return Array.from(backdrop.children).find(
    (element): element is HTMLElement =>
      element instanceof HTMLElement &&
      element.matches('form, section, article, .mcc-card, .mcc-modal, [data-dialog]') &&
      !isLegacyManagerExcluded(element),
  ) ?? null;
}

function collectLegacyDialogCandidates() {
  const candidates: Array<{ dialog: HTMLElement; backdrop: HTMLElement }> = [];
  const seen = new Set<HTMLElement>();
  const backdrops = Array.from(document.querySelectorAll<HTMLElement>(legacyBackdropSelector));

  for (const backdrop of backdrops) {
    const dialog = resolveLegacyDialog(backdrop);
    if (!dialog || seen.has(dialog) || !elementIsRendered(dialog)) continue;
    seen.add(dialog);
    candidates.push({ dialog, backdrop });
  }

  for (const dialog of Array.from(
    document.querySelectorAll<HTMLElement>(legacySemanticDialogSelector),
  )) {
    if (
      seen.has(dialog) ||
      isLegacyManagerExcluded(dialog) ||
      !elementIsRendered(dialog) ||
      dialog.closest(legacyBackdropSelector)
    ) {
      continue;
    }
    seen.add(dialog);
    candidates.push({ dialog, backdrop: dialog });
  }

  return candidates;
}

function validLabelReference(dialog: HTMLElement) {
  const ids = dialog.getAttribute('aria-labelledby')?.trim().split(/\s+/).filter(Boolean) ?? [];
  return ids.some(id => {
    const label = document.getElementById(id);
    return Boolean(label?.textContent?.trim());
  });
}

function findLegacyDialogHeading(dialog: HTMLElement) {
  return dialog.querySelector<HTMLElement>(
    '[data-mcc-dialog-title], .modal-heading h1, .modal-heading h2, .modal-heading h3, ' +
    '.modal-heading h4, .modal-heading h5, .modal-heading h6, h1, h2, h3, h4, h5, h6',
  );
}

function controlledIdsWithin(dialog: HTMLElement) {
  const ids = new Set<string>();
  const controls = [
    ...(dialog.hasAttribute('aria-controls') ? [dialog] : []),
    ...Array.from(dialog.querySelectorAll<HTMLElement>('[aria-controls]')),
  ];
  for (const control of controls) {
    for (const id of control.getAttribute('aria-controls')?.trim().split(/\s+/) ?? []) {
      if (id) ids.add(id);
    }
  }
  return ids;
}

function activeAllowedPortals(dialog: HTMLElement) {
  const controlledIds = controlledIdsWithin(dialog);
  const dialogId = dialog.id;
  return Array.from(document.querySelectorAll<HTMLElement>(legacyAllowedPortalSelector))
    .filter(element => {
      if (!elementIsRendered(element)) return false;
      if (dialog.contains(element)) return true;
      if (element.id && controlledIds.has(element.id)) return true;
      if (!dialogId) return false;
      return element.dataset.mccDialogOwner === dialogId
        || element.dataset.mccLegacyDialogOwner === dialogId;
    });
}

function focusScopesForDialog(dialog: HTMLElement) {
  return [dialog, ...activeAllowedPortals(dialog)];
}

function focusTargetsForDialog(dialog: HTMLElement) {
  const targets = focusScopesForDialog(dialog)
    .flatMap(scope => legacyFocusableElements(scope));
  return [...new Set(targets)];
}

function validFocusReturnTarget(element: HTMLElement | null): element is HTMLElement {
  return Boolean(
    element
    && element !== document.body
    && element !== document.documentElement
    && element.isConnected
    && element.getAttribute('aria-disabled') !== 'true'
    && elementIsRendered(element)
    && (element.matches(focusableSelector) || element.tabIndex >= 0)
  );
}

function activeDedicatedDialog() {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>(
    '[data-mcc-modal], [data-mcc-command-overlay][aria-modal="true"]',
  )).filter(element => elementIsRendered(element));
  return dialogs[dialogs.length - 1] ?? null;
}

function findLegacyCloseControl(dialog: HTMLElement) {
  const controls = Array.from(dialog.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
    'button, input[type="button"], input[type="reset"]',
  )).filter(control => (
    !control.disabled &&
    control.getAttribute('aria-disabled') !== 'true' &&
    elementIsRendered(control)
  ));
  const exactText = /^(close|cancel|dismiss|done|ok|okay)$/i;
  return controls.find(control => control.hasAttribute('data-mcc-dialog-close'))
    ?? controls.find(control => /(?:close|cancel|dismiss)/i.test(control.getAttribute('aria-label') ?? ''))
    ?? controls.find(control => exactText.test(
      ('value' in control && control.value ? control.value : control.textContent ?? '').trim(),
    ))
    ?? null;
}

/**
 * Compatibility manager for legacy module dialogs. It intentionally performs
 * DOM-only accessibility upgrades so existing module state, validation,
 * submission, and close handlers remain the source of truth.
 */
export function MccLegacyDialogManager() {
  useEffect(() => {
    const records = new Map<HTMLElement, LegacyDialogRecord>();
    const stack: HTMLElement[] = [];
    let generatedLabelIndex = 0;
    let bodyOverflowBeforeDialogs = '';
    let scrollLocked = false;
    let lastInteractionTarget: HTMLElement | null = null;
    let lastFocusedTarget: HTMLElement | null = null;
    let inheritedTrigger: HTMLElement | null = null;
    let inheritanceFrame = 0;
    let focusFrame = 0;

    function topRecord() {
      const top = stack[stack.length - 1];
      return top ? records.get(top) ?? null : null;
    }

    function setScrollLock(locked: boolean) {
      if (locked && !scrollLocked) {
        bodyOverflowBeforeDialogs = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        scrollLocked = true;
      } else if (!locked && scrollLocked) {
        document.body.style.overflow = bodyOverflowBeforeDialogs;
        scrollLocked = false;
      } else if (locked) {
        document.body.style.overflow = 'hidden';
      }
    }

    function focusScopes(record: LegacyDialogRecord) {
      return focusScopesForDialog(record.dialog);
    }

    function focusTargets(record: LegacyDialogRecord) {
      const scopes = focusScopes(record);
      const targets = scopes.flatMap(scope => legacyFocusableElements(scope));
      return [...new Set(targets)];
    }

    function focusInitial(record: LegacyDialogRecord) {
      window.cancelAnimationFrame(focusFrame);
      focusFrame = window.requestAnimationFrame(() => {
        if (topRecord() !== record || activeDedicatedDialog()) return;
        const active = document.activeElement;
        if (
          active instanceof HTMLElement &&
          focusScopes(record).some(scope => scope.contains(active))
        ) {
          return;
        }
        const preferred = record.dialog.querySelector<HTMLElement>(
          '[autofocus], input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
          'textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        );
        (preferred && elementIsRendered(preferred) ? preferred : record.dialog).focus();
      });
    }

    function addRecord(dialog: HTMLElement, backdrop: HTMLElement) {
      const active = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      const trigger = [
        active,
        lastInteractionTarget,
        lastFocusedTarget,
        inheritedTrigger,
      ].find(candidate => (
        validFocusReturnTarget(candidate ?? null) && !dialog.contains(candidate as HTMLElement)
      )) ?? null;
      if (trigger === inheritedTrigger) inheritedTrigger = null;
      const heading = findLegacyDialogHeading(dialog);
      const record: LegacyDialogRecord = {
        dialog,
        backdrop,
        trigger,
        roleBefore: dialog.getAttribute('role'),
        ariaModalBefore: dialog.getAttribute('aria-modal'),
        ariaLabelBefore: dialog.getAttribute('aria-label'),
        ariaLabelledByBefore: dialog.getAttribute('aria-labelledby'),
        tabIndexBefore: dialog.getAttribute('tabindex'),
        heading,
        headingIdBefore: heading?.getAttribute('id') ?? null,
      };

      if (!dialog.matches('[role="dialog"], [role="alertdialog"]')) {
        dialog.setAttribute('role', 'dialog');
      }
      dialog.setAttribute('aria-modal', 'true');
      if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;

      if (!dialog.getAttribute('aria-label')?.trim() && !validLabelReference(dialog)) {
        if (heading?.textContent?.trim()) {
          if (!heading.id) {
            generatedLabelIndex += 1;
            heading.id = `mcc-legacy-dialog-title-${generatedLabelIndex}`;
          }
          dialog.setAttribute('aria-labelledby', heading.id);
        } else {
          dialog.setAttribute('aria-label', 'Maintenance Command Center dialog');
        }
      }

      dialog.setAttribute('data-mcc-legacy-dialog', '');
      backdrop.setAttribute('data-mcc-legacy-dialog-backdrop', '');
      records.set(dialog, record);
      stack.push(dialog);
      focusInitial(record);
    }

    function restoreAttribute(element: HTMLElement, name: string, value: string | null) {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }

    function restoreRecord(record: LegacyDialogRecord) {
      restoreAttribute(record.dialog, 'role', record.roleBefore);
      restoreAttribute(record.dialog, 'aria-modal', record.ariaModalBefore);
      restoreAttribute(record.dialog, 'aria-label', record.ariaLabelBefore);
      restoreAttribute(record.dialog, 'aria-labelledby', record.ariaLabelledByBefore);
      restoreAttribute(record.dialog, 'tabindex', record.tabIndexBefore);
      record.dialog.removeAttribute('data-mcc-legacy-dialog');
      record.backdrop.removeAttribute('data-mcc-legacy-dialog-backdrop');
      record.backdrop.removeAttribute('data-mcc-legacy-dialog-depth');
      if (record.heading) restoreAttribute(record.heading, 'id', record.headingIdBefore);
    }

    function removeRecord(record: LegacyDialogRecord, restore = false) {
      const wasTop = topRecord() === record;
      const stackIndex = stack.lastIndexOf(record.dialog);
      if (stackIndex >= 0) stack.splice(stackIndex, 1);
      records.delete(record.dialog);
      if (restore && record.dialog.isConnected) restoreRecord(record);

      if (wasTop) {
        const returnTarget = record.trigger;
        if (validFocusReturnTarget(returnTarget)) {
          inheritedTrigger = returnTarget;
          window.cancelAnimationFrame(inheritanceFrame);
          inheritanceFrame = window.requestAnimationFrame(() => {
            inheritedTrigger = null;
          });
        }
        window.requestAnimationFrame(() => {
          const next = topRecord();
          const active = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
          if (next) {
            if (focusScopes(next).some(scope => active && scope.contains(active))) return;
            if (validFocusReturnTarget(returnTarget) && next.dialog.contains(returnTarget)) {
              returnTarget.focus();
            } else {
              (focusTargets(next)[0] ?? next.dialog).focus();
            }
          } else if (
            validFocusReturnTarget(returnTarget)
            && (!validFocusReturnTarget(active) || active === returnTarget)
          ) {
            returnTarget.focus();
          }
        });
      }
    }

    function reconcile() {
      const candidates = collectLegacyDialogCandidates();
      const present = new Set(candidates.map(candidate => candidate.dialog));

      for (const record of [...records.values()]) {
        if (!present.has(record.dialog)) removeRecord(record);
      }
      for (const candidate of candidates) {
        if (!records.has(candidate.dialog)) addRecord(candidate.dialog, candidate.backdrop);
      }
      stack.forEach((dialog, index) => {
        const record = records.get(dialog);
        record?.backdrop.setAttribute('data-mcc-legacy-dialog-depth', String(index + 1));
      });
      setScrollLock(records.size > 0);
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof HTMLElement) {
        lastInteractionTarget = event.target.matches(focusableSelector)
          ? event.target
          : event.target.closest<HTMLElement>(focusableSelector);
      }
    }

    function handleTriggerKeyDown(event: KeyboardEvent) {
      if (
        (event.key === 'Enter' || event.key === ' ') &&
        event.target instanceof HTMLElement
      ) {
        lastInteractionTarget = event.target;
      }
    }

    function rememberPotentialTrigger(event: FocusEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !validFocusReturnTarget(target)) return;
      const targetEnteredNewDialog = collectLegacyDialogCandidates().some(candidate => (
        !records.has(candidate.dialog)
        && (
          candidate.dialog.contains(target)
          || activeAllowedPortals(candidate.dialog).some(portal => portal.contains(target))
        )
      ));
      if (!targetEnteredNewDialog) lastFocusedTarget = target;
    }

    function handleDialogKeyDown(event: KeyboardEvent) {
      reconcile();
      const record = topRecord();
      if (!record || activeDedicatedDialog()) return;
      const portals = activeAllowedPortals(record.dialog);
      const target = event.target instanceof Node ? event.target : null;
      const targetInPortal = Boolean(target && portals.some(portal => portal.contains(target)));

      if (event.key === 'Escape') {
        if (targetInPortal || portals.length > 0) return;
        const closeControl = findLegacyCloseControl(record.dialog);
        if (!closeControl) return;
        event.preventDefault();
        event.stopPropagation();
        closeControl.click();
        return;
      }

      if (event.key !== 'Tab') return;
      const targets = focusTargets(record);
      if (!targets.length) {
        event.preventDefault();
        record.dialog.focus();
        return;
      }
      const first = targets[0];
      const last = targets[targets.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !targets.includes(active as HTMLElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !targets.includes(active as HTMLElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    function handleFocusIn(event: FocusEvent) {
      reconcile();
      const record = topRecord();
      if (!record || activeDedicatedDialog()) return;
      const target = event.target;
      if (
        target instanceof Node &&
        focusScopes(record).some(scope => scope.contains(target))
      ) {
        return;
      }
      const focusTarget = focusTargets(record)[0] ?? record.dialog;
      focusTarget.focus();
    }

    const observer = new MutationObserver(reconcile);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleTriggerKeyDown, true);
    document.addEventListener('keydown', handleDialogKeyDown, true);
    document.addEventListener('focusin', rememberPotentialTrigger, true);
    document.addEventListener('focusin', handleFocusIn);
    reconcile();

    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleTriggerKeyDown, true);
      document.removeEventListener('keydown', handleDialogKeyDown, true);
      document.removeEventListener('focusin', rememberPotentialTrigger, true);
      document.removeEventListener('focusin', handleFocusIn);
      window.cancelAnimationFrame(focusFrame);
      window.cancelAnimationFrame(inheritanceFrame);
      for (const record of [...records.values()]) removeRecord(record, true);
      window.cancelAnimationFrame(inheritanceFrame);
      setScrollLock(false);
    };
  }, []);

  return null;
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
      const focusTarget = initialFocusRef?.current ?? focusTargetsForDialog(dialog)[0] ?? dialog;
      focusTarget.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      const dialog = dialogRef.current;
      if (!dialog || !topModalIs(token)) return;

      if (event.key === 'Escape' && closeOnEscape) {
        const portals = activeAllowedPortals(dialog);
        const target = event.target instanceof Node ? event.target : null;
        if (
          portals.length > 0
          || (target && portals.some(portal => portal.contains(target)))
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = focusTargetsForDialog(dialog);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !focusable.includes(active as HTMLElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !focusable.includes(active as HTMLElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    function keepFocusInside(event: FocusEvent) {
      const dialog = dialogRef.current;
      if (!dialog || !topModalIs(token)) return;
      const target = event.target;
      if (
        target instanceof Node
        && focusScopesForDialog(dialog).some(scope => scope.contains(target))
      ) {
        return;
      }
      const focusTarget = initialFocusRef?.current ?? focusTargetsForDialog(dialog)[0] ?? dialog;
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
