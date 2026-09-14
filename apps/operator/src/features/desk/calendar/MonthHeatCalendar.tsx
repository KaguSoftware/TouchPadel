/**
 * The zoomed-out level: a month of days, each shaded by how busy it was.
 *
 * The shade is the whole point — the owner asked that a day with 30
 * reservations read far darker than one with 6 — so it is measured against the
 * busiest day of the month on screen (see `heatLevel`). The count is also
 * printed in the square, because a shade alone cannot be read exactly and
 * cannot be read at all by a third of the colour-blind.
 *
 * Every square is a button carrying `data-cal-date`, which is what ZoomStage
 * measures to zoom in and out of the right day. Days of the neighbouring
 * months fill the rectangle but are faded and unshaded: their counts are for a
 * different month's scale.
 */
import type { CSSProperties } from 'react';
import { formatDate, formatDayNumber, formatMonthYear, formatNumber, formatWeekdayShort } from '@touch/i18n';
import { useLocale } from '../../../lib/i18n';
import { heatLevel, monthStart, monthWeeks } from './monthLogic';

/** Above this shade the day number flips to the contrast ink. */
const INK_FLIP = 0.55;

/** Shade → ground. oklab so the ramp darkens evenly rather than muddying mid-way. */
export function heatGround(level: number): string {
  if (level <= 0) return 'var(--tp-surface)';
  return `color-mix(in oklab, var(--tp-accent) ${Math.round(level * 100)}%, var(--tp-surface))`;
}

const noon = (iso: string) => new Date(`${iso}T12:00:00Z`);

export function MonthHeatCalendar({
  date,
  today,
  counts,
  max,
  loading,
  closedDates,
  onPick,
  countLabel,
  style,
}: {
  /** Any date in the month; also the day that is outlined as selected. */
  date: string;
  today: string;
  counts: ReadonlyMap<string, number>;
  /** The busiest in-month count — the full-dark end of the scale. */
  max: number;
  loading?: boolean;
  closedDates?: readonly string[];
  onPick: (date: string) => void;
  /** "30 bookings" — the spoken and legend form of a count. */
  countLabel: (count: number) => string;
  style?: CSSProperties;
}) {
  const { tr, locale } = useLocale();
  const month = monthStart(date).slice(0, 7);
  const weeks = monthWeeks(date);
  const closed = new Set(closedDates ?? []);

  let busiest: string | null = null;
  for (const d of weeks.flat()) {
    if (!d.startsWith(month)) continue;
    const c = counts.get(d) ?? 0;
    if (c > 0 && c === max && busiest === null) busiest = d;
  }

  return (
    <section style={{ display: 'grid', gap: 'var(--tp-sp-3)', alignContent: 'start', ...style }} aria-label={formatMonthYear(noon(date), locale, 'UTC')}>
      <div role="grid" style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
        <div role="row" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 'var(--tp-sp-1)' }}>
          {weeks[0]!.map((d) => (
            <div
              key={d}
              role="columnheader"
              style={{ fontSize: 'var(--tp-fs-xs)', fontWeight: 600, color: 'var(--tp-muted-fg)', textAlign: 'center', paddingBlock: 'var(--tp-sp-1)' }}
            >
              {formatWeekdayShort(noon(d), locale, 'UTC')}
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0]} role="row" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 'var(--tp-sp-1)' }}>
            {week.map((d) => {
              const inMonth = d.startsWith(month);
              const count = counts.get(d) ?? 0;
              const level = inMonth && !loading ? heatLevel(count, max) : 0;
              const dark = level >= INK_FLIP;
              const isClosed = closed.has(d);
              const spoken = `${formatDate(noon(d), locale, 'UTC')} · ${isClosed ? tr('ws.kit.calendar.closed') : countLabel(count)}`;
              return (
                <button
                  key={d}
                  type="button"
                  role="gridcell"
                  data-cal-date={d}
                  aria-label={spoken}
                  aria-selected={d === date}
                  title={spoken}
                  onClick={() => onPick(d)}
                  className="tp-tile"
                  style={{
                    position: 'relative',
                    minBlockSize: '4.75rem',
                    padding: 'var(--tp-sp-2)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    alignItems: 'stretch',
                    textAlign: 'start',
                    font: 'inherit',
                    cursor: 'pointer',
                    borderRadius: 'var(--tp-radius-ctl)',
                    border: '1px solid var(--tp-border)',
                    background: heatGround(level),
                    color: dark ? 'var(--tp-accent-contrast)' : 'var(--tp-fg)',
                    opacity: inMonth ? 1 : 0.42,
                    outline: d === date ? '2px solid var(--tp-fg)' : undefined,
                    outlineOffset: d === date ? '-2px' : undefined,
                    transition: 'background var(--tp-dur-base) var(--tp-ease-out)',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1)' }}>
                    <span
                      style={{
                        fontWeight: d === today ? 800 : 600,
                        fontVariantNumeric: 'tabular-nums',
                        ...(d === today
                          ? {
                              display: 'inline-grid',
                              placeItems: 'center',
                              minInlineSize: '1.6rem',
                              blockSize: '1.6rem',
                              borderRadius: '999px',
                              background: dark ? 'var(--tp-accent-contrast)' : 'var(--tp-fg)',
                              color: dark ? 'var(--tp-accent)' : 'var(--tp-bg)',
                            }
                          : null),
                      }}
                    >
                      {formatDayNumber(noon(d), locale, 'UTC')}
                    </span>
                    {isClosed && inMonth && (
                      <span style={{ fontSize: 'var(--tp-fs-xs)', opacity: 0.8, marginInlineStart: 'auto' }}>{tr('ws.kit.calendar.closed')}</span>
                    )}
                  </span>
                  {inMonth && (
                    <span
                      aria-hidden
                      style={{
                        alignSelf: 'flex-end',
                        fontSize: count > 0 ? 'var(--tp-fs-lg)' : 'var(--tp-fs-sm)',
                        fontWeight: count > 0 ? 700 : 400,
                        fontVariantNumeric: 'tabular-nums',
                        opacity: count > 0 ? 1 : 0.45,
                      }}
                    >
                      {loading ? '—' : formatNumber(count, locale)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-3)', flexWrap: 'wrap', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)' }}>
          {tr('ws.kit.calendar.fewer')}
          {[0.12, 0.34, 0.56, 0.78, 1].map((l) => (
            <span key={l} aria-hidden style={{ inlineSize: '1rem', blockSize: '0.75rem', borderRadius: '3px', background: heatGround(l), border: '1px solid var(--tp-border)' }} />
          ))}
          {tr('ws.kit.calendar.more')}
        </span>
        <span>{tr('ws.kit.calendar.scaleNote')}</span>
        {busiest && (
          <span style={{ marginInlineStart: 'auto', color: 'var(--tp-fg)' }}>
            {tr('ws.kit.calendar.busiest', { date: formatDate(noon(busiest), locale, 'UTC'), count: countLabel(max) })}
          </span>
        )}
      </div>
    </section>
  );
}
