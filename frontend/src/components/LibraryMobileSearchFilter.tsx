import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  library: string;
  label: string;
  placeholder: string;
  query: string;
  onQueryChange: (query: string) => void;
  activeFilterCount: number;
  filtersOpen: boolean;
  onFiltersOpenChange: (open: boolean) => void;
  filtersId: string;
  filters: ReactNode;
};

export function LibraryMobileSearchFilter({ library, label, placeholder, query, onQueryChange, activeFilterCount, filtersOpen, onFiltersOpenChange, filtersId, filters }: Props) {
  const [expanded, setExpanded] = useState(Boolean(query));
  const inputRef = useRef<HTMLInputElement>(null);
  const shouldFocus = useRef(false);

  useEffect(() => {
    if (query) setExpanded(true);
  }, [query]);
  useEffect(() => {
    if (expanded && shouldFocus.current) {
      inputRef.current?.focus();
      shouldFocus.current = false;
    }
  }, [expanded]);

  function toggleSearch() {
    if (!expanded) {
      shouldFocus.current = true;
      setExpanded(true);
    } else if (query) {
      inputRef.current?.focus();
    } else {
      onFiltersOpenChange(false);
      setExpanded(false);
    }
  }

  return createPortal(
    <div className="library-mobile-fixed-shell" data-library={library}>
      <div className={`library-mobile-search-filter${expanded ? ' is-expanded' : ''}`} role="search" aria-label={`${library} search and filters`}>
        <div className="library-mobile-search-bar">
          <button className={`library-mobile-search-toggle${activeFilterCount ? ' has-active-filters' : ''}`} type="button" aria-label="Search" aria-expanded={expanded} onClick={toggleSearch}>
            <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="10.75" cy="10.75" r="6.75"/><path d="m16 16 5 5"/></svg>
          </button>
          {expanded && <>
            <label className="library-mobile-search">
              <span className="visually-hidden">{label}</span>
              <input ref={inputRef} className="glass-input" type="search" value={query} onChange={event => onQueryChange(event.target.value)} placeholder={placeholder} />
            </label>
            <button className={`library-mobile-filter-toggle${activeFilterCount ? ' has-active-filters' : ''}`} type="button" aria-label={activeFilterCount ? `Filter, ${activeFilterCount} active` : 'Filter'} aria-expanded={filtersOpen} aria-controls={filtersId} onClick={() => onFiltersOpenChange(!filtersOpen)}>
              Filter{activeFilterCount ? ` (${activeFilterCount})` : ''}
            </button>
          </>}
        </div>
      </div>
      <div id={filtersId} className={`library-mobile-filter-popover${expanded && filtersOpen ? ' is-open' : ''}`}>{filters}</div>
    </div>,
    document.body,
  );
}
