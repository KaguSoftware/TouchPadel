/**
 * Week view for the desk calendar — SOW L307, "Day and week calendar across
 * all courts".
 *
 * The day grid is courts × time, which is the right shape for "what is court 2
 * doing at 19:00". A week is a different question — "are we free on Saturday
 * afternoon" — so this is days × time, with every court's bookings sharing the
 * cell and each chip naming its court. Seven days times N courts as separate
 * columns would be unreadable on a desk monitor.
 *
 * Clicking a chip opens the SAME detail modal the day grid uses, so move,
 * shorten, extend and cancel all work from here without a second code path.
 */
import { useMemo } from 'react';
import { formatTime } from '@touch/i18n';
import { useLocale, pickName } from '../../lib/i18n';
import { card } from '../../components/ui';
import type { CourtRow } from '../../lib/queries';
import { bucketByLocalDate, localMinutesOf, rowIndexFor, weekDates } from './weekLogic';

export interface WeekReservation {
  id: string;
  court_id: string;
  kind: string;
  status: string;
  start_at: string;
  end_at: string;
  guest_name: string | null;
}

const SLOT_MIN = 60; // Coarser than the day grid: a week has to fit on one screen.

export function WeekGrid({
  date,
  timeZone,
  openMin,
  closeMin,
  closedDates,
  courts,
  reservations,
  onSelect,
}: {
  /** Any date inside the week to show. */
  date: string;
  timeZone: string;
  openMin: number;
  closeMin: number;
  closedDates: readonly string[];
  courts: readonly CourtRow[];
  reservations: readonly WeekReservation[];
  onSelect(id: string): void;
}) {
  const { tr, locale } = useLocale();

  const dates = useMemo(() => weekDates(date), [date]);
  const rowCount = Math.max(0, Math.ceil((closeMin - openMin) / SLOT_MIN));
  const rows = useMemo(
    () => Array.from({ length: rowCount }, (_, i) => openMin + i * SLOT_MIN),
    [rowCount, openMin],
  );
  const buckets = useMemo(
    () => bucketByLocalDate(reservations, dates, timeZone),
    [reservations, dates, timeZone],
  );
  const courtName = useMemo(
    () => new Map(courts.map((c) => [c.id, pickName(locale, c)])),
    [courts, locale],
  );

  if (rowCount === 0) {
    return <p style={card}>{tr('op.desk.closedToday')}</p>;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `4.5rem repeat(7, minmax(9rem, 1fr))`,
          gap: '2px',
          minInlineSize: '68rem',
        }}
      >
        <div />
        {dates.map((d) => {
          const closed = closedDates.includes(d);
          return (
            <div
              key={d}
              style={{
                paddingBlock: '0.3rem',
                textAlign: 'center',
                fontWeight: 600,
                color: closed ? 'var(--tp-muted-fg)' : 'var(--tp-fg)',
              }}
            >
              <div>
                {new Date(`${d}T12:00:00Z`).toLocaleDateString(
                  locale === 'ar' ? 'ar-IQ' : 'en-GB',
                  { weekday: 'short', timeZone: 'UTC' },
                )}
              </div>
              <div style={{ fontSize: '0.75rem', fontWeight: 400 }} dir="ltr">
                {d.slice(5)}
              </div>
              {/* A closed day is stated, not just empty: an empty column and a
                  shut venue look identical otherwise. */}
              {closed && (
                <div style={{ fontSize: '0.7rem', color: 'var(--tp-muted-fg)' }}>
                  {tr('op.hours.closedDay')}
                </div>
              )}
            </div>
          );
        })}

        {rows.map((min, rowIdx) => (
          <FragmentRow
            key={min}
            min={min}
            rowIdx={rowIdx}
            dates={dates}
            buckets={buckets}
            timeZone={timeZone}
            openMin={openMin}
            rowCount={rowCount}
            courtName={courtName}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function FragmentRow({
  min,
  rowIdx,
  dates,
  buckets,
  timeZone,
  openMin,
  rowCount,
  courtName,
  onSelect,
}: {
  min: number;
  rowIdx: number;
  dates: readonly string[];
  buckets: ReadonlyMap<string, WeekReservation[]>;
  timeZone: string;
  openMin: number;
  rowCount: number;
  courtName: ReadonlyMap<string, string>;
  onSelect(id: string): void;
}) {
  const { tr, locale } = useLocale();
  const label = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

  return (
    <>
      <div
        style={{ fontSize: '0.75rem', color: 'var(--tp-muted-fg)', paddingBlockStart: '0.2rem' }}
        dir="ltr"
      >
        {label}
      </div>
      {dates.map((d) => {
        const inRow = (buckets.get(d) ?? []).filter(
          (r) =>
            rowIndexFor(localMinutesOf(r.start_at, timeZone), openMin, SLOT_MIN, rowCount) ===
            rowIdx,
        );
        return (
          <div
            key={d}
            style={{
              minBlockSize: '2.6rem',
              background: 'var(--tp-surface-2, var(--tp-muted))',
              borderRadius: '4px',
              padding: '2px',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
            }}
          >
            {inRow.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelect(r.id)}
                title={`${courtName.get(r.court_id) ?? ''} · ${r.guest_name ?? tr('op.desk.walkIn')}`}
                style={{
                  ...chipStyle(r),
                  textAlign: 'start',
                  border: 'none',
                  cursor: 'pointer',
                  font: 'inherit',
                  fontSize: '0.72rem',
                  paddingBlock: '0.15rem',
                  paddingInline: '0.3rem',
                  borderRadius: '3px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {formatTime(new Date(r.start_at), locale, timeZone)}{' '}
                {courtName.get(r.court_id) ?? ''} · {r.guest_name ?? tr('op.desk.walkIn')}
              </button>
            ))}
          </div>
        );
      })}
    </>
  );
}

/** Same colour language as the day grid, so the two views read as one calendar. */
function chipStyle(r: WeekReservation): { background: string; color: string } {
  if (r.kind === 'maintenance') {
    return { background: 'var(--tp-muted)', color: 'var(--tp-fg)' };
  }
  if (r.kind === 'hold' || r.status === 'arrived') {
    return { background: 'var(--tp-accent-2)', color: 'var(--tp-accent-2-contrast)' };
  }
  if (r.status === 'completed') {
    return { background: 'var(--tp-muted)', color: 'var(--tp-muted-fg)' };
  }
  return { background: 'var(--tp-accent)', color: 'var(--tp-accent-contrast)' };
}
