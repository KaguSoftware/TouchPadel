/**
 * 06.1 TodaysBoardScreen — the desk's landing. Same rows, same cache slot and
 * same broadcast as the calendar (useTradingNight), so what the desk promises
 * here is what the calendar shows.
 *
 * WHY THIS LAYOUT
 *
 * A clerk looks at this screen between guests, often with one in front of
 * them. It answers three questions, top to bottom:
 *
 *  1. **Who is at the door?** Arrivals: bookings that started and are not
 *     marked arrived (late — still coming, or a no-show?), then everyone due
 *     within the hour. One click marks a guest arrived. Guests already here are
 *     not on this list; the old panel mixed them in, so half of the one list the
 *     desk scans was things already done. And it sat under a list of every
 *     court, below the fold on a busy venue.
 *  2. **Can I put a walk-in on a court now?** Courts now, as tiles: free until
 *     when, or in use until when and by whom. A free tile books that court; a
 *     busy one opens its booking.
 *  3. **What does the whole day look like?** Every booking, latest start first,
 *     with its status and where its court fee stands. Rows that have ended
 *     recede. The whole row opens the booking.
 *
 * Money the desk still has to collect (0106) sits with the arrivals, because
 * it is the same moment: the group coming off court passes the group walking
 * on. "Played, not paid" lists games that are over with the fee still open,
 * and an arriving group's row says when the group before them on that court
 * has not paid. Every figure and state comes from app.booking_bill_states.
 *
 * Marking a guest arrived no longer asks for a reason. An arrival is the
 * normal course of a booking, not an override, and the prompt offered only
 * "customer request / weather / staff error / duplicate / other" — none of
 * which is why a guest walks in.
 *
 * Open matches (docs/design/open-matches/operator.md §5.9) have a group of
 * their own after the courts: the night's matches still needing players,
 * with Add player, Open and "Start an open match". A match's booking reads
 * its organiser's name (bookingLabel) with the seat chip, and offers
 * **Players** (its booking screen) where another booking offers Mark arrived:
 * a match is marked player by player, never as a whole.
 *
 * `TodaysBoardView` is pure presentation (spec §06.1 data-in / events-out)
 * so its four states are testable without a database.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { wallTimeToUtc } from '@touch/core';
import { formatDate, formatNumber, formatTime, formatTimeRange, formatWeekdayShort, VENUE_TZ } from '@touch/i18n';
import { mutate } from '../../lib/mutate';
import type { CourtRow } from '../../lib/queries';
import { useToast } from '../../components/toast';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, Skeleton } from '../../components/ui';
import { AsyncStateWrapper, CustomerFlagBadge, EmptyState, PageHeader, Panel, StatusBadge, type AsyncStatus } from '../../components/kit';
import { ChevronForward, Icon, type IconName } from '../../components/icons';
import { ChargeCell, ReservationBadge } from './deskStatus';
import { arrivalsDue, courtAvailability, isVisible, nightSummary, slotTaken, sortByStart, sortByStartDesc, type CourtAvailability } from './deskLogic';
import type { CustomerFlag, ReservationRow } from './deskTypes';
import { CreateReservationDialog, type StartMatchCarry } from './CreateReservationDialog';
import { bookingLabel, isMatchLiteral, type MatchReadStatus } from '../matches/matchLogic';
import type { MatchState, OpenMatches } from '../matches/matchPayloads';
import { SeatChip } from '../matches/SeatChip';
import { NeedsPlayersPanel } from '../matches/NeedsPlayersPanel';
import { StartMatchDialog } from '../matches/StartMatchDialog';
import { AddSeatDialog } from '../matches/AddSeatDialog';
import { earliestStartAt } from '../matches/startMatchLogic';
import { matchBookingIds, useMatchCaps, useMatchRead, useMatchStates, useOpenMatches } from '../matches/useMatches';
import { useStationReach } from '../../lib/stationReach';
import { todayInTz, tonightInTz, useTradingNight } from './useTradingNight';
import { hasEnded, statesById, toSettle, unsettledBefore, type BillStateRow } from './payment/deskPaymentLogic';
import { useBookingBillStates } from './payment/useBookingBill';
import { TillShiftPanel } from '../tillShift/TillShiftPanel';

const ARRIVAL_HORIZON_MS = 60 * 60_000;
/**
 * Tiles shown before "Show all courts". A venue with a few courts sees them
 * all; a long list (the dev stack has well over a hundred) would otherwise
 * push the day's bookings a screen and a half down. Courts in use are always
 * shown — they are the ones the desk may need to open.
 */
const COURT_TILES_SHOWN = 12;
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
  live: boolean;
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
}

export function TodaysBoardView(p: TodaysBoardViewProps) {
  const { tr, locale } = useLocale();
  const courtName = (id: string) => pickName(locale, p.courts.find((c) => c.id === id));
  const summary = useMemo(() => nightSummary(p.reservations, p.nowIso), [p.reservations, p.nowIso]);
  const availability = useMemo(() => courtAvailability(p.courts.map((c) => c.id), p.reservations, p.nowIso), [p.courts, p.reservations, p.nowIso]);
  const due = useMemo(() => arrivalsDue(p.reservations, p.nowIso, p.horizonIso), [p.reservations, p.nowIso, p.horizonIso]);
  const unpaid = useMemo(() => toSettle(p.reservations, p.billStates, p.nowIso), [p.reservations, p.billStates, p.nowIso]);
  const dayNoon = new Date(`${p.date}T12:00:00Z`);
  const ready = p.status === 'ready' || p.status === 'empty';

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
  const courtsPanel = <CourtsNow availability={availability} reservations={p.reservations} courtName={courtName} tz={p.tz} live={p.live} states={states} onBook={p.onBookCourt} onOpen={p.onSelectReservation} />;
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

  return (
    <div>
      {header}
      <AsyncStateWrapper
        status={p.status}
        error={p.error}
        onRetry={p.onRetry}
        skeleton={
          <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
            <Skeleton lines={3} blockSize="3rem" />
            <Skeleton lines={2} blockSize="3.5rem" />
            <Skeleton lines={6} blockSize="2.2rem" />
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
            {courtsPanel}
            {matchesPanel}
          </div>
        }
      >
        <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
          <ArrivalsPanel
            due={due}
            unpaid={unpaid}
            billStates={p.billStates}
            reservations={p.reservations}
            nowIso={p.nowIso}
            tz={p.tz}
            courtName={courtName}
            states={states}
            flagsByGuest={p.flagsByGuest}
            markingId={p.markingId}
            onMarkArrived={p.onMarkArrived}
            onOpen={p.onSelectReservation}
          />
          {courtsPanel}
          {matchesPanel}
          <Panel title={<PanelTitle icon="calendar">{tr('ws.courtDesk.board.bookings')}</PanelTitle>} padded={false}>
            <div style={{ overflowX: 'auto' }}>
              <table className="tp-table" data-dense="true" aria-label={tr('ws.courtDesk.board.bookings')}>
                <thead>
                  <tr>
                    <th>{tr('ws.courtDesk.board.time')}</th>
                    <th>{tr('ws.courtDesk.board.court')}</th>
                    <th>{tr('ws.courtDesk.board.customer')}</th>
                    <th>{tr('ws.courtDesk.board.status')}</th>
                    <th>{tr('ws.courtDesk.board.payment')}</th>
                    <th aria-label={tr('ws.courtDesk.common.actions')} />
                  </tr>
                </thead>
                <tbody>
                  {sortByStartDesc(p.reservations).map((r) => (
                    <BoardRow
                      key={r.id}
                      r={r}
                      courtName={courtName(r.court_id)}
                      tz={p.tz}
                      nowIso={p.nowIso}
                      billState={p.billStates?.get(r.id)}
                      flags={r.guest_id ? p.flagsByGuest?.get(r.guest_id) : undefined}
                      match={states?.[r.id]}
                      marking={p.markingId === r.id}
                      onSelect={() => p.onSelectReservation(r.id)}
                      onMarkArrived={() => p.onMarkArrived(r.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
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
      <Icon name={icon} size={16} style={{ color: 'var(--tp-muted-fg)' }} />
      {children}
    </span>
  );
}

/** The name a row shows; an open match's booking reads its organiser (or "Open match"). */
function guestLabel(r: ReservationRow, tr: ReturnType<typeof useLocale>['tr'], states?: Readonly<Record<string, MatchState>>): string {
  if (r.kind === 'maintenance') return r.notes ?? tr('ws.courtDesk.board.blocked');
  if (r.kind === 'hold') return tr('ws.courtDesk.board.hold');
  return bookingLabel(r, states?.[r.id], tr) ?? tr('ws.courtDesk.board.walkIn');
}

/** A match's booking: its state says so, or its row does (no account, the literal name). */
function isMatchRow(r: ReservationRow, match: MatchState | undefined): boolean {
  return r.kind === 'booking' && (match !== undefined || isMatchLiteral(r));
}

const minutesBetween = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000));

// ---------------------------------------------------------------------------
// 1 — Arrivals
// ---------------------------------------------------------------------------

function ArrivalsPanel({
  due,
  unpaid,
  billStates,
  reservations,
  nowIso,
  tz,
  courtName,
  states,
  flagsByGuest,
  markingId,
  onMarkArrived,
  onOpen,
}: {
  due: ReturnType<typeof arrivalsDue>;
  unpaid: readonly ReservationRow[];
  billStates?: ReadonlyMap<string, BillStateRow>;
  reservations: readonly ReservationRow[];
  nowIso: string;
  tz: string;
  courtName: (id: string) => string;
  states?: Readonly<Record<string, MatchState>>;
  flagsByGuest?: ReadonlyMap<string, readonly CustomerFlag[]>;
  markingId?: string | null;
  onMarkArrived: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const { tr, locale } = useLocale();
  const nothing = due.late.length === 0 && due.soon.length === 0 && unpaid.length === 0;
  const previousUnpaid = (r: ReservationRow) => {
    const prev = unsettledBefore(r, reservations, billStates, nowIso);
    return prev ? tr('ws.courtDesk.board.previousUnpaid', { name: guestLabel(prev, tr, states) }) : undefined;
  };
  // With nobody due, say when the next guest is — the question that follows.
  const next = nothing ? sortByStart(reservations).find((r) => r.kind === 'booking' && r.status === 'confirmed' && r.start_at > nowIso) : undefined;

  return (
    <Panel title={<PanelTitle icon="users">{tr('ws.courtDesk.board.arrivals')}</PanelTitle>}>
      {nothing ? (
        <p style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', color: 'var(--tp-muted-fg)' }}>
          <Icon name="checkCircle" size={18} style={{ color: 'var(--tp-success-mark)', flex: '0 0 auto' }} />
          <span style={{ color: 'var(--tp-fg)', fontWeight: 600 }}>{tr('ws.courtDesk.board.arrivalsEmpty')}</span>
          {next && (
            <bdi>
              {tr('ws.courtDesk.board.nextArrival', {
                time: formatTime(new Date(next.start_at), locale, tz),
                name: guestLabel(next, tr, states),
                court: courtName(next.court_id),
              })}
            </bdi>
          )}
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
          {unpaid.length > 0 && (
            <ArrivalGroup title={tr('ws.courtDesk.board.toSettleTitle')} hint={tr('ws.courtDesk.board.toSettleHint')}>
              {unpaid.map((r) => (
                <ArrivalRow
                  key={r.id}
                  r={r}
                  tone="warn"
                  when={formatTimeRange(new Date(r.start_at), new Date(r.end_at), locale, tz)}
                  tz={tz}
                  courtName={courtName(r.court_id)}
                  match={states?.[r.id]}
                  started={r.start_at <= nowIso}
                  flags={r.guest_id ? flagsByGuest?.get(r.guest_id) : undefined}
                  marking={false}
                  billState={billStates?.get(r.id)}
                  onOpen={() => onOpen(r.id)}
                />
              ))}
            </ArrivalGroup>
          )}
          {due.late.length > 0 && (
            <ArrivalGroup title={tr('ws.courtDesk.board.lateTitle')} hint={tr('ws.courtDesk.board.lateHint')}>
              {due.late.map((r) => (
                <ArrivalRow
                  key={r.id}
                  r={r}
                  tone="warn"
                  when={tr('ws.courtDesk.board.startedAgo', { minutes: formatNumber(minutesBetween(r.start_at, nowIso), locale) })}
                  tz={tz}
                  courtName={courtName(r.court_id)}
                  match={states?.[r.id]}
                  started={r.start_at <= nowIso}
                  flags={r.guest_id ? flagsByGuest?.get(r.guest_id) : undefined}
                  marking={markingId === r.id}
                  notice={previousUnpaid(r)}
                  onMarkArrived={() => onMarkArrived(r.id)}
                  onOpen={() => onOpen(r.id)}
                />
              ))}
            </ArrivalGroup>
          )}
          {due.soon.length > 0 && (
            <ArrivalGroup title={tr('ws.courtDesk.board.soonTitle')}>
              {due.soon.map((r) => (
                <ArrivalRow
                  key={r.id}
                  r={r}
                  tone="neutral"
                  when={tr('ws.courtDesk.board.startsIn', { minutes: formatNumber(minutesBetween(nowIso, r.start_at), locale) })}
                  tz={tz}
                  courtName={courtName(r.court_id)}
                  match={states?.[r.id]}
                  started={r.start_at <= nowIso}
                  flags={r.guest_id ? flagsByGuest?.get(r.guest_id) : undefined}
                  marking={markingId === r.id}
                  notice={previousUnpaid(r)}
                  onMarkArrived={() => onMarkArrived(r.id)}
                  onOpen={() => onOpen(r.id)}
                />
              ))}
            </ArrivalGroup>
          )}
        </div>
      )}
    </Panel>
  );
}

function ArrivalGroup({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <h3 style={{ fontSize: 'var(--tp-fs-xs)', fontWeight: 600, color: 'var(--tp-muted-fg)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</h3>
      {hint && <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockStart: 'var(--tp-sp-0)' }}>{hint}</p>}
      <ul style={{ listStyle: 'none', margin: 0, marginBlockStart: 'var(--tp-sp-2)', padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>{children}</ul>
    </section>
  );
}

function ArrivalRow({
  r,
  tone,
  when,
  tz,
  courtName,
  match,
  started,
  flags,
  marking,
  notice,
  billState,
  onMarkArrived,
  onOpen,
}: {
  r: ReservationRow;
  tone: 'warn' | 'neutral';
  when: string;
  tz: string;
  courtName: string;
  /** app.desk_match_states for an open match's booking. */
  match?: MatchState;
  /** The booking has started by the board's clock (the seat chip's R39 reading). */
  started: boolean;
  flags?: readonly CustomerFlag[];
  marking: boolean;
  /** One line the desk should know as this group walks in. */
  notice?: string;
  /** Set on "Played, not paid" rows: the fee state replaces "Mark arrived". */
  billState?: BillStateRow;
  /** Absent on "Played, not paid" rows — they are settled from the booking. */
  onMarkArrived?: () => void;
  onOpen: () => void;
}) {
  const { tr, locale } = useLocale();
  const name = guestLabel(r, tr, match ? { [r.id]: match } : undefined);
  const isMatch = isMatchRow(r, match);
  // A match's booking settles per player: say how many still owe (booking_bill_states, 0262).
  const owing = isMatch && billState && (billState.seats_owing ?? 0) > 0 ? billState.seats_owing! : null;
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--tp-sp-3)',
        flexWrap: 'wrap',
        paddingBlock: 'var(--tp-sp-2)',
        paddingInline: 'var(--tp-sp-3)',
        borderRadius: 'var(--tp-radius-ctl)',
        background: 'var(--tp-surface-2)',
      }}
    >
      <span style={{ display: 'grid', minInlineSize: '6.5rem' }}>
        <strong style={{ fontSize: 'var(--tp-fs-lg)', fontVariantNumeric: 'tabular-nums' }}>
          <bdi>{formatTime(new Date(r.start_at), locale, tz)}</bdi>
        </strong>
        {/* The time on the clock face is the fact; how long ago / how soon is
            what the desk acts on, and late is the only one that is tinted. */}
        <span style={{ fontSize: 'var(--tp-fs-xs)', fontWeight: 600, color: tone === 'warn' ? 'var(--tp-warn-fg)' : 'var(--tp-muted-fg)' }}>{when}</span>
      </span>
      <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', flex: '1 1 14rem', minInlineSize: 0 }}>
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 'var(--tp-fs-md)' }}>
            <bdi>{name}</bdi>
          </strong>
          {match && <SeatChip state={match} started={started} />}
          {flags?.map((f, i) => (
            <CustomerFlagBadge key={`${f.type}-${i}`} flag={f} />
          ))}
        </span>
        <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', display: 'inline-flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
          <bdi>{courtName}</bdi>
          {r.guest_phone && (
            <bdi dir="ltr" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {r.guest_phone}
            </bdi>
          )}
        </span>
        {owing !== null && (
          <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600, color: 'var(--tp-warn-fg)' }}>{tr('ws.matches.today.playersOwing', { count: formatNumber(owing, locale) })}</span>
        )}
        {notice && (
          <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)', alignItems: 'center', fontSize: 'var(--tp-fs-sm)', fontWeight: 600, color: 'var(--tp-warn-fg)' }}>
            <Icon name="alert" size={14} style={{ flex: '0 0 auto' }} />
            <bdi>{notice}</bdi>
          </span>
        )}
      </span>
      <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)', alignItems: 'center', marginInlineStart: 'auto' }}>
        {billState && <ChargeCell state={billState} kind={r.kind} ended />}
        {onMarkArrived ? (
          <>
            <Button kind="ghost" iconEnd="chevronEnd" onClick={onOpen} aria-label={`${tr('ws.courtDesk.board.open')} ${name}`}>
              {tr('ws.courtDesk.board.open')}
            </Button>
            {isMatch ? (
              // Players are marked one by one, on the booking's Players panel.
              <Button kind="primary" icon="users" onClick={onOpen} aria-label={`${tr('ws.matches.booking.players')} ${name}`}>
                {tr('ws.matches.booking.players')}
              </Button>
            ) : (
              <Button kind="primary" icon="check" busy={marking} onClick={onMarkArrived}>
                {tr('ws.courtDesk.board.markArrived')}
              </Button>
            )}
          </>
        ) : (
          <Button kind="primary" icon="banknote" onClick={onOpen} aria-label={`${tr('ws.courtDesk.board.takePayment')} ${name}`}>
            {tr('ws.courtDesk.board.takePayment')}
          </Button>
        )}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// 2 — Courts now
// ---------------------------------------------------------------------------

function CourtsNow({
  availability,
  reservations,
  courtName,
  tz,
  live,
  states,
  onBook,
  onOpen,
}: {
  availability: readonly CourtAvailability[];
  reservations: readonly ReservationRow[];
  courtName: (id: string) => string;
  tz: string;
  live: boolean;
  states?: Readonly<Record<string, MatchState>>;
  onBook: (courtId: string) => void;
  onOpen: (id: string) => void;
}) {
  const { tr, locale } = useLocale();
  const free = availability.filter((a) => a.state === 'free').length;
  const [showAll, setShowAll] = useState(false);
  const long = availability.length > COURT_TILES_SHOWN;
  const shown = useMemo(() => {
    if (!long || showAll) return availability;
    const room = Math.max(0, COURT_TILES_SHOWN - (availability.length - free));
    let freeLeft = room;
    // Court order is kept: the desk learns where a court sits in the grid.
    return availability.filter((a) => a.state === 'busy' || freeLeft-- > 0);
  }, [availability, long, showAll, free]);
  return (
    <Panel
      title={<PanelTitle icon="court">{tr('ws.courtDesk.board.availability')}</PanelTitle>}
      actions={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-3)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          <span>
            {tr('ws.courtDesk.board.freeNow')}{' '}
            <strong style={{ color: 'var(--tp-fg)', fontVariantNumeric: 'tabular-nums' }}>
              {tr('ws.courtDesk.board.freeOf', { free: formatNumber(free, locale), total: formatNumber(availability.length, locale) })}
            </strong>
          </span>
          {/* Both states carry a glyph; neither pulses — live is steady, and its label says so. */}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-xs)', color: live ? 'var(--tp-success-fg)' : 'var(--tp-muted-fg)' }}>
            <Icon name={live ? 'checkCircle' : 'clock'} size={12} />
            {live ? tr('ws.courtDesk.board.live') : tr('ws.courtDesk.board.polling')}
          </span>
        </span>
      }
    >
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)', gridTemplateColumns: 'repeat(auto-fill, minmax(12rem, 1fr))' }}>
        {shown.map((a) => {
          const busy = a.state === 'busy' ? reservations.find((r) => r.id === a.reservationId) : undefined;
          const line =
            a.state === 'busy'
              ? tr(a.kind === 'maintenance' ? 'ws.courtDesk.board.busyBlocked' : 'ws.courtDesk.board.busyUntil', { time: formatTime(new Date(a.untilAt), locale, tz) })
              : a.nextStartAt
                ? tr('ws.courtDesk.board.freeUntil', { time: formatTime(new Date(a.nextStartAt), locale, tz) })
                : tr('ws.courtDesk.board.free');
          const name = courtName(a.courtId);
          return (
            <li key={a.courtId}>
              <button
                type="button"
                className="tp-tile"
                onClick={() => (a.state === 'busy' ? onOpen(a.reservationId) : onBook(a.courtId))}
                aria-label={a.state === 'busy' ? `${name} · ${line} · ${tr('ws.courtDesk.board.open')}` : `${name} · ${line} · ${tr('ws.courtDesk.board.bookCourt')}`}
                style={{
                  inlineSize: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--tp-sp-2)',
                  paddingBlock: 'var(--tp-sp-2)',
                  paddingInline: 'var(--tp-sp-3)',
                  border: '1px solid var(--tp-border)',
                  borderRadius: 'var(--tp-radius-ctl)',
                  background: 'var(--tp-surface)',
                  color: 'inherit',
                  font: 'inherit',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    flex: '0 0 auto',
                    inlineSize: '0.6rem',
                    blockSize: '0.6rem',
                    borderRadius: '50%',
                    background: a.state === 'free' ? 'var(--tp-success-mark)' : a.kind === 'maintenance' ? 'var(--tp-neutral-mark)' : 'var(--tp-accent)',
                  }}
                />
                <span style={{ display: 'grid', minInlineSize: 0, flex: 1 }}>
                  <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <bdi>{name}</bdi>
                  </strong>
                  <span style={{ fontSize: 'var(--tp-fs-xs)', color: a.state === 'free' ? 'var(--tp-success-fg)' : 'var(--tp-muted-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {line}
                    {busy && busy.kind === 'booking' && (
                      <>
                        {' · '}
                        <bdi>{guestLabel(busy, tr, states)}</bdi>
                      </>
                    )}
                  </span>
                </span>
                {a.state === 'free' ? (
                  <Icon name="plus" size={16} style={{ color: 'var(--tp-muted-fg)', flex: '0 0 auto' }} />
                ) : (
                  <ChevronForward size={14} style={{ color: 'var(--tp-muted-fg)', flex: '0 0 auto' }} />
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {long && (
        <Button size="sm" kind="ghost" icon={showAll ? 'chevronDown' : 'plus'} onClick={() => setShowAll((v) => !v)} style={{ marginBlockStart: 'var(--tp-sp-2)' }}>
          {showAll ? tr('ws.courtDesk.board.showFewerCourts') : tr('ws.courtDesk.board.showAllCourts', { count: formatNumber(availability.length, locale) })}
        </Button>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 3 — Every booking today
// ---------------------------------------------------------------------------

function BoardRow({
  r,
  courtName,
  tz,
  nowIso,
  billState,
  flags,
  match,
  marking,
  onSelect,
  onMarkArrived,
}: {
  r: ReservationRow;
  courtName: string;
  tz: string;
  nowIso: string;
  billState?: BillStateRow;
  flags?: readonly CustomerFlag[];
  /** app.desk_match_states for an open match's booking. */
  match?: MatchState;
  marking: boolean;
  onSelect: () => void;
  onMarkArrived: () => void;
}) {
  const { tr, locale } = useLocale();
  const inProgress = r.start_at <= nowIso && r.end_at > nowIso;
  const ended = hasEnded(r, nowIso);
  const label = guestLabel(r, tr, match ? { [r.id]: match } : undefined);
  const isMatch = isMatchRow(r, match);
  return (
    <tr
      data-clickable="true"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      // What is over recedes; it stays listed because the desk still settles it.
      style={{ color: ended ? 'var(--tp-muted-fg)' : undefined }}
    >
      <td style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: 600 }}>
        <bdi>{formatTimeRange(new Date(r.start_at), new Date(r.end_at), locale, tz)}</bdi>
        {inProgress && <StatusBadge size="sm" tone="success" label={tr('ws.courtDesk.board.onCourtNow')} style={{ marginInlineStart: '0.4rem' }} />}
      </td>
      <td>
        <bdi>{courtName}</bdi>
      </td>
      <td>
        <span style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ color: ended ? 'var(--tp-muted-fg)' : 'var(--tp-fg)' }}>
            <bdi>{label}</bdi>
          </strong>
          {match && <SeatChip state={match} started={r.start_at <= nowIso} />}
          {r.guest_phone && (
            <bdi dir="ltr" style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)', fontVariantNumeric: 'tabular-nums' }}>
              {r.guest_phone}
            </bdi>
          )}
          {flags?.map((f, i) => (
            <CustomerFlagBadge key={`${f.type}-${i}`} flag={f} />
          ))}
        </span>
      </td>
      <td>
        <ReservationBadge reservation={r} size="sm" />
      </td>
      <td>
        <ChargeCell state={billState} kind={r.kind} ended={ended} />
      </td>
      <td style={{ textAlign: 'end', whiteSpace: 'nowrap' }}>
        <span style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center' }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {r.kind === 'booking' && r.status === 'confirmed' && r.end_at > nowIso && (
            isMatch ? (
              // Players are marked one by one, on the booking's Players panel.
              <Button size="sm" icon="users" onClick={onSelect} aria-label={`${tr('ws.matches.booking.players')} ${label}`}>
                {tr('ws.matches.booking.players')}
              </Button>
            ) : (
              <Button size="sm" icon="check" busy={marking} onClick={onMarkArrived}>
                {tr('ws.courtDesk.board.markArrived')}
              </Button>
            )
          )}
          <Button size="sm" kind="ghost" icon="chevronEnd" onClick={onSelect} aria-label={`${tr('ws.courtDesk.board.open')} ${label}`} />
        </span>
      </td>
    </tr>
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
        live={!reservationsQ.isError}
        markingId={markingId}
        onRetry={retry}
        onSelectReservation={(id) => void navigate({ to: '/desk/bookings/$id', params: { id } })}
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
      {addPlayerTo && <AddSeatDialog matchId={addPlayerTo} onClose={() => setAddPlayerTo(null)} onAdded={() => setAddPlayerTo(null)} />}
    </>
  );
}
