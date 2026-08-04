import { useEffect, useId, useMemo, useRef, useState } from 'react';

export function MccSearchableCombobox({
  label,
  value,
  options,
  onChange,
  disabled = false,
  required = false,
  placeholder = 'Search options',
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
}) {
  const inputId = useId();
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open,setOpen] = useState(false);
  const [query,setQuery] = useState(value);
  const [activeIndex,setActiveIndex] = useState(0);
  const filteredOptions = useMemo(() => {
    const search = query.trim().toLowerCase();
    return search ? options.filter(option => option.toLowerCase().includes(search)) : [...options];
  },[options,query]);

  useEffect(() => {
    if (!open) setQuery(value);
  },[open,value]);
  useEffect(() => {
    setActiveIndex(index => Math.min(index, Math.max(filteredOptions.length - 1, 0)));
  },[filteredOptions.length]);
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown',onPointerDown);
    return () => document.removeEventListener('pointerdown',onPointerDown);
  },[]);

  function choose(option: string) {
    onChange(option);
    setQuery(option);
    setOpen(false);
  }

  return (
    <div className="form-field mcc-searchable-combobox" ref={rootRef}>
      <span><label htmlFor={inputId}>{label}</label></span>
      <input
        id={inputId}
        className="glass-input"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && filteredOptions.length ? `${listboxId}-option-${activeIndex}` : undefined}
        value={query}
        disabled={disabled}
        required={required}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => {
          if (!disabled) {
            setQuery('');
            setOpen(true);
          }
        }}
        onChange={event => {
          setQuery(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setActiveIndex(index => filteredOptions.length ? (index + 1) % filteredOptions.length : 0);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            setActiveIndex(index => filteredOptions.length ? (index - 1 + filteredOptions.length) % filteredOptions.length : 0);
          } else if (event.key === 'Enter' && open && filteredOptions[activeIndex]) {
            event.preventDefault();
            choose(filteredOptions[activeIndex]);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setQuery(value);
            setOpen(false);
          }
        }}
      />
      {open && !disabled && (
        <div className="mcc-combobox-options" id={listboxId} role="listbox" aria-label={`${label} options`}>
          {filteredOptions.map((option,index) => (
            <button
              className={`mcc-combobox-option${index === activeIndex ? ' is-active' : ''}`}
              id={`${listboxId}-option-${index}`}
              key={option}
              type="button"
              role="option"
              aria-selected={option === value}
              onPointerDown={event => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(option)}
            >
              {option}
            </button>
          ))}
          {!filteredOptions.length && <span className="mcc-combobox-empty">No setup types match “{query}”.</span>}
        </div>
      )}
    </div>
  );
}
