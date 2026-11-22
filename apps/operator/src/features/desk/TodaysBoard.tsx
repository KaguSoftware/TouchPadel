/**
 * 06.1 TodaysBoardScreen — the desk's landing. Same rows, same cache slot and
 * same broadcast as the calendar (useTradingNight), so what the desk promises
 * here is what the calendar shows.
 *
 * WHY THIS LAYOUT (option C of the Today rework, 2026-11-22)
 *
 * A clerk looks at this screen between guests, often with one in front of
 * them, on the desk tablet as often as the till. Court state comes first, and
 * the to-do list stays in one column beside it:
 *
 *  - **The night in figures**: courts free, arrived, still to come, late, and
 *    the court fee still to collect on games that are over.
 *  - **Courts now**, one card per court in court order: a band that names its
 *    state (free, on court, not arrived, lesson, blocked), the time left (or
 *    how long it stays free), who is on, and who is next. A free card books
 *    that court; a busy one opens its booking. Padel Green means a group that
 *    has arrived and is on court (DESIGN.md).
 *  - **The rail**: Arrivals (late, then the next hour; guests already here are
 *    not on it) and To collect (games over with the fee still open). Each row
 *    is one fact per line, with its actions on a line of their own. Marking a
 *    guest arrived is one click, with no reason prompt: an arrival is the
 *    normal course of a booking, not an override.
 *
 * The full list of the night's bookings is gone from here; the calendar has it.
 * An arriving group's row says when the group before them on that court has
 * not paid (0106). Every figure and state comes from app.booking_bill_states.
 *
 * Open matches (docs/design/open-matches/operator.md §5.9) have a group of
 * their own after the courts: the night's matches still needing players,
 * with Add player, Open and "Start an open match". A match's booking reads
 * its organiser's name (bookingLabel) with the seat chip, and offers
 * **Players** (its booking screen) where another booking offers Mark arrived:
 * a match is marked player by player, never as a whole.
 *
 * Lessons (docs/design/coaching/operator.md §5.11) have the "Lessons today"
 * group after the open matches. A court a lesson holds shows a Lesson card
 * that reads `lessonLabel` and opens the lesson; a lesson is never on the
 * arrivals rail, since students are marked one by one on the lesson's screen.
 *
 * `TodaysBoardView` is pure presentation (spec §06.1 data-in / events-out)
 * so its four states are testable without a database.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { wallTimeToUtc } from '@touch/core';
import { formatDate, formatIQD, formatNumber, formatTime, formatTimeRange, formatWeekdayShort, VENUE_TZ } from '@touch/i18n';
import { mutate } from '../../lib/mutate';
import type { CourtRow } from '../../lib/queries';
import { useToast } from '../../components/toast';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, Skeleton } from '../../components/ui';
import { AsyncStateWrapper, CustomerFlagBadge, EmptyState, PageHeader, Panel, ViewMore, useListCap, type AsyncStatus } from '../../components/kit';
import { Icon, type IconName } from '../../components/icons';
import { ChargeCell } from './deskStatus';
import { arrivalsDue, courtCards, isVisible, nightSummary, slotTaken, sortByStart, type CourtCard, type CourtCardState } from './deskLogic';
import type { CustomerFlag, ReservationRow } from './deskTypes';
import { CreateReservationDialog, type StartLessonCarry, type StartMatchCarry } from './CreateReservationDialog';
import { bookingLabel, isMatchLiteral, type MatchReadStatus } from '../matches/matchLogic';
import { LessonsTodayPanel } from '../coaching/LessonsTodayPanel';
import { StartLessonDialog } from '../coaching/StartLessonDialog';
import { isLessonRow, lessonLabel, lessonOfRow, lessonsByReservation, nowOf } from '../coaching/lessonLogic';
import type { DeskLesson, DeskLessons } from '../coaching/lessonPayloads';
import { initialStart, startOf } from '../coaching/startLessonLogic';
import { useCoachingCaps, useDeskLessons, useLessonRead } from '../coaching/useCoaching';
import type { MatchState, OpenMatches } from '../matches/matchPayloads';
import { SeatChip } from '../matches/SeatChip';
import { NeedsPlayersPanel } from '../matches/NeedsPlayersPanel';
import { StartMatchDialog } from '../matches/StartMatchDialog';
import { AddSeatDialog } from '../matches/AddSeatDialog';
import { earliestStartAt } from '../matches/startMatchLogic';
import { matchBookingIds, useMatchCaps, useMatchRead, useMatchStates, useOpenMatches } from '../matches/useMatches';
import { useStationReach } from '../../lib/stationReach';
import type { BroadcastStatus } from '../../lib/realtime';
import { ConnectionPill } from '../../components/ConnectionPill';
import { todayInTz, tonightInTz, useTradingNight } from './useTradingNight';
import { statesById, toSettle, unsettledBefore, type BillStateRow } from './payment/deskPaymentLogic';
import { useBookingBillStates } from './payment/useBookingBill';
import { TillShiftPanel } from '../tillShift/TillShiftPanel';

const ARRIVAL_HORIZON_MS = 60 * 60_000;
const CLOCK_TICK_MS = 30_000;

export interface TodaysBoardViewProps {
  status: AsyncStatus;
  error?: unknown;
  date: string;
  tz: string;
  nowIso: string;
  horizonIso: string;
  courts: readonly CourtRow[];
  /** Visible rows for the trading night (cancelled / expired already filtered). */
  reservations: readonly ReservationRow[];
  /** Court fee state per booking id (0106); undefined while unknown. */
  billStates?: ReadonlyMap<string, BillStateRow>;
  /** Flags by guest id, when the customer data is available. */
  flagsByGuest?: ReadonlyMap<string, readonly CustomerFlag[]>;
  /** The 'courts' broadcast's state, shown as the floor's connection pill. */
  connection: BroadcastStatus;
  markingId?: string | null;
  onRetry: () => void;
  onSelectReservation: (id: string) => void;
  onCreateBooking: () => void;
  /** A free court tile: book that court from the next half-hour. */
  onBookCourt: (courtId: string) => void;
  onSearchCustomer: () => void;
  onMarkArrived: (id: string) => void;
  /** app.desk_open_matches read the §5.5 way; absent: no open-match group. */
  openMatches?: MatchReadStatus<OpenMatches>;
  /** app.desk_match_states by reservation id: a match booking's organiser and seat chip. */
  matchStates?: Readonly<Record<string, MatchState>> | null;
  /** CAPABILITY_ROLES.runMatches: Start an open match, Add player. */
  runMatches?: boolean;
  /** The station reaches the server: every match write is online only (DF-11). */
  reachable?: boolean;
  onAddPlayer?: (matchId: string) => void;
  onOpenMatch?: (matchId: string) => void;
  onStartMatch?: () => void;
  onRetryOpenMatches?: () => void;
  /**
   * app.desk_lessons read the §5.5 way (coaching operator.md §5.11); absent:
   * no Lessons group, and lesson rows read "Lesson" with no coach.
   */
  lessons?: MatchReadStatus<DeskLessons>;
  /** CAPABILITY_ROLES.runLessons: New lesson. */
  runLessons?: boolean;
  /** CAPABILITY_ROLES.takeLessonPayment: Take payment on a lesson that owes. */
  takeLessonPayment?: boolean;
  onOpenLesson?: (lessonId: string) => void;
  onPayLesson?: (lessonId: string) => void;
  onNewLesson?: () => void;
  onRetryLessons?: () => void;
}

export function TodaysBoardView(p: TodaysBoardViewProps) {
  const { tr, locale } = useLocale();
  const courtName = (id: string) => pickName(locale, p.courts.find((c) => c.id === id));
  const summary = useMemo(() => nightSummary(p.reservations, p.nowIso), [p.reservations, p.nowIso]);
  const due = useMemo(() => arrivalsDue(p.reservations, p.nowIso, p.horizonIso), [p.reservations, p.nowIso, p.horizonIso]);
  const unpaid = useMemo(() => toSettle(p.reservations, p.billStates, p.nowIso), [p.reservations, p.billStates, p.nowIso]);
  const dayNoon = new Date(`${p.date}T12:00:00Z`);
  const ready = p.status === 'ready' || p.status === 'empty';
  // The night's lessons by the court row they hold, and the lessons payload's clock (§5.1).
  const lessonData = p.lessons?.kind === 'ready' ? p.lessons.data : null;
  const lessonsBy = useMemo(() => lessonsByReservation(lessonData), [lessonData]);
  const cards = useMemo(
    () => courtCards(p.courts.map((c) => c.id), p.reservations, p.nowIso, (r) => isLessonRow(r, lessonsBy)),
    [p.courts, p.reservations, p.nowIso, lessonsBy],
  );
  const nowMs = Date.parse(p.nowIso);
  const lessonNow = p.lessons?.kind === 'ready' ? nowOf(lessonData?.server_now, Math.max(0, nowMs - p.lessons.updatedAt), nowMs) : nowMs;

  const header = (
    <PageHeader
      title={tr('ws.courtDesk.board.title')}
      subtitle={
        // The day itself, then the three counts that say how it is going —
        // each a label and its number, so no plural is ever needed.
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1) var(--tp-sp-3)', flexWrap: 'wrap', alignItems: 'baseline' }}>
          <bdi>
            {formatWeekdayShort(dayNoon, locale, 'UTC')} · {formatDate(dayNoon, locale, 'UTC')}
          </bdi>
          {ready && (
            <>
              <SubtitleFigure label={tr('ws.courtDesk.board.summaryBookings')} value={summary.bookings} />
              <SubtitleFigure label={tr('ws.courtDesk.board.summaryArrived')} value={summary.arrived} />
              <SubtitleFigure label={tr('ws.courtDesk.board.summaryToCome')} value={summary.toCome} />
              {summary.lessons > 0 && <SubtitleFigure label={tr('ws.coaching.common.lessons')} value={summary.lessons} />}
              {unpaid.length > 0 && <SubtitleFigure label={tr('ws.courtDesk.board.toSettleTitle')} value={unpaid.length} />}
            </>
          )}
        </span>
      }
      actions={
        <>
          <Button icon="search" onClick={p.onSearchCustomer}>
            {tr('ws.courtDesk.board.searchCustomer')}
          </Button>
          <Button
            kind="primary"
            icon="plus"
            onClick={p.onCreateBooking}
            disabled={!ready}
            disabledReason={p.status === 'error' ? tr('ws.courtDesk.board.newBookingBlockedError') : tr('ws.courtDesk.board.newBookingBlockedLoading')}
          >
            {tr('ws.courtDesk.board.newBooking')}
          </Button>
        </>
      }
    />
  );

  const states = p.matchStates ?? undefined;
  const lessonsPanel = p.lessons ? (
    <LessonsTodayPanel
      status={p.lessons}
      tz={p.tz}
      nowMs={lessonNow}
      runLessons={p.runLessons ?? false}
      takeLessonPayment={p.takeLessonPayment ?? false}
      reachable={p.reachable ?? true}
      onOpenLesson={(id) => p.onOpenLesson?.(id)}
      onPayLesson={(id) => p.onPayLesson?.(id)}
      onNewLesson={() => p.onNewLesson?.()}
      onRetry={() => p.onRetryLessons?.()}
    />
  ) : null;
  const matchesPanel = p.openMatches ? (
    <NeedsPlayersPanel
      status={p.openMatches}
      tz={p.tz}
      runMatches={p.runMatches ?? false}
      reachable={p.reachable ?? true}
      onAddPlayer={(id) => p.onAddPlayer?.(id)}
      onOpenMatch={(id) => p.onOpenMatch?.(id)}
      onStartMatch={() => p.onStartMatch?.()}
      onRetry={() => p.onRetryOpenMatches?.()}
    />
  ) : null;

  // What the group before on this court still owes, said to the group walking on.
  const beforeOwes = (r: ReservationRow) => {
    const prev = unsettledBefore(r, p.reservations, p.billStates, p.nowIso);
    return prev ? tr('ws.courtDesk.board.beforeOwes', { name: guestLabel(prev, tr, states) }) : undefined;
  };
  const rowProps = { tz: p.tz, nowIso: p.nowIso, courtName, states, flagsByGuest: p.flagsByGuest, billStates: p.billStates, markingId: p.markingId, onMarkArrived: p.onMarkArrived, onOpen: p.onSelectReservation };

  // Option C (2026-11-22): the night's figures, court cards beside a rail of
  // who is at the door and what is still to collect. The rail wraps under the
  // cards when the window is too narrow for both, with no media query.
  const board = (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
      <TonightFigures cards={cards} arrived={summary.arrived} toCome={summary.toCome} late={due.late.length} unpaid={unpaid} billStates={p.billStates} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-4)', alignItems: 'flex-start' }}>
        <div style={{ flex: '999 1 34rem', minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-4)' }}>
          <CourtCardsPanel cards={cards} courtName={courtName} tz={p.tz} connection={p.connection} states={states} lessonsBy={lessonsBy} onBook={p.onBookCourt} onOpen={p.onSelectReservation} />
          {matchesPanel}
          {lessonsPanel}
        </div>
        <div style={{ flex: '1 1 20rem', minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-4)' }}>
          <ArrivalsRail due={due} reservations={p.reservations} beforeOwes={beforeOwes} row={rowProps} />
          <CollectPanel unpaid={unpaid} row={rowProps} />
        </div>
      </div>
    </div>
  );

  return (
    <div>
      {header}
      <AsyncStateWrapper
        status={p.status}
        error={p.error}
        onRetry={p.onRetry}
        skeleton={
          <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
            <Skeleton lines={1} blockSize="3.5rem" />
            <Skeleton lines={2} blockSize="9rem" />
          </div>
        }
        emptyContent={
          <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
            <EmptyState
              icon="calendar"
              title={tr('ws.courtDesk.board.emptyTitle')}
              body={tr('ws.courtDesk.board.emptyBody')}
              action={
                <Button kind="primary" icon="plus" onClick={p.onCreateBooking}>
                  {tr('ws.courtDesk.board.emptyAction')}
                </Button>
              }
            />
            {board}
          </div>
        }
      >
        {board}
      </AsyncStateWrapper>
    </div>
  );
}

function SubtitleFigure({ label, value }: { label: string; value: number }) {
  const { locale } = useLocale();
  return (
    <span>
      {label} <strong style={{ color: 'var(--tp-fg)', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(value, locale)}</strong>
    </span>
  );
}

function PanelTitle({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
      <Icon name={icon} size={16} />
      {children}
    </span>
  );
}

/** A count in a panel band: the number, bold, in the band's own ink. */
function BandCount({ children }: { children: ReactNode }) {
  return <strong style={{ fontVariantNumeric: 'tabular-nums', fontSize: 'var(--tp-fs-sm)' }}>{children}</strong>;
}

/**
 * The name a row shows; an open match's booking reads its organiser (or "Open
 * match"); a lesson (its court row, or a held lesson's hold row) reads
 * `lessonLabel`, "Lesson" when its desk_lessons row is not known (coaching §5.8).
 */
function guestLabel(
  r: ReservationRow,
  tr: ReturnType<typeof useLocale>['tr'],
  states?: Readonly<Record<string, MatchState>>,
  lessons?: { by: ReadonlyMap<string, DeskLesson>; locale: ReturnType<typeof useLocale>['locale'] },
): string {
  if (isLessonRow(r, lessons?.by)) return lessonLabel(lessonOfRow(r, lessons?.by), lessons?.locale ?? 'en', tr);
  if (r.kind === 'maintenance') return r.notes ?? tr('ws.courtDesk.board.blocked');
  if (r.kind === 'hold') return tr('ws.courtDesk.board.hold');
  return bookingLabel(r, states?.[r.id], tr) ?? tr('ws.courtDesk.board.walkIn');
}

/** A match's booking: its state says so, or its row does (no account, the literal name). */
function isMatchRow(r: ReservationRow, match: MatchState | undefined): boolean {
  return r.kind === 'booking' && (match !== undefined || isMatchLiteral(r));
}

const minutesBetween = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000));

/** "45 min", "2 h", "1 h 30": time left on a card, short enough for its big figure. */
function useDuration() {
  const { tr, locale } = useLocale();
  return (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return tr('ws.courtDesk.board.minutes', { minutes: formatNumber(m, locale) });
    if (m === 0) return tr('ws.courtDesk.board.hours', { hours: formatNumber(h, locale) });
    return tr('ws.courtDesk.board.hoursMinutes', { hours: formatNumber(h, locale), minutes: formatNumber(m, locale) });
  };
}

// ---------------------------------------------------------------------------
// The night in figures
// ---------------------------------------------------------------------------

function TonightFigures({
  cards,
  arrived,
  toCome,
  late,
  unpaid,
  billStates,
}: {
  cards: readonly CourtCard[];
  arrived: number;
  toCome: number;
  late: number;
  unpaid: readonly ReservationRow[];
  billStates?: ReadonlyMap<string, BillStateRow>;
}) {
  const { tr, locale } = useLocale();
  const free = cards.filter((c) => c.state === 'free').length;
  // The court fee still open on games that are over (0106); "—" while the bill states are unknown.
  const owed = unpaid.reduce((sum, r) => sum + (billStates?.get(r.id)?.court_remaining_iqd ?? 0), 0);
  const figures: { label: string; value: string; warn?: boolean }[] = [
    { label: tr('ws.courtDesk.board.figCourtsFree'), value: tr('ws.courtDesk.board.freeOf', { free: formatNumber(free, locale), total: formatNumber(cards.length, locale) }) },
    { label: tr('ws.courtDesk.board.summaryArrived'), value: formatNumber(arrived, locale) },
    { label: tr('ws.courtDesk.board.summaryToCome'), value: formatNumber(toCome, locale) },
    { label: tr('ws.courtDesk.board.figLate'), value: formatNumber(late, locale), warn: late > 0 },
    { label: tr('ws.courtDesk.board.figToCollect'), value: billStates ? formatIQD(owed, locale) : '—', warn: owed > 0 },
  ];
  return (
    <dl
      aria-label={tr('ws.courtDesk.board.figures')}
      style={{
        margin: 0,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(8.5rem, 1fr))',
        gap: '1px',
        background: 'var(--tp-border)',
        border: '1px solid var(--tp-border)',
        borderRadius: 'var(--tp-radius-panel)',
        overflow: 'hidden',
      }}
    >
      {figures.map((f) => (
        <div key={f.label} style={{ display: 'flex', flexDirection: 'column-reverse', gap: 'var(--tp-sp-0)', paddingBlock: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-3)', background: 'var(--tp-surface)' }}>
          <dt style={{ fontSize: 'var(--tp-fs-xs)', fontWeight: 600, color: 'var(--tp-muted-fg)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{f.label}</dt>
          <dd style={{ margin: 0, fontSize: 'var(--tp-fs-2xl)', fontWeight: 700, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums', color: f.warn ? 'var(--tp-warn-fg)' : 'var(--tp-fg)' }}>
            <bdi>{f.value}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Courts now: one card per court
// ---------------------------------------------------------------------------

/** Each state's band, edge and progress colour. Padel Green means here and now (DESIGN.md). */
const CARD_TONE: Record<CourtCardState, { band: string; bandFg: string; edge: string; bar: string; dashed?: boolean }> = {
  free: { band: 'var(--tp-success-soft)', bandFg: 'var(--tp-success-fg)', edge: 'var(--tp-success-mark)', bar: 'var(--tp-success-mark)', dashed: true },
  here: { band: 'var(--tp-success)', bandFg: 'var(--tp-accent-2-contrast)', edge: 'var(--tp-border)', bar: 'var(--tp-success-mark)' },
  booked: { band: 'var(--tp-accent-soft)', bandFg: 'var(--tp-accent-soft-fg)', edge: 'var(--tp-border)', bar: 'var(--tp-accent)' },
  late: { band: 'var(--tp-warn-soft)', bandFg: 'var(--tp-warn-fg)', edge: 'var(--tp-warn-mark)', bar: 'var(--tp-warn-mark)' },
  lesson: { band: 'var(--tp-lesson-soft)', bandFg: 'var(--tp-lesson)', edge: 'var(--tp-border)', bar: 'var(--tp-lesson)' },
  blocked: { band: 'var(--tp-surface-3)', bandFg: 'var(--tp-muted-fg)', edge: 'var(--tp-border)', bar: 'var(--tp-neutral-mark)' },
  held: { band: 'var(--tp-surface-3)', bandFg: 'var(--tp-muted-fg)', edge: 'var(--tp-border)', bar: 'var(--tp-neutral-mark)' },
};

function CourtCardsPanel({
  cards,
  courtName,
  tz,
  connection,
  states,
  lessonsBy,
  onBook,
  onOpen,
}: {
  cards: readonly CourtCard[];
  courtName: (id: string) => string;
  tz: string;
  connection: BroadcastStatus;
  states?: Readonly<Record<string, MatchState>>;
  lessonsBy?: ReadonlyMap<string, DeskLesson>;
  onBook: (courtId: string) => void;
  onOpen: (id: string) => void;
}) {
  const { tr } = useLocale();
  return (
    <Panel
      title={<PanelTitle icon="court">{tr('ws.courtDesk.board.availability')}</PanelTitle>}
      // The same pill as the live floor: Live, Connecting… or Disconnected.
      actions={<ConnectionPill status={connection} />}
    >
      {/* Every court, in court order: the desk learns where a court sits in the grid. */}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-3)', gridTemplateColumns: 'repeat(auto-fill, minmax(13.5rem, 1fr))' }}>
        {cards.map((c) => (
          <li key={c.courtId} style={{ display: 'flex' }}>
            <CourtCardButton card={c} name={courtName(c.courtId)} tz={tz} states={states} lessonsBy={lessonsBy} onBook={onBook} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function CourtCardButton({
  card,
  name,
  tz,
  states,
  lessonsBy,
  onBook,
  onOpen,
}: {
  card: CourtCard;
  name: string;
  tz: string;
  states?: Readonly<Record<string, MatchState>>;
  lessonsBy?: ReadonlyMap<string, DeskLesson>;
  onBook: (courtId: string) => void;
  onOpen: (id: string) => void;
}) {
  const { tr, locale } = useLocale();
  const duration = useDuration();
  const tone = CARD_TONE[card.state];
  const lessons = lessonsBy ? { by: lessonsBy, locale } : undefined;
  const label = (r: ReservationRow) => guestLabel(r, tr, states, lessons);
  const time = (iso: string) => formatTime(new Date(iso), locale, tz);
  const { current, next } = card;

  // The one-line reading, for the button's name: the same words the old tiles used.
  const line = current
    ? tr(card.state === 'lesson' ? 'ws.coaching.common.lessonUntil' : card.state === 'blocked' ? 'ws.courtDesk.board.busyBlocked' : 'ws.courtDesk.board.busyUntil', { time: time(current.end_at) })
    : next
      ? tr('ws.courtDesk.board.freeUntil', { time: time(next.start_at) })
      : tr('ws.courtDesk.board.free');
  const big = card.minutesLeft === null ? tr('ws.courtDesk.board.untilClose') : duration(card.minutesLeft);
  const small = current ? tr('ws.courtDesk.board.leftEnds', { time: time(current.end_at) }) : next ? tr('ws.courtDesk.board.openUntil', { time: time(next.start_at) }) : tr('ws.courtDesk.board.nothingAfter');
  const foot = current ? (next ? tr('ws.courtDesk.board.nextUp', { time: time(next.start_at), name: label(next) }) : tr('ws.courtDesk.board.nobodyAfter')) : tr('ws.courtDesk.board.bookCourt');
  const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

  return (
    <button
      type="button"
      className="tp-court-card"
      onClick={() => (current ? onOpen(current.id) : onBook(card.courtId))}
      aria-label={`${name} · ${line} · ${current ? tr('ws.courtDesk.board.open') : tr('ws.courtDesk.board.bookCourt')}`}
      style={{
        inlineSize: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: 0,
        border: `${tone.dashed ? '1.5px dashed' : '1px solid'} ${tone.edge}`,
        borderRadius: 'var(--tp-radius-panel)',
        // White on paper, the panel body in blue mode (the strip-tile ground).
        background: 'var(--tp-branch-tile)',
        color: 'inherit',
        font: 'inherit',
        textAlign: 'start',
        overflow: 'hidden',
        cursor: 'pointer',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--tp-sp-2)', paddingBlock: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-3)', background: tone.band, color: tone.bandFg }}>
        <strong style={{ fontSize: 'var(--tp-fs-md)', ...ellipsis }}>
          <bdi>{name}</bdi>
        </strong>
        <span style={{ fontSize: 'var(--tp-fs-xs)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{tr(`ws.courtDesk.board.card.${card.state}`)}</span>
      </span>
      <span style={{ display: 'grid', gap: 'var(--tp-sp-2)', padding: 'var(--tp-sp-3)' }}>
        <span style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
          <strong style={{ fontSize: 'var(--tp-fs-3xl)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            <bdi>{big}</bdi>
          </strong>
          <span style={{ fontSize: 'var(--tp-fs-xs)', fontWeight: 600, color: 'var(--tp-muted-fg)' }}>
            <bdi>{small}</bdi>
          </span>
        </span>
        {current && (
          <>
            <strong style={{ fontSize: 'var(--tp-fs-md)', ...ellipsis }}>
              <bdi>{label(current)}</bdi>
            </strong>
            <span aria-hidden="true" style={{ display: 'block', blockSize: '6px', borderRadius: 'var(--tp-radius-pill)', background: 'var(--tp-surface-3)', overflow: 'hidden' }}>
              <span style={{ display: 'block', blockSize: '100%', inlineSize: `${Math.round(card.progress * 100)}%`, background: tone.bar }} />
            </span>
          </>
        )}
      </span>
      <span
        style={{
          marginBlockStart: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--tp-sp-1)',
          paddingBlock: 'var(--tp-sp-2)',
          paddingInline: 'var(--tp-sp-3)',
          borderBlockStart: '1px solid var(--tp-border)',
          fontSize: 'var(--tp-fs-xs)',
          fontWeight: current ? 500 : 700,
          color: current ? 'var(--tp-muted-fg)' : 'var(--tp-success-fg)',
          minInlineSize: 0,
        }}
      >
        <Icon name={current ? 'clock' : 'plus'} size={12} style={{ flex: '0 0 auto' }} />
        <bdi style={ellipsis}>{foot}</bdi>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// The rail: arrivals, then what is still to collect
// ---------------------------------------------------------------------------

interface RailRowShared {
  tz: string;
  nowIso: string;
  courtName: (id: string) => string;
  states?: Readonly<Record<string, MatchState>>;
  flagsByGuest?: ReadonlyMap<string, readonly CustomerFlag[]>;
  billStates?: ReadonlyMap<string, BillStateRow>;
  markingId?: string | null;
  onMarkArrived: (id: string) => void;
  onOpen: (id: string) => void;
}

function ArrivalsRail({
  due,
  reservations,
  beforeOwes,
  row,
}: {
  due: ReturnType<typeof arrivalsDue>;
  reservations: readonly ReservationRow[];
  beforeOwes: (r: ReservationRow) => string | undefined;
  row: RailRowShared;
}) {
  const { tr, locale } = useLocale();
  // Each group folds on its own (owner's rule, 2026-10-08), so a long late list never hides who is next.
  const lateCap = useListCap(due.late);
  const soonCap = useListCap(due.soon);
  const nothing = due.late.length === 0 && due.soon.length === 0;
  // With nobody due, say when the next guest is — the question that follows.
  const next = nothing ? sortByStart(reservations).find((r) => r.kind === 'booking' && r.status === 'confirmed' && r.start_at > row.nowIso) : undefined;
  const count = due.late.length + due.soon.length;
  return (
    <Panel title={<PanelTitle icon="users">{tr('ws.courtDesk.board.arrivals')}</PanelTitle>} actions={count > 0 ? <BandCount>{formatNumber(count, locale)}</BandCount> : undefined}>
      {nothing ? (
        <RailEmpty
          title={tr('ws.courtDesk.board.arrivalsEmpty')}
          body={
            next &&
            tr('ws.courtDesk.board.nextArrival', {
              time: formatTime(new Date(next.start_at), locale, row.tz),
              name: guestLabel(next, tr, row.states),
              court: row.courtName(next.court_id),
            })
          }
        />
      ) : (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
          {due.late.length > 0 && (
            <RailGroup title={tr('ws.courtDesk.board.groupCount', { title: tr('ws.courtDesk.board.lateGroup'), count: formatNumber(due.late.length, locale) })} cap={lateCap}>
              {lateCap.shown.map((r) => (
                <RailRow key={r.id} r={r} type="late" warn={beforeOwes(r)} {...row} />
              ))}
            </RailGroup>
          )}
          {due.soon.length > 0 && (
            <RailGroup title={tr('ws.courtDesk.board.groupCount', { title: tr('ws.courtDesk.board.soonGroup'), count: formatNumber(due.soon.length, locale) })} cap={soonCap}>
              {soonCap.shown.map((r) => (
                <RailRow key={r.id} r={r} type="soon" warn={beforeOwes(r)} {...row} />
              ))}
            </RailGroup>
          )}
        </div>
      )}
    </Panel>
  );
}

/** Games that are over with the court fee still open (0106), each settled from its booking. */
function CollectPanel({ unpaid, row }: { unpaid: readonly ReservationRow[]; row: RailRowShared }) {
  const { tr, locale } = useLocale();
  const cap = useListCap(unpaid);
  return (
    <Panel title={<PanelTitle icon="banknote">{tr('ws.courtDesk.board.toCollect')}</PanelTitle>} actions={unpaid.length > 0 ? <BandCount>{formatNumber(unpaid.length, locale)}</BandCount> : undefined}>
      {unpaid.length === 0 ? (
        <RailEmpty title={tr('ws.courtDesk.board.toCollectEmpty')} />
      ) : (
        <RailGroup cap={cap} label={tr('ws.courtDesk.board.toCollect')}>
          {cap.shown.map((r) => (
            <RailRow key={r.id} r={r} type="pay" {...row} />
          ))}
        </RailGroup>
      )}
    </Panel>
  );
}

function RailEmpty({ title, body }: { title: string; body?: string | false }) {
  return (
    <p style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--tp-sp-2)', color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', margin: 0 }}>
      <Icon name="checkCircle" size={18} style={{ color: 'var(--tp-success-mark)', flex: '0 0 auto' }} />
      <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
        <span style={{ color: 'var(--tp-fg)', fontWeight: 600 }}>{title}</span>
        {body && <bdi>{body}</bdi>}
      </span>
    </p>
  );
}

function RailGroup({ title, label, cap, children }: { title?: string; label?: string; cap: ReturnType<typeof useListCap>; children: ReactNode }) {
  return (
    <section aria-label={title ?? label}>
      {title && (
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', margin: 0, marginBlockEnd: 'var(--tp-sp-2)', fontSize: 'var(--tp-fs-xs)', fontWeight: 700, color: 'var(--tp-muted-fg)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {title}
          <span aria-hidden="true" style={{ flex: 1, borderBlockStart: '1px solid var(--tp-border)' }} />
        </h3>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>{children}</ul>
      <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} />
    </section>
  );
}

const RAIL_EDGE = { late: 'var(--tp-warn-mark)', soon: 'var(--tp-success-mark)', pay: 'var(--tp-accent)' } as const;

/**
 * One row of the rail, one fact per line: time and how late or soon; the name
 * with its chips; court and end; the phone; and what the group before still
 * owes. The actions sit on their own line, so nothing is squeezed.
 */
function RailRow({
  r,
  type,
  warn,
  tz,
  nowIso,
  courtName,
  states,
  flagsByGuest,
  billStates,
  markingId,
  onMarkArrived,
  onOpen,
}: RailRowShared & { r: ReservationRow; type: 'late' | 'soon' | 'pay'; warn?: string }) {
  const { tr, locale } = useLocale();
  const match = states?.[r.id];
  const name = guestLabel(r, tr, match ? { [r.id]: match } : undefined);
  const isMatch = isMatchRow(r, match);
  const billState = billStates?.get(r.id);
  const flags = r.guest_id ? flagsByGuest?.get(r.guest_id) : undefined;
  const pay = type === 'pay';
  // A match's booking settles per player: say how many still owe (booking_bill_states, 0262).
  const owing = pay && isMatch && billState && (billState.seats_owing ?? 0) > 0 ? billState.seats_owing! : null;
  const time = (iso: string) => formatTime(new Date(iso), locale, tz);
  const rel = pay
    ? tr('ws.courtDesk.board.ended')
    : type === 'late'
      ? tr('ws.courtDesk.board.minutesLate', { minutes: formatNumber(minutesBetween(r.start_at, nowIso), locale) })
      : tr('ws.courtDesk.board.startsIn', { minutes: formatNumber(minutesBetween(nowIso, r.start_at), locale) });
  const where = pay
    ? `${courtName(r.court_id)} · ${formatTimeRange(new Date(r.start_at), new Date(r.end_at), locale, tz)}`
    : tr('ws.courtDesk.board.courtUntil', { court: courtName(r.court_id), time: time(r.end_at) });
  const muted = { fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', lineHeight: 1.35 } as const;

  return (
    <li
      style={{
        display: 'grid',
        gridTemplateColumns: '4.2rem minmax(0, 1fr)',
        gridTemplateAreas: "'t m' 'a a'",
        gap: 'var(--tp-sp-2) var(--tp-sp-3)',
        alignItems: 'start',
        paddingBlock: 'var(--tp-sp-2)',
        paddingInline: 'var(--tp-sp-3)',
        border: '1px solid var(--tp-border)',
        borderInlineStart: `4px solid ${RAIL_EDGE[type]}`,
        borderRadius: 'var(--tp-radius-ctl)',
        background: type === 'late' ? 'var(--tp-warn-soft)' : 'var(--tp-branch-tile)',
      }}
    >
      <span style={{ gridArea: 't', display: 'grid' }}>
        <strong style={{ fontSize: 'var(--tp-fs-lg)', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>
          <bdi>{time(pay ? r.end_at : r.start_at)}</bdi>
        </strong>
        <span style={{ fontSize: 'var(--tp-fs-xs)', fontWeight: 700, whiteSpace: 'nowrap', color: type === 'late' ? 'var(--tp-warn-fg)' : 'var(--tp-muted-fg)' }}>{rel}</span>
      </span>
      <span style={{ gridArea: 'm', display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--tp-sp-2)', minInlineSize: 0 }}>
          <strong style={{ fontSize: 'var(--tp-fs-md)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>
            <bdi>{name}</bdi>
          </strong>
          <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)', alignItems: 'center', flex: '0 0 auto' }}>
            {flags?.map((f, i) => (
              <CustomerFlagBadge key={`${f.type}-${i}`} flag={f} />
            ))}
            {match && <SeatChip state={match} started={r.start_at <= nowIso} />}
            {pay && billState && <ChargeCell state={billState} kind={r.kind} ended />}
          </span>
        </span>
        <span style={muted}>
          <bdi>{where}</bdi>
        </span>
        {!pay && r.guest_phone && (
          <bdi dir="ltr" style={{ ...muted, fontVariantNumeric: 'tabular-nums', textAlign: 'start' }}>
            {r.guest_phone}
          </bdi>
        )}
        {owing !== null && <span style={{ fontSize: 'var(--tp-fs-xs)', fontWeight: 700, color: 'var(--tp-warn-fg)' }}>{tr('ws.matches.today.playersOwing', { count: formatNumber(owing, locale) })}</span>}
        {warn && (
          <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)', alignItems: 'flex-start', marginBlockStart: 'var(--tp-sp-0)', fontSize: 'var(--tp-fs-xs)', fontWeight: 700, lineHeight: 1.35, color: 'var(--tp-warn-fg)' }}>
            <Icon name="alert" size={13} style={{ flex: '0 0 auto', marginBlockStart: '1px' }} />
            <bdi>{warn}</bdi>
          </span>
        )}
      </span>
      <span style={{ gridArea: 'a', display: 'flex', justifyContent: 'flex-end', gap: 'var(--tp-sp-2)', paddingBlockStart: 'var(--tp-sp-2)', borderBlockStart: '1px solid var(--tp-border)' }}>
        <Button size="sm" kind="ghost" onClick={() => onOpen(r.id)} aria-label={`${tr('ws.courtDesk.board.open')} ${name}`}>
          {tr('ws.courtDesk.board.open')}
        </Button>
        {pay ? (
          <Button size="sm" kind="primary" icon="banknote" onClick={() => onOpen(r.id)} aria-label={`${tr('ws.courtDesk.board.takePayment')} ${name}`}>
            {tr('ws.courtDesk.board.takePayment')}
          </Button>
        ) : isMatch ? (
          // Players are marked one by one, on the booking's Players panel.
          <Button size="sm" kind="primary" icon="users" onClick={() => onOpen(r.id)} aria-label={`${tr('ws.matches.booking.players')} ${name}`}>
            {tr('ws.matches.booking.players')}
          </Button>
        ) : (
          <Button size="sm" kind="primary" icon="check" busy={markingId === r.id} onClick={() => onMarkArrived(r.id)}>
            {tr('ws.courtDesk.board.markArrived')}
          </Button>
        )}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Screen: data + events
// ---------------------------------------------------------------------------

export function TodaysBoardScreen() {
  const { tr } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(t);
  }, []);

  const [date, setDate] = useState(() => todayInTz(VENUE_TZ));
  const night = useTradingNight(date);
  const { tz, settingsQ, courtsQ, reservationsQ, courts, rows } = night;
  // Once the venue's settings arrive, re-anchor "today" to the night that is
  // trading now — and follow the clock, so the board rolls over at close.
  useEffect(() => {
    if (settingsQ.data) setDate(tonightInTz(settingsQ.data.timezone, settingsQ.data.opening_hours));
  }, [settingsQ.data, nowMs]);

  const visible = useMemo(() => night.reservations.filter((r) => isVisible(r, nowMs)), [night.reservations, nowMs]);
  const bookingIds = useMemo(() => visible.filter((r) => r.kind === 'booking').map((r) => r.id), [visible]);
  const billStatesQ = useBookingBillStates(bookingIds);
  const billStates = useMemo(() => statesById(billStatesQ.data), [billStatesQ.data]);

  const [createAt, setCreateAt] = useState<{ courtId: string; startAt: Date } | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);

  // Open matches over the same night (§5.9). A server without matches
  // answers null: no group, no chips, no Players button.
  const caps = useMatchCaps();
  const { reachable } = useStationReach();
  const openQ = useOpenMatches(night.dayStart, night.dayEnd, settingsQ.isSuccess);
  const openStatus = useMatchRead(openQ);
  const openMatches = openStatus.kind === 'ready' ? openStatus.data : null;
  const matchIds = useMemo(() => matchBookingIds(visible), [visible]);
  const matchStates = useMatchStates(matchIds).data ?? null;
  const [startMatch, setStartMatch] = useState<StartMatchCarry | null>(null);
  const [addPlayerTo, setAddPlayerTo] = useState<string | null>(null);

  // Lessons over the same night (coaching operator.md §5.11). A server
  // without coaching answers null: no group, no New lesson, no Lesson kind.
  const coachingCaps = useCoachingCaps();
  const lessonsQ = useDeskLessons(night.dayStart, night.dayEnd, settingsQ.isSuccess);
  const lessonsStatus = useLessonRead(lessonsQ);
  const deskLessons = lessonsStatus.kind === 'ready' ? lessonsStatus.data : null;
  const lessonsBy = useMemo(() => lessonsByReservation(deskLessons), [deskLessons]);
  const [startLesson, setStartLesson] = useState<StartLessonCarry | null>(null);

  const status: AsyncStatus =
    (settingsQ.isError && !settingsQ.data) || (courtsQ.isError && !courtsQ.data) || (reservationsQ.isError && !reservationsQ.data)
      ? 'error'
      : !settingsQ.data || !courtsQ.data || !reservationsQ.data
        ? 'loading'
        : visible.length === 0
          ? 'empty'
          : 'ready';

  function retry() {
    void settingsQ.refetch();
    void courtsQ.refetch();
    void reservationsQ.refetch();
  }

  /** The next half-hour row of tonight that has not started, or undefined after the last one. */
  const nextStart = (): Date | undefined => {
    const min = rows.find((m) => wallTimeToUtc(date, m, tz).getTime() >= nowMs);
    return min === undefined ? undefined : wallTimeToUtc(date, min, tz);
  };

  /** Book a given court from the next half-hour. After the last row of the night, the calendar takes over. */
  function bookCourt(courtId: string) {
    const startAt = nextStart();
    if (!startAt) {
      void navigate({ to: '/desk' });
      return;
    }
    setCreateAt({ courtId, startAt });
  }

  /**
   * "New booking": the first court free for an hour from the next half-hour.
   * It is only a starting point — court and time are both editable in the
   * dialog — so when every court is taken it still opens, on the first one.
   */
  function createBooking() {
    const startAt = nextStart();
    const first = courts[0];
    if (!startAt || !first) {
      void navigate({ to: '/desk' });
      return;
    }
    const free = courts.find((c) => !slotTaken(visible, c.id, startAt.getTime(), startAt.getTime() + 60 * 60_000));
    setCreateAt({ courtId: (free ?? first).id, startAt });
  }

  /**
   * "Start an open match": the first half-hour tonight the server will take
   * (OM-43: its clock plus the lead), on the first court (a filling match holds
   * no court; the court prices it). Court and time stay editable in the dialog.
   */
  function openStartMatch() {
    const earliest = earliestStartAt({ serverNow: openMatches?.server_now, earliestStartMinutes: openMatches?.earliest_start_minutes });
    const floor = Math.max(nowMs, earliest ? Date.parse(earliest) : 0);
    const min = rows.find((m) => wallTimeToUtc(date, m, tz).getTime() >= floor);
    const startAt = min === undefined ? nextStart() : wallTimeToUtc(date, min, tz);
    const first = courts[0];
    if (!startAt || !first) {
      void navigate({ to: '/desk' });
      return;
    }
    setStartMatch({ courtId: first.id, startAt, customer: null, guestName: '', guestPhone: '' });
  }

  /**
   * "New lesson" (§5.11): the next lesson-grid start, no court in hand (the
   * server picks one, C-10). Kind, time and coach stay editable in the dialog.
   */
  function openNewLesson() {
    const from = nextStart() ?? new Date(nowMs);
    const at = initialStart(from, tz);
    setStartLesson({ courtId: null, startAt: new Date(startOf(at.date, at.time, tz) ?? from.toISOString()), customer: null, guestName: '', guestPhone: '' });
  }

  /** A lesson's row opens its lesson; without its desk_lessons row the booking route forwards (§5.8). */
  function selectReservation(id: string) {
    const lesson = lessonsBy.get(id);
    if (lesson) void navigate({ to: '/desk/lessons/$id', params: { id: lesson.lesson_id } });
    else void navigate({ to: '/desk/bookings/$id', params: { id } });
  }

  async function markArrived(id: string) {
    const r = visible.find((x) => x.id === id);
    if (!r) return;
    setMarkingId(r.id);
    // Optimistic, like the calendar dialog: single-row transition, idempotent server-side.
    queryClient.setQueryData(['reservations', date], (list?: ReservationRow[]) => list?.map((row) => (row.id === r.id ? { ...row, status: 'arrived' } : row)));
    try {
      const outcome = await mutate('reservation.update', { action: 'mark', reservationId: r.id, status: 'arrived' });
      if (outcome.queued) toast.info(tr('ws.courtDesk.detail.queued'));
      else toast.ok(tr('ws.courtDesk.board.arrivedToast', { name: bookingLabel(r, matchStates?.[r.id], tr) ?? tr('ws.courtDesk.board.walkIn') }));
    } catch (e) {
      toast.err(e);
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    } finally {
      setMarkingId(null);
    }
  }

  const nowIso = new Date(nowMs).toISOString();
  const horizonIso = new Date(nowMs + ARRIVAL_HORIZON_MS).toISOString();

  return (
    <>
      {/* Wave 5 (§2.9.9, §5.1): the desk's shift, asked for before the first court payment. */}
      <TillShiftPanel style={{ marginBlockEnd: 'var(--tp-sp-4)' }} />
      <TodaysBoardView
        status={status}
        error={settingsQ.error ?? courtsQ.error ?? reservationsQ.error}
        date={date}
        tz={tz}
        nowIso={nowIso}
        horizonIso={horizonIso}
        courts={courts}
        reservations={visible}
        billStates={billStates}
        connection={night.connection}
        markingId={markingId}
        onRetry={retry}
        onSelectReservation={selectReservation}
        onCreateBooking={createBooking}
        onBookCourt={bookCourt}
        onSearchCustomer={() => void navigate({ to: '/desk/customers' })}
        onMarkArrived={(id) => void markArrived(id)}
        openMatches={openStatus}
        matchStates={matchStates}
        runMatches={caps.runMatches}
        reachable={reachable}
        onAddPlayer={setAddPlayerTo}
        onOpenMatch={(id) => void navigate({ to: '/desk/matches/$id', params: { id } })}
        onStartMatch={openStartMatch}
        onRetryOpenMatches={() => void openQ.refetch()}
        lessons={lessonsStatus}
        runLessons={coachingCaps.runLessons}
        takeLessonPayment={coachingCaps.takeLessonPayment}
        onOpenLesson={(id) => void navigate({ to: '/desk/lessons/$id', params: { id } })}
        // desk_lessons carries no enrolment ids, so `?pay=` cannot be known here: the lesson screen picks the sign-up.
        onPayLesson={(id) => void navigate({ to: '/desk/lessons/$id', params: { id } })}
        onNewLesson={openNewLesson}
        onRetryLessons={() => void lessonsQ.refetch()}
      />
      {createAt && (
        <CreateReservationDialog
          courtId={createAt.courtId}
          startAt={createAt.startAt}
          courts={courts}
          tz={tz}
          night={{ date, rows, reservations: visible }}
          openMatches={openMatches?.matches ?? null}
          onStartMatch={
            caps.runMatches && openMatches?.matches_enabled
              ? (carry) => {
                  setCreateAt(null);
                  setStartMatch(carry);
                }
              : undefined
          }
          // Coaching on or off, once the night's desk_lessons answered (the desk stages, R51).
          onStartLesson={
            coachingCaps.runLessons && deskLessons
              ? (carry) => {
                  setCreateAt(null);
                  setStartLesson(carry);
                }
              : undefined
          }
          onClose={() => setCreateAt(null)}
          onCreated={(queued) => {
            setCreateAt(null);
            if (queued) toast.info(tr('ws.courtDesk.detail.queued'));
            else toast.ok(tr('op.desk.created'));
            void queryClient.invalidateQueries({ queryKey: ['reservations'] });
            void queryClient.invalidateQueries({ queryKey: ['reservationsMonth'] });
          }}
        />
      )}
      {startMatch && (
        <StartMatchDialog
          courtId={startMatch.courtId}
          startAt={startMatch.startAt}
          courts={courts}
          tz={tz}
          night={{ date, rows, reservations: visible }}
          customer={startMatch.customer}
          guestName={startMatch.guestName}
          guestPhone={startMatch.guestPhone}
          openMatches={openMatches}
          openMatchesAt={openQ.dataUpdatedAt}
          onClose={() => setStartMatch(null)}
        />
      )}
      {startLesson && (
        <StartLessonDialog
          courtId={startLesson.courtId}
          startAt={startLesson.startAt}
          courts={courts}
          tz={tz}
          customer={startLesson.customer}
          guestName={startLesson.guestName}
          guestPhone={startLesson.guestPhone}
          lessons={lessonsStatus.kind === 'loading' ? undefined : deskLessons}
          lessonsAt={lessonsQ.dataUpdatedAt}
          onClose={() => setStartLesson(null)}
        />
      )}
      {addPlayerTo && <AddSeatDialog matchId={addPlayerTo} onClose={() => setAddPlayerTo(null)} onAdded={() => setAddPlayerTo(null)} />}
    </>
  );
}
