/**
 * 06.2 ReservationCalendarScreen — day grid (courts × 30-min rows over one
 * trading night) and week grid. Reservations render from the DB; the
 * 'courts' broadcast refreshes them. Writes go through mutate(); a move the
 * server refuses renders a ConflictNotice, never a silent revert.
 *
 * Keyboard: ← → move the date (by a week in week view), D / W switch views.
 * Pointer: drag a live booking onto another cell to move it (reason
 * required, then the server decides). Resize stays on the booking's own
 * shorten / extend buttons — a drag handle that could silently re-price a
 * booking is not worth the ambiguity at a busy desk.
 *
 * e2e selectors kept: heading 'Desk calendar', buttons '‹' '›' 'Today' 'Day'
 * 'Week', block buttons named by guest name, closed-day text, time labels.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { tradingSpan, wallTimeToUtc, type DayKey } from '@touch/core';
import { formatDate, formatTime, formatTimeRange, VENUE_TZ } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { mutate } from '../../lib/mutate';
import { AppRpcError } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, inputStyle, type ReasonCode } from '../../components/ui';
import {
  AsyncStateWrapper,
  ConflictNotice,
  EmptyState,
  Kbd,
  PageHeader,
  ReasonCodePrompt,
  SegmentedControl,
  Toolbar,
  asyncStatus,
} from '../../components/kit';
import { Icon } from '../../components/icons';
import { ReservationBadge, TONE_EDGE, TONE_FG, TONE_SOFT, reservationTone } from './deskStatus';
import { WeekGrid } from './WeekGrid';
import { shiftIsoDate, startOfWeek, weekDates } from './weekLogic';
import { CreateReservationDialog } from './CreateReservationDialog';
import { OVERRIDE_REASONS, ReservationActionsDialog } from './ReservationActionsDialog';
import { DAY_KEYS, SLOT_MIN, todayInTz, useTradingNight } from './useTradingNight';
import { BLOCKING_STATUSES, isLive, isVisible } from './deskLogic';
import { RESERVATION_COLUMNS, type ReservationRow } from './deskTypes';

type View = 'day' | 'week';

const DRAG_THRESHOLD_PX = 6;

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
  const [date, setDate] = useState<string>(() => todayInTz(VENUE_TZ));
  const [view, setView] = useState<View>('day');
  const [createAt, setCreateAt] = useState<{ courtId: string; startAt: Date } | null>(null);
  const [selected, setSelected] = useState<ReservationRow | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveError, setMoveError] = useState<unknown>(null);
  const [moveConflict, setMoveConflict] = useState<PendingMove | null>(null);

  const night = useTradingNight(date);
  const { tz, settingsQ, courtsQ, reservationsQ, courts, openMin, rowCount, rows, dayStart, closed } = night;

  // The week grid spans days with different hours: the widest trading night wins.
  const weekSpans = DAY_KEYS.map((k, i) =>
    tradingSpan(settingsQ.data?.opening_hours?.[k] ?? [], settingsQ.data?.opening_hours?.[DAY_KEYS[(i + 1) % 7] as DayKey] ?? []),
  ).filter((sp) => sp.endMin > sp.startMin);
  const weekOpenMin = weekSpans.length ? Math.min(...weekSpans.map((sp) => sp.startMin)) : 0;
  const weekCloseMin = weekSpans.length ? Math.max(...weekSpans.map((sp) => sp.endMin)) : 0;

  const weekStart = startOfWeek(date);
  const weekBounds = useMemo(() => {
    const days = weekDates(date);
    return {
      from: wallTimeToUtc(days[0]!, 0, tz),
      // Saturday night runs into Sunday, which is in the NEXT week: widen by the trading span.
      to: wallTimeToUtc(days[6]!, Math.max(24 * 60, weekCloseMin), tz),
    };
  }, [date, tz, weekCloseMin]);

  // Separate from the day query: the day grid is on the desk's critical path
  // and must not fetch seven days because a week view exists somewhere.
  const weekQ = useQuery({
    queryKey: ['reservationsWeek', weekStart],
    enabled: view === 'week' && settingsQ.isSuccess,
    queryFn: async (): Promise<ReservationRow[]> => {
      const { data, error } = await supabase
        .from('reservations')
        .select(RESERVATION_COLUMNS)
        .gte('start_at', weekBounds.from.toISOString())
        .lt('start_at', weekBounds.to.toISOString())
        .order('start_at');
      if (error) throw error;
      return data as unknown as ReservationRow[];
    },
    refetchInterval: 60_000,
  });

  const now = Date.now();
  const reservations = useMemo(() => night.reservations.filter((r) => isVisible(r, now)), [night.reservations, now]);

  function rowIndexOf(iso: string): number {
    const min = (new Date(iso).getTime() - dayStart.getTime()) / 60_000;
    return Math.floor((min - openMin) / SLOT_MIN);
  }
  function spanOf(r: ReservationRow): number {
    return Math.max(1, Math.round((new Date(r.end_at).getTime() - new Date(r.start_at).getTime()) / 60_000 / SLOT_MIN));
  }

  const dialogOpen = createAt !== null || selected !== null || pendingMove !== null;
  const step = view === 'week' ? 7 : 1;

  // Keyboard: arrows move the date, D / W switch views. Never while typing or
  // while a dialog owns the keyboard.
  useEffect(() => {
    if (dialogOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
      const backward = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
      if (e.key === forward) {
        e.preventDefault();
        setDate((d) => shiftIsoDate(d, step));
      } else if (e.key === backward) {
        e.preventDefault();
        setDate((d) => shiftIsoDate(d, -step));
      } else if (e.key === 'd' || e.key === 'D') {
        setView('day');
      } else if (e.key === 'w' || e.key === 'W') {
        setView('week');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialogOpen, dir, step]);

  // ---- drag to move -------------------------------------------------------
  const dragStart = useRef<{ id: string; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  function onBlockPointerDown(e: ReactPointerEvent<HTMLButtonElement>, r: ReservationRow) {
    if (e.button !== 0 || r.kind !== 'booking' || !isLive(r.status)) return;
    dragStart.current = { id: r.id, x: e.clientX, y: e.clientY };
  }

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const start = dragStart.current;
      if (!start) return;
      if (!dragRef.current) {
        if (Math.abs(e.clientX - start.x) < DRAG_THRESHOLD_PX && Math.abs(e.clientY - start.y) < DRAG_THRESHOLD_PX) return;
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
      if (target.courtId === r.court_id && startAt.toISOString() === new Date(r.start_at).toISOString()) return;
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

  const courtName = (id: string) => pickName(locale, courts.find((c) => c.id === id));
  const gridStatus = asyncStatus(courtsQ, (c) => c.length === 0);
  const dayStatus = settingsQ.isError && !settingsQ.data ? 'error' : reservationsQ.isError && !reservationsQ.data ? 'error' : settingsQ.data && reservationsQ.data ? 'ready' : 'loading';

  return (
    /*
     * The screen owns main's full height and hands ALL of it to the grid, so
     * the date controls, the view switch and the court headers stay on screen
     * at 23:00 (rulebook 5.2 / 5.4). Scrolling the page instead of the grid is
     * what used to take them away — the two facts a clerk needs while a guest
     * waits are which court a column is and which date they are looking at.
     */
    <div style={{ display: 'flex', flexDirection: 'column', blockSize: '100%', minBlockSize: 0 }}>
      <PageHeader
        style={{ flexShrink: 0 }}
        title={tr('desk.title')}
        subtitle={tr('ws.courtDesk.calendar.lead')}
        actions={
          <>
            <Link to="/desk/series/new" className="tp-btn" data-kind="default" data-size="md">
              <Icon name="repeat" size={16} /> {tr('ws.courtDesk.calendar.series')}
            </Link>
            <Link to="/desk/block" className="tp-btn" data-kind="default" data-size="md">
              <Icon name="ban" size={16} /> {tr('ws.courtDesk.calendar.block')}
            </Link>
            <Button kind="ghost" icon="refresh" onClick={() => void queryClient.invalidateQueries({ queryKey: ['reservations'] })}>
              {tr('op.common.refresh')}
            </Button>
          </>
        }
      >
        <Toolbar
          style={{ marginBlockEnd: 0 }}
          end={
            <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)' }}>
              <Kbd>←</Kbd>
              <Kbd>→</Kbd> {tr('ws.courtDesk.calendar.keys')} · <Kbd>D</Kbd> {tr('ws.courtDesk.calendar.keyDay')} · <Kbd>W</Kbd> {tr('ws.courtDesk.calendar.keyWeek')}
            </span>
          }
        >
          <Button onClick={() => setDate(shiftIsoDate(date, -step))} title={tr('ws.courtDesk.calendar.prev')}>
            ‹
          </Button>
          <input
            type="date"
            aria-label={tr('ws.courtDesk.common.date')}
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            style={{ ...inputStyle, inlineSize: 'auto' }}
          />
          <Button onClick={() => setDate(shiftIsoDate(date, step))} title={tr('ws.courtDesk.calendar.next')}>
            ›
          </Button>
          <Button onClick={() => setDate(todayInTz(tz))}>{tr('common.today')}</Button>
          <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', marginInlineStart: '0.25rem' }}>
            <bdi>{formatDate(new Date(`${date}T12:00:00Z`), locale, 'UTC')}</bdi>
          </span>
          <SegmentedControl<View>
            aria-label={tr('ws.courtDesk.calendar.view')}
            value={view}
            onChange={setView}
            options={[
              { value: 'day', label: tr('op.desk.viewDay') },
              { value: 'week', label: tr('op.desk.viewWeek') },
            ]}
          />
        </Toolbar>
      </PageHeader>

      {moveConflict && (
        <ConflictNotice
          body={tr('ws.courtDesk.calendar.moveConflict')}
          onResolve={() => setMoveConflict(null)}
          style={{ marginBlockEnd: '0.75rem' }}
        >
          <p style={{ fontSize: 'var(--tp-fs-sm)' }}>
            <bdi>{moveConflict.reservation.guest_name ?? tr('op.desk.walkIn')}</bdi> ·{' '}
            {tr('ws.courtDesk.calendar.moveTo', { court: courtName(moveConflict.courtId), time: formatTime(moveConflict.startAt, locale, tz) })}
          </p>
        </ConflictNotice>
      )}

      {view === 'week' ? (
        <AsyncStateWrapper status={weekQ.isError && !weekQ.data ? 'error' : weekQ.data && settingsQ.data ? 'ready' : 'loading'} error={weekQ.error} onRetry={() => void weekQ.refetch()}>
          <WeekGrid
            date={date}
            timeZone={tz}
            openMin={weekOpenMin}
            closeMin={weekCloseMin}
            closedDates={night.closedDates}
            courts={courts}
            reservations={(weekQ.data ?? []).filter((r) => isVisible(r, now))}
            onSelect={(id) => {
              const row = (weekQ.data ?? []).find((r) => r.id === id);
              if (row) setSelected(row);
            }}
          />
        </AsyncStateWrapper>
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
            <div style={{ display: 'grid', gap: 'var(--tp-sp-0)', gridTemplateColumns: '4.5rem repeat(3, 1fr)' }}>
              {Array.from({ length: 24 }, (_, i) => (
                <div key={i} className="tp-skel" style={{ blockSize: '2.4rem', borderRadius: 'var(--tp-radius-sm)' }} />
              ))}
            </div>
          }
        >
          {closed || rowCount === 0 ? (
            <EmptyState icon="ban" title={tr('op.desk.closedToday')} />
          ) : (
            <div style={{ flex: 1, minBlockSize: 0, overflow: 'auto' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `4.5rem repeat(${courts.length}, minmax(11rem, 1fr))`,
                  gap: 'var(--tp-sp-0)',
                  minInlineSize: `${4.5 + courts.length * 11}rem`,
                  userSelect: drag ? 'none' : undefined,
                }}
              >
                {/* Above both sticky axes, or the time labels slide out from under it. */}
                <div style={{ ...STICKY_HEAD, insetInlineStart: 0, zIndex: 'var(--tp-z-sticky)' }} />
                {courts.map((c) => (
                  <div key={c.id} style={{ ...STICKY_HEAD, fontWeight: 700, paddingBlock: 'var(--tp-sp-1)', textAlign: 'center', borderBlockEnd: '2px solid var(--tp-border)' }}>
                    {pickName(locale, c)}
                  </div>
                ))}

                <div style={{ ...STICKY_TIME, display: 'grid', gridTemplateRows: `repeat(${rowCount}, 2.4rem)`, rowGap: 'var(--tp-sp-0)' }}>
                  {rows.map((min) => (
                    <div key={min} style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums', paddingBlockStart: 'var(--tp-sp-0)' }}>
                      {formatTime(wallTimeToUtc(date, min, tz), locale, tz)}
                    </div>
                  ))}
                </div>

                {courts.map((c) => {
                  const courtRes = reservations.filter((r) => r.court_id === c.id);
                  const blockedRows = new Set<number>();
                  for (const r of courtRes) {
                    if (!BLOCKING_STATUSES.has(r.status)) continue;
                    const from = Math.max(0, rowIndexOf(r.start_at));
                    for (let i = from; i < Math.min(rowCount, from + spanOf(r)); i++) blockedRows.add(i);
                  }
                  return (
                    <div key={c.id} style={{ display: 'grid', gridTemplateRows: `repeat(${rowCount}, 2.4rem)`, rowGap: 'var(--tp-sp-0)', position: 'relative' }}>
                      {rows.map((min, i) => {
                        const startAt = wallTimeToUtc(date, min, tz);
                        const past = startAt.getTime() < now;
                        const isTarget = drag?.target?.courtId === c.id && drag.target.min === min;
                        const common = {
                          'data-slot-court': c.id,
                          'data-slot-min': min,
                        } as const;
                        if (blockedRows.has(i)) {
                          return <div key={min} {...common} style={{ outline: isTarget ? '2px solid var(--tp-accent)' : undefined, borderRadius: 'var(--tp-radius-sm)' }} />;
                        }
                        return (
                          <button
                            key={min}
                            type="button"
                            {...common}
                            disabled={past && !drag}
                            onClick={() => {
                              if (suppressClick.current) return;
                              setCreateAt({ courtId: c.id, startAt });
                            }}
                            title={past ? tr('ws.courtDesk.calendar.pastSlot') : tr('op.desk.free')}
                            aria-label={`${pickName(locale, c)} ${formatTime(startAt, locale, tz)} · ${past ? tr('ws.courtDesk.calendar.pastSlot') : tr('ws.courtDesk.calendar.freeSlot')}`}
                            style={{
                              border: isTarget ? '2px solid var(--tp-accent)' : '1px dashed var(--tp-border)',
                              borderRadius: 'var(--tp-radius-sm)',
                              background: isTarget ? 'var(--tp-accent-soft)' : past ? 'var(--tp-surface)' : 'var(--tp-bg)',
                              cursor: past ? 'default' : 'pointer',
                              opacity: past && !isTarget ? 'var(--tp-opacity-disabled)' : 1,
                              padding: 0,
                            }}
                          />
                        );
                      })}
                      {courtRes.map((r) => {
                        const from = Math.max(0, rowIndexOf(r.start_at));
                        const span = spanOf(r);
                        const tone = reservationTone(r);
                        const dragging = drag?.id === r.id;
                        const draggable = r.kind === 'booking' && isLive(r.status);
                        const name = r.kind === 'maintenance' ? (r.notes ?? tr('op.desk.maintenance')) : r.kind === 'hold' ? tr('op.desk.hold') : (r.guest_name ?? tr('op.desk.walkIn'));
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
                            <strong style={{ fontSize: 'var(--tp-fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              <bdi>{name}</bdi>
                            </strong>
                            <span style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                              <bdi style={{ fontVariantNumeric: 'tabular-nums' }}>{formatTimeRange(new Date(r.start_at), new Date(r.end_at), locale, tz)}</bdi>
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

      {createAt && (
        <CreateReservationDialog
          courtId={createAt.courtId}
          startAt={createAt.startAt}
          courts={courts}
          tz={tz}
          onClose={() => setCreateAt(null)}
          onCreated={() => {
            setCreateAt(null);
            void queryClient.invalidateQueries({ queryKey: ['reservations'] });
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
            void queryClient.invalidateQueries({ queryKey: ['reservationsWeek'] });
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
            {tr('ws.courtDesk.calendar.moveTo', { court: courtName(pendingMove.courtId), time: formatTime(pendingMove.startAt, locale, tz) })}
          </p>
        </ReasonCodePrompt>
      )}
    </div>
  );
}
