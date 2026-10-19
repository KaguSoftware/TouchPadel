/**
 * The operator's one date-range control (Sait's pick, 2026-10-19, option E).
 *
 * A small field that reads "20 Sep – 19 Oct" with a chevron. It opens a panel
 * with the screen's periods as chips on one line (scrolling sideways when they
 * do not fit), a one-month calendar whose title opens a month grid and then a
 * year grid, and Clear / Apply at the foot. There is no summary line: the
 * FIELD shows the pick as it is made. Apply keeps it and closes; Escape or a
 * press outside closes and the field goes back to the applied range.
 *
 * The panel is portalled and fixed-positioned for the same reasons SelectMenu
 * is (read its header): the analytics bar is sticky and carries
 * backdrop-filter, which would otherwise trap and offset the panel. It also
 * carries `data-menu-portal` so a surrounding popover does not take a press
 * inside it for a press outside.
 *
 * The date logic is in ./dateRangeLogic.ts, tested under node.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { formatDate, formatMonthShort, formatMonthYear } from '@touch/i18n';
import { Button, inputStyle } from './ui';
import { ChevronBack, ChevronForward, Icon } from './icons';
import { useLocale } from '../lib/i18n';
import {
  addMonths,
  compareMonths,
  inRange,
  isoOf,
  isoParts,
  isoToDate,
  monthCells,
  monthTouches,
  openRangeText,
  orderedRange,
  rangeText,
  samePeriod,
  stepDay,
  yearMonthOf,
  yearPage,
  yearTouches,
  type Period,
  type YearMonth,
} from './dateRangeLogic';

export type { Period } from './dateRangeLogic';

export interface DateRangePreset {
  /** Handed back with the period, so a screen can keep a rolling preset ("30d") rather than fixed dates. */
  key: string;
  label: string;
  period: Period;
}

type Mode = 'days' | 'months' | 'years';

/** The station's own calendar date, for screens that pass no `today`. */
function localToday(): string {
  const d = new Date();
  return isoOf(d.getFullYear(), d.getMonth(), d.getDate());
}

export function DateRangePicker({
  value,
  onChange,
  presets = [],
  today,
  max,
  disabled,
  style,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: {
  value: Period;
  /** Called on Apply only. `presetKey` is set when the range is one of the chips. */
  onChange: (next: Period, presetKey?: string) => void;
  presets?: readonly DateRangePreset[];
  /** The day marked as today, and whose year the field leaves off. Defaults to the station clock. */
  today?: string;
  /** The last day that can be picked; later days, months and years are disabled. */
  max?: string;
  disabled?: boolean;
  /** Applied to the field, so a caller can size it like its neighbours. */
  style?: CSSProperties;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}) {
  const { tr, locale, dir } = useLocale();
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const todayIso = today ?? localToday();
  const currentYear = isoParts(todayIso).year;
  const maxMonth = max ? yearMonthOf(max) : null;
  const maxYear = maxMonth?.year;

  // Where the panel sits; null while closed. Measured once per open and never
  // chased: a scroll that moves the field closes it, as SelectMenu does.
  const [box, setBox] = useState<{ start: number; blockStart: number } | null>(null);
  const open = box !== null;
  const anchor = useRef<{ x: number; y: number } | null>(null);

  // The pick in progress. `draft` is what Apply would keep; `first` is the
  // first end of a range whose second end has not been picked yet.
  const [draft, setDraft] = useState<Period | null>(value);
  const [draftKey, setDraftKey] = useState<string | undefined>(undefined);
  const [first, setFirst] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('days');
  const [view, setView] = useState<YearMonth>(() => yearMonthOf(value.to));
  const [pickYear, setPickYear] = useState(() => yearMonthOf(value.to).year);
  const [focusDay, setFocusDay] = useState(value.to);
  const moveFocus = useRef(false);

  const monthName = useCallback(
    (month: number) => formatMonthShort(new Date(Date.UTC(2000, month, 15, 12)), locale, 'UTC'),
    [locale],
  );
  const keyOf = useCallback((p: Period) => presets.find((x) => samePeriod(x.period, p))?.key, [presets]);

  const close = useCallback((focusTrigger: boolean) => {
    setBox(null);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  function openPanel() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    anchor.current = { x: rect.left, y: rect.top };
    setDraft(value);
    setDraftKey(keyOf(value));
    setFirst(null);
    setHover(null);
    setMode('days');
    const ym = yearMonthOf(value.to);
    setView(ym);
    setPickYear(ym.year);
    setFocusDay(value.to);
    const GAP = 4;
    const GUTTER = 8;
    const IDEAL = 26 * 16;
    const below = window.innerHeight - rect.bottom - GAP - GUTTER;
    const above = rect.top - GAP - GUTTER;
    const flip = below < IDEAL && above > below;
    setBox({
      // Same reading-side arithmetic as SelectMenu: the portal inherits the
      // document's direction, so in Arabic this inset is from the right edge.
      start: dir === 'rtl' ? window.innerWidth - rect.right : rect.left,
      blockStart: flip ? -(window.innerHeight - rect.top + GAP) : rect.bottom + GAP,
    });
  }

  useEffect(() => {
    if (!open) return;
    const dismiss = (e: Event) => {
      const t = e.target;
      if (t instanceof Node && panelRef.current?.contains(t)) return;
      const was = anchor.current;
      const now = triggerRef.current?.getBoundingClientRect();
      if (was && now && Math.abs(now.top - was.y) < 1 && Math.abs(now.left - was.x) < 1) return;
      setBox(null);
    };
    const onResize = () => setBox(null);
    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !triggerRef.current?.contains(t)) setBox(null);
    };
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', onResize);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  // Slide the panel back inside the window when the field sits near its far edge.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel || !box) return;
    const rect = panel.getBoundingClientRect();
    const GUTTER = 8;
    const overflow = dir === 'rtl' ? GUTTER - rect.left : rect.right - (window.innerWidth - GUTTER);
    if (overflow <= 0) return;
    const start = Math.max(box.start - overflow, GUTTER);
    if (start !== box.start) setBox({ ...box, start });
  }, [open, box, dir]);

  // On open: focus the day the keyboard starts on, and bring the chosen chip into view.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>('.tp-drp-day[tabindex="0"]')?.focus();
    panelRef.current?.querySelector<HTMLElement>('.tp-drp-chip[aria-pressed="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [open]);

  // After an arrow key: follow the day it moved to.
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    panelRef.current?.querySelector<HTMLElement>(`[data-iso="${focusDay}"]`)?.focus();
  }, [focusDay, view]);

  function pickDay(iso: string) {
    setFocusDay(iso);
    if (first === null) {
      setFirst(iso);
      setHover(null);
      return;
    }
    const range = orderedRange(first, iso);
    setDraft(range);
    setDraftKey(keyOf(range));
    setFirst(null);
    setHover(null);
  }

  function pickPreset(p: DateRangePreset) {
    setDraft(p.period);
    setDraftKey(p.key);
    setFirst(null);
    setHover(null);
    setMode('days');
    setView(yearMonthOf(p.period.to));
    setFocusDay(p.period.to);
  }

  function clear() {
    setDraft(null);
    setDraftKey(undefined);
    setFirst(null);
    setHover(null);
  }

  function apply() {
    if (!draft || first !== null) return;
    onChange(draft, draftKey);
    close(true);
  }

  function onPanelKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // A dialog behind the panel must not close too.
      close(true);
    }
  }

  function onDayKeyDown(e: KeyboardEvent) {
    const next = stepDay(focusDay, e.key, dir === 'rtl');
    if (next === null) return;
    e.preventDefault();
    if (max && next > max) return;
    moveFocus.current = true;
    setFocusDay(next);
    if (first !== null) setHover(next);
    const ym = yearMonthOf(next);
    if (compareMonths(ym, view) !== 0) setView(ym);
  }

  // What the calendar paints: the live preview while the second end is being chosen.
  const shown: Period | null = first !== null ? orderedRange(first, hover ?? first) : draft;
  const fieldText = !open
    ? rangeText(value, currentYear, monthName)
    : first !== null
      ? openRangeText(first, currentYear, monthName)
      : draft
        ? rangeText(draft, currentYear, monthName)
        : null;

  const cells = monthCells(view);
  const viewFirst = isoOf(view.year, view.month, 1);
  const focusInView = compareMonths(yearMonthOf(focusDay), view) === 0;
  const tabbable = focusInView ? focusDay : viewFirst;
  const weekdays = tr('ws.kit.dateRange.weekdays').split(',');

  const nav = (label: string, back: boolean, onClick: () => void, off: boolean) => (
    <button type="button" className="tp-drp-nav" aria-label={label} disabled={off} onClick={onClick}>
      {back ? <ChevronBack size={16} /> : <ChevronForward size={16} />}
    </button>
  );

  let head: ReactNode;
  let body: ReactNode;
  if (mode === 'days') {
    head = (
      <>
        {nav(tr('ws.kit.dateRange.prevMonth'), true, () => setView((v) => addMonths(v, -1)), false)}
        <button
          type="button"
          className="tp-drp-title"
          aria-label={tr('ws.kit.dateRange.chooseMonth')}
          onClick={() => {
            setPickYear(view.year);
            setMode('months');
          }}
        >
          {formatMonthYear(isoToDate(viewFirst), locale, 'UTC')}
          <Icon name="chevronDown" size={14} />
        </button>
        {nav(tr('ws.kit.dateRange.nextMonth'), false, () => setView((v) => addMonths(v, 1)), maxMonth !== null && compareMonths(view, maxMonth) >= 0)}
      </>
    );
    body = (
      <div className="tp-drp-grid" onKeyDown={onDayKeyDown} onPointerLeave={() => setHover(null)}>
        {weekdays.map((w, i) => (
          <span key={`wd${i}`} className="tp-drp-wd" aria-hidden="true">
            {w}
          </span>
        ))}
        {cells.map((iso, i) =>
          iso === null ? (
            <span key={`blank${i}`} />
          ) : (
            <button
              key={iso}
              type="button"
              className="tp-drp-day"
              data-iso={iso}
              data-in={inRange(iso, shown) ? '' : undefined}
              data-start={shown?.from === iso ? '' : undefined}
              data-end={shown?.to === iso ? '' : undefined}
              data-today={iso === todayIso ? '' : undefined}
              aria-pressed={inRange(iso, shown)}
              aria-label={formatDate(isoToDate(iso), locale, 'UTC')}
              disabled={max !== undefined && iso > max}
              tabIndex={iso === tabbable ? 0 : -1}
              onClick={() => pickDay(iso)}
              onPointerEnter={() => {
                if (first !== null) setHover(iso);
              }}
            >
              {isoParts(iso).day}
            </button>
          ),
        )}
      </div>
    );
  } else if (mode === 'months') {
    head = (
      <>
        {nav(tr('ws.kit.dateRange.prevYear'), true, () => setPickYear((y) => y - 1), false)}
        <button type="button" className="tp-drp-title" aria-label={tr('ws.kit.dateRange.chooseYear')} onClick={() => setMode('years')}>
          {pickYear}
          <Icon name="chevronDown" size={14} />
        </button>
        {nav(tr('ws.kit.dateRange.nextYear'), false, () => setPickYear((y) => y + 1), maxYear !== undefined && pickYear >= maxYear)}
      </>
    );
    body = (
      <div className="tp-drp-picks">
        {Array.from({ length: 12 }, (_, m) => {
          const ym = { year: pickYear, month: m };
          return (
            <button
              key={m}
              type="button"
              className="tp-drp-pick"
              data-has={monthTouches(ym, shown) ? '' : undefined}
              data-cur={compareMonths(ym, view) === 0 ? '' : undefined}
              data-now={compareMonths(ym, yearMonthOf(todayIso)) === 0 ? '' : undefined}
              disabled={maxMonth !== null && compareMonths(ym, maxMonth) > 0}
              onClick={() => {
                setView(ym);
                setMode('days');
              }}
            >
              {monthName(m)}
            </button>
          );
        })}
      </div>
    );
  } else {
    const years = yearPage(pickYear, maxYear);
    head = (
      <>
        {nav(tr('ws.kit.dateRange.prevYears'), true, () => setPickYear((y) => y - 12), false)}
        <span className="tp-drp-title" data-plain="">
          {years[0]} – {years[years.length - 1]}
        </span>
        {nav(
          tr('ws.kit.dateRange.nextYears'),
          false,
          () => setPickYear((y) => (maxYear === undefined ? y + 12 : Math.min(maxYear, y + 12))),
          maxYear !== undefined && (years[years.length - 1] ?? 0) >= maxYear,
        )}
      </>
    );
    body = (
      <div className="tp-drp-picks">
        {years.map((y) => (
          <button
            key={y}
            type="button"
            className="tp-drp-pick"
            data-has={yearTouches(y, shown) ? '' : undefined}
            data-cur={y === view.year ? '' : undefined}
            data-now={y === currentYear ? '' : undefined}
            onClick={() => {
              setPickYear(y);
              setMode('months');
            }}
          >
            {y}
          </button>
        ))}
      </div>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        disabled={disabled}
        className={['tp-drp-field', className].filter(Boolean).join(' ')}
        data-open={open ? '' : undefined}
        onClick={() => (open ? close(false) : openPanel())}
        style={{ ...inputStyle, inlineSize: 'auto', ...style }}
      >
        <span data-placeholder={fieldText === null ? '' : undefined}>{fieldText ?? tr('ws.kit.dateRange.pickDates')}</span>
        <Icon name="chevronDown" size={14} />
      </button>
      {box &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label={tr('ws.kit.dateRange.panel')}
            className="tp-menu-glass tp-rise tp-drp"
            data-menu-portal=""
            onKeyDown={onPanelKeyDown}
            style={{
              position: 'fixed',
              insetInlineStart: `${box.start}px`,
              ...(box.blockStart < 0 ? { insetBlockEnd: `${-box.blockStart}px` } : { insetBlockStart: `${box.blockStart}px` }),
              zIndex: 'var(--tp-z-menu)',
            }}
          >
            {presets.length > 0 && (
              <div
                className="tp-drp-chips"
                role="group"
                aria-label={tr('ws.kit.dateRange.label')}
                // The row has no scrollbar, so a plain mouse wheel moves it sideways.
                onWheel={(e) => {
                  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
                  e.currentTarget.scrollLeft += dir === 'rtl' ? -e.deltaY : e.deltaY;
                }}
              >
                {presets.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className="tp-drp-chip"
                    aria-pressed={first === null && draftKey === p.key}
                    onClick={() => pickPreset(p)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            <div className="tp-drp-head">{head}</div>
            {body}
            <div className="tp-drp-foot">
              <Button size="sm" onClick={clear}>
                {tr('ws.kit.dateRange.clear')}
              </Button>
              <Button size="sm" kind="primary" disabled={draft === null || first !== null} onClick={apply}>
                {tr('ws.kit.dateRange.apply')}
              </Button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
