import { type ReactNode, useEffect, useRef } from 'react';

/** Keeps section components mounted so their editors, loading and guards remain authoritative. */
export function MccCompactDetailGrid({ children, openSection }: { children: ReactNode; openSection: string | null }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const previousSection = useRef(openSection);

  useEffect(() => {
    // React's accepted selection is authoritative: rejected guards and initial deep links do not scroll.
    if (previousSection.current === openSection) return;
    previousSection.current = openSection;
    if (!openSection) return;

    const frame = window.requestAnimationFrame(() => {
      const panel = gridRef.current?.querySelector<HTMLElement>(':scope > article > .machine-detail-accordion-panel[aria-hidden="false"]');
      if (!panel) return;
      const bounds = panel.getBoundingClientRect();
      window.scrollTo({
        top: window.scrollY + bounds.top + bounds.height / 2 - window.innerHeight / 2,
        left: window.scrollX,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [openSection]);

  return <div ref={gridRef} className="machine-detail-accordion-list mcc-compact-detail-grid">{children}</div>;
}
