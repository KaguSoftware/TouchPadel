/**
 * 06.2 ReservationCalendarScreen — day grid (courts × 30-min rows over one
 * trading night) and a zoomed-out month. Reservations render from the DB; the
 * 'courts' broadcast refreshes them. Writes go through mutate(); a move the
 * server refuses renders a ConflictNotice, never a silent revert.
 *
 * The month replaced the week view (owner call, 2026-09-13). The zoom pulls
 * back from the day to a month of days shaded by how many bookings each holds;
 * pressing a day zooms back into its grid. See calendar/ZoomStage.
 *
 * WHAT THE DESK NEEDS FROM IT, FASTEST FIRST
 *
 *  - **Where is now?** Tonight's grid opens scrolled to the current half-hour,
 *    with a line across every court at the current time. It used to open at
 *    09:00 every time, so an evening clerk scrolled past twenty-eight rows of
 *    greyed-out past slots before every walk-in.
 *  - **Which slot is free?** A free slot shows its time and a plus under the
 *    pointer, so the target reads before the click, not after.
 *  - **Which day am I on?** One date control and one label with the weekday.
 *    The keyboard legend that sat beside it moved into the buttons' tooltips.
 *  - **Book for a customer.** `?customer=<id>` (from the customer record and
 *    search) keeps a strip on screen naming who is being booked; the slot the
 *    clerk picks opens the booking already linked to them.
 *
 * Keyboard: ← → move the date (by a month in month view), D / M switch views.
 * Pointer: drag a live booking onto another cell to move it (reason
 * required, then the server decides). Resize stays on the booking's own
 * shorten / extend buttons — a drag handle that could silently re-price a
 * booking is not worth the ambiguity at a busy desk.
 *
 * e2e selectors kept: heading 'Desk calendar', buttons '‹' '›' 'Today', the
 * 'Month' / 'Day' view buttons, slots titled 'Free', label 'Date', block
 * buttons named by guest name, closed-day text, time labels.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { wallTimeToUtc } from '@touch/core';
import {
  formatDate,
  formatMonthYear,
  formatNumber,
  formatTime,
  formatTimeRange,
  formatWeekdayShort,
  VENUE_TZ,
} from '@touch/i18n';
import { mutate } from '../../lib/mutate';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, type ReasonCode } from '../../components/ui';
import {
  AsyncStateWrapper,
  ConflictNotice,
  CustomerFlagBadge,
  EmptyState,
  PageHeader,
  ReasonCodePrompt,
  StatusBadge,
  Toolbar,
  asyncStatus,
} from '../../components/kit';
import { Icon } from '../../components/icons';
import { ReservationBadge, TONE_EDGE, TONE_FG, TONE_SOFT, reservationTone } from './deskStatus';
import { shiftIsoDate } from './weekLogic';
import { MonthHeatCalendar } from './calendar/MonthHeatCalendar';
import { ZoomStage } from './calendar/ZoomStage';
import { useMonthCounts } from './calendar/useMonthCounts';
import { fetchBookingCounts } from './calendar/monthFetchers';
import { shiftMonth } from './calendar/monthLogic';
import { CreateReservationDialog } from './CreateReservationDialog';
import { OVERRIDE_REASONS, ReservationActionsDialog } from './ReservationActionsDialog';
import { SLOT_MIN, tonightInTz, todayInTz, useTradingNight } from './useTradingNight';
import { DateField } from '../../components/inputs';
import { BLOCKING_STATUSES, canMoveReservation, isVisible } from './deskLogic';
import type { CustomerRecord, ReservationRow } from './deskTypes';
import type { PickedCustomer } from './customers/CustomerPicker';

type View = 'day' | 'month';

const DRAG_THRESHOLD_PX = 6;
const CLOCK_TICK_MS = 30_000;
/** One grid row: its height plus the row gap. The now line is placed with it. */
const ROW_PITCH = 'calc(2.4rem + var(--tp-sp-0))';

/** `/desk?date=YYYY-MM-DD&customer=<id>` — validated at the route (routes/desk/_children.ts). */
export interface DeskCalendarSearch {
  date?: string;
  customer?: string;
}

/*
 * The hover state of a free slot. Inline styles cannot say :hover, and a React
 * hover state would re-render a thousand slot buttons per mouse move; one
 * scoped rule does it. The label is the slot's own time, from data-hover.
 */
const SLOT_CSS = `
.desk-slot:not(:disabled):hover { background: var(--tp-accent-soft) !important; border-color: var(--tp-accent) !important; border-style: solid !important; }
.desk-slot:not(:disabled):hover::after { content: '+ ' attr(data-hover); color: var(--tp-accent-soft-fg); font-size: var(--tp-fs-xs); font-weight: 600; padding-inline: 0.45rem; }
.desk-slot:focus-visible::after { content: '+ ' attr(data-hover); color: var(--tp-accent-soft-fg); font-size: var(--tp-fs-xs); font-weight: 600; padding-inline: 0.45rem; }
`;

/**
 * The two axes that must survive a scroll to 23:00. Both live in the grid's
 * own scrollport, so they need no arithmetic against the page header.
 */
const STICKY_HEAD = {
  position: 'sticky',
  insetBlockStart: 0,
  zIndex: 'var(--tp-z-table-head)',
  background: 'var(--tp-bg)',
} as const;
const STICKY_TIME = {
  position: 'sticky',
  insetInlineStart: 0,
  zIndex: 'var(--tp-z-table-head)',
  background: 'var(--tp-bg)',
} as const;

interface DragState {
  id: string;
  /** Where the pointer is over: a cell, or null while between cells. */
  target: { courtId: string; min: number } | null;
}

interface PendingMove {
  reservation: ReservationRow;
  courtId: string;
  startAt: Date;
}

function slotUnderPointer(x: number, y: number): { courtId: string; min: number } | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-slot-court]');
  if (!el) return null;
  const courtId = el.dataset.slotCourt;
  const min = Number(el.dataset.slotMin);
  if (!courtId || Number.isNaN(min)) return null;
  return { courtId, min };
}

export function DeskCalendar() {
  const { tr, locale, dir } = useLocale();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const search = useSearch({ strict: false }) as DeskCalendarSearch;
  const [date, setDate] = useState<string>(() => search.date ?? todayInTz(VENUE_TZ));
  const [view, setView] = useState<View>('day');
  const [createAt, setCreateAt] = useState<{ courtId: string; startAt: Date } | null>(null);
  const [selected, setSelected] = useState<ReservationRow | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveError, setMoveError] = useState<unknown>(null);
  const [moveConflict, setMoveConflict] = useState<PendingMove | null>(null);

  const night = useTradingNight(date);
  const {
    tz,
    settingsQ,
    courtsQ,
    reservationsQ,
    courts,
    openMin,
    rowCount,
    rows,
    dayStart,
    closed,
  } = night;

  const month = useMonthCounts({
    queryKey: 'reservationsMonth',
    date,
    timeZone: tz,
    hours: settingsQ.data?.opening_hours,
    enabled: view === 'month' && settingsQ.isSuccess,
    fetchCounts: fetchBookingCounts,
  });

  // The clock the grid is drawn against: which slots are past, where the now
  // line sits. Ticks, so an open screen does not keep offering 23:00 at 23:10.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(t);
  }, []);
  const reservations = useMemo(
    () => night.reservations.filter((r) => isVisible(r, now)),
    [night.reservations, now],
  );

  const hours = settingsQ.data?.opening_hours;
  const tonight = settingsQ.data ? tonightInTz(tz, hours) : todayInTz(tz);
  // Opened without a date: land on the night that is trading now, not on the
  // calendar date (after midnight those differ).
  const anchored = useRef(Boolean(search.date));
  useEffect(() => {
    if (anchored.current || !settingsQ.data) return;
    anchored.current = true;
    setDate(tonightInTz(settingsQ.data.timezone, settingsQ.data.opening_hours));
  }, [settingsQ.data]);

  // Booking FOR a customer (from their record or the customer search).
  const bookForQ = useQuery({
    queryKey: ['customer', search.customer ?? ''],
    enabled: Boolean(search.customer),
    queryFn: () =>
      appRpc<CustomerRecord | null>('customer_record', { p_customer_id: search.customer }),
    retry: false,
  });
  const bookFor: PickedCustomer | null =
    search.customer && bookForQ.data
      ? {
          id: bookForQ.data.customer.id,
          name: bookForQ.data.customer.full_name,
          phone: bookForQ.data.customer.phone,
          flags: bookForQ.data.flags,
        }
      : null;
  const stopBookingFor = () => void navigate({ to: '/desk', search: { date } as never });

  function rowIndexOf(iso: string): number {
    const min = (new Date(iso).getTime() - dayStart.getTime()) / 60_000;
    return Math.floor((min - openMin) / SLOT_MIN);
  }
  function spanOf(r: ReservationRow): number {
    return Math.max(
      1,
      Math.round(
        (new Date(r.end_at).getTime() - new Date(r.start_at).getTime()) / 60_000 / SLOT_MIN,
      ),
    );
  }

  const dialogOpen = createAt !== null || selected !== null || pendingMove !== null;
  const shiftDate = (d: string, dirn: 1 | -1) =>
    view === 'month' ? shiftMonth(d, dirn) : shiftIsoDate(d, dirn);

  // Keyboard: arrows move the date, D / W switch views. Never while typing or
  // while a dialog owns the keyboard.
  useEffect(() => {
    if (dialogOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'SELECT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      )
        return;
      const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
      const backward = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
      if (e.key === forward) {
        e.preventDefault();
        setDate((d) => shiftDate(d, 1));
      } else if (e.key === backward) {
        e.preventDefault();
        setDate((d) => shiftDate(d, -1));
      } else if (e.key === 'd' || e.key === 'D') {
        setView('day');
      } else if (e.key === 'm' || e.key === 'M') {
        setView('month');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shiftDate reads only `view`
  }, [dialogOpen, dir, view]);

  // ---- drag to move -------------------------------------------------------
  const dragStart = useRef<{ id: string; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  function onBlockPointerDown(e: ReactPointerEvent<HTMLButtonElement>, r: ReservationRow) {
    if (e.button !== 0 || !canMoveReservation(r, now)) return;
    dragStart.current = { id: r.id, x: e.clientX, y: e.clientY };
  }

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const start = dragStart.current;
      if (!start) return;
      if (!dragRef.current) {
        if (
          Math.abs(e.clientX - start.x) < DRAG_THRESHOLD_PX &&
          Math.abs(e.clientY - start.y) < DRAG_THRESHOLD_PX
        )
          return;
        suppressClick.current = true;
      }
      setDrag({ id: start.id, target: slotUnderPointer(e.clientX, e.clientY) });
    }
    function onUp(e: PointerEvent) {
      const start = dragStart.current;
      dragStart.current = null;
      const current = dragRef.current;
      setDrag(null);
      if (!start || !current) return;
      const target = slotUnderPointer(e.clientX, e.clientY) ?? current.target;
      const r = reservations.find((x) => x.id === start.id);
      if (!target || !r) return;
      const startAt = wallTimeToUtc(date, target.min, tz);
      if (
        target.courtId === r.court_id &&
        startAt.toISOString() === new Date(r.start_at).toISOString()
      )
        return;
      setMoveError(null);
      setMoveConflict(null);
      setPendingMove({ reservation: r, courtId: target.courtId, startAt });
    }
    function onCancel() {
      dragStart.current = null;
      setDrag(null);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [reservations, date, tz]);

  async function confirmMove(reason: ReasonCode, note: string) {
    if (!pendingMove) return;
    const { reservation: r, courtId, startAt } = pendingMove;
    const durationMs = new Date(r.end_at).getTime() - new Date(r.start_at).getTime();
    setMoveBusy(true);
    setMoveError(null);
    try {
      await mutate('reservation.update', {
        action: 'move',
        reservationId: r.id,
        courtId,
        startAt: startAt.toISOString(),
        endAt: new Date(startAt.getTime() + durationMs).toISOString(),
        reason: note ? `${reason}: ${note}` : reason,
      });
      setPendingMove(null);
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
      void queryClient.invalidateQueries({ queryKey: ['reservationsMonth'] });
    } catch (e) {
      if (e instanceof AppRpcError && e.code === 'SLOT_TAKEN') {
        setMoveConflict(pendingMove);
        setPendingMove(null);
      } else {
        setMoveError(e);
      }
    } finally {
      setMoveBusy(false);
    }
  }

  const courtName = (id: string) =>
    pickName(
      locale,
      courts.find((c) => c.id === id),
    );
  const gridStatus = asyncStatus(courtsQ, (c) => c.length === 0);
  const dayStatus =
    settingsQ.isError && !settingsQ.data
      ? 'error'
      : reservationsQ.isError && !reservationsQ.data
        ? 'error'
        : settingsQ.data && reservationsQ.data
          ? 'ready'
          : 'loading';

  // Minutes past the grid's opening that `now` sits at, when now is inside
  // tonight's grid; otherwise null and no line is drawn.
  const nowMinInGrid = (() => {
    if (date !== tonight || rowCount === 0) return null;
    const m = (now - dayStart.getTime()) / 60_000 - openMin;
    return m >= 0 && m < rowCount * SLOT_MIN ? m : null;
  })();

  /*
   * Open tonight's grid at the current half-hour (one row of context above).
   * Offsets, not getBoundingClientRect: the zoom back in from the month scales
   * the grid while it arrives, and a measured rectangle would be the scaled one.
   * Once per date, so the desk's own scrolling is never taken back.
   */
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<string | null>(null);
  const gridReady =
    view === 'day' && dayStatus === 'ready' && gridStatus === 'ready' && !closed && rowCount > 0;
  useEffect(() => {
    if (!gridReady || scrolledFor.current === date) return;
    const box = gridScrollRef.current;
    if (!box) return;
    scrolledFor.current = date;
    if (nowMinInGrid === null) return;
    const row = Math.max(0, Math.floor(nowMinInGrid / SLOT_MIN) - 1);
    const cell = box.querySelector<HTMLElement>(`[data-slot-min="${rows[row]}"]`);
    const column = cell?.parentElement;
    const head = box.querySelector<HTMLElement>('[data-grid-head]');
    if (!cell || !column) return;
    box.scrollTop = column.offsetTop + cell.offsetTop - (head?.offsetHeight ?? 0);
  }, [gridReady, date, nowMinInGrid, rows]);
  useEffect(() => {
    // Leaving the day view unmounts the grid; coming back should land on now again.
    if (view !== 'day') scrolledFor.current = null;
  }, [view]);

  const dayNoon = new Date(`${date}T12:00:00Z`);
  const dayCount = reservations.filter((r) => r.kind === 'booking').length;

  return (
    /*
     * The screen owns main's full height and hands ALL of it to the grid, so
     * the date controls, the view switch and the court headers stay on screen
     * at 23:00 (rulebook 5.2 / 5.4). Scrolling the page instead of the grid is
     * what used to take them away — the two facts a clerk needs while a guest
     * waits are which court a column is and which date they are looking at.
     */
    <div style={{ display: 'flex', flexDirection: 'column', blockSize: '100%', minBlockSize: 0 }}>
      <style>{SLOT_CSS}</style>
      <PageHeader
        style={{ flexShrink: 0 }}
        title={tr('desk.title')}
        subtitle={
          view === 'month'
            ? tr('ws.courtDesk.calendar.leadMonth')
            : tr('ws.courtDesk.calendar.lead')
        }
        actions={
          <>
            <Button icon="repeat" onClick={() => void navigate({ to: '/desk/series/new' })}>
              {tr('ws.courtDesk.calendar.series')}
            </Button>
            <Button
              icon="ban"
              onClick={() => void navigate({ to: '/desk/block', search: { date } as never })}
            >
              {tr('ws.courtDesk.calendar.block')}
            </Button>
            <Button
              kind="ghost"
              icon="refresh"
              busy={reservationsQ.isFetching && reservationsQ.data !== undefined}
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: ['reservations'] });
                void queryClient.invalidateQueries({ queryKey: ['reservationsMonth'] });
              }}
            >
              {tr('op.common.refresh')}
            </Button>
          </>
        }
      >
        <Toolbar style={{ marginBlockEnd: 0 }}>
          <Button
            onClick={() => setDate(shiftDate(date, -1))}
            title={
              view === 'month'
                ? tr('ws.courtDesk.calendar.prevMonth')
                : tr('ws.courtDesk.calendar.prev')
            }
          >
            ‹
          </Button>
          <DateField
            ariaLabel={tr('ws.courtDesk.common.date')}
            value={date}
            onChange={setDate}
            style={{ inlineSize: 'auto' }}
          />
          <Button
            onClick={() => setDate(shiftDate(date, 1))}
            title={
              view === 'month'
                ? tr('ws.courtDesk.calendar.nextMonth')
                : tr('ws.courtDesk.calendar.next')
            }
          >
            ›
          </Button>
          <Button onClick={() => setDate(tonight)} disabled={date === tonight && view === 'day'}>
            {tr('common.today')}
          </Button>
          {/* One label, the one the date box cannot give: the weekday (or the
              month), and whether this is tonight. */}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--tp-sp-2)',
              fontWeight: 600,
              marginInlineStart: 'var(--tp-sp-1)',
            }}
          >
            <bdi>
              {view === 'month'
                ? formatMonthYear(dayNoon, locale, 'UTC')
                : `${formatWeekdayShort(dayNoon, locale, 'UTC')} · ${formatDate(dayNoon, locale, 'UTC')}`}
            </bdi>
            {view === 'day' && date === tonight && (
              <StatusBadge size="sm" tone="accent" label={tr('ws.courtDesk.calendar.tonight')} />
            )}
            {view === 'day' && dayStatus === 'ready' && (
              <span
                style={{
                  fontWeight: 400,
                  color: 'var(--tp-muted-fg)',
                  fontSize: 'var(--tp-fs-sm)',
                }}
              >
                {tr('ws.courtDesk.calendar.dayCount')}{' '}
                <strong style={{ color: 'var(--tp-fg)' }}>{formatNumber(dayCount, locale)}</strong>
              </span>
            )}
          </span>
          <span
            style={{ marginInlineStart: 'auto', display: 'inline-flex', gap: 'var(--tp-sp-1)' }}
            role="group"
            aria-label={tr('ws.courtDesk.calendar.view')}
          >
            <Button
              icon="zoomIn"
              aria-pressed={view === 'day'}
              onClick={() => setView('day')}
              title={tr('ws.courtDesk.calendar.keyDayHint')}
            >
              {tr('op.desk.viewDay')}
            </Button>
            <Button
              icon="zoomOut"
              aria-pressed={view === 'month'}
              onClick={() => setView('month')}
              title={tr('ws.courtDesk.calendar.keyMonthHint')}
            >
              {tr('ws.kit.calendar.month')}
            </Button>
          </span>
        </Toolbar>
      </PageHeader>

      {search.customer && (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--tp-sp-3)',
            flexWrap: 'wrap',
            flexShrink: 0,
            marginBlockEnd: 'var(--tp-sp-3)',
            paddingBlock: 'var(--tp-sp-2)',
            paddingInline: 'var(--tp-sp-3)',
            borderRadius: 'var(--tp-radius-ctl)',
            background: 'var(--tp-accent-soft)',
            color: 'var(--tp-accent-soft-fg)',
          }}
        >
          <Icon name="user" size={18} />
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--tp-sp-2)',
              flexWrap: 'wrap',
              fontWeight: 600,
            }}
          >
            {bookFor ? (
              <>
                <bdi>{tr('ws.courtDesk.calendar.bookingFor', { name: bookFor.name })}</bdi>
                {bookFor.flags.map((f, i) => (
                  <CustomerFlagBadge key={`${f.type}-${i}`} flag={f} />
                ))}
              </>
            ) : bookForQ.isError ? (
              tr('ws.courtDesk.calendar.bookingForMissing')
            ) : (
              '…'
            )}
          </span>
          <span style={{ fontSize: 'var(--tp-fs-sm)' }}>
            {view === 'month'
              ? tr('ws.courtDesk.calendar.bookingForMonth')
              : tr('ws.courtDesk.calendar.bookingForHint')}
          </span>
          <Button
            size="sm"
            kind="ghost"
            icon="x"
            onClick={stopBookingFor}
            style={{ marginInlineStart: 'auto' }}
          >
            {tr('ws.courtDesk.calendar.bookingForStop')}
          </Button>
        </div>
      )}

      {moveConflict && (
        <ConflictNotice
          body={tr('ws.courtDesk.calendar.moveConflict')}
          onResolve={() => setMoveConflict(null)}
          style={{ marginBlockEnd: '0.75rem' }}
        >
          <p style={{ fontSize: 'var(--tp-fs-sm)' }}>
            <bdi>{moveConflict.reservation.guest_name ?? tr('op.desk.walkIn')}</bdi> ·{' '}
            {tr('ws.courtDesk.calendar.moveTo', {
              court: courtName(moveConflict.courtId),
              time: formatTime(moveConflict.startAt, locale, tz),
            })}
          </p>
        </ConflictNotice>
      )}

      <ZoomStage level={view} focusDate={date} style={{ flex: 1 }}>
        {view === 'month' ? (
          <div style={{ flex: 1, minBlockSize: 0, overflow: 'auto' }}>
            <AsyncStateWrapper
              status={month.isError ? 'error' : 'ready'}
              error={month.error}
              onRetry={month.refetch}
            >
              <MonthHeatCalendar
                date={date}
                today={tonight}
                counts={month.counts}
                max={month.max}
                loading={month.isPending}
                closedDates={night.closedDates}
                countLabel={(count) =>
                  tr(count === 1 ? 'ws.kit.calendar.bookingsOne' : 'ws.kit.calendar.bookings', {
                    count,
                  })
                }
                onPick={(d) => {
                  setDate(d);
                  setView('day');
                }}
              />
            </AsyncStateWrapper>
          </div>
        ) : (
          <AsyncStateWrapper
            status={dayStatus === 'ready' ? gridStatus : dayStatus}
            error={settingsQ.error ?? reservationsQ.error ?? courtsQ.error}
            onRetry={() => {
              void settingsQ.refetch();
              void courtsQ.refetch();
              void reservationsQ.refetch();
            }}
            skeleton={
              <div
                style={{
                  display: 'grid',
                  gap: 'var(--tp-sp-0)',
                  gridTemplateColumns: '4.5rem repeat(3, 1fr)',
                }}
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <div
                    key={i}
                    className="tp-skel"
                    style={{ blockSize: '2.4rem', borderRadius: 'var(--tp-radius-sm)' }}
                  />
                ))}
              </div>
            }
          >
            {closed || rowCount === 0 ? (
              <EmptyState
                icon="ban"
                title={tr('op.desk.closedToday')}
                body={tr('ws.courtDesk.calendar.closedBody')}
                action={
                  date !== tonight ? (
                    <Button onClick={() => setDate(tonight)}>{tr('common.today')}</Button>
                  ) : undefined
                }
              />
            ) : (
              <div ref={gridScrollRef} style={{ flex: 1, minBlockSize: 0, overflow: 'auto' }}>
                <div
                  style={{
                    // Positioned so a column's offsetTop is measured from here (scroll to now).
                    position: 'relative',
                    display: 'grid',
                    gridTemplateColumns: `4.5rem repeat(${courts.length}, minmax(11rem, 1fr))`,
                    gap: 'var(--tp-sp-0)',
                    minInlineSize: `${4.5 + courts.length * 11}rem`,
                    userSelect: drag ? 'none' : undefined,
                  }}
                >
                  {/* Above both sticky axes, or the time labels slide out from under it. */}
                  <div
                    data-grid-head
                    style={{ ...STICKY_HEAD, insetInlineStart: 0, zIndex: 'var(--tp-z-sticky)' }}
                  />
                  {courts.map((c) => (
                    <div
                      key={c.id}
                      style={{
                        ...STICKY_HEAD,
                        fontWeight: 700,
                        paddingBlock: 'var(--tp-sp-1)',
                        textAlign: 'center',
                        borderBlockEnd: '2px solid var(--tp-border)',
                      }}
                    >
                      {pickName(locale, c)}
                    </div>
                  ))}

                  <div
                    style={{
                      ...STICKY_TIME,
                      display: 'grid',
                      gridTemplateRows: `repeat(${rowCount}, 2.4rem)`,
                      rowGap: 'var(--tp-sp-0)',
                    }}
                  >
                    {rows.map((min) => (
                      <div
                        key={min}
                        style={{
                          fontSize: 'var(--tp-fs-xs)',
                          color: 'var(--tp-muted-fg)',
                          fontVariantNumeric: 'tabular-nums',
                          paddingBlockStart: 'var(--tp-sp-0)',
                        }}
                      >
                        {formatTime(wallTimeToUtc(date, min, tz), locale, tz)}
                      </div>
                    ))}
                    {nowMinInGrid !== null && (
                      <span
                        aria-hidden="true"
                        style={{
                          position: 'absolute',
                          insetInlineEnd: 'var(--tp-sp-1)',
                          insetBlockStart: `calc(${nowMinInGrid / SLOT_MIN} * ${ROW_PITCH} - 0.55rem)`,
                          paddingInline: 'var(--tp-sp-1)',
                          borderRadius: 'var(--tp-radius-sm)',
                          background: 'var(--tp-danger-mark)',
                          color: 'var(--tp-danger-contrast)',
                          fontSize: 'var(--tp-fs-xs)',
                          fontWeight: 700,
                          lineHeight: '1.1rem',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {formatTime(new Date(now), locale, tz)}
                      </span>
                    )}
                  </div>

                  {courts.map((c) => {
                    const courtRes = reservations.filter((r) => r.court_id === c.id);
                    const blockedRows = new Set<number>();
                    for (const r of courtRes) {
                      if (!BLOCKING_STATUSES.has(r.status)) continue;
                      const from = Math.max(0, rowIndexOf(r.start_at));
                      for (let i = from; i < Math.min(rowCount, from + spanOf(r)); i++)
                        blockedRows.add(i);
                    }
                    return (
                      <div
                        key={c.id}
                        style={{
                          display: 'grid',
                          gridTemplateRows: `repeat(${rowCount}, 2.4rem)`,
                          rowGap: 'var(--tp-sp-0)',
                          position: 'relative',
                        }}
                      >
                        {nowMinInGrid !== null && (
                          // Above the slots, below the bookings (they paint later),
                          // and never in the way of a click.
                          <span
                            aria-hidden="true"
                            style={{
                              position: 'absolute',
                              insetInline: 0,
                              insetBlockStart: `calc(${nowMinInGrid / SLOT_MIN} * ${ROW_PITCH})`,
                              blockSize: '2px',
                              background: 'var(--tp-danger-mark)',
                              pointerEvents: 'none',
                            }}
                          />
                        )}
                        {rows.map((min, i) => {
                          const startAt = wallTimeToUtc(date, min, tz);
                          const past = startAt.getTime() < now;
                          const isTarget =
                            drag?.target?.courtId === c.id && drag.target.min === min;
                          const common = {
                            'data-slot-court': c.id,
                            'data-slot-min': min,
                          } as const;
                          if (blockedRows.has(i)) {
                            return (
                              <div
                                key={min}
                                {...common}
                                style={{
                                  outline: isTarget ? '2px solid var(--tp-accent)' : undefined,
                                  borderRadius: 'var(--tp-radius-sm)',
                                }}
                              />
                            );
                          }
                          return (
                            <button
                              key={min}
                              type="button"
                              className="desk-slot"
                              data-hover={formatTime(startAt, locale, tz)}
                              {...common}
                              disabled={past && !drag}
                              onClick={() => {
                                if (suppressClick.current) return;
                                setCreateAt({ courtId: c.id, startAt });
                              }}
                              title={
                                past ? tr('ws.courtDesk.calendar.pastSlot') : tr('op.desk.free')
                              }
                              aria-label={`${pickName(locale, c)} ${formatTime(startAt, locale, tz)} · ${past ? tr('ws.courtDesk.calendar.pastSlot') : tr('ws.courtDesk.calendar.freeSlot')}`}
                              style={{
                                border: isTarget
                                  ? '2px solid var(--tp-accent)'
                                  : '1px dashed var(--tp-border)',
                                borderRadius: 'var(--tp-radius-sm)',
                                background: isTarget
                                  ? 'var(--tp-accent-soft)'
                                  : past
                                    ? 'var(--tp-surface)'
                                    : 'var(--tp-bg)',
                                cursor: past ? 'default' : 'pointer',
                                opacity: past && !isTarget ? 'var(--tp-opacity-disabled)' : 1,
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                              }}
                            />
                          );
                        })}
                        {courtRes.map((r) => {
                          const from = Math.max(0, rowIndexOf(r.start_at));
                          const span = spanOf(r);
                          const tone = reservationTone(r);
                          const dragging = drag?.id === r.id;
                          const draggable = canMoveReservation(r, now);
                          const name =
                            r.kind === 'maintenance'
                              ? (r.notes ?? tr('op.desk.maintenance'))
                              : r.kind === 'hold'
                                ? tr('op.desk.hold')
                                : (r.guest_name ?? tr('op.desk.walkIn'));
                          return (
                            <button
                              key={r.id}
                              type="button"
                              onPointerDown={(e) => onBlockPointerDown(e, r)}
                              onClick={() => {
                                if (suppressClick.current) {
                                  suppressClick.current = false;
                                  return;
                                }
                                setSelected(r);
                              }}
                              style={{
                                gridRow: `${from + 1} / span ${Math.min(span, rowCount - from)}`,
                                gridColumn: 1,
                                /* position: relative alone paints this above the
                                 unpositioned slot buttons behind it; the raw
                                 z-index: 2 it used to carry sat outside the
                                 scale and fought the sticky header. */
                                position: 'relative',
                                background: TONE_SOFT[tone],
                                color: TONE_FG[tone],
                                border: `1px ${r.kind === 'maintenance' ? 'dashed' : 'solid'} ${TONE_EDGE[tone]}`,
                                borderRadius: 'var(--tp-radius-ctl)',
                                textAlign: 'start',
                                paddingBlock: '0.25rem',
                                paddingInline: '0.45rem',
                                fontSize: 'var(--tp-fs-xs)',
                                lineHeight: 1.3,
                                overflow: 'hidden',
                                cursor: draggable ? (dragging ? 'grabbing' : 'grab') : 'pointer',
                                opacity: dragging ? 0.55 : 1,
                                touchAction: draggable ? 'none' : undefined,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.15rem',
                                font: 'inherit',
                              }}
                            >
                              <strong
                                style={{
                                  fontSize: 'var(--tp-fs-sm)',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                <bdi>{name}</bdi>
                              </strong>
                              <span
                                style={{
                                  display: 'flex',
                                  gap: '0.35rem',
                                  alignItems: 'center',
                                  flexWrap: 'wrap',
                                }}
                              >
                                <bdi style={{ fontVariantNumeric: 'tabular-nums' }}>
                                  {formatTimeRange(
                                    new Date(r.start_at),
                                    new Date(r.end_at),
                                    locale,
                                    tz,
                                  )}
                                </bdi>
                                <ReservationBadge reservation={r} size="sm" />
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </AsyncStateWrapper>
        )}
      </ZoomStage>

      {createAt && (
        <CreateReservationDialog
          courtId={createAt.courtId}
          startAt={createAt.startAt}
          courts={courts}
          tz={tz}
          night={{ date, rows, reservations }}
          customer={bookFor}
          onClose={() => setCreateAt(null)}
          onCreated={() => {
            setCreateAt(null);
            toast.ok(
              bookFor
                ? tr('ws.courtDesk.calendar.bookedFor', { name: bookFor.name })
                : tr('op.desk.created'),
            );
            void queryClient.invalidateQueries({ queryKey: ['reservations'] });
            void queryClient.invalidateQueries({ queryKey: ['reservationsMonth'] });
            // A booking-for is one booking: the strip goes once it is made.
            if (search.customer) stopBookingFor();
          }}
        />
      )}
      {selected && (
        <ReservationActionsDialog
          reservation={selected}
          courts={courts}
          date={date}
          tz={tz}
          rows={rows}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            void queryClient.invalidateQueries({ queryKey: ['reservations'] });
            void queryClient.invalidateQueries({ queryKey: ['reservationsMonth'] });
          }}
        />
      )}
      {pendingMove && (
        <ReasonCodePrompt
          action={tr('ws.courtDesk.calendar.moveAction')}
          reasonCodes={OVERRIDE_REASONS}
          busy={moveBusy}
          error={moveError}
          onSubmit={(code, note) => void confirmMove(code, note)}
          onCancel={() => setPendingMove(null)}
        >
          <p style={{ marginBlockEnd: '0.75rem' }}>
            <strong>
              <bdi>{pendingMove.reservation.guest_name ?? tr('op.desk.walkIn')}</bdi>
            </strong>
            <br />
            {tr('ws.courtDesk.calendar.moveTo', {
              court: courtName(pendingMove.courtId),
              time: formatTime(pendingMove.startAt, locale, tz),
            })}
          </p>
        </ReasonCodePrompt>
      )}
    </div>
  );
}
