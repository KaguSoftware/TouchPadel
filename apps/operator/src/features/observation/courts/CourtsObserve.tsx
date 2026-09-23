/**
 * Courts (/observation/courts) — Management's reading of the courts.
 *
 * The desk calendar is a workstation: 30-minute slots to click into, bookings
 * to drag, a dialog on every block. An owner watching the venue needs none of
 * that and was being handed all of it. This board answers three questions and
 * changes nothing (owner call, 2026-09-13):
 *
 *   1. What does the day add up to?   — the figure strip.
 *   2. What is each court doing now?  — one card per court, today only.
 *   3. How is the night laid out?     — the schedule in two-hour rows, which
 *      shows the shape of a night without the minute-level grid a clerk books
 *      into. Bookings that did not happen are listed under it, not drawn on it.
 *
 * Zooming out shows the month, each day shaded by its bookings against the
 * busiest day of that month; pressing a day zooms back into it. Pressing a
 * booking opens the read-only panel, whose one button moves the station into
 * the court desk on that booking.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { wallTimeToUtc } from '@touch/core';
import { formatDate, formatNumber, formatTime, formatTimeRange, VENUE_TZ } from '@touch/i18n';
import { supabase } from '../../../lib/supabase';
import { useLocale, pickName } from '../../../lib/i18n';
import { Button } from '../../../components/ui';
import { AsyncStateWrapper, DescriptionList, EmptyState, HeadlineFigure, Money, PageHeader, Panel, StatusBadge, TabStatusIndicator, asyncStatus, type Tone } from '../../../components/kit';
import { ChevronForward, Icon } from '../../../components/icons';
import { useTradingNight, todayInTz } from '../../desk/useTradingNight';
import { ReservationBadge, TONE_EDGE, TONE_FG, TONE_SOFT, reservationTone } from '../../desk/deskStatus';
import { courtAvailability, guestNameOf } from '../../desk/deskLogic';
import type { ReservationRow } from '../../desk/deskTypes';
import type { CourtRow } from '../../../lib/queries';
import { MonthHeatCalendar } from '../../desk/calendar/MonthHeatCalendar';
import { ZoomStage, type ZoomLevel } from '../../desk/calendar/ZoomStage';
import { useMonthCounts } from '../../desk/calendar/useMonthCounts';
import { fetchBookingCounts } from '../../desk/calendar/monthFetchers';
import { tradingDateOf } from '../../desk/calendar/monthLogic';
import { ObserveDateBar } from '../ObserveDateBar';
import { DetailPanel, PanelSection } from '../DetailPanel';
import { courtDaySummary, didNotHappen, isOnSchedule, schedulePlacement } from '../observeLogic';

/** Two-hour rows (owner call): the shape of the night, not the minute. */
const BAND_MIN = 120;
const BAND_REM = 3;
/** Time gutter and the narrowest a court column gets before the board scrolls. */
const GUTTER_REM = 4;
const COURT_MIN_REM = 7.5;

export function CourtsObserveScreen() {
  const { tr } = useLocale();
  const queryClient = useQueryClient();
  const [date, setDate] = useState<string>(() => todayInTz(VENUE_TZ));
  const [level, setLevel] = useState<ZoomLevel>('day');
  const [openId, setOpenId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const night = useTradingNight(date);
  const { tz, settingsQ } = night;
  const today = todayInTz(tz);

  const month = useMonthCounts({
    queryKey: 'reservationsMonth',
    date,
    timeZone: tz,
    hours: settingsQ.data?.opening_hours,
    enabled: level === 'month' && settingsQ.isSuccess,
    fetchCounts: fetchBookingCounts,
  });

  const opened = night.reservations.find((r) => r.id === openId) ?? null;
  const updatedAt = night.reservationsQ.dataUpdatedAt ? new Date(night.reservationsQ.dataUpdatedAt) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minBlockSize: '100%' }}>
      <PageHeader
        style={{ flexShrink: 0 }}
        title={tr('ws.owner.observe.courts.title')}
        subtitle={tr('ws.owner.observe.courts.lead')}
        actions={
          <>
            {updatedAt && <UpdatedAt at={updatedAt} />}
            <Button
              kind="ghost"
              icon="refresh"
              busy={night.reservationsQ.isFetching && night.reservationsQ.data !== undefined}
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: ['reservations'] });
                void queryClient.invalidateQueries({ queryKey: ['reservationsMonth'] });
              }}
            >
              {tr('ws.kit.actions.refresh')}
            </Button>
          </>
        }
      >
        <ObserveDateBar date={date} today={today} level={level} onDate={setDate} onLevel={setLevel} keysDisabled={openId !== null} />
      </PageHeader>

      <ZoomStage level={level} focusDate={date} style={{ flex: 1 }}>
        {level === 'month' ? (
          <AsyncStateWrapper status={month.isError ? 'error' : 'ready'} error={month.error} onRetry={month.refetch}>
            <MonthHeatCalendar
              date={date}
              today={today}
              counts={month.counts}
              max={month.max}
              loading={month.isPending}
              closedDates={night.closedDates}
              countLabel={(count) => tr(count === 1 ? 'ws.kit.calendar.bookingsOne' : 'ws.kit.calendar.bookings', { count })}
              onPick={(d) => {
                setDate(d);
                setLevel('day');
              }}
            />
          </AsyncStateWrapper>
        ) : (
          <DayView date={date} today={today} now={now} night={night} onOpen={setOpenId} />
        )}
      </ZoomStage>

      {opened && <BookingPanel reservation={opened} courts={night.courts} tz={tz} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function UpdatedAt({ at }: { at: Date }) {
  const { tr, locale } = useLocale();
  return <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.ops.updated', { time: formatTime(at, locale) })}</span>;
}

function DayView({
  date,
  today,
  now,
  night,
  onOpen,
}: {
  date: string;
  today: string;
  now: number;
  night: ReturnType<typeof useTradingNight>;
  onOpen: (id: string) => void;
}) {
  const { tr, locale } = useLocale();
  const { settingsQ, courtsQ, reservationsQ, courts, reservations, closed, openMin, closeMin, dayStart, tz } = night;
  const isToday = date === today;
  // The fetch window starts at local midnight, so it also holds the 00:00–02:00
  // tail of the PREVIOUS night. Those bookings are that night's figures; counted
  // here too, every late booking would be in two days' totals.
  const hours = settingsQ.data?.opening_hours;
  const ownNight = useMemo(() => reservations.filter((r) => tradingDateOf(r.start_at, tz, hours) === date), [reservations, tz, hours, date]);
  const summary = useMemo(() => courtDaySummary(ownNight, now), [ownNight, now]);
  const missed = useMemo(() => didNotHappen(ownNight), [ownNight]);

  const status =
    settingsQ.isError && !settingsQ.data
      ? 'error'
      : reservationsQ.isError && !reservationsQ.data
        ? 'error'
        : settingsQ.data && reservationsQ.data && courtsQ.data
          ? 'ready'
          : 'loading';

  return (
    <AsyncStateWrapper
      status={status === 'ready' ? asyncStatus(courtsQ, (c) => c.length === 0) : status}
      error={settingsQ.error ?? reservationsQ.error ?? courtsQ.error}
      onRetry={() => {
        void settingsQ.refetch();
        void courtsQ.refetch();
        void reservationsQ.refetch();
      }}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', paddingBlockEnd: 'var(--tp-sp-4)' }}>
        <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(10.5rem, 1fr))' }}>
          <HeadlineFigure
            label={tr('ws.owner.observe.courts.figures.booked')}
            value={formatNumber(summary.booked, locale)}
            hint={tr('ws.owner.observe.courts.figures.bookedHint', { hours: formatNumber(Math.round((summary.bookedMinutes / 60) * 10) / 10, locale) })}
          />
          {/* No "of 3 booked" hint: the booked count is the tile beside it. */}
          <HeadlineFigure label={tr('ws.owner.observe.courts.figures.arrived')} value={formatNumber(summary.arrived, locale)} />
          {date >= today && <HeadlineFigure label={tr('ws.owner.observe.courts.figures.upcoming')} value={formatNumber(summary.upcoming, locale)} />}
          <HeadlineFigure
            label={tr('ws.owner.observe.courts.figures.noShows')}
            value={formatNumber(summary.noShows, locale)}
            tone={summary.noShows > 0 ? 'danger' : 'neutral'}
          />
          <HeadlineFigure label={tr('ws.owner.observe.courts.figures.cancelled')} value={formatNumber(summary.cancelled, locale)} />
          <HeadlineFigure
            label={tr('ws.owner.observe.courts.figures.value')}
            value={<Money amount={summary.bookedIqd} />}
            hint={tr('ws.owner.observe.courts.figures.valueHint')}
          />
        </div>

        {closed ? (
          <EmptyState icon="ban" title={tr('ws.owner.observe.courts.schedule.closed')} />
        ) : (
          <>
            {isToday && <CourtsNow courts={courts} reservations={reservations} now={now} tz={tz} onOpen={onOpen} />}
            <Panel title={tr('ws.owner.observe.courts.schedule.title')} padded={false}>
              <ScheduleLegend />
              <ScheduleBoard
                date={date}
                tz={tz}
                courts={courts}
                reservations={ownNight.filter(isOnSchedule)}
                openMin={openMin}
                closeMin={closeMin}
                dayStartMs={dayStart.getTime()}
                nowMs={isToday ? now : null}
                onOpen={onOpen}
              />
            </Panel>
            {missed.length > 0 && (
              <Panel title={tr('ws.owner.observe.courts.notActive.title')}>
                <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.owner.observe.courts.notActive.lead')}</p>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
                  {missed.map((r) => (
                    <li key={r.id}>
                      <button type="button" className="tp-row" onClick={() => onOpen(r.id)} style={rowButton}>
                        <strong style={{ minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <bdi>{guestNameOf(r) ?? tr('op.desk.walkIn')}</bdi>
                        </strong>
                        <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
                          {pickName(locale, courts.find((c) => c.id === r.court_id))} · <bdi>{formatTimeRange(new Date(r.start_at), new Date(r.end_at), locale, tz)}</bdi>
                        </span>
                        <span style={{ marginInlineStart: 'auto', display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
                          <ReservationBadge reservation={r} size="sm" />
                          <ChevronForward size={14} style={{ color: 'var(--tp-muted-fg)' }} />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </>
        )}
      </div>
    </AsyncStateWrapper>
  );
}

const rowButton = {
  inlineSize: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--tp-sp-3)',
  flexWrap: 'wrap',
  textAlign: 'start',
  font: 'inherit',
  color: 'inherit',
  background: 'transparent',
  border: '1px solid var(--tp-border)',
  borderRadius: 'var(--tp-radius-ctl)',
  paddingBlock: 'var(--tp-sp-2)',
  paddingInline: 'var(--tp-sp-3)',
  cursor: 'pointer',
} as const;

// ---------------------------------------------------------------------------
// Right now
// ---------------------------------------------------------------------------

function CourtsNow({
  courts,
  reservations,
  now,
  tz,
  onOpen,
}: {
  courts: readonly CourtRow[];
  reservations: readonly ReservationRow[];
  now: number;
  tz: string;
  onOpen: (id: string) => void;
}) {
  const { tr, locale } = useLocale();
  const states = courtAvailability(
    courts.map((c) => c.id),
    reservations,
    new Date(now).toISOString(),
  );
  const inPlay = states.filter((s) => s.state === 'busy' && s.kind === 'booking').length;
  // A court that is free with nothing more booked tonight has nothing to say
  // beyond its name, and on a quiet night that was every card on the board —
  // a wall of identical "Free · nothing more tonight" tiles pushing the
  // schedule off the screen. Those courts are named on one line instead, and
  // the cards are the courts with something happening, busy ones first.
  const idle = states.filter((s) => s.state !== 'busy' && !s.nextStartAt);
  const shown = [...states.filter((s) => s.state === 'busy'), ...states.filter((s) => s.state !== 'busy' && s.nextStartAt)];

  return (
    <Panel
      title={tr('ws.owner.observe.courts.now.title')}
      actions={
        <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          {tr('ws.owner.observe.courts.now.summary', { inPlay: formatNumber(inPlay, locale), total: formatNumber(courts.length, locale) })}
        </span>
      }
    >
      {shown.length > 0 && (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', gridTemplateColumns: 'repeat(auto-fill, minmax(13rem, 1fr))' }}>
          {shown.map((s) => {
            const court = courts.find((c) => c.id === s.courtId);
            let tone: Tone;
            let label: string;
            let line: string;
            let who: string | null = null;
            let targetId: string | null = null;
            if (s.state === 'busy') {
              const r = reservations.find((x) => x.id === s.reservationId);
              tone = s.kind === 'booking' ? 'success' : s.kind === 'hold' ? 'info' : 'neutral';
              label = tr(s.kind === 'booking' ? 'ws.owner.observe.courts.now.inPlay' : s.kind === 'hold' ? 'ws.owner.observe.courts.now.held' : 'ws.owner.observe.courts.now.blocked');
              line = tr('ws.owner.observe.courts.now.until', { time: formatTime(new Date(s.untilAt), locale, tz) });
              who = s.kind === 'booking' ? (guestNameOf(r) ?? tr('op.desk.walkIn')) : (r?.notes ?? null);
              targetId = s.reservationId;
            } else {
              const next = s.nextStartAt ? reservations.find((x) => x.start_at === s.nextStartAt && x.court_id === s.courtId) : null;
              tone = 'neutral';
              label = tr('ws.owner.observe.courts.now.free');
              line = s.nextStartAt ? tr('ws.owner.observe.courts.now.next', { time: formatTime(new Date(s.nextStartAt), locale, tz) }) : tr('ws.owner.observe.courts.now.nextNone');
              who = next ? (next.kind === 'booking' ? (guestNameOf(next) ?? tr('op.desk.walkIn')) : null) : null;
              targetId = next?.id ?? null;
            }
            const body = (
              <>
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', minInlineSize: 0 }}>
                  <Icon name="court" size={15} style={{ color: 'var(--tp-muted-fg)', flexShrink: 0 }} />
                  <strong style={{ minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pickName(locale, court)}</strong>
                  <span style={{ marginInlineStart: 'auto', flexShrink: 0 }}>
                    <StatusBadge tone={tone} size="sm" label={label} />
                  </span>
                </span>
                <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                  {who && (
                    <>
                      <bdi style={{ color: 'var(--tp-fg)' }}>{who}</bdi> ·{' '}
                    </>
                  )}
                  {line}
                </span>
              </>
            );
            const style = {
              display: 'grid',
              // minmax(0, …): a long court name must truncate, not push the badge out.
              gridTemplateColumns: 'minmax(0, 1fr)',
              gap: 'var(--tp-sp-1)',
              textAlign: 'start' as const,
              font: 'inherit',
              color: 'inherit',
              padding: 'var(--tp-sp-3)',
              borderRadius: 'var(--tp-radius-ctl)',
              border: `1px solid ${s.state === 'busy' ? TONE_EDGE[tone] : 'var(--tp-border)'}`,
              background: s.state === 'busy' ? TONE_SOFT[tone] : 'var(--tp-bg)',
            };
            return targetId ? (
              <button key={s.courtId} type="button" className="tp-tile" onClick={() => onOpen(targetId)} style={{ ...style, cursor: 'pointer' }}>
                {body}
              </button>
            ) : (
              <div key={s.courtId} style={style}>
                {body}
              </div>
            );
          })}
        </div>
      )}
      {idle.length > 0 && <IdleCourts names={idle.map((s) => pickName(locale, courts.find((c) => c.id === s.courtId)))} spaced={shown.length > 0} />}
    </Panel>
  );
}

/** How many idle court names are printed before the rest fold into a count. */
const IDLE_NAMES_SHOWN = 12;

function IdleCourts({ names, spaced }: { names: string[]; spaced: boolean }) {
  const { tr, locale } = useLocale();
  const rest = names.length - IDLE_NAMES_SHOWN;
  return (
    <p style={{ marginBlockStart: spaced ? 'var(--tp-sp-3)' : 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', alignItems: 'baseline' }}>
      <span style={{ fontWeight: 600, color: 'var(--tp-fg)' }}>{tr('ws.owner.observe.courts.now.freeRest')}</span>
      <bdi>{names.slice(0, IDLE_NAMES_SHOWN).join(' · ')}</bdi>
      {rest > 0 && <span>{tr('ws.owner.observe.courts.now.more', { count: formatNumber(rest, locale) })}</span>}
    </p>
  );
}

/**
 * What the block colours mean. The schedule drew six tones and two border
 * styles and explained none of them; the lead above it described the rows
 * instead.
 */
const LEGEND: readonly { key: 'confirmed' | 'pending' | 'arrived' | 'completed' | 'noShow' | 'hold' | 'maintenance'; tone: Tone; dashed?: boolean }[] = [
  { key: 'confirmed', tone: 'accent' },
  { key: 'pending', tone: 'warn' },
  { key: 'arrived', tone: 'success' },
  { key: 'completed', tone: 'neutral' },
  { key: 'noShow', tone: 'danger', dashed: true },
  { key: 'hold', tone: 'info' },
  { key: 'maintenance', tone: 'neutral', dashed: true },
];

function ScheduleLegend() {
  const { tr } = useLocale();
  return (
    <ul style={{ listStyle: 'none', margin: 0, paddingBlock: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-3)', display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-1) var(--tp-sp-3)', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
      {LEGEND.map((l) => (
        <li key={l.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)' }}>
          <span aria-hidden style={{ inlineSize: '0.9rem', blockSize: '0.65rem', borderRadius: '3px', background: TONE_SOFT[l.tone], border: `1px ${l.dashed ? 'dashed' : 'solid'} ${TONE_EDGE[l.tone]}` }} />
          {tr(`ws.owner.observe.courts.schedule.legend.${l.key}`)}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------

function ScheduleBoard({
  date,
  tz,
  courts,
  reservations,
  openMin,
  closeMin,
  dayStartMs,
  nowMs,
  onOpen,
}: {
  date: string;
  tz: string;
  courts: readonly CourtRow[];
  reservations: readonly ReservationRow[];
  openMin: number;
  closeMin: number;
  dayStartMs: number;
  /** Set only for today: draws the now line. */
  nowMs: number | null;
  onOpen: (id: string) => void;
}) {
  const { tr, locale } = useLocale();
  const bands = Math.max(0, Math.ceil((closeMin - openMin) / BAND_MIN));
  const spanMin = bands * BAND_MIN;
  if (bands === 0) {
    return (
      <div style={{ padding: 'var(--tp-sp-3)' }}>
        <EmptyState compact icon="ban" title={tr('ws.owner.observe.courts.schedule.closed')} />
      </div>
    );
  }
  const nowFrac = nowMs === null ? null : ((nowMs - dayStartMs) / 60_000 - openMin) / spanMin;
  const showNow = nowFrac !== null && nowFrac >= 0 && nowFrac <= 1;
  const heightRem = bands * BAND_REM;

  return (
    <div style={{ overflowX: 'auto' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `${GUTTER_REM}rem repeat(${courts.length}, minmax(${COURT_MIN_REM}rem, 1fr))`,
          minInlineSize: `${GUTTER_REM + courts.length * COURT_MIN_REM}rem`,
          borderBlockStart: '1px solid var(--tp-border)',
        }}
      >
        <div />
        {courts.map((c) => (
          <div key={c.id} title={pickName(locale, c)} style={{ fontWeight: 700, fontSize: 'var(--tp-fs-sm)', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingInline: 'var(--tp-sp-1)', paddingBlock: 'var(--tp-sp-1)', borderBlockEnd: '1px solid var(--tp-border)', borderInlineStart: '1px solid var(--tp-border)' }}>
            {pickName(locale, c)}
          </div>
        ))}

        <div style={{ position: 'relative', blockSize: `${heightRem}rem` }}>
          {Array.from({ length: bands }, (_, i) => (
            <span
              key={i}
              style={{
                position: 'absolute',
                insetBlockStart: `${i * BAND_REM}rem`,
                insetInlineStart: 0,
                paddingInline: 'var(--tp-sp-1-5)',
                paddingBlockStart: '0.125rem',
                fontSize: 'var(--tp-fs-xs)',
                color: 'var(--tp-muted-fg)',
                fontVariantNumeric: 'tabular-nums',
                whiteSpace: 'nowrap',
              }}
            >
              {formatTime(wallTimeToUtc(date, openMin + i * BAND_MIN, tz), locale, tz)}
            </span>
          ))}
        </div>

        {courts.map((c) => (
          <div
            key={c.id}
            style={{
              position: 'relative',
              blockSize: `${heightRem}rem`,
              borderInlineStart: '1px solid var(--tp-border)',
              backgroundImage: `repeating-linear-gradient(to bottom, var(--tp-border) 0 1px, transparent 1px ${BAND_REM}rem)`,
            }}
          >
            {reservations
              .filter((r) => r.court_id === c.id)
              .map((r) => {
                const p = schedulePlacement(r, dayStartMs, openMin, spanMin);
                if (!p) return null;
                const tone = r.status === 'no_show' ? 'danger' : reservationTone(r);
                const name =
                  r.kind === 'maintenance' ? (r.notes ?? tr('op.desk.maintenance')) : r.kind === 'hold' ? tr('op.desk.hold') : (guestNameOf(r) ?? tr('op.desk.walkIn'));
                // Rows are short, so a block shows only what its height holds: one line, name over time, or the badge row too.
                const blockRem = p.height * heightRem;
                const lines = blockRem >= 4 ? 3 : blockRem >= 2 ? 2 : 1;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onOpen(r.id)}
                    aria-label={`${name} · ${formatTimeRange(new Date(r.start_at), new Date(r.end_at), locale, tz)}`}
                    className="tp-tile"
                    style={{
                      position: 'absolute',
                      insetBlockStart: `calc(${p.top * 100}% + 2px)`,
                      blockSize: `calc(${p.height * 100}% - 4px)`,
                      insetInline: '4px',
                      background: TONE_SOFT[tone],
                      color: TONE_FG[tone],
                      border: `1px ${r.kind === 'maintenance' || r.status === 'no_show' ? 'dashed' : 'solid'} ${TONE_EDGE[tone]}`,
                      borderRadius: 'var(--tp-radius-ctl)',
                      paddingBlock: lines === 1 ? 0 : '0.125rem',
                      paddingInline: '0.375rem',
                      textAlign: 'start',
                      font: 'inherit',
                      fontSize: 'var(--tp-fs-xs)',
                      lineHeight: 1.2,
                      overflow: 'hidden',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: lines === 1 ? 'row' : 'column',
                      alignItems: lines === 1 ? 'center' : 'stretch',
                      gap: lines === 1 ? '0.35rem' : '0.05rem',
                      opacity: r.status === 'no_show' || r.status === 'completed' ? 0.75 : 1,
                    }}
                  >
                    <strong style={{ minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <bdi>{name}</bdi>
                    </strong>
                    <bdi style={{ flexShrink: lines === 1 ? 0 : 1, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', opacity: lines === 1 ? 0.8 : 1 }}>
                      {lines === 1 ? formatTime(new Date(r.start_at), locale, tz) : formatTimeRange(new Date(r.start_at), new Date(r.end_at), locale, tz)}
                    </bdi>
                    {lines === 3 && r.kind === 'booking' && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <ReservationBadge reservation={r} size="sm" />
                        {r.price_iqd != null && <Money amount={r.price_iqd} style={{ fontSize: 'var(--tp-fs-xs)' }} />}
                      </span>
                    )}
                  </button>
                );
              })}
            {showNow && (
              <span
                aria-hidden
                style={{ position: 'absolute', insetInline: 0, insetBlockStart: `${nowFrac! * 100}%`, borderBlockStart: '2px solid var(--tp-danger-mark)', pointerEvents: 'none' }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

interface LinkedTab {
  id: string;
  status: string;
  total_iqd: number | null;
}

function BookingPanel({ reservation: r, courts, tz, onClose }: { reservation: ReservationRow; courts: readonly CourtRow[]; tz: string; onClose: () => void }) {
  const { tr, locale } = useLocale();
  const tabsQ = useQuery({
    queryKey: ['observeBookingTabs', r.id],
    enabled: r.kind === 'booking',
    queryFn: async (): Promise<LinkedTab[]> => {
      const { data, error } = await supabase.from('tabs').select('id, status, total_iqd').eq('reservation_id', r.id).is('merged_into_tab_id', null);
      if (error) throw error;
      return (data ?? []) as LinkedTab[];
    },
    retry: false,
  });
  const minutes = Math.round((new Date(r.end_at).getTime() - new Date(r.start_at).getTime()) / 60_000);
  const eyebrow = tr(r.kind === 'maintenance' ? 'ws.owner.observe.courts.peek.maintenance' : r.kind === 'hold' ? 'ws.owner.observe.courts.peek.hold' : 'ws.owner.observe.courts.peek.booking');
  const title = r.kind === 'maintenance' ? (r.notes ?? tr('op.desk.maintenance')) : r.kind === 'hold' ? tr('op.desk.hold') : (guestNameOf(r) ?? tr('op.desk.walkIn'));

  return (
    <DetailPanel
      eyebrow={eyebrow}
      title={<bdi>{title}</bdi>}
      status={
        <span>
          <ReservationBadge reservation={r} />
        </span>
      }
      onClose={onClose}
      target={
        r.kind === 'booking'
          ? { workspace: 'courtDesk', to: '/desk/bookings/$id', params: { id: r.id } }
          : { workspace: 'courtDesk', to: '/desk' }
      }
    >
      <DescriptionList
        columns={2}
        items={[
          { label: tr('ws.owner.observe.courts.peek.court'), value: pickName(locale, courts.find((c) => c.id === r.court_id)) },
          { label: tr('ws.owner.observe.courts.peek.date'), value: <bdi>{formatDate(new Date(r.start_at), locale, tz)}</bdi> },
          { label: tr('ws.owner.observe.courts.peek.time'), value: <bdi>{formatTimeRange(new Date(r.start_at), new Date(r.end_at), locale, tz)}</bdi> },
          { label: tr('ws.owner.observe.courts.peek.duration'), value: tr('ws.owner.observe.courts.peek.durationValue', { minutes: formatNumber(minutes, locale) }), numeric: true },
          ...(r.kind === 'booking'
            ? [
                { label: tr('ws.owner.observe.courts.peek.price'), value: r.price_iqd == null ? '—' : <Money amount={r.price_iqd} strong />, numeric: true },
                { label: tr('ws.owner.observe.courts.peek.phone'), value: r.guest_phone ? <bdi dir="ltr">{r.guest_phone}</bdi> : '—' },
              ]
            : []),
        ]}
      />
      {r.notes && r.kind === 'booking' && (
        <PanelSection title={tr('ws.owner.observe.courts.peek.notes')}>
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.notes}</p>
        </PanelSection>
      )}
      {r.kind === 'booking' && (
        <PanelSection title={tr('ws.owner.observe.courts.peek.cafeTab')}>
          {tabsQ.isPending ? (
            <span style={{ color: 'var(--tp-muted-fg)' }}>—</span>
          ) : tabsQ.isError || (tabsQ.data ?? []).length === 0 ? (
            <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.owner.observe.courts.peek.noTab')}</p>
          ) : (
            (tabsQ.data ?? []).map((t) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
                <TabStatusIndicator status={t.status} size="sm" />
                <span style={{ marginInlineStart: 'auto' }}>
                  {t.total_iqd != null ? (
                    <Money amount={t.total_iqd} strong />
                  ) : t.status === 'open' || t.status === 'awaiting_payment' ? (
                    <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.owner.observe.courts.peek.tabRunning')}</span>
                  ) : (
                    '—'
                  )}
                </span>
              </div>
            ))
          )}
        </PanelSection>
      )}
    </DetailPanel>
  );
}
