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
 * Pointer: a live booking carries a grip and is dragged to move it. The block
 * travels WITH the hand — the row it was taken hold of stays under the pointer
 * — and a dashed outline draws the whole destination, court, start and end, at
 * the booking's full length, before the release. A destination the desk may
 * not use (in the past, or already booked) draws in danger and says which;
 * dropping there says so out loud rather than doing nothing. Then the reason
 * prompt, then the server decides (0150 refuses a past start on its own).
 * Resize stays on the booking's own shorten / extend buttons — a drag handle
 * that could silently re-price a booking is not worth the ambiguity at a busy
 * desk. The pure part of all this is dragLogic.ts, which has the tests.
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
import { BLOCKING_STATUSES, canMoveReservation, guestNameOf, isVisible, packLanes, rowIndexOf as rowIndexAt } from './deskLogic';
import { dropRefusal, dropStartMin, grabRowOffset, type DropRefusal } from './dragLogic';
import type { CustomerRecord, ReservationRow } from './deskTypes';
import type { PickedCustomer } from './customers/CustomerPicker';

type View = 'day' | 'month';

const DRAG_THRESHOLD_PX = 6;
/*
 * A drag that reaches the edge of the grid keeps going: the band, in px, in
 * which the scrollport starts following the pointer, and how much of the
 * overlap it travels per frame.
 *
 * The night is taller than the screen. Holding a booking and pushing towards
 * 02:00 used to end with the pointer against the bottom of the window and the
 * booking still a row short of where it belonged (Parsa, 2026-09-23) — the
 * only way down was to let go, scroll, and take hold again.
 */
const EDGE_SCROLL_BAND_PX = 56;
const EDGE_SCROLL_RATE = 0.28;
const CLOCK_TICK_MS = 30_000;
/** One grid row: its height plus the row gap. The now line is placed with it. */
const ROW_PITCH = 'calc(2.4rem + var(--tp-sp-0))';

/**
 * The hairline between two reservation cards that sit next to each other.
 * Small enough that a half-width card keeps its text, wide enough that the
 * cards' own borders stay two lines rather than one doubled one.
 */
const LANE_GAP = '3px';

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
.desk-grid:not([data-dragging]) .desk-slot:not(:disabled):hover { background: var(--tp-accent-soft) !important; border-color: var(--tp-accent) !important; border-style: solid !important; }
.desk-grid:not([data-dragging]) .desk-slot:not(:disabled):hover::after { content: '+ ' attr(data-hover); color: var(--tp-accent-soft-fg); font-size: var(--tp-fs-xs); font-weight: 600; padding-inline: 0.45rem; }
.desk-slot:focus-visible::after { content: '+ ' attr(data-hover); color: var(--tp-accent-soft-fg); font-size: var(--tp-fs-xs); font-weight: 600; padding-inline: 0.45rem; }
/*
 * While a booking is in the hand, the bookings stop answering the pointer.
 * The drop target is read with elementFromPoint, and a booking sits ON TOP of
 * the slots it covers: dragging over ANY booking — including the one being
 * dragged, which is every short drag — used to find no cell at all, so the
 * grid went quiet exactly when the desk needed it to speak.
 */
.desk-grid[data-dragging] .desk-block { pointer-events: none; }
.desk-grid[data-dragging] .desk-slot { cursor: grabbing; }
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
  /** Rows between the booking's own start and where the hand took hold of it. */
  grabRows: number;
  /** How many rows the booking covers — the preview is drawn this tall. */
  spanRows: number;
  /** Where it would land, or null until the pointer has been over the grid. */
  drop: { courtId: string; startMin: number; refusal: DropRefusal | null } | null;
}

interface PendingMove {
  reservation: ReservationRow;
  courtId: string;
  startAt: Date;
}

/**
 * The cell the pointer is over — or, when the pointer has run past the grid,
 * the cell at the edge it ran past.
 *
 * `box` is the grid's scrollport. The pointer is pulled back inside it before
 * the hit test, minus the header it would otherwise land on and minus the
 * scrollbars, which are not cells and answer elementFromPoint with the
 * scroller itself. Without that, the LAST row of the night was unreachable on
 * a screen shorter than the night: the pointer hit the bottom of the window
 * first and the grid stopped answering.
 */
function slotUnderPointer(
  x: number,
  y: number,
  box?: HTMLElement | null,
): { courtId: string; min: number } | null {
  if (box) {
    const r = box.getBoundingClientRect();
    const barX = box.offsetWidth - box.clientWidth; // vertical scrollbar
    const barY = box.offsetHeight - box.clientHeight; // horizontal scrollbar
    const head = box.querySelector<HTMLElement>('[data-grid-head]')?.offsetHeight ?? 0;
    x = Math.min(Math.max(x, r.left + barX + 2), r.right - barX - 2);
    y = Math.min(Math.max(y, r.top + head + 2), r.bottom - barY - 2);
  }
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
    closeMin,
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

  const rowIndexOf = (iso: string) => rowIndexAt(iso, dayStart.getTime(), openMin, SLOT_MIN);

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
  /** The grid's scrollport: the drag reads it, and "open at now" scrolls it. */
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{
    id: string;
    x: number;
    y: number;
    grabRows: number;
    spanRows: number;
  } | null>(null);
  const suppressClick = useRef(false);
  /*
   * Where the pointer last was. A ref rather than a local, because the drag
   * effect is rebuilt whenever the night's rows change — the 60 s refetch, the
   * courts broadcast — and a desk holding a booking against the bottom edge,
   * waiting for the grid to come to it, would otherwise see the scroll stop
   * dead until it moved the mouse again.
   */
  const pointerAt = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  function onBlockPointerDown(e: ReactPointerEvent<HTMLButtonElement>, r: ReservationRow) {
    if (e.button !== 0 || !canMoveReservation(r, now)) return;
    // Which row of the block the hand closed on, so the block travels WITH the
    // hand instead of snapping its start under the pointer. Measured off the
    // drawn element: it is the only thing that knows the row pitch after the
    // zoom has scaled the grid.
    const box = e.currentTarget.getBoundingClientRect();
    const from = Math.max(0, rowIndexOf(r.start_at));
    const visible = Math.max(1, Math.min(spanOf(r), rowCount - from));
    dragStart.current = {
      id: r.id,
      x: e.clientX,
      y: e.clientY,
      grabRows: grabRowOffset(e.clientY - box.top, box.height, visible),
      spanRows: spanOf(r),
    };
  }

  useEffect(() => {
    /** Where the booking would land for a pointer over this cell, and whether it may. */
    function dropFor(
      start: NonNullable<typeof dragStart.current>,
      cell: { courtId: string; min: number },
    ): DragState['drop'] {
      const r = reservations.find((x) => x.id === start.id);
      if (!r) return null;
      const startMin = dropStartMin(
        cell.min,
        start.grabRows,
        start.spanRows,
        openMin,
        closeMin,
        SLOT_MIN,
      );
      const startMs = wallTimeToUtc(date, startMin, tz).getTime();
      const originalStartMs = new Date(r.start_at).getTime();
      return {
        courtId: cell.courtId,
        startMin,
        refusal: dropRefusal({
          reservations,
          ignoreId: r.id,
          courtId: cell.courtId,
          startMs,
          endMs: startMs + (new Date(r.end_at).getTime() - originalStartMs),
          originalStartMs,
          nowMs: Date.now(),
        }),
      };
    }

    /** Read the pointer, redraw the preview. The one place the drag state is set. */
    function paint(x: number, y: number) {
      const start = dragStart.current;
      if (!start) return;
      const cell = slotUnderPointer(x, y, gridScrollRef.current);
      setDrag({
        id: start.id,
        grabRows: start.grabRows,
        spanRows: start.spanRows,
        // Nowhere on the grid at all (another window, the page behind it):
        // the preview stays where it last was rather than blinking out.
        drop: cell ? dropFor(start, cell) : (dragRef.current?.drop ?? null),
      });
    }

    /*
     * While the pointer sits in the band at either end of the scrollport, the
     * grid travels under it and the preview is redrawn against the rows that
     * arrive. Speed follows how far into the band the pointer is, so easing up
     * slows it down instead of being all-or-nothing. It stops on its own at
     * either end of the scroll range, because scrollTop stops changing.
     */
    let raf = 0;
    function edgeScroll() {
      raf = 0;
      const box = gridScrollRef.current;
      const at = pointerAt.current;
      if (!box || !dragStart.current || !at) return;
      const r = box.getBoundingClientRect();
      const past = at.y - (r.bottom - EDGE_SCROLL_BAND_PX);
      const above = r.top + EDGE_SCROLL_BAND_PX - at.y;
      const over =
        past > 0
          ? Math.min(past, EDGE_SCROLL_BAND_PX)
          : above > 0
            ? -Math.min(above, EDGE_SCROLL_BAND_PX)
            : 0;
      if (over !== 0) {
        const before = box.scrollTop;
        box.scrollTop = before + over * EDGE_SCROLL_RATE;
        if (box.scrollTop !== before) paint(at.x, at.y);
      }
      raf = requestAnimationFrame(edgeScroll);
    }
    // Rebuilt mid-drag: pick the loop back up where it was.
    if (dragStart.current && pointerAt.current) raf = requestAnimationFrame(edgeScroll);

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
      pointerAt.current = { x: e.clientX, y: e.clientY };
      if (!raf) raf = requestAnimationFrame(edgeScroll);
      paint(e.clientX, e.clientY);
    }
    function onUp(e: PointerEvent) {
      const start = dragStart.current;
      dragStart.current = null;
      const current = dragRef.current;
      cancelAnimationFrame(raf);
      raf = 0;
      pointerAt.current = null;
      setDrag(null);
      if (!start || !current) return;
      const cell = slotUnderPointer(e.clientX, e.clientY, gridScrollRef.current);
      // The preview the desk was looking at IS the drop: falling back to it
      // keeps the release from being a different move than the one on screen.
      const drop = (cell ? dropFor(start, cell) : null) ?? current.drop;
      const r = reservations.find((x) => x.id === start.id);
      if (!drop || !r) return;
      const startAt = wallTimeToUtc(date, drop.startMin, tz);
      if (
        drop.courtId === r.court_id &&
        startAt.toISOString() === new Date(r.start_at).toISOString()
      )
        return;
      // Say why, where the hand let go. A drop that is refused in silence
      // reads as the grid being broken, and the desk simply tries it again.
      if (drop.refusal) {
        toast.err(
          tr(
            drop.refusal === 'past'
              ? 'ws.courtDesk.calendar.dropPastBody'
              : 'ws.courtDesk.calendar.dropTakenBody',
          ),
        );
        return;
      }
      setMoveError(null);
      setMoveConflict(null);
      setPendingMove({ reservation: r, courtId: drop.courtId, startAt });
    }
    function onCancel() {
      dragStart.current = null;
      cancelAnimationFrame(raf);
      raf = 0;
      pointerAt.current = null;
      setDrag(null);
    }
    /*
     * Every gesture starts able to click, and only the gesture that actually
     * dragged swallows its own trailing click.
     *
     * The flag used to be cleared by the block's own onClick — which assumed
     * that click would arrive. It does not: a click is dispatched on the
     * common ancestor of the press and the release, so a block dragged onto a
     * slot fires its click on the court column, and the block's handler never
     * runs. The flag then stayed raised and ate the NEXT click anywhere on the
     * grid. Clearing it on pointerdown needs nothing to arrive.
     */
    function onDown() {
      suppressClick.current = false;
    }
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toast and tr are stable for the screen
  }, [reservations, date, tz, openMin, closeMin, rowCount]);

  async function confirmMove(reason: ReasonCode, note: string) {
    if (!pendingMove) return;
    const { reservation: r, courtId, startAt } = pendingMove;
    const durationMs = new Date(r.end_at).getTime() - new Date(r.start_at).getTime();
    setMoveBusy(true);
    setMoveError(null);
    try {
      const outcome = await mutate('reservation.update', {
        action: 'move',
        reservationId: r.id,
        courtId,
        startAt: startAt.toISOString(),
        endAt: new Date(startAt.getTime() + durationMs).toISOString(),
        reason: note ? `${reason}: ${note}` : reason,
      });
      setPendingMove(null);
      if (outcome.queued) toast.info(tr('ws.courtDesk.detail.queued'));
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

  // The booking in the hand, and how long it is: the preview is drawn from
  // these, so what the desk sees before releasing is the whole destination
  // slot — its court, its start AND its end — not a one-cell outline.
  const dragged = drag ? (reservations.find((r) => r.id === drag.id) ?? null) : null;
  const dragDurationMs = dragged
    ? new Date(dragged.end_at).getTime() - new Date(dragged.start_at).getTime()
    : 0;

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
        titleAfter={
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
        }
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
            <bdi>{guestNameOf(moveConflict.reservation) ?? tr('op.desk.walkIn')}</bdi> ·{' '}
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
                  className="desk-grid"
                  data-dragging={drag ? '' : undefined}
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
                        // The row this label names, so a test can prove the
                        // court columns still line up with the gutter.
                        data-grid-time={min}
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
                    /*
                     * Rows that start at or after the close have no row to sit
                     * in: `rowCount - from` goes 0 or negative, and `span 0` /
                     * `span -1` made CSS grid invent implicit rows below the
                     * calendar — the band of dotted slots hanging off the end
                     * of the night. A booking that overruns the close still
                     * paints, clamped to the last row; one that begins past it
                     * is simply not in this grid.
                     */
                    const courtRes = reservations.filter(
                      (r) => r.court_id === c.id && rowIndexOf(r.start_at) < rowCount,
                    );
                    // Two reservations on one court at one time used to paint on
                    // top of each other; each takes its own column instead.
                    const lanes = packLanes(courtRes);
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
                          /* Nothing should land outside the named rows now that
                           every child names one; at 0 an accidental one is
                           visibly wrong here rather than silently adding
                           height and sliding the column past the gutter. */
                          gridAutoRows: 0,
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
                          /*
                           * Every slot names its OWN row.
                           *
                           * The cards below are placed explicitly (gridRow:
                           * from+1 / span n). Auto-placement flows around an
                           * explicitly-placed item, so while these slots were
                           * auto-placed a card spanning three rows pushed the
                           * slots after it three rows down and grid invented
                           * implicit rows at the bottom to hold the overflow:
                           * the 10:30 button carrying the right label sat two
                           * rows below the 10:30 label in the gutter, and the
                           * whole column read as a gap under the booking. The
                           * gutter never drifted because nothing is placed
                           * explicitly in it.
                           */
                          const common = {
                            'data-slot-court': c.id,
                            'data-slot-min': min,
                            style: { gridRow: i + 1, gridColumn: 1 },
                          } as const;
                          if (blockedRows.has(i)) {
                            return (
                              <div
                                key={min}
                                {...common}
                                style={{ ...common.style, borderRadius: 'var(--tp-radius-sm)' }}
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
                                ...common.style,
                                border: '1px dashed var(--tp-border)',
                                borderRadius: 'var(--tp-radius-sm)',
                                background: past ? 'var(--tp-surface)' : 'var(--tp-bg)',
                                cursor: past ? 'default' : 'pointer',
                                opacity: past ? 'var(--tp-opacity-disabled)' : 1,
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
                          const { lane, lanes: laneCount } = lanes.get(r.id) ?? { lane: 0, lanes: 1 };
                          // Share the column's width between the lanes of one
                          // overlapping cluster; a lone booking keeps all of it.
                          const laneWidth = 100 / laneCount;
                          const tone = reservationTone(r);
                          const dragging = drag?.id === r.id;
                          const draggable = canMoveReservation(r, now);
                          const name =
                            r.kind === 'maintenance'
                              ? (r.notes ?? tr('op.desk.maintenance'))
                              : r.kind === 'hold'
                                ? tr('op.desk.hold')
                                : (guestNameOf(r) ?? tr('op.desk.walkIn'));
                          return (
                            <button
                              key={r.id}
                              type="button"
                              className="desk-block"
                              title={
                                draggable
                                  ? tr('ws.courtDesk.calendar.dragHint')
                                  : tr('ws.courtDesk.calendar.openDetail')
                              }
                              onPointerDown={(e) => onBlockPointerDown(e, r)}
                              onClick={() => {
                                if (suppressClick.current) return;
                                setSelected(r);
                              }}
                              style={{
                                gridRow: `${from + 1} / span ${Math.min(span, rowCount - from)}`,
                                gridColumn: 1,
                                /* position: relative alone paints this above the
                                 unpositioned slot buttons behind it; the raw
                                 z-index: 2 it used to carry sat outside the
                                 scale and fought the sticky header. Its lane
                                 narrows the box within the cell rather than
                                 offsetting it, so the card is never pushed out
                                 past the court's column. */
                                position: 'relative',
                                marginInlineStart: `${lane * laneWidth}%`,
                                /* A gap off every lane but the last keeps the
                                 two 1px borders of neighbouring cards from
                                 meeting and reading as one thick edge; the
                                 last lane takes none so the cluster still ends
                                 flush with the court's column. */
                                inlineSize:
                                  lane === laneCount - 1
                                    ? `${laneWidth}%`
                                    : `calc(${laneWidth}% - ${LANE_GAP})`,
                                justifySelf: 'start',
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
                              <span
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.25rem',
                                  minInlineSize: 0,
                                }}
                              >
                                {/* The grip is the affordance: the old block
                                    was a plain rectangle that happened to be
                                    draggable, which nobody discovers. */}
                                {draggable && (
                                  <Icon
                                    name="grip"
                                    size={13}
                                    style={{ opacity: 0.6, marginInlineStart: '-0.2rem' }}
                                  />
                                )}
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
                              </span>
                              {/* Time and status on their own lines: sharing one
                               row, the badge was squeezed off the end of a card
                               that only has half a court's width to itself. */}
                              <bdi style={{ fontVariantNumeric: 'tabular-nums' }}>
                                {formatTimeRange(
                                  new Date(r.start_at),
                                  new Date(r.end_at),
                                  locale,
                                  tz,
                                )}
                              </bdi>
                              {/* The pill carries 0.45rem of inline padding of
                               its own, which set its dot in from the name and
                               the time above it; pulled back by exactly that,
                               the three lines share one start edge. */}
                              <span
                                style={{
                                  display: 'flex',
                                  marginInlineStart: '-0.45rem',
                                  minInlineSize: 0,
                                }}
                              >
                                <ReservationBadge reservation={r} size="sm" />
                              </span>
                            </button>
                          );
                        })}
                        {/*
                         * Where it would land. Drawn at the booking's FULL
                         * length in the destination court, with the times it
                         * would take and, when the destination cannot have it,
                         * the reason — so the release is never a surprise.
                         * Painted after the blocks, so it sits over them.
                         */}
                        {(() => {
                          const drop = drag?.drop;
                          if (!drag || !drop || !dragged || drop.courtId !== c.id) return null;
                          const at = Math.max(
                            0,
                            Math.round((drop.startMin - openMin) / SLOT_MIN),
                          );
                          const span = Math.max(1, Math.min(drag.spanRows, rowCount - at));
                          const startAt = wallTimeToUtc(date, drop.startMin, tz);
                          const bad = drop.refusal !== null;
                          return (
                            <div
                              aria-hidden="true"
                              style={{
                                gridRow: `${at + 1} / span ${span}`,
                                gridColumn: 1,
                                position: 'relative',
                                pointerEvents: 'none',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.1rem',
                                overflow: 'hidden',
                                borderRadius: 'var(--tp-radius-ctl)',
                                border: `2px ${bad ? 'solid' : 'dashed'} ${bad ? 'var(--tp-danger-mark)' : 'var(--tp-accent)'}`,
                                background: bad ? 'var(--tp-danger-soft)' : 'var(--tp-accent-soft)',
                                color: bad ? 'var(--tp-danger-fg)' : 'var(--tp-accent-soft-fg)',
                                paddingBlock: '0.25rem',
                                paddingInline: '0.45rem',
                                fontSize: 'var(--tp-fs-xs)',
                                fontWeight: 700,
                                lineHeight: 1.3,
                              }}
                            >
                              <bdi style={{ fontVariantNumeric: 'tabular-nums' }}>
                                {formatTimeRange(
                                  startAt,
                                  new Date(startAt.getTime() + dragDurationMs),
                                  locale,
                                  tz,
                                )}
                              </bdi>
                              <span style={{ fontWeight: 600 }}>
                                {tr(
                                  drop.refusal === 'past'
                                    ? 'ws.courtDesk.calendar.dropPast'
                                    : drop.refusal === 'taken'
                                      ? 'ws.courtDesk.calendar.dropTaken'
                                      : 'ws.courtDesk.calendar.dropHere',
                                )}
                              </span>
                            </div>
                          );
                        })()}
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
          onCreated={(queued) => {
            setCreateAt(null);
            // A queued booking is not a booking yet: the slot can still be refused.
            if (queued) toast.info(tr('ws.courtDesk.detail.queued'));
            else
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
              <bdi>{guestNameOf(pendingMove.reservation) ?? tr('op.desk.walkIn')}</bdi>
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
