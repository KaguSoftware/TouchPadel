/**
 * 06.1 TodaysBoardScreen — the desk's landing: today's bookings grouped by
 * start time, live court availability, arrivals due within the hour. Same
 * rows, same cache slot and same broadcast as the calendar (useTradingNight),
 * so what the desk promises here is what the calendar shows.
 *
 * `TodaysBoardView` is pure presentation (spec §06.1 data-in / events-out)
 * so its four states are testable without a database.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { wallTimeToUtc } from '@touch/core';
import { formatDate, formatNumber, formatTime, formatTimeRange, VENUE_TZ } from '@touch/i18n';
import { mutate } from '../../lib/mutate';
import type { CourtRow } from '../../lib/queries';
import { useToast } from '../../components/toast';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, Skeleton } from '../../components/ui';
import {
  AsyncStateWrapper,
  BookingStatusIndicator,
  CustomerFlagBadge,
  EmptyState,
  PageHeader,
  Panel,
  PaymentStatusIndicator,
  ReasonCodePrompt,
  StatusBadge,
  type AsyncStatus,
} from '../../components/kit';
import { Icon } from '../../components/icons';
import { arrivals, courtAvailability, groupByStart, isVisible, paymentStatusFor, type CourtAvailability } from './deskLogic';
import type { CustomerFlag, ReservationRow, TabLinkRow } from './deskTypes';
import { CreateReservationDialog } from './CreateReservationDialog';
import { OVERRIDE_REASONS } from './ReservationActionsDialog';
import { todayInTz, useTabLinks, useTradingNight } from './useTradingNight';

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
  tabLinks?: readonly TabLinkRow[];
  /** Flags by guest id, when the customer data is available. */
  flagsByGuest?: ReadonlyMap<string, readonly CustomerFlag[]>;
  live: boolean;
  markingId?: string | null;
  onRetry: () => void;
  onSelectReservation: (id: string) => void;
  onCreateBooking: () => void;
  onSearchCustomer: () => void;
  onOpenCalendar: () => void;
  onMarkArrived: (id: string) => void;
}

export function TodaysBoardView(p: TodaysBoardViewProps) {
  const { tr, locale } = useLocale();
  const courtName = (id: string) => pickName(locale, p.courts.find((c) => c.id === id));
  const bookings = useMemo(() => p.reservations.filter((r) => r.kind === 'booking'), [p.reservations]);
  const groups = useMemo(() => groupByStart(p.reservations), [p.reservations]);
  const availability = useMemo(() => courtAvailability(p.courts.map((c) => c.id), p.reservations, p.nowIso), [p.courts, p.reservations, p.nowIso]);
  const due = useMemo(() => arrivals(p.reservations, p.nowIso, p.horizonIso), [p.reservations, p.nowIso, p.horizonIso]);

  const header = (
    <PageHeader
      title={tr('ws.courtDesk.board.title')}
      subtitle={tr('ws.courtDesk.board.subtitle', { date: formatDate(new Date(`${p.date}T12:00:00Z`), locale, 'UTC'), count: formatNumber(bookings.length, locale) })}
      actions={
        <>
          <Button kind="primary" icon="plus" onClick={p.onCreateBooking} disabled={p.status !== 'ready' && p.status !== 'empty'}>
            {tr('ws.courtDesk.board.newBooking')}
          </Button>
          <Button icon="search" onClick={p.onSearchCustomer}>
            {tr('ws.courtDesk.board.searchCustomer')}
          </Button>
          <Button icon="calendar" onClick={p.onOpenCalendar}>
            {tr('ws.courtDesk.board.openCalendar')}
          </Button>
        </>
      }
    />
  );

  return (
    <div>
      {header}
      <AsyncStateWrapper
        status={p.status}
        error={p.error}
        onRetry={p.onRetry}
        skeleton={
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(16rem, 1fr)', gap: '1rem' }}>
            <Skeleton lines={8} blockSize="2.2rem" />
            <Skeleton lines={5} blockSize="2.2rem" />
          </div>
        }
        emptyContent={
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(16rem, 1fr)', gap: '1rem', alignItems: 'start' }}>
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
            <AvailabilityStrip availability={availability} courtName={courtName} tz={p.tz} live={p.live} />
          </div>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(16rem, 1fr)', gap: '1rem', alignItems: 'start' }}>
          <Panel title={tr('ws.courtDesk.board.bookings')} padded={false}>
            <table className="tp-table" data-dense="true" aria-label={tr('ws.courtDesk.board.bookings')}>
              <thead>
                <tr>
                  <th>{tr('ws.courtDesk.board.time')}</th>
                  <th>{tr('ws.courtDesk.board.court')}</th>
                  <th>{tr('ws.courtDesk.board.customer')}</th>
                  <th>{tr('ws.courtDesk.board.status')}</th>
                  <th>{tr('ws.courtDesk.board.payment')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {groups.map((g) =>
                  g.rows.map((r, i) => (
                    <BoardRow
                      key={r.id}
                      r={r}
                      first={i === 0}
                      groupSize={g.rows.length}
                      courtName={courtName(r.court_id)}
                      tz={p.tz}
                      nowIso={p.nowIso}
                      tabLinks={p.tabLinks}
                      flags={r.guest_id ? p.flagsByGuest?.get(r.guest_id) : undefined}
                      marking={p.markingId === r.id}
                      onSelect={() => p.onSelectReservation(r.id)}
                      onMarkArrived={() => p.onMarkArrived(r.id)}
                    />
                  )),
                )}
              </tbody>
            </table>
          </Panel>
          <div style={{ display: 'grid', gap: '1rem' }}>
            <AvailabilityStrip availability={availability} courtName={courtName} tz={p.tz} live={p.live} />
            <Panel title={tr('ws.courtDesk.board.arrivals')} padded={false}>
              <p style={{ paddingBlock: '0.5rem', paddingInline: '0.85rem', color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)', borderBlockEnd: '1px solid var(--tp-border)' }}>
                {tr('ws.courtDesk.board.arrivalsLead')}
              </p>
              {due.length === 0 ? (
                <p style={{ paddingBlock: '0.9rem', paddingInline: '0.85rem', color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.courtDesk.board.arrivalsEmpty')}</p>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {due.map((r) => (
                    <li
                      key={r.id}
                      className="tp-row"
                      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingBlock: '0.45rem', paddingInline: '0.85rem', borderBlockEnd: '1px solid var(--tp-border)' }}
                    >
                      <div style={{ minInlineSize: 0, flex: 1 }}>
                        <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <bdi>{r.guest_name ?? tr('ws.courtDesk.board.walkIn')}</bdi>
                        </div>
                        <div style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
                          <bdi>{courtName(r.court_id)}</bdi> · <bdi>{formatTime(new Date(r.start_at), locale, p.tz)}</bdi>
                        </div>
                      </div>
                      {r.status === 'arrived' ? (
                        <BookingStatusIndicator status="arrived" size="sm" />
                      ) : (
                        <Button size="sm" icon="check" busy={p.markingId === r.id} onClick={() => p.onMarkArrived(r.id)}>
                          {tr('ws.courtDesk.board.markArrived')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      </AsyncStateWrapper>
    </div>
  );
}

function BoardRow({
  r,
  first,
  groupSize,
  courtName,
  tz,
  nowIso,
  tabLinks,
  flags,
  marking,
  onSelect,
  onMarkArrived,
}: {
  r: ReservationRow;
  first: boolean;
  groupSize: number;
  courtName: string;
  tz: string;
  nowIso: string;
  tabLinks?: readonly TabLinkRow[];
  flags?: readonly CustomerFlag[];
  marking: boolean;
  onSelect: () => void;
  onMarkArrived: () => void;
}) {
  const { tr, locale } = useLocale();
  const inProgress = r.start_at <= nowIso && r.end_at > nowIso;
  const label = r.kind === 'maintenance' ? (r.notes ?? tr('ws.courtDesk.board.blocked')) : r.kind === 'hold' ? tr('ws.courtDesk.board.hold') : (r.guest_name ?? tr('ws.courtDesk.board.walkIn'));
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
      style={{ borderBlockStart: first && groupSize > 1 ? '2px solid var(--tp-border-strong)' : undefined }}
    >
      <td style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: first ? 600 : 400, color: first ? 'var(--tp-fg)' : 'var(--tp-muted-fg)' }}>
        <bdi>{formatTimeRange(new Date(r.start_at), new Date(r.end_at), locale, tz)}</bdi>
        {inProgress && (
          <StatusBadge size="sm" tone="success" label={tr('ws.courtDesk.board.live')} style={{ marginInlineStart: '0.4rem' }} />
        )}
      </td>
      <td>
        <bdi>{courtName}</bdi>
      </td>
      <td>
        <span style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>
            <bdi>{label}</bdi>
          </strong>
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
      <td>{r.kind === 'booking' ? <BookingStatusIndicator status={r.status} size="sm" /> : <StatusBadge size="sm" label={tr(`ws.kit.reservationKind.${r.kind}`)} />}</td>
      <td>{r.kind === 'booking' ? <PaymentStatusIndicator paymentStatus={paymentStatusFor(r, tabLinks)} size="sm" /> : null}</td>
      <td style={{ textAlign: 'end', whiteSpace: 'nowrap' }}>
        <span style={{ display: 'inline-flex', gap: '0.3rem' }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {r.kind === 'booking' && r.status === 'confirmed' && (
            <Button size="sm" icon="check" busy={marking} onClick={onMarkArrived}>
              {tr('ws.courtDesk.board.markArrived')}
            </Button>
          )}
          <Button size="sm" kind="ghost" iconEnd="chevronEnd" onClick={onSelect} aria-label={`${tr('ws.courtDesk.board.open')} ${label}`}>
            {tr('ws.courtDesk.board.open')}
          </Button>
        </span>
      </td>
    </tr>
  );
}

function AvailabilityStrip({
  availability,
  courtName,
  tz,
  live,
}: {
  availability: readonly CourtAvailability[];
  courtName: (id: string) => string;
  tz: string;
  live: boolean;
}) {
  const { tr, locale } = useLocale();
  return (
    <Panel
      title={tr('ws.courtDesk.board.availability')}
      padded={false}
      actions={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: 'var(--tp-fs-xs)', color: live ? 'var(--tp-success-fg)' : 'var(--tp-muted-fg)' }}>
          <Icon name={live ? 'wifiOff' : 'clock'} size={12} style={{ display: live ? 'none' : undefined }} />
          {live ? tr('ws.courtDesk.board.live') : tr('ws.courtDesk.board.polling')}
        </span>
      }
    >
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {availability.map((a) => {
          let body: ReactNode;
          let tone: 'success' | 'accent' | 'neutral' = 'success';
          if (a.state === 'busy') {
            tone = a.kind === 'maintenance' ? 'neutral' : 'accent';
            body = tr(a.kind === 'maintenance' ? 'ws.courtDesk.board.busyBlocked' : 'ws.courtDesk.board.busyUntil', { time: formatTime(new Date(a.untilAt), locale, tz) });
          } else if (a.nextStartAt) {
            body = tr('ws.courtDesk.board.freeUntil', { time: formatTime(new Date(a.nextStartAt), locale, tz) });
          } else {
            body = tr('ws.courtDesk.board.free');
          }
          return (
            <li key={a.courtId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', paddingBlock: '0.5rem', paddingInline: '0.85rem', borderBlockEnd: '1px solid var(--tp-border)' }}>
              <span style={{ fontWeight: 600 }}>
                <bdi>{courtName(a.courtId)}</bdi>
              </span>
              <StatusBadge size="sm" tone={tone} label={typeof body === 'string' ? body : ''} />
            </li>
          );
        })}
      </ul>
    </Panel>
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
  // Once the venue's timezone arrives, re-anchor "today" to it.
  useEffect(() => {
    if (settingsQ.data) setDate(todayInTz(settingsQ.data.timezone));
  }, [settingsQ.data]);

  const visible = useMemo(() => night.reservations.filter((r) => isVisible(r, nowMs)), [night.reservations, nowMs]);
  const bookingIds = useMemo(() => visible.filter((r) => r.kind === 'booking').map((r) => r.id), [visible]);
  const tabLinksQ = useTabLinks(bookingIds);

  const [createAt, setCreateAt] = useState<{ courtId: string; startAt: Date } | null>(null);
  const [pendingArrive, setPendingArrive] = useState<ReservationRow | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);

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

  /** The next free half-hour on any court from now; otherwise send the desk to the calendar. */
  function createBooking() {
    const nowIso = new Date(nowMs).toISOString();
    const avail = courtAvailability(courts.map((c) => c.id), visible, nowIso);
    const free = avail.find((a) => a.state === 'free');
    const nextMin = rows.find((min) => wallTimeToUtc(date, min, tz).getTime() >= nowMs);
    if (!free || nextMin === undefined) {
      void navigate({ to: '/desk' });
      return;
    }
    setCreateAt({ courtId: free.courtId, startAt: wallTimeToUtc(date, nextMin, tz) });
  }

  async function markArrived(reason: string) {
    if (!pendingArrive) return;
    const r = pendingArrive;
    setPendingArrive(null);
    setMarkingId(r.id);
    // Optimistic, like the calendar dialog: single-row transition, idempotent server-side.
    queryClient.setQueryData(['reservations', date], (list?: ReservationRow[]) => list?.map((row) => (row.id === r.id ? { ...row, status: 'arrived' } : row)));
    try {
      await mutate('reservation.update', { action: 'mark', reservationId: r.id, status: 'arrived', reason });
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
      <TodaysBoardView
        status={status}
        error={settingsQ.error ?? courtsQ.error ?? reservationsQ.error}
        date={date}
        tz={tz}
        nowIso={nowIso}
        horizonIso={horizonIso}
        courts={courts}
        reservations={visible}
        tabLinks={tabLinksQ.data}
        live={!reservationsQ.isError}
        markingId={markingId}
        onRetry={retry}
        onSelectReservation={(id) => void navigate({ to: '/desk/bookings/$id', params: { id } })}
        onCreateBooking={createBooking}
        onSearchCustomer={() => void navigate({ to: '/desk/customers' })}
        onOpenCalendar={() => void navigate({ to: '/desk' })}
        onMarkArrived={(id) => {
          const r = visible.find((x) => x.id === id);
          if (r) setPendingArrive(r);
        }}
      />
      {createAt && (
        <CreateReservationDialog
          courtId={createAt.courtId}
          startAt={createAt.startAt}
          courts={courts}
          tz={tz}
          onClose={() => setCreateAt(null)}
          onCreated={() => {
            setCreateAt(null);
            toast.ok(tr('op.desk.created'));
            void queryClient.invalidateQueries({ queryKey: ['reservations'] });
          }}
        />
      )}
      {pendingArrive && (
        <ReasonCodePrompt
          action={tr('ws.courtDesk.detail.reason.arrived')}
          reasonCodes={OVERRIDE_REASONS}
          withNote={false}
          onSubmit={(code) => void markArrived(code)}
          onCancel={() => setPendingArrive(null)}
        >
          <p style={{ marginBlockEnd: '0.75rem', fontWeight: 600 }}>
            <bdi>{pendingArrive.guest_name ?? tr('ws.courtDesk.board.walkIn')}</bdi>
          </p>
        </ReasonCodePrompt>
      )}
    </>
  );
}
