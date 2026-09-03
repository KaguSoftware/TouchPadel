/**
 * Desk calendar — day view grid (courts x 30-min rows from venue opening
 * hours). Reservations render from the DB; the 'courts' broadcast (0022)
 * refreshes the grid. All writes go through the 0008 RPCs; SLOT_TAKEN
 * conflicts surface inline in the open dialog.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { tradingSpan, wallTimeToUtc, type DayKey } from '@touch/core';
import { formatIQD, formatTime, VENUE_TZ } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { clientRef } from '../../lib/idem';
import { mutate } from '../../lib/mutate';
import { cachedQuery } from '../../lib/refCache';
import { QK, fetchVenueSettings, fetchActiveCourts, type CourtRow } from '../../lib/queries';
import { WeekGrid } from './WeekGrid';
import { startOfWeek, weekDates } from './weekLogic';
import { useBroadcast } from '../../lib/realtime';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, ErrorText, Field, Modal, card, inputStyle } from '../../components/ui';

type ReservationRow = {
  id: string;
  court_id: string;
  kind: 'booking' | 'hold' | 'maintenance';
  status: string;
  start_at: string;
  end_at: string;
  guest_id: string | null;
  guest_name: string | null;
  guest_phone: string | null;
  price_iqd: number | null;
  hold_expires_at: string | null;
  notes: string | null;
};

const DAY_KEYS: readonly DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const SLOT_MIN = 30;
const BLOCKING = new Set(['pending', 'confirmed', 'arrived']);

function todayInTz(tz: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz });
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const CANCEL_REASONS = ['customer_request', 'weather', 'staff_error', 'duplicate', 'other'] as const;

/**
 * SOW L313: "Every override written to the audit log with actor and reason."
 *
 * The RPCs have taken `p_reason` since 0048 and default it to 'staff_op'; the
 * desk never passed one, so every move, extend and status change in the audit
 * log said 'staff_op' — an actor with no reason, which is exactly what the
 * clause exists to prevent. These are the reasons a desk actually has.
 */
const OVERRIDE_REASONS = [
  'customer_request',
  'staff_error',
  'weather',
  'duplicate',
  'other',
] as const;

/**
 * Shorten and extend move in half-hour steps, matching the grid.
 *
 * The FLOOR is the court's own shortest bookable duration, not a constant:
 * rate rules price the durations the venue actually sells (60/90/120 in the
 * fixtures), so shortening a 60-minute booking to 30 leaves the server with
 * nothing to charge and it refuses with "No rate rule prices this slot". The
 * refusal is correct — the button should simply not offer the move.
 */
const STEP_MIN = 30;

export function DeskCalendar() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const [date, setDate] = useState<string>(() => todayInTz(VENUE_TZ));
  const [createAt, setCreateAt] = useState<{ courtId: string; startAt: Date } | null>(null);
  const [selected, setSelected] = useState<ReservationRow | null>(null);
  // SOW L307 asks for a day AND week calendar; the desk was day-only, so
  // "are we free Saturday afternoon?" meant seven presses of the arrow.
  const [view, setView] = useState<'day' | 'week'>('day');

  // Both fetchers live in lib/queries.ts. They used to be declared here AND,
  // more narrowly, in the admin editors under the same cache keys — so whichever
  // screen loaded first decided what the other one saw.
  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings });
  const courtsQ = useQuery({ queryKey: QK.courts, queryFn: fetchActiveCourts });

  const tz = settingsQ.data?.timezone ?? VENUE_TZ;
  const dayStart = useMemo(() => wallTimeToUtc(date, 0, tz), [date, tz]);

  const dayIndex = new Date(`${date}T12:00:00Z`).getUTCDay();
  const dayKey = DAY_KEYS[dayIndex] as DayKey;
  const windows = settingsQ.data?.opening_hours?.[dayKey] ?? [];
  const closed = (settingsQ.data?.closed_dates ?? []).includes(date);

  /**
   * The grid renders one TRADING NIGHT, not one calendar day.
   *
   * Touch trades 09:00 → 02:00, stored as two windows on adjacent days, so
   * min(open)/max(close) over the raw windows gives 00:00 → 24:00 — 48 rows
   * with a dead 02:00–09:00 band down the middle. `tradingSpan` folds the
   * NEXT day's inherited tail back in and returns 540 → 1560 instead, and the
   * row labels below already wrap correctly because `wallTimeToUtc` accepts
   * minutes past 1440.
   */
  const nextDayWindows =
    settingsQ.data?.opening_hours?.[DAY_KEYS[(dayIndex + 1) % 7] as DayKey] ?? [];
  const { startMin: openMin, endMin: closeMin } = tradingSpan(windows, nextDayWindows);
  const rowCount = Math.max(0, Math.ceil((closeMin - openMin) / SLOT_MIN));

  const rows = useMemo(
    () => Array.from({ length: rowCount }, (_, i) => openMin + i * SLOT_MIN),
    [rowCount, openMin],
  );

  // The week grid spans days with different hours, so it needs the widest
  // trading night in the week rather than today's.
  const weekSpans = DAY_KEYS.map((k, i) =>
    tradingSpan(
      settingsQ.data?.opening_hours?.[k] ?? [],
      settingsQ.data?.opening_hours?.[DAY_KEYS[(i + 1) % 7] as DayKey] ?? [],
    ),
  ).filter((sp) => sp.endMin > sp.startMin);
  const weekOpenMin = weekSpans.length ? Math.min(...weekSpans.map((sp) => sp.startMin)) : 0;
  const weekCloseMin = weekSpans.length ? Math.max(...weekSpans.map((sp) => sp.endMin)) : 0;

  /**
   * Fetch the whole trading night, not the calendar day. Touch's 00:00-02:00 slots fall on
   * the FOLLOWING date, so a plain 00:00-24:00 window would render those rows permanently
   * empty -- the desk would read them as free and promise a court that was already taken.
   * Never narrower than the calendar day, so nothing that used to be visible disappears.
   */
  const dayEnd = useMemo(
    () => wallTimeToUtc(date, Math.max(24 * 60, closeMin), tz),
    [date, tz, closeMin],
  );

  // The week query is separate rather than a widened day query: the day grid
  // is on the critical path for the desk and must not start fetching seven
  // days of rows because a week view exists somewhere on the screen.
  const weekStart = startOfWeek(date);
  const weekBounds = useMemo(() => {
    const days = weekDates(date);
    return {
      from: wallTimeToUtc(days[0]!, 0, tz),
      // Saturday night runs into Sunday, and that Sunday is in the NEXT week.
      // Widen by the trading span so the last night of the week is not cut off
      // at midnight.
      to: wallTimeToUtc(days[6]!, Math.max(24 * 60, weekCloseMin), tz),
    };
  }, [date, tz, weekCloseMin]);

  const weekQ = useQuery({
    queryKey: ['reservationsWeek', weekStart],
    enabled: view === 'week' && settingsQ.isSuccess,
    queryFn: async (): Promise<ReservationRow[]> => {
      const { data, error } = await supabase
        .from('reservations')
        .select(
          'id, court_id, kind, status, start_at, end_at, guest_id, guest_name, guest_phone, price_iqd, hold_expires_at, notes',
        )
        .gte('start_at', weekBounds.from.toISOString())
        .lt('start_at', weekBounds.to.toISOString())
        .order('start_at');
      if (error) throw error;
      return data as unknown as ReservationRow[];
    },
    refetchInterval: 60_000,
  });

  const reservationsQ = useQuery({
    queryKey: ['reservations', date],
    queryFn: async (): Promise<ReservationRow[]> => {
      // The ref_cache slot holds ONE day's rows tagged with its date; offline,
      // a cached different day must not be presented as this one — the fetch
      // error is more honest than the wrong grid.
      const cached = await cachedQuery('reservations', async () => {
        const { data, error } = await supabase
          .from('reservations')
          .select(
            'id, court_id, kind, status, start_at, end_at, guest_id, guest_name, guest_phone, price_iqd, hold_expires_at, notes',
          )
          .gte('start_at', dayStart.toISOString())
          .lt('start_at', dayEnd.toISOString())
          .order('start_at');
        if (error) throw error;
        return { date, rows: data as unknown as ReservationRow[] };
      });
      if (cached.date !== date) throw new Error(`cached reservations are for ${cached.date}`);
      return cached.rows;
    },
    enabled: settingsQ.isSuccess,
    // Safety net under the 'courts' broadcast. Without it a missed realtime
    // frame left the desk grid showing a slot as free after a guest had taken
    // it — the exclusion constraint would still refuse the double booking, but
    // only after the desk had promised it to someone standing there.
    refetchInterval: 60_000,
  });

  useBroadcast({
    topic: 'courts',
    isPrivate: true,
    events: ['slot_changed'],
    invalidateKeys: [['reservations'], ['reservationsWeek']],
  });


  const courts = courtsQ.data ?? [];
  const reservations = reservationsQ.data ?? [];
  const now = Date.now();

  function visible(r: ReservationRow): boolean {
    if (r.status === 'cancelled' || r.status === 'expired' || r.status === 'no_show') return false;
    if (r.kind === 'hold' && r.hold_expires_at && new Date(r.hold_expires_at).getTime() <= now)
      return false;
    return true;
  }

  function rowIndexOf(iso: string): number {
    const min = (new Date(iso).getTime() - dayStart.getTime()) / 60000;
    return Math.floor((min - openMin) / SLOT_MIN);
  }

  const statusKey: Record<string, string> = {
    pending: tr('op.desk.statusPending'),
    confirmed: tr('op.desk.statusConfirmed'),
    arrived: tr('op.desk.statusArrived'),
    completed: tr('op.desk.statusCompleted'),
    cancelled: tr('op.desk.statusCancelled'),
    no_show: tr('op.desk.statusNoShow'),
    expired: tr('op.desk.statusExpired'),
  };

  function blockColors(r: ReservationRow): { bg: string; fg: string } {
    if (r.kind === 'maintenance') return { bg: 'var(--tp-muted)', fg: 'var(--tp-fg)' };
    if (r.kind === 'hold') return { bg: 'var(--tp-accent-2)', fg: 'var(--tp-accent-2-contrast)' };
    if (r.status === 'arrived') return { bg: 'var(--tp-accent-2)', fg: 'var(--tp-accent-2-contrast)' };
    if (r.status === 'completed') return { bg: 'var(--tp-muted)', fg: 'var(--tp-muted-fg)' };
    return { bg: 'var(--tp-accent)', fg: 'var(--tp-accent-contrast)' };
  }

  return (
    <div>
      <div
        style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBlockEnd: '0.8rem' }}
      >
        <h1 style={{ margin: 0, fontSize: '1.3rem', marginInlineEnd: '1rem' }}>
          {tr('desk.title')}
        </h1>
        <Button onClick={() => setDate(shiftDate(date, -1))}>‹</Button>
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          style={{ ...inputStyle, inlineSize: 'auto' }}
        />
        <Button onClick={() => setDate(shiftDate(date, 1))}>›</Button>
        <Button onClick={() => setDate(todayInTz(tz))}>{tr('common.today')}</Button>
        <Button
          aria-pressed={view === 'day'}
          kind={view === 'day' ? 'primary' : undefined}
          onClick={() => setView('day')}
        >
          {tr('op.desk.viewDay')}
        </Button>
        <Button
          aria-pressed={view === 'week'}
          kind={view === 'week' ? 'primary' : undefined}
          onClick={() => setView('week')}
        >
          {tr('op.desk.viewWeek')}
        </Button>
        <span style={{ flex: 1 }} />
        <Button
          kind="ghost"
          onClick={() => void queryClient.invalidateQueries({ queryKey: ['reservations'] })}
        >
          {tr('op.common.refresh')}
        </Button>
      </div>

      {view === 'week' ? (
        <>
          <ErrorText error={weekQ.error} />
          <WeekGrid
            date={date}
            timeZone={tz}
            openMin={weekOpenMin}
            closeMin={weekCloseMin}
            closedDates={settingsQ.data?.closed_dates ?? []}
            courts={courts}
            reservations={(weekQ.data ?? []).filter(visible)}
            onSelect={(id) => {
              const row = (weekQ.data ?? []).find((r) => r.id === id);
              if (row) setSelected(row);
            }}
          />
        </>
      ) : closed || rowCount === 0 ? (
        <p style={card}>{tr('op.desk.closedToday')}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `4.5rem repeat(${courts.length}, minmax(11rem, 1fr))`,
              gap: '2px',
              minInlineSize: `${4.5 + courts.length * 11}rem`,
            }}
          >
            <div />
            {courts.map((c) => (
              <div key={c.id} style={{ fontWeight: 700, paddingBlock: '0.3rem', textAlign: 'center' }}>
                {pickName(locale, c)}
              </div>
            ))}

            {/* time gutter */}
            <div
              style={{
                display: 'grid',
                gridTemplateRows: `repeat(${rowCount}, 2.4rem)`,
                rowGap: '2px',
              }}
            >
              {rows.map((min) => (
                <div key={min} style={{ fontSize: '0.75rem', color: 'var(--tp-muted-fg)' }}>
                  {formatTime(wallTimeToUtc(date, min, tz), locale, tz)}
                </div>
              ))}
            </div>

            {courts.map((c) => {
              const courtRes = reservations.filter((r) => r.court_id === c.id && visible(r));
              const blockedRows = new Set<number>();
              for (const r of courtRes) {
                if (!BLOCKING.has(r.status)) continue;
                const from = Math.max(0, rowIndexOf(r.start_at));
                const span = Math.max(
                  1,
                  Math.round(
                    (new Date(r.end_at).getTime() - new Date(r.start_at).getTime()) / 60000 / SLOT_MIN,
                  ),
                );
                for (let i = from; i < Math.min(rowCount, from + span); i++) blockedRows.add(i);
              }
              return (
                <div
                  key={c.id}
                  style={{
                    display: 'grid',
                    gridTemplateRows: `repeat(${rowCount}, 2.4rem)`,
                    rowGap: '2px',
                    position: 'relative',
                  }}
                >
                  {rows.map((min, i) => {
                    const startAt = wallTimeToUtc(date, min, tz);
                    const past = startAt.getTime() < now;
                    if (blockedRows.has(i)) return <div key={min} />;
                    return (
                      <button
                        key={min}
                        type="button"
                        disabled={past}
                        onClick={() => setCreateAt({ courtId: c.id, startAt })}
                        title={tr('op.desk.free')}
                        style={{
                          border: '1px dashed var(--tp-border)',
                          borderRadius: '0.25rem',
                          background: past ? 'var(--tp-surface)' : 'var(--tp-bg)',
                          cursor: past ? 'default' : 'pointer',
                          opacity: past ? 0.5 : 1,
                        }}
                      />
                    );
                  })}
                  {courtRes.map((r) => {
                    const from = Math.max(0, rowIndexOf(r.start_at));
                    const span = Math.max(
                      1,
                      Math.round(
                        (new Date(r.end_at).getTime() - new Date(r.start_at).getTime()) /
                          60000 /
                          SLOT_MIN,
                      ),
                    );
                    const colors = blockColors(r);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setSelected(r)}
                        style={{
                          gridRow: `${from + 1} / span ${Math.min(span, rowCount - from)}`,
                          gridColumn: 1,
                          position: 'relative',
                          zIndex: 2,
                          background: colors.bg,
                          color: colors.fg,
                          border: 'none',
                          borderRadius: '0.3rem',
                          textAlign: 'start',
                          paddingBlock: '0.2rem',
                          paddingInline: '0.4rem',
                          fontSize: '0.8rem',
                          overflow: 'hidden',
                          cursor: 'pointer',
                        }}
                      >
                        <strong>
                          {r.kind === 'maintenance'
                            ? tr('op.desk.maintenance')
                            : r.kind === 'hold'
                              ? tr('op.desk.hold')
                              : (r.guest_name ?? tr('op.desk.walkIn'))}
                        </strong>
                        <br />
                        {formatTime(new Date(r.start_at), locale, tz)}–
                        {formatTime(new Date(r.end_at), locale, tz)} · {statusKey[r.status] ?? r.status}
                        {r.price_iqd != null && <> · {formatIQD(r.price_iqd, locale)}</>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {createAt && (
        <CreateReservationDialog
          courtId={createAt.courtId}
          startAt={createAt.startAt}
          courts={courts}
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
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create walk-in booking dialog
// ---------------------------------------------------------------------------
function CreateReservationDialog({
  courtId,
  startAt,
  courts,
  onClose,
  onCreated,
}: {
  courtId: string;
  startAt: Date;
  courts: CourtRow[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { tr, locale } = useLocale();
  const court = courts.find((c) => c.id === courtId);
  const durations = court?.duration_options?.length ? court.duration_options : [60, 90, 120];
  const [kind, setKind] = useState<'booking' | 'maintenance'>('booking');
  const [duration, setDuration] = useState<number>(durations[0] ?? 60);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [guestId, setGuestId] = useState<string | null>(null);
  const [linkedName, setLinkedName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const profilesQ = useQuery({
    queryKey: ['profilesSearch', search],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from('profiles')
        .select('id, full_name, phone')
        .or(`full_name.ilike.%${search}%,phone.ilike.%${search}%`)
        .limit(8);
      if (err) throw err;
      return data as { id: string; full_name: string; phone: string | null }[];
    },
    enabled: search.trim().length >= 2,
  });

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await mutate('reservation.create', {
        clientRef: clientRef(),
        courtId,
        kind,
        startAt: startAt.toISOString(),
        endAt: new Date(startAt.getTime() + duration * 60000).toISOString(),
        ...(guestName ? { guestName } : {}),
        ...(guestPhone ? { guestPhone } : {}),
        ...(guestId ? { guestId } : {}),
        ...(notes ? { notes } : {}),
      });
      onCreated();
    } catch (e) {
      setError(e); // SLOT_TAKEN etc. surface inline here
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={tr('op.desk.newBooking')} onClose={onClose}>
      <p style={{ marginBlockStart: 0, color: 'var(--tp-muted-fg)' }}>
        {court ? pickName(locale, court) : ''} · {formatTime(startAt, locale)}
      </p>
      <Field label={tr('op.desk.kind')}>
        <select
          style={inputStyle}
          value={kind}
          onChange={(e) => setKind(e.target.value as 'booking' | 'maintenance')}
        >
          <option value="booking">{tr('op.desk.kindBooking')}</option>
          <option value="maintenance">{tr('op.desk.kindMaintenance')}</option>
        </select>
      </Field>
      <Field label={tr('op.desk.duration')}>
        <select
          style={inputStyle}
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
        >
          {durations.map((d) => (
            <option key={d} value={d}>
              {tr('op.common.minutesShort', { minutes: d })}
            </option>
          ))}
        </select>
      </Field>
      {kind === 'booking' && (
        <>
          <Field label={tr('op.desk.guestName')}>
            <input style={inputStyle} value={guestName} onChange={(e) => setGuestName(e.target.value)} />
          </Field>
          <Field label={tr('op.desk.guestPhone')}>
            <input
              style={inputStyle}
              dir="ltr"
              inputMode="tel"
              value={guestPhone}
              onChange={(e) => setGuestPhone(e.target.value)}
            />
          </Field>
          <Field label={tr('op.desk.linkAccount')}>
            <input
              style={inputStyle}
              placeholder={tr('op.desk.searchAccount')}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setGuestId(null);
                setLinkedName(null);
              }}
            />
          </Field>
          {linkedName && (
            <p style={{ color: 'var(--tp-accent)', fontSize: '0.85rem' }}>
              {tr('op.desk.linkedTo', { name: linkedName })}
            </p>
          )}
          {search.trim().length >= 2 && !linkedName && (
            <div style={{ ...card, marginBlockEnd: '0.6rem' }}>
              {(profilesQ.data ?? []).map((p) => (
                <Button
                  key={p.id}
                  kind="ghost"
                  style={{ display: 'block', inlineSize: '100%', textAlign: 'start' }}
                  onClick={() => {
                    setGuestId(p.id);
                    setLinkedName(p.full_name);
                    if (!guestName) setGuestName(p.full_name);
                  }}
                >
                  {p.full_name} {p.phone ? `· ${p.phone}` : ''}
                </Button>
              ))}
              {profilesQ.isSuccess && (profilesQ.data ?? []).length === 0 && (
                <p style={{ margin: 0, color: 'var(--tp-muted-fg)' }}>{tr('op.desk.noMatches')}</p>
              )}
            </div>
          )}
        </>
      )}
      <Field label={tr('op.common.notes')}>
        <input style={inputStyle} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <ErrorText error={error} />
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>{tr('common.cancel')}</Button>
        <Button
          kind="primary"
          disabled={busy || (kind === 'booking' && !guestName && !guestId)}
          onClick={() => void submit()}
        >
          {tr('op.desk.create')}
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Reservation actions: move / extend / cancel / arrived / completed / no-show
// ---------------------------------------------------------------------------
function ReservationActionsDialog({
  reservation: r,
  courts,
  date,
  tz,
  rows,
  onClose,
  onChanged,
}: {
  reservation: ReservationRow;
  courts: CourtRow[];
  date: string;
  tz: string;
  rows: number[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { tr, locale } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [showMove, setShowMove] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [moveCourt, setMoveCourt] = useState(r.court_id);
  const [moveStartMin, setMoveStartMin] = useState<number | ''>('');
  const [cancelReason, setCancelReason] = useState<string>(CANCEL_REASONS[0]);
  const [reason, setReason] = useState<string>(OVERRIDE_REASONS[0]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const durationMs = new Date(r.end_at).getTime() - new Date(r.start_at).getTime();
  const live = ['pending', 'confirmed', 'arrived'].includes(r.status);
  const court = courts.find((c) => c.id === r.court_id);
  const minDurationMin = court?.duration_options?.length
    ? Math.min(...court.duration_options)
    : STEP_MIN;

  return (
    <Modal title={r.guest_name ?? tr('op.desk.walkIn')} onClose={onClose}>
      <p style={{ marginBlockStart: 0, color: 'var(--tp-muted-fg)' }}>
        {formatTime(new Date(r.start_at), locale, tz)}–{formatTime(new Date(r.end_at), locale, tz)}
        {r.guest_phone && (
          <>
            {' · '}
            <span dir="ltr">{r.guest_phone}</span>
          </>
        )}
        {r.price_iqd != null && <> · {formatIQD(r.price_iqd, locale)}</>}
      </p>
      {r.notes && <p style={{ color: 'var(--tp-muted-fg)' }}>{r.notes}</p>}
      <ErrorText error={error} />
      {live && !showMove && !showCancel && (
        <Field label={tr('op.desk.overrideReason')}>
          <select style={inputStyle} value={reason} onChange={(e) => setReason(e.target.value)}>
            {OVERRIDE_REASONS.map((code) => (
              <option key={code} value={code}>
                {tr(`op.reasons.${code}`)}
              </option>
            ))}
          </select>
        </Field>
      )}
      {live && !showMove && !showCancel && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {r.status === 'confirmed' && (
            <Button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  mutate('reservation.update', {
                    action: 'mark',
                    reservationId: r.id,
                    status: 'arrived',
                    reason,
                  }),
                )
              }
            >
              {tr('op.desk.arrived')}
            </Button>
          )}
          {['confirmed', 'arrived'].includes(r.status) && (
            <Button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  mutate('reservation.update', {
                    action: 'mark',
                    reservationId: r.id,
                    status: 'completed',
                    reason,
                  }),
                )
              }
            >
              {tr('op.desk.completed')}
            </Button>
          )}
          {r.status === 'confirmed' && (
            <Button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  mutate('reservation.update', {
                    action: 'mark',
                    reservationId: r.id,
                    status: 'no_show',
                    reason,
                  }),
                )
              }
            >
              {tr('op.desk.noShow')}
            </Button>
          )}
          {/* SOW L310 lists "move, SHORTEN, extend and cancel". Shorten had no UI
              path at all; app.extend_reservation takes an absolute end, so it is
              the same call with an earlier time — and since 0048 it re-prices
              either way, which is the reason it must not be a raw UPDATE. */}
          <Button
            disabled={busy || durationMs - STEP_MIN * 60_000 < minDurationMin * 60_000}
            onClick={() =>
              void run(() =>
                mutate('reservation.update', {
                  action: 'extend',
                  reservationId: r.id,
                  newEndAt: new Date(new Date(r.end_at).getTime() - STEP_MIN * 60_000).toISOString(),
                  reason,
                }),
              )
            }
          >
            {tr('op.desk.shorten30')}
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void run(() =>
                mutate('reservation.update', {
                  action: 'extend',
                  reservationId: r.id,
                  newEndAt: new Date(new Date(r.end_at).getTime() + STEP_MIN * 60_000).toISOString(),
                  reason,
                }),
              )
            }
          >
            {tr('op.desk.extend30')}
          </Button>
          <Button disabled={busy} onClick={() => setShowMove(true)}>
            {tr('op.desk.move')}
          </Button>
          <Button kind="danger" disabled={busy} onClick={() => setShowCancel(true)}>
            {tr('op.desk.cancelBooking')}
          </Button>
        </div>
      )}

      {showMove && (
        <div style={{ marginBlockStart: '0.6rem' }}>
          <h3 style={{ marginBlock: '0.4rem', fontSize: '1rem' }}>{tr('op.desk.moveTitle')}</h3>
          <Field label={tr('op.desk.newCourt')}>
            <select style={inputStyle} value={moveCourt} onChange={(e) => setMoveCourt(e.target.value)}>
              {courts.map((c) => (
                <option key={c.id} value={c.id}>
                  {pickName(locale, c)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tr('op.desk.newStart')}>
            <select
              style={inputStyle}
              value={moveStartMin}
              onChange={(e) => setMoveStartMin(e.target.value === '' ? '' : Number(e.target.value))}
            >
              <option value="">—</option>
              {rows.map((min) => (
                <option key={min} value={min}>
                  {formatTime(wallTimeToUtc(date, min, tz), locale, tz)}
                </option>
              ))}
            </select>
          </Field>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <Button onClick={() => setShowMove(false)}>{tr('common.back')}</Button>
            <Button
              kind="primary"
              disabled={busy}
              onClick={() => {
                const start =
                  moveStartMin === '' ? new Date(r.start_at) : wallTimeToUtc(date, moveStartMin, tz);
                void run(() =>
                  mutate('reservation.update', {
                    action: 'move',
                    reservationId: r.id,
                    courtId: moveCourt,
                    startAt: start.toISOString(),
                    endAt: new Date(start.getTime() + durationMs).toISOString(),
                    reason,
                  }),
                );
              }}
            >
              {tr('op.desk.move')}
            </Button>
          </div>
        </div>
      )}

      {showCancel && (
        <div style={{ marginBlockStart: '0.6rem' }}>
          <Field label={tr('op.common.reason')}>
            <select
              style={inputStyle}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            >
              {CANCEL_REASONS.map((code) => (
                <option key={code} value={code}>
                  {tr(`op.reasons.${code}`)}
                </option>
              ))}
            </select>
          </Field>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <Button onClick={() => setShowCancel(false)}>{tr('common.back')}</Button>
            <Button
              kind="danger"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  mutate('reservation.update', {
                    action: 'cancel',
                    reservationId: r.id,
                    reason: cancelReason,
                  }),
                )
              }
            >
              {tr('op.desk.cancelBooking')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
