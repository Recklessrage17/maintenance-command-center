import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

type DatePopoverPosition = { top: number; left: number; width: number; placement: 'top' | 'bottom' };
type ParsedDateInput = { iso: string; complete: boolean; valid: boolean };

export function localIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseIsoDate(value: string) {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return strictDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

export function isoDateValue(value: string) {
  const parsed = parseTypedDate(value);
  return parsed.valid ? parsed.iso : value.trim() ? null : '';
}

export function formatDateDisplay(value: string) {
  const iso = isoDateValue(value);
  if (iso === null || !iso) return value;
  const [year, month, day] = iso.split('-');
  return `${month}/${day}/${year}`;
}

export function isValidMccDateValue(value: string, required = false) {
  const clean = value.trim();
  if (!clean) return !required;
  return parseTypedDate(clean).valid;
}

function strictDate(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function parsedResult(date: Date | null, complete: boolean): ParsedDateInput {
  return { iso: date ? localIsoDate(date) : '', complete, valid: Boolean(date) };
}

function parseTypedDate(value: string): ParsedDateInput {
  const clean = value.trim();
  if (!clean) return { iso: '', complete: true, valid: true };
  const digits = clean.replace(/\D/g, '');
  if (/^\d{8}$/.test(digits)) {
    const asMonthFirst = strictDate(Number(digits.slice(4)), Number(digits.slice(0, 2)), Number(digits.slice(2, 4)));
    if (asMonthFirst) return parsedResult(asMonthFirst, true);
    const asYearFirst = strictDate(Number(digits.slice(0, 4)), Number(digits.slice(4, 6)), Number(digits.slice(6, 8)));
    return parsedResult(asYearFirst, true);
  }
  const isoMatch = clean.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoMatch) return parsedResult(strictDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3])), true);
  const usMatch = clean.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (usMatch) return parsedResult(strictDate(Number(usMatch[3]), Number(usMatch[1]), Number(usMatch[2])), true);
  return { iso: '', complete: digits.length >= 8, valid: false };
}

export function MccDateInput({
  label,
  value,
  onChange,
  disabled = false,
  helper,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  helper?: ReactNode;
  required?: boolean;
}) {
  const today = useMemo(()=>new Date(),[]);
  const generatedId=useId().replace(/:/g,'');
  const calendarId=`mcc-date-calendar-${generatedId}`;
  const [draft,setDraft]=useState(formatDateDisplay(value));
  const [open,setOpen]=useState(false);
  const parsed = parseTypedDate(value);
  const selectedDate = parsed.valid && parsed.iso ? parseIsoDate(parsed.iso) : null;
  const [viewDate,setViewDate]=useState<Date>(selectedDate ?? today);
  const [focusedIso,setFocusedIso]=useState(selectedDate ? localIsoDate(selectedDate) : localIsoDate(today));
  const [focusRequest,setFocusRequest]=useState(0);
  const wrapRef=useRef<HTMLLabelElement>(null);
  const inputRef=useRef<HTMLInputElement>(null);
  const triggerRef=useRef<HTMLButtonElement>(null);
  const popoverRef=useRef<HTMLDivElement>(null);
  const returnFocusRef=useRef<HTMLElement|null>(null);
  const focusDayOnRenderRef=useRef(false);
  const [position,setPosition]=useState<DatePopoverPosition>({top:0,left:0,width:312,placement:'bottom'});
  const invalid = Boolean(draft.trim()) && !parseTypedDate(draft).valid;
  const viewYear = viewDate.getFullYear();
  const viewMonth = viewDate.getMonth();
  const monthStart = new Date(viewYear, viewMonth, 1);
  const gridStart = new Date(viewYear, viewMonth, 1 - monthStart.getDay());
  const days = Array.from({length:42},(_,index)=>new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index));
  const selectedIso = selectedDate ? localIsoDate(selectedDate) : '';
  const todayIso = localIsoDate(today);

  useEffect(()=>setDraft(formatDateDisplay(value)),[value]);

  function findDayButton(iso: string) {
    return Array.from(
      popoverRef.current?.querySelectorAll<HTMLButtonElement>('[data-mcc-calendar-date]') ?? [],
    ).find(button=>button.dataset.mccCalendarDate===iso) ?? null;
  }

  function requestDayFocus(date: Date) {
    const iso=localIsoDate(date);
    focusDayOnRenderRef.current=true;
    setFocusRequest(current=>current+1);
    setFocusedIso(iso);
    if(date.getFullYear()!==viewYear||date.getMonth()!==viewMonth){
      setViewDate(new Date(date.getFullYear(),date.getMonth(),1));
    }
  }

  function openCalendar(returnTarget: HTMLElement, focusCalendar = false) {
    returnFocusRef.current=returnTarget;
    const focusDate=selectedDate ?? today;
    setViewDate(focusDate);
    setFocusedIso(localIsoDate(focusDate));
    focusDayOnRenderRef.current=focusCalendar;
    if(focusCalendar)setFocusRequest(current=>current+1);
    setOpen(true);
  }

  function closeCalendar(restoreFocus = false) {
    setOpen(false);
    focusDayOnRenderRef.current=false;
    if(!restoreFocus)return;
    const returnTarget=returnFocusRef.current ?? inputRef.current;
    window.requestAnimationFrame(()=>{
      if(returnTarget?.isConnected&&!returnTarget.matches(':disabled'))returnTarget.focus();
    });
  }

  function updatePopoverPosition() {
    const anchor = wrapRef.current?.querySelector('.mcc-date-control') ?? wrapRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const margin = 10;
    const preferredWidth = Math.min(312, Math.max(260, window.innerWidth - margin * 2));
    const popoverHeight = popoverRef.current?.offsetHeight || 344;
    const width = Math.min(preferredWidth, window.innerWidth - margin * 2);
    const belowTop = rect.bottom + 8;
    const aboveTop = rect.top - popoverHeight - 8;
    const hasRoomBelow = belowTop + popoverHeight <= window.innerHeight - margin;
    const top = hasRoomBelow ? belowTop : Math.max(margin, aboveTop);
    const left = Math.min(Math.max(margin, rect.right - width), window.innerWidth - width - margin);
    setPosition({top,left,width,placement:hasRoomBelow ? 'bottom' : 'top'});
  }

  useEffect(()=>{
    if(!open) return;
    const focusDate=selectedDate ?? today;
    setViewDate(focusDate);
    setFocusedIso(localIsoDate(focusDate));
    updatePopoverPosition();
    const frame = window.requestAnimationFrame(updatePopoverPosition);
    return ()=>window.cancelAnimationFrame(frame);
  },[open,selectedIso,today]);

  useEffect(()=>{
    if(!open||!focusDayOnRenderRef.current)return;
    const frame=window.requestAnimationFrame(()=>{
      const button=findDayButton(focusedIso);
      if(!button)return;
      focusDayOnRenderRef.current=false;
      button.focus();
    });
    return()=>window.cancelAnimationFrame(frame);
  },[focusRequest,focusedIso,open,viewMonth,viewYear]);

  useEffect(()=>{
    if(!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if(wrapRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      closeCalendar();
    }
    function onKeyDown(event: KeyboardEvent) {
      if(event.key!=='Escape')return;
      event.preventDefault();
      event.stopPropagation();
      closeCalendar(true);
    }
    document.addEventListener('pointerdown',onPointerDown);
    document.addEventListener('keydown',onKeyDown);
    window.addEventListener('resize',updatePopoverPosition);
    window.addEventListener('scroll',updatePopoverPosition,true);
    return ()=>{
      document.removeEventListener('pointerdown',onPointerDown);
      document.removeEventListener('keydown',onKeyDown);
      window.removeEventListener('resize',updatePopoverPosition);
      window.removeEventListener('scroll',updatePopoverPosition,true);
    };
  },[open]);

  function setDateValue(raw: string) {
    const next = parseTypedDate(raw);
    if (next.valid) {
      onChange(next.iso);
      setDraft(next.iso ? formatDateDisplay(next.iso) : '');
      return;
    }
    setDraft(raw);
    onChange(raw);
  }

  function chooseDate(date: Date) {
    const iso = localIsoDate(date);
    onChange(iso);
    setDraft(formatDateDisplay(iso));
    closeCalendar(true);
  }

  function shiftedMonthDate(offset: number) {
    const focusedDate=parseIsoDate(focusedIso) ?? new Date(viewYear,viewMonth,1);
    const targetMonthStart=new Date(viewYear,viewMonth+offset,1);
    const lastDay=new Date(
      targetMonthStart.getFullYear(),
      targetMonthStart.getMonth()+1,
      0,
    ).getDate();
    return new Date(
      targetMonthStart.getFullYear(),
      targetMonthStart.getMonth(),
      Math.min(focusedDate.getDate(),lastDay),
    );
  }

  function moveMonth(offset: number, focusDay = false) {
    const next=shiftedMonthDate(offset);
    setViewDate(new Date(next.getFullYear(),next.getMonth(),1));
    setFocusedIso(localIsoDate(next));
    focusDayOnRenderRef.current=focusDay;
    if(focusDay)setFocusRequest(current=>current+1);
  }

  function handleDayKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, day: Date) {
    let next:Date|null=null;
    if(event.key==='ArrowLeft')next=new Date(day.getFullYear(),day.getMonth(),day.getDate()-1);
    if(event.key==='ArrowRight')next=new Date(day.getFullYear(),day.getMonth(),day.getDate()+1);
    if(event.key==='ArrowUp')next=new Date(day.getFullYear(),day.getMonth(),day.getDate()-7);
    if(event.key==='ArrowDown')next=new Date(day.getFullYear(),day.getMonth(),day.getDate()+7);
    if(event.key==='Home')next=new Date(day.getFullYear(),day.getMonth(),day.getDate()-day.getDay());
    if(event.key==='End')next=new Date(day.getFullYear(),day.getMonth(),day.getDate()+(6-day.getDay()));
    if(event.key==='PageUp'||event.key==='PageDown'){
      event.preventDefault();
      moveMonth(event.key==='PageUp'?-1:1,true);
      return;
    }
    if(!next)return;
    event.preventDefault();
    requestDayFocus(next);
  }

  const calendar = open ? createPortal(
    <div
      id={calendarId}
      className={`mcc-date-popover placement-${position.placement}`}
      ref={popoverRef}
      role="dialog"
      aria-label={`${label} calendar`}
      style={{top:position.top,left:position.left,width:position.width}}
    >
      <div className="mcc-date-header">
        <button type="button" onClick={()=>moveMonth(-1)} aria-label="Previous month">&lt;</button>
        <strong>{viewDate.toLocaleString(undefined,{month:'long',year:'numeric'})}</strong>
        <button type="button" onClick={()=>moveMonth(1)} aria-label="Next month">&gt;</button>
      </div>
      <div className="mcc-date-weekdays" aria-hidden="true">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day=><span key={day}>{day}</span>)}
      </div>
      <div className="mcc-date-grid">
        {days.map(day=>{
          const iso=localIsoDate(day);
          const outside=day.getMonth()!==viewMonth;
          return <button
            className={`${outside?'outside ':''}${iso===todayIso?'today ':''}${iso===selectedIso?'selected ':''}`.trim()}
            type="button"
            key={iso}
            data-mcc-calendar-date={iso}
            tabIndex={iso===focusedIso?0:-1}
            onFocus={()=>setFocusedIso(iso)}
            onKeyDown={event=>handleDayKeyDown(event,day)}
            onClick={()=>chooseDate(day)}
            aria-label={day.toLocaleDateString(undefined,{dateStyle:'full'})}
            aria-pressed={iso===selectedIso}
          >
            {day.getDate()}
          </button>;
        })}
      </div>
      <div className="mcc-date-footer">
        <button type="button" onClick={()=>{onChange('');setDraft('');closeCalendar(true);}}>Clear</button>
        <button type="button" onClick={()=>chooseDate(today)}>Today</button>
      </div>
    </div>,
    document.body,
  ) : null;

  return <label className={open?'form-field machine-date-field mcc-date-open':'form-field machine-date-field'} ref={wrapRef}>
    <span>{label}</span>
    <div className="mcc-date-control">
      <input
        ref={inputRef}
        className="mcc-date-input"
        type="text"
        inputMode="numeric"
        value={draft}
        disabled={disabled}
        required={required}
        aria-invalid={invalid}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={calendarId}
        onClick={event=>{if(!open)openCalendar(event.currentTarget);}}
        onKeyDown={event=>{
          if(event.key!=='ArrowDown')return;
          event.preventDefault();
          openCalendar(event.currentTarget,true);
        }}
        onChange={event=>setDateValue(event.target.value)}
        onBlur={()=>{
          const next = parseTypedDate(draft);
          if (next.valid) setDraft(next.iso ? formatDateDisplay(next.iso) : '');
        }}
        placeholder="MM/DD/YYYY"
      />
      <button
        ref={triggerRef}
        className="mcc-date-trigger"
        type="button"
        aria-label={`Open ${label} calendar`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={calendarId}
        disabled={disabled}
        onKeyDown={event=>{
          if(event.key!=='ArrowDown')return;
          event.preventDefault();
          openCalendar(event.currentTarget,true);
        }}
        onClick={event=>{
          if(open)closeCalendar();
          else openCalendar(event.currentTarget);
        }}
      >
        <span className="mcc-date-icon" aria-hidden="true" />
      </button>
      {calendar}
    </div>
    {invalid&&<small className="machine-date-error">Enter a valid date.</small>}
    {helper}
  </label>;
}
