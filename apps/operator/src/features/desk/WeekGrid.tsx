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
 *
 * Colour and label both come from deskStatus, not from here. This file used to
 * own a private palette — solid --tp-accent and --tp-accent-2 fills — that
 * agreed with nothing else on the workspace and stated every state in colour
 * alone; a chip is now the same soft-ground, edged, LABELLED shape as a block
 * on the day grid.
 */
import { useMemo } from 'react';
import { formatTime } from '@touch/i18n';
import { useLocale, pickName } from '../../lib/i18n';
import { EmptyState } from '../../components/kit';
import type { CourtRow } from '../../lib/queries';
import { ReservationBadge, TONE_EDGE, TONE_FG, TONE_SOFT, reservationTone } from './deskStatus';
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

/**
 * The header row and the time column stay put while the night scrolls.
 * Scroll to 23:00 in the old grid and both were gone, leaving seven unlabelled
 * columns of chips — the two facts you need to read one are which day it is
 * and what hour you are looking at.
 */
const STICKY_HEAD = {
  position: 'sticky',
  insetBlockStart: 0,
  zIndex: 'var(--tp-z-table-head)',
  background: 'var(--tp-bg)',
} as const;

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
    return <EmptyState icon="ban" title={tr('op.desk.closedToday')} />;
  }

  return (
    <div style={{ flex: 1, minBlockSize: 0, overflow: 'auto' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `4.5rem repeat(7, minmax(9rem, 1fr))`,
          gap: 'var(--tp-sp-0)',
          minInlineSize: '68rem',
        }}
      >
        {/* Above both sticky axes, or the time labels slide out from under it. */}
        <div style={{ ...STICKY_HEAD, insetInlineStart: 0, zIndex: 'var(--tp-z-sticky)' }} />
        {dates.map((d) => {
          const closed = closedDates.includes(d);
          return (
            <div
              key={d}
              style={{
                ...STICKY_HEAD,
                paddingBlock: 'var(--tp-sp-1)',
                textAlign: 'center',
                fontWeight: 600,
                color: closed ? 'var(--tp-muted-fg)' : 'var(--tp-fg)',
                borderBlockEnd: '2px solid var(--tp-border)',
              }}
            >
              <div>
                {new Date(`${d}T12:00:00Z`).toLocaleDateString(
                  locale === 'ar' ? 'ar-IQ' : 'en-GB',
                  { weekday: 'short', timeZone: 'UTC' },
                )}
              </div>
              <div style={{ fontSize: 'var(--tp-fs-xs)', fontWeight: 400 }} dir="ltr">
                {d.slice(5)}
              </div>
              {/* A closed day is stated, not just empty: an empty column and a
                  shut venue look identical otherwise. */}
              {closed && (
                <div style={{ fontSize: 'var(--tp-fs-xs)', fontWeight: 400, color: 'var(--tp-muted-fg)' }}>
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
        style={{
          position: 'sticky',
          insetInlineStart: 0,
          zIndex: 'var(--tp-z-table-head)',
          background: 'var(--tp-bg)',
          fontSize: 'var(--tp-fs-xs)',
          color: 'var(--tp-muted-fg)',
          paddingBlockStart: 'var(--tp-sp-1)',
        }}
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
              minBlockSize: 'var(--tp-row-h)',
              background: 'var(--tp-surface-2)',
              borderRadius: 'var(--tp-radius-sm)',
              padding: 'var(--tp-sp-0)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--tp-sp-0)',
            }}
          >
            {inRow.map((r) => {
              const name = r.guest_name ?? tr('op.desk.walkIn');
              const court = courtName.get(r.court_id) ?? '';
              const tone = reservationTone(r);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onSelect(r.id)}
                  title={`${court} · ${name}`}
                  style={{
                    // Deliberately NOT .tp-tile: its hover repaints the whole
                    // surface in --tp-accent-soft, which would erase the one
                    // thing this chip's ground is carrying.
                    cursor: 'pointer',
                    textAlign: 'start',
                    // `font: inherit` FIRST: as a later declaration the
                    // shorthand reset the font-size set above it, so every
                    // chip rendered at body size whatever this file asked for.
                    font: 'inherit',
                    fontSize: 'var(--tp-fs-xs)',
                    lineHeight: 1.3,
                    display: 'grid',
                    gap: 'var(--tp-sp-0)',
                    minInlineSize: 0,
                    background: TONE_SOFT[tone],
                    color: TONE_FG[tone],
                    border: `1px ${r.kind === 'maintenance' ? 'dashed' : 'solid'} ${TONE_EDGE[tone]}`,
                    borderRadius: 'var(--tp-radius-sm)',
                    paddingBlock: 'var(--tp-sp-1)',
                    paddingInline: 'var(--tp-sp-1-5)',
                  }}
                >
                  <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <bdi style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatTime(new Date(r.start_at), locale, timeZone)}
                    </bdi>{' '}
                    <bdi>{name}</bdi>
                  </strong>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--tp-sp-1)' }}>
                    <bdi style={{ minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{court}</bdi>
                    <ReservationBadge reservation={r} size="sm" />
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
