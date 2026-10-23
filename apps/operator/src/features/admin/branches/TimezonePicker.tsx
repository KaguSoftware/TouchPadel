/**
 * The new branch's timezone, chosen in three steps: continent, then country,
 * then city (Sait, 2026-10-22), with a search across all of them. Only "Open a
 * new branch" offers it: once a branch exists its timezone is fixed at setup.
 *
 * The panel is portalled and position:fixed off the field's rect, the
 * SelectMenu machinery, so the wizard's scrolling body never clips it; it
 * closes on Escape, an outside press, or a scroll that moved the field.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { countPhrase, type MessageKey } from '@touch/i18n';
import { useLocale } from '../../../lib/i18n';
import { inputStyle } from '../../../components/ui';
import { ChevronBack, ChevronForward, Icon } from '../../../components/icons';
import type { TzContinent } from './timezoneData';
import { buildTzZones, tzCities, tzContinents, tzCountries, tzSearch, type TzZone } from './timezoneLogic';

type Level = 'continent' | 'country' | 'city';

const T = 'ws.branches.create.tz';

export function TimezonePicker({
  value,
  onChange,
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
}: {
  value: string;
  onChange: (zone: string) => void;
  /** Field(group) names the control from its label and hint. */
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}) {
  const { tr, locale, dir } = useLocale();
  const zones = useMemo(() => buildTzZones(locale), [locale]);
  const chosen = zones.find((z) => z.id === value);
  const continentName = (c: TzContinent) => tr(`${T}.continents.${c}` as MessageKey);

  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ start: number; top: number; width: number } | null>(null);
  const [level, setLevel] = useState<Level>('continent');
  const [continent, setContinent] = useState<TzContinent>(chosen?.continent ?? 'asia');
  const [country, setCountry] = useState<string>(chosen?.country ?? '');
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const anchor = useRef<{ x: number; y: number } | null>(null);
  const listId = useId();

  const close = (refocus: boolean) => {
    setOpen(false);
    setBox(null);
    if (refocus) triggerRef.current?.focus();
  };

  const openPanel = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    anchor.current = { x: rect.left, y: rect.top };
    setBox({ start: dir === 'rtl' ? window.innerWidth - rect.right : rect.left, top: rect.bottom + 4, width: rect.width });
    // Opens on the first list, with the chosen zone's continent and country lit.
    setLevel('continent');
    setContinent(chosen?.continent ?? 'asia');
    setCountry(chosen?.country ?? '');
    setQuery('');
    setOpen(true);
  };

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !triggerRef.current?.contains(t)) close(false);
    };
    // A scroll of the panel's own list stays open; one that moved the field closes it.
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && panelRef.current?.contains(e.target)) return;
      const now = triggerRef.current?.getBoundingClientRect();
      const was = anchor.current;
      if (was && now && Math.abs(now.top - was.y) < 1 && Math.abs(now.left - was.x) < 1) return;
      close(false);
    };
    const onResize = () => close(false);
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const pick = (z: TzZone) => {
    onChange(z.id);
    close(true);
  };

  const searching = query.trim() !== '';
  const results = searching ? tzSearch(zones, query, continentName) : [];
  const countryName = zones.find((z) => z.country === country)?.countryName ?? country;

  const tick = <Icon name="check" size={16} />;
  const more = <ChevronForward size={16} />;

  let rows: ReactNode = null;
  if (level === 'continent') {
    rows = tzContinents(zones).map((c) => {
      const on = c.key === chosen?.continent;
      return (
        <button key={c.key} type="button" role="option" aria-selected={on} className="tp-tz-row" onClick={() => { setContinent(c.key); setLevel('country'); }}>
          <span className="tp-tz-name">{continentName(c.key)}</span>
          <span className="tp-tz-meta">{countPhrase(`${T}.countries`, c.countries, locale)}</span>
          <span className="tp-tz-end" aria-hidden="true">{more}</span>
        </button>
      );
    });
  } else if (level === 'country') {
    rows = tzCountries(zones, continent, locale).map((c) => {
      const on = c.code === chosen?.country;
      return (
        <button key={c.code} type="button" role="option" aria-selected={on} className="tp-tz-row" onClick={() => { setCountry(c.code); setLevel('city'); }}>
          <span className="tp-tz-name"><bdi>{c.name}</bdi></span>
          <span className="tp-tz-meta">{countPhrase(`${T}.cities`, c.cities, locale)}</span>
          <span className="tp-tz-end" aria-hidden="true">{more}</span>
        </button>
      );
    });
  } else {
    rows = tzCities(zones, country).map((z) => {
      const on = z.id === value;
      return (
        <button key={z.id} type="button" role="option" aria-selected={on} className="tp-tz-row" onClick={() => pick(z)} data-value={z.id}>
          <span className="tp-tz-name"><bdi>{z.city}</bdi></span>
          <span className="tp-tz-meta" dir="ltr">{z.offset}</span>
          <span className="tp-tz-end" aria-hidden="true">{on ? tick : null}</span>
        </button>
      );
    });
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="tp-tz-field"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        onClick={() => (open ? close(false) : openPanel())}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.preventDefault();
            e.stopPropagation();
            close(true);
          }
        }}
        data-testid="branch-create.timezone"
        style={{ ...inputStyle, paddingBlock: 0 }}
      >
        <Icon name="globe" size={16} />
        <span className="tp-tz-path">
          {chosen ? (
            <>
              {continentName(chosen.continent)} › <bdi>{chosen.countryName}</bdi> › <strong><bdi>{chosen.city}</bdi></strong>
            </>
          ) : (
            <bdi dir="ltr">{value}</bdi>
          )}
        </span>
        {chosen && <span className="tp-tz-offset" dir="ltr">{chosen.offset}</span>}
        <Icon name="chevronDown" size={16} />
      </button>
      {open && box &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={tr(`${T}.list`)}
            className="tp-menu-glass tp-rise"
            // Portalled, so a dialog's dismiss-on-outside-click must know it is ours.
            data-menu-portal=""
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close(true);
              }
            }}
            style={{
              position: 'fixed',
              insetInlineStart: `${box.start}px`,
              insetBlockStart: `${box.top}px`,
              inlineSize: `${box.width}px`,
              zIndex: 'var(--tp-z-menu)',
              padding: 'var(--tp-sp-2)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--tp-sp-2)',
            }}
          >
            <label className="tp-tz-search">
              <Icon name="search" size={16} />
              <span className="tp-sr-only">{tr(`${T}.searchLabel`)}</span>
              <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr(`${T}.search`)} data-testid="branch-create.timezone.search" />
            </label>

            {searching ? (
              <div role="listbox" id={listId} aria-label={tr(`${T}.list`)} className="tp-tz-list">
                {results.map((z) => {
                  const on = z.id === value;
                  return (
                    <button key={z.id} type="button" role="option" aria-selected={on} className="tp-tz-row" onClick={() => pick(z)} data-value={z.id}>
                      <span className="tp-tz-name" style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
                        <strong><bdi>{z.city}</bdi></strong>
                        <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 400 }}>
                          {continentName(z.continent)} › <bdi>{z.countryName}</bdi>
                        </span>
                      </span>
                      <span className="tp-tz-offset" dir="ltr">{z.offset}</span>
                      <span className="tp-tz-end" aria-hidden="true">{on ? tick : null}</span>
                    </button>
                  );
                })}
                {results.length === 0 && <div style={{ padding: 'var(--tp-sp-4) var(--tp-sp-2-5)', fontSize: 'var(--tp-fs-md)' }}>{tr(`${T}.none`)}</div>}
              </div>
            ) : (
              <>
                {level !== 'continent' && (
                  <button type="button" className="tp-tz-back" onClick={() => setLevel(level === 'city' ? 'country' : 'continent')}>
                    <ChevronBack size={16} />
                    {level === 'city' ? (
                      <>
                        {continentName(continent)} › <bdi>{countryName}</bdi>
                      </>
                    ) : (
                      continentName(continent)
                    )}
                  </button>
                )}
                <div role="listbox" id={listId} aria-label={tr(`${T}.list`)} className="tp-tz-list">
                  {rows}
                </div>
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

/** "Baghdad · GMT+3" for the wizard's step menu, or the bare id when the platform does not know it. */
export function useTimezoneSummary(value: string): string {
  const { locale } = useLocale();
  const zones = useMemo(() => buildTzZones(locale), [locale]);
  const z = zones.find((x) => x.id === value);
  return z ? `${z.city} · ${z.offset}` : value;
}
