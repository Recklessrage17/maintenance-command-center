import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { MccContactPill, MccStatusPill } from '../../components/MccPills';

type ComboboxOption = {
  value: string;
  label: string;
  searchTerms?: string[];
};

const COUNTRY_CODES = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW XK`.split(' ');

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });

const countryAliases: Record<string, string[]> = {
  US: ['USA', 'U.S.', 'U.S.A.', 'United', 'United States of America', 'America'],
  GB: ['UK', 'U.K.', 'Britain', 'Great Britain'],
  KR: ['South Korea', 'Korea South'],
  KP: ['North Korea', 'Korea North'],
  CZ: ['Czech Republic'],
  CI: ["Cote d'Ivoire", 'Ivory Coast'],
  CD: ['DR Congo', 'Democratic Republic of the Congo'],
  CG: ['Republic of the Congo'],
  TW: ['Taiwan'],
  XK: ['Kosovo'],
};

export const countryOptions: ComboboxOption[] = COUNTRY_CODES.map(code => ({
  value: countryNames.of(code) || code,
  label: countryNames.of(code) || code,
  searchTerms: [code, ...(countryAliases[code] ?? [])],
})).sort((left, right) => left.label.localeCompare(right.label));

const usStateRows = [
  ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming'],['DC','District of Columbia'],
] as const;

export const usStateOptions: ComboboxOption[] = usStateRows.map(([code, name]) => ({ value: name, label: name, searchTerms: [code] }));

function optionMatches(option: ComboboxOption, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return [option.label, option.value, ...(option.searchTerms ?? [])].some(term => term.toLocaleLowerCase().includes(normalized));
}

function exactOption(options: ComboboxOption[], value: string) {
  const normalized = value.trim().toLocaleLowerCase().replace(/\./g, '');
  return options.find(option => [option.label, option.value, ...(option.searchTerms ?? [])]
    .some(term => term.toLocaleLowerCase().replace(/\./g, '') === normalized));
}

export function canonicalCountryValue(value: string) {
  const trimmed = value.trim();
  return exactOption(countryOptions, trimmed)?.value ?? trimmed;
}

export function canonicalUsStateValue(value: string) {
  const trimmed = value.trim();
  return exactOption(usStateOptions, trimmed)?.value ?? trimmed;
}

export function isUnitedStatesCountry(value: string) {
  const canonical = canonicalCountryValue(value).toLocaleLowerCase();
  return canonical === 'united states' || ['us','usa','u.s','u.s.a','united states of america'].includes(value.trim().toLocaleLowerCase().replace(/\.$/, ''));
}

function SearchableCombobox({label,value,onChange,options,placeholder,allowCustom=true,required=false,error='',onBlur}:{label:string;value:string;onChange:(value:string)=>void;options:ComboboxOption[];placeholder?:string;allowCustom?:boolean;required?:boolean;error?:string;onBlur?:()=>void}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query,setQuery]=useState(value);
  const [open,setOpen]=useState(false);
  const [activeIndex,setActiveIndex]=useState(0);
  const filtered = useMemo(()=>options.filter(option=>optionMatches(option,query)).slice(0,12),[options,query]);

  useEffect(()=>{ if (!open) setQuery(value); },[value,open]);
  useEffect(()=>{ setActiveIndex(0); },[query]);

  function choose(option: ComboboxOption) {
    onChange(option.value);
    setQuery(option.label);
    setOpen(false);
    queueMicrotask(()=>inputRef.current?.focus());
  }

  function commitDraft() {
    const match = exactOption(options, query);
    if (match) {
      onChange(match.value);
      setQuery(match.label);
    } else if (allowCustom) {
      onChange(query.trim());
      setQuery(query.trim());
    } else {
      setQuery(value);
    }
    setOpen(false);
    onBlur?.();
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(index=>Math.min(index + 1, Math.max(filtered.length - 1,0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(index=>Math.max(index - 1,0));
    } else if (event.key === 'Enter' && open && filtered[activeIndex]) {
      event.preventDefault();
      choose(filtered[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setQuery(value);
      setOpen(false);
    }
  }

  return (
    <label className={`form-field searchable-combobox${error ? ' has-error' : ''}`}>
      <span>{label}{required&&<> <b className="required-marker" aria-label="required">*</b></>}</span>
      <div className="searchable-combobox-control">
        <input
          ref={inputRef}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open&&filtered[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          value={query}
          placeholder={placeholder}
          autoComplete="off"
          onFocus={()=>setOpen(true)}
          onChange={event=>{setQuery(event.target.value);setOpen(true);}}
          onKeyDown={keyDown}
          onBlur={()=>setTimeout(commitDraft,0)}
        />
        <span className="searchable-combobox-chevron" aria-hidden="true">⌄</span>
        {open&&(
          <div className="searchable-combobox-menu" id={listId} role="listbox">
            {filtered.map((option,index)=><button
              id={`${listId}-${index}`}
              className={index===activeIndex ? 'is-active' : ''}
              key={`${option.value}-${index}`}
              type="button"
              role="option"
              aria-selected={option.value===value}
              onMouseDown={event=>event.preventDefault()}
              onClick={()=>choose(option)}
            ><strong>{option.label}</strong>{option.searchTerms?.[0]&&<span>{option.searchTerms[0]}</span>}</button>)}
            {!filtered.length&&<div className="searchable-combobox-empty">{allowCustom ? 'Keep this value as entered' : 'No matching option'}</div>}
          </div>
        )}
      </div>
      {error&&<small className="field-validation-error" role="alert">{error}</small>}
    </label>
  );
}

export function CountrySelect({value,onChange,error=''}:{value:string;onChange:(value:string)=>void;error?:string}) {
  return <SearchableCombobox label="Country" value={value} onChange={value=>onChange(canonicalCountryValue(value))} options={countryOptions} placeholder="Search country or code" error={error} />;
}

export function StateProvinceSelect({country,value,onChange,error=''}:{country:string;value:string;onChange:(value:string)=>void;error?:string}) {
  if (!isUnitedStatesCountry(country)) {
    return <label className={`form-field${error ? ' has-error' : ''}`}><span>State / Province / Region</span><input value={value} onChange={event=>onChange(event.target.value)} placeholder="Enter state, province, or region" />{error&&<small className="field-validation-error" role="alert">{error}</small>}</label>;
  }
  return <SearchableCombobox label="State" value={canonicalUsStateValue(value)} onChange={value=>onChange(canonicalUsStateValue(value))} options={usStateOptions} placeholder="Search state or abbreviation" error={error} />;
}

function internationalInput(value: string) {
  const trimmed = value.trimStart();
  const leadingPlus = trimmed.startsWith('+');
  const cleaned = trimmed.replace(/[^0-9()\- .]/g,'').replace(/-{2,}/g,'-').replace(/\s{2,}/g,' ');
  return `${leadingPlus ? '+' : ''}${cleaned}`.slice(0,80);
}

function usDigitsDisplay(digits: string) {
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0,3)}-${digits.slice(3)}`;
  return `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6,10)}${digits.length > 10 ? `-${digits.slice(10)}` : ''}`;
}

export function formatPhoneForCountry(value: string, country: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const digits = trimmed.replace(/\D/g,'');
  if (!isUnitedStatesCountry(country)) return internationalInput(value);
  if (trimmed.startsWith('+') && !digits.startsWith('1')) return internationalInput(value);
  if (trimmed.startsWith('+') && digits.startsWith('1')) return `+1${digits.length > 1 ? ` ${usDigitsDisplay(digits.slice(1))}` : ''}`;
  if (digits.length === 11 && digits.startsWith('1')) return `1-${usDigitsDisplay(digits.slice(1))}`;
  return usDigitsDisplay(digits);
}

export function normalizedPhoneValue(value: string, country: string) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g,'');
  if (!digits) return '';
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (isUnitedStatesCountry(country)) {
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  }
  return digits;
}

export function phoneValidationMessage(value: string, country: string, label = 'Phone Number') {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const digits = trimmed.replace(/\D/g,'');
  if (isUnitedStatesCountry(country)) {
    const valid = digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
    if (!valid) return `${label} must contain a 10-digit United States number, with optional +1.`;
    if (trimmed.startsWith('+') && !digits.startsWith('1')) return `${label} must use the +1 country code for United States.`;
    return '';
  }
  if (digits.length < 6 || digits.length > 15) return `${label} must contain 6 to 15 digits for the selected country.`;
  return '';
}

export function PhoneInput({label,value,country,onChange,error='',required=false,inputProps}:{label:string;value:string;country:string;onChange:(value:string)=>void;error?:string;required?:boolean;inputProps?:Record<string,string>}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [touched,setTouched]=useState(false);
  const inlineError = error || (touched ? phoneValidationMessage(value,country,label) : '');

  function handleSeparatorDelete(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Backspace' && event.key !== 'Delete') return;
    const input = event.currentTarget;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? start;
    if (start !== end) return;
    const neighbor = event.key === 'Backspace' ? value[start - 1] : value[start];
    if (neighbor !== '-' && neighbor !== ' ') return;
    event.preventDefault();
    const removeIndex = event.key === 'Backspace' ? Math.max(0,start - 2) : Math.min(value.length - 1,start + 1);
    const next = `${value.slice(0,removeIndex)}${value.slice(removeIndex + 1)}`;
    onChange(formatPhoneForCountry(next,country));
  }

  return (
    <label className={`form-field phone-input-field${inlineError ? ' has-error' : ''}`}>
      <span>{label}{required&&<> <b className="required-marker" aria-label="required">*</b></>}</span>
      <input
        {...inputProps}
        ref={inputRef}
        type="tel"
        inputMode="tel"
        value={value}
        onChange={event=>onChange(formatPhoneForCountry(event.target.value,country))}
        onKeyDown={handleSeparatorDelete}
        onBlur={()=>setTouched(true)}
        aria-invalid={Boolean(inlineError)}
      />
      {inlineError&&<small className="field-validation-error" role="alert">{inlineError}</small>}
    </label>
  );
}

export function ContactAccordion({expanded,onToggle,name,title,isPrimary,children,className=''}:{expanded:boolean;onToggle:()=>void;name:string;title:string;isPrimary:boolean;children?:ReactNode;className?:string}) {
  const panelId = useId();
  return (
    <article className={`vendor-contact-accordion${expanded ? ' is-expanded' : ''}${className ? ` ${className}` : ''}`}>
      <button className="vendor-contact-accordion-toggle" type="button" aria-expanded={expanded} aria-controls={panelId} onClick={onToggle}>
        <MccContactPill className="vendor-contact-name-pill">{name.trim() || 'New Contact'}</MccContactPill>
        {title.trim()&&<span className="vendor-contact-title-summary">{title}</span>}
        {isPrimary&&<MccStatusPill variant="contact" className="vendor-contact-primary-badge">Primary</MccStatusPill>}
        <span className="vendor-contact-chevron" aria-hidden="true">⌄</span>
      </button>
      {expanded&&<div className="vendor-contact-accordion-panel" id={panelId}>{children}</div>}
    </article>
  );
}
