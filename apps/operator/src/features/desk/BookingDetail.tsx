/**
 * 06.4 BookingDetailScreen — one reservation and every staff action against
 * it. Every override (move, shorten, extend, cancel, status change) goes
 * through ReasonCodePrompt before mutate() fires; the server writes the
 * audit row with actor + reason. A rule refusal (FORBIDDEN, NOT_MOVABLE, …)
 * renders as a refusal with the control still visible (spec R9).
 *
 * Notes are read-only here: no reservation RPC takes a notes argument
 * (move / extend / cancel / mark only), so there is no honest way to write
 * one. They show when there are some, and nothing pretends to edit them.
 *
 * Marking arrived and completed are one click with no reason prompt: they are
 * the normal course of a booking, not overrides, and the prompt's reasons
 * ("customer request", "weather"…) did not describe them. Everything that
 * changes or ends the booking still asks why.
 *
 * The court fee and any cafe bill charged to the booking are paid right here
 * (CourtBillPanel, 0106) — the desk takes the money without the till.
 * "Charge on till" stays only for roles that can open the till, as a way to
 * add items; the court desk never sees a button that leads to a refusal.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { wallTimeToUtc } from '@touch/core';
import { formatDate, formatIQD, formatTimeRange, formatWeekdayShort, VENUE_TZ } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { mutate } from '../../lib/mutate';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { QK, fetchActiveCourts, fetchVenueSettings } from '../../lib/queries';
import { errorToMessageKey } from '../../lib/errors';
import { useToast } from '../../components/toast';
import { useLocale, pickName } from '../../lib/i18n';
import { canAccess, useAuth } from '../../lib/auth';
import { Button, ErrorText, Field, Select, inputStyle, type ReasonCode } from '../../components/ui';
import {
  AsyncStateWrapper,
  CustomerFlagBadge,
  DescriptionList,
  EmptyState,
  MessagePresenter,
  Money,
  PageHeader,
  Panel,
  ReasonCodePrompt,
} from '../../components/kit';
import { allowedMarks, isLive, isOverrideRefusal } from './deskLogic';
import { tradingDateOf } from './calendar/monthLogic';
import { ReservationBadge } from './deskStatus';
import type { CustomerRecord, ReservationRow } from './deskTypes';
import { OVERRIDE_REASONS, STEP_MIN } from './ReservationActionsDialog';
import { CourtBillPanel } from './payment/CourtBillPanel';
import type { BookingBill } from './payment/deskPaymentLogic';

const CANCEL_REASONS = ['customer_request', 'weather', 'staff_error', 'duplicate', 'other'] as const;

type ActionKind = 'move' | 'shorten' | 'extend' | 'cancel' | 'arrived' | 'completed' | 'noShow';

interface MoveDraft {
  courtId: string;
  date: string;
  time: string; // HH:MM
}

export interface BookingDetailSearch {
  /** A customer id handed back by /desk/customers?attach=booking — see CustomerSearch. */
  customer?: string;
}

export function BookingDetailScreen() {
  const { tr, locale } = useLocale();
  const { id } = useParams({ strict: false }) as { id: string };
  const search = useSearch({ strict: false }) as BookingDetailSearch;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { staff } = useAuth();

  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings });
  const courtsQ = useQuery({ queryKey: QK.courts, queryFn: fetchActiveCourts });
  const tz = settingsQ.data?.timezone ?? VENUE_TZ;

  const reservationQ = useQuery({
    queryKey: ['reservation', id],
    queryFn: async (): Promise<ReservationRow | null> => {
      const { data, error } = await supabase.from('reservations').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      return (data as unknown as ReservationRow | null) ?? null;
    },
    refetchInterval: 60_000,
  });
  const r = reservationQ.data ?? null;

  const customerQ = useQuery({
    queryKey: ['customer', r?.guest_id ?? ''],
    enabled: Boolean(r?.guest_id),
    queryFn: () => appRpc<CustomerRecord>('customer_record', { p_customer_id: r!.guest_id }),
    retry: false,
  });

  const [pending, setPending] = useState<ActionKind | null>(null);
  const [busy, setBusy] = useState<ActionKind | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refused, setRefused] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [move, setMove] = useState<MoveDraft | null>(null);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['reservation', id] });
    void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    void queryClient.invalidateQueries({ queryKey: ['reservationsMonth'] });
    void queryClient.invalidateQueries({ queryKey: ['series'] });
    // Moving, extending or ending a booking can change what it owes (0106).
    void queryClient.invalidateQueries({ queryKey: ['bookingBill'] });
    void queryClient.invalidateQueries({ queryKey: ['bookingBillStates'] });
  }

  /** `reason` is absent for arrived / completed: the server records its own default. */
  async function run(kind: ActionKind, reason?: string) {
    if (!r) return;
    setBusy(kind);
    setError(null);
    setRefused(null);
    setDone(false);
    const durationMs = new Date(r.end_at).getTime() - new Date(r.start_at).getTime();
    let queued = false;
    try {
      switch (kind) {
        case 'arrived':
        case 'completed':
        case 'noShow':
          queued = (await mutate('reservation.update', { action: 'mark', reservationId: r.id, status: kind === 'noShow' ? 'no_show' : kind, reason })).queued;
          break;
        case 'shorten':
          queued = (await mutate('reservation.update', { action: 'extend', reservationId: r.id, newEndAt: new Date(new Date(r.end_at).getTime() - STEP_MIN * 60_000).toISOString(), reason })).queued;
          break;
        case 'extend':
          queued = (await mutate('reservation.update', { action: 'extend', reservationId: r.id, newEndAt: new Date(new Date(r.end_at).getTime() + STEP_MIN * 60_000).toISOString(), reason })).queued;
          break;
        case 'cancel':
          queued = (await mutate('reservation.update', { action: 'cancel', reservationId: r.id, reason })).queued;
          break;
        case 'move': {
          if (!move) return;
          const [hh, mm] = move.time.split(':').map(Number);
          const start = wallTimeToUtc(move.date, (hh ?? 0) * 60 + (mm ?? 0), tz);
          queued = (
            await mutate('reservation.update', {
              action: 'move',
              reservationId: r.id,
              courtId: move.courtId,
              startAt: start.toISOString(),
              endAt: new Date(start.getTime() + durationMs).toISOString(),
              reason,
            })
          ).queued;
          setShowMove(false);
          break;
        }
      }
      setPending(null);
      // "Saved" only for what the server took; a queued change is not applied yet.
      setDone(!queued);
      if (queued) {
        toast.info(tr('ws.courtDesk.detail.queued'));
        invalidate();
        return;
      }
      // Completing a game whose court fee is still open says so, once, where
      // the clerk is looking — the bill panel beside it offers the payment.
      const owed = kind === 'completed' ? queryClient.getQueryData<BookingBill>(['bookingBill', r.id]) : undefined;
      if (owed && owed.court_remaining_iqd > 0) toast.info(`${tr('ws.courtDesk.payment.completedOwed')} ${formatIQD(owed.court_remaining_iqd, locale)}`);
      else toast.ok(tr('ws.courtDesk.detail.done'));
      invalidate();
    } catch (e) {
      if (e instanceof AppRpcError && isOverrideRefusal(e.code)) {
        setPending(null);
        setRefused(e);
      } else {
        setError(e);
      }
    } finally {
      setBusy(null);
    }
  }

  function onReason(code: ReasonCode, note: string) {
    if (!pending) return;
    void run(pending, note ? `${code}: ${note}` : code);
  }

  const status = reservationQ.isError && !reservationQ.data ? 'error' : reservationQ.data === undefined ? 'loading' : reservationQ.data === null ? 'empty' : 'ready';
  const court = r ? courtsQ.data?.find((c) => c.id === r.court_id) : undefined;
  const courts = courtsQ.data ?? [];
  const live = r ? isLive(r.status) : false;
  const marks = r ? allowedMarks(r.status, r.start_at) : [];
  const minDurationMin = court?.duration_options?.length ? Math.min(...court.duration_options) : STEP_MIN;
  const durationMs = r ? new Date(r.end_at).getTime() - new Date(r.start_at).getTime() : 0;
  const canShorten = live && durationMs - STEP_MIN * 60_000 >= minDurationMin * 60_000;
  // Where the date + time boxes currently point, and whether that is a start
  // in the past. Same rule as the calendar's drag: moving a booking backwards
  // past now takes it off the guest's app while the desk still shows it
  // confirmed (Parsa, 2026-09-23). A start that does not move is a court
  // change and stays allowed.
  const moveStart =
    move && /^\d{2}:\d{2}$/.test(move.time)
      ? wallTimeToUtc(move.date, Number(move.time.slice(0, 2)) * 60 + Number(move.time.slice(3, 5)), tz)
      : null;
  const movePast = Boolean(
    r && moveStart && moveStart.getTime() < Date.now() && moveStart.getTime() !== new Date(r.start_at).getTime(),
  );
  const customer = customerQ.data;
  const guestName = r ? (r.guest_name ?? customer?.customer.full_name ?? null) : null;
  const title = !r ? tr('ws.courtDesk.detail.title') : r.kind === 'booking' ? (guestName ?? tr('ws.courtDesk.detail.walkIn')) : tr(`ws.courtDesk.detail.kindLabel.${r.kind}`);
  const night = r ? tradingDateOf(r.start_at, tz, settingsQ.data?.opening_hours) : null;
  const canCharge = canAccess(staff?.role, '/till');
  const start = r ? new Date(r.start_at) : null;

  const actionLabel: Record<ActionKind, string> = {
    move: tr('ws.courtDesk.detail.reason.move'),
    shorten: tr('ws.courtDesk.detail.reason.shorten'),
    extend: tr('ws.courtDesk.detail.reason.extend'),
    cancel: tr('ws.courtDesk.detail.reason.cancel'),
    arrived: tr('ws.courtDesk.detail.reason.arrived'),
    completed: tr('ws.courtDesk.detail.reason.completed'),
    noShow: tr('ws.courtDesk.detail.reason.noShow'),
  };

  return (
    <div>
      <PageHeader
        eyebrow={r && r.kind === 'booking' ? tr('ws.courtDesk.detail.eyebrow') : undefined}
        title={title}
        subtitle={
          r && start ? (
            <span style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <bdi>{court ? pickName(locale, court) : ''}</bdi>
              <bdi>
                {formatWeekdayShort(start, locale, tz)} · {formatDate(start, locale, tz)}
              </bdi>
              <bdi style={{ fontVariantNumeric: 'tabular-nums' }}>{formatTimeRange(start, new Date(r.end_at), locale, tz)}</bdi>
              <ReservationBadge reservation={r} />
            </span>
          ) : undefined
        }
        actions={
          <>
            <Button icon="calendar" onClick={() => void navigate({ to: '/desk', search: (night ? { date: night } : {}) as never })}>
              {tr('ws.courtDesk.detail.seeOnCalendar')}
            </Button>
            {r && r.kind === 'booking' && canCharge && (
              <Button icon="receipt" title={tr('ws.courtDesk.detail.chargeCafeLead')} onClick={() => void navigate({ to: '/till', search: { reservation: r.id } as never })}>
                {tr('ws.courtDesk.detail.chargeCafe')}
              </Button>
            )}
          </>
        }
      />

      {search.customer && (
        // Nothing can link a customer to a booking after it is made (no RPC
        // takes a guest id on an existing reservation). Say what to do instead.
        <MessagePresenter tone="refused" message={tr('ws.courtDesk.detail.attachUnavailable')} style={{ marginBlockEnd: '0.75rem' }} />
      )}

      <AsyncStateWrapper
        status={status}
        error={reservationQ.error}
        onRetry={() => void reservationQ.refetch()}
        emptyContent={
          <EmptyState
            icon="calendar"
            title={tr('ws.courtDesk.detail.notFound')}
            action={
              <Button onClick={() => void navigate({ to: '/desk' })}>{tr('ws.courtDesk.detail.backToCalendar')}</Button>
            }
          />
        }
      >
        {r && start && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))', gap: '1rem', alignItems: 'start' }}>
            <Panel title={tr('ws.courtDesk.detail.details')}>
              <DescriptionList
                columns={2}
                items={[
                  ...(r.kind === 'booking'
                    ? [
                        {
                          label: tr('ws.courtDesk.detail.customer'),
                          value: (
                            <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                              <bdi>{guestName ?? tr('ws.courtDesk.detail.walkIn')}</bdi>
                              {customer?.flags.map((f, i) => (
                                <CustomerFlagBadge key={`${f.type}-${i}`} flag={f} />
                              ))}
                              {r.guest_id && (
                                <Link to="/desk/customers/$id" params={{ id: r.guest_id }} style={{ color: 'var(--tp-accent)', fontWeight: 600, fontSize: 'var(--tp-fs-sm)', textDecoration: 'none' }}>
                                  {tr('ws.courtDesk.detail.openCustomer')}
                                </Link>
                              )}
                            </span>
                          ),
                        },
                        { label: tr('ws.courtDesk.detail.contact'), value: r.guest_phone ? <bdi dir="ltr">{r.guest_phone}</bdi> : '—' },
                        { label: tr('ws.courtDesk.detail.price'), value: <Money amount={r.price_iqd} />, numeric: true },
                      ]
                    : []),
                  { label: tr('ws.courtDesk.detail.court'), value: <bdi>{court ? pickName(locale, court) : '—'}</bdi> },
                  { label: tr('ws.courtDesk.detail.when'), value: <bdi>{formatTimeRange(start, new Date(r.end_at), locale, tz)}</bdi> },
                  ...(r.source === 'mobile' || r.source === 'desk' ? [{ label: tr('ws.courtDesk.detail.source'), value: tr(`ws.courtDesk.detail.sourceLabel.${r.source}`) }] : []),
                  ...(r.series_id
                    ? [
                        {
                          label: tr('ws.courtDesk.detail.series'),
                          value: (
                            <Link to="/desk/series/$id" params={{ id: r.series_id }} style={{ color: 'var(--tp-accent)', fontWeight: 600, textDecoration: 'none' }}>
                              {tr('ws.courtDesk.detail.viewSeries')}
                            </Link>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
              {r.notes && (
                <div style={{ marginBlockStart: '0.75rem', paddingBlockStart: '0.75rem', borderBlockStart: '1px solid var(--tp-border)' }}>
                  <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: '0.25rem' }}>{tr('ws.courtDesk.detail.notes')}</p>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{r.notes}</p>
                </div>
              )}
            </Panel>

            {r.kind === 'booking' && <CourtBillPanel reservationId={r.id} tz={tz} />}

            <Panel title={tr('ws.courtDesk.detail.actions')}>
              {done && <MessagePresenter tone="success" message={tr('ws.courtDesk.detail.done')} style={{ marginBlockEnd: '0.75rem' }} />}
              {refused != null && (
                <MessagePresenter tone="refused" message={`${tr('ws.courtDesk.detail.refused')} ${tr(errorToMessageKey(refused))}`} style={{ marginBlockEnd: '0.75rem' }} />
              )}
              <ErrorText error={pending ? null : error} />
              {!live && <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.courtDesk.detail.notLive', { status: tr(`ws.kit.bookingStatus.${r.status as 'completed'}`) })}</p>}
              {live && r.kind === 'booking' && (
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  {marks.includes('arrived') && (
                    <Button icon="check" kind="primary" size="lg" busy={busy === 'arrived'} disabled={busy !== null} onClick={() => void run('arrived')}>
                      {tr('ws.courtDesk.detail.arrived')}
                    </Button>
                  )}
                  {marks.includes('completed') && (
                    <Button icon="checkCircle" size="lg" busy={busy === 'completed'} disabled={busy !== null} onClick={() => void run('completed')}>
                      {tr('ws.courtDesk.detail.completed')}
                    </Button>
                  )}
                  <h3 style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 700, marginBlockStart: marks.length > 0 ? '0.5rem' : 0 }}>{tr('ws.courtDesk.calendar.changeTitle')}</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', alignItems: 'start' }}>
                    <Button icon="minus" busy={busy === 'shorten'} disabled={busy !== null || !canShorten} onClick={() => setPending('shorten')}>
                      {tr('ws.courtDesk.detail.shorten')}
                    </Button>
                    <Button icon="plus" busy={busy === 'extend'} disabled={busy !== null} onClick={() => setPending('extend')}>
                      {tr('ws.courtDesk.detail.extend')}
                    </Button>
                  </div>
                  {/* Rulebook 4.3, under the pair rather than inside one cell, so the two buttons stay the same height. */}
                  {!canShorten && (
                    <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginBlockStart: '-0.25rem' }}>
                      {tr('ws.courtDesk.detail.shortenFloor', { minutes: tr('ws.courtDesk.common.minutes', { minutes: String(minDurationMin) }) })}
                    </p>
                  )}
                  <Button
                    icon="repeat"
                    aria-pressed={showMove}
                    disabled={busy !== null}
                    onClick={() => {
                      setShowMove((v) => !v);
                      if (!move) setMove({ courtId: r.court_id, date: new Date(r.start_at).toLocaleDateString('en-CA', { timeZone: tz }), time: '' });
                    }}
                  >
                    {tr('ws.courtDesk.detail.move')}
                  </Button>
                  {showMove && move && (
                    <div style={{ display: 'grid', gap: '0.25rem', paddingBlock: '0.5rem', paddingInline: '0.6rem', background: 'var(--tp-surface-2)', borderRadius: 'var(--tp-radius-ctl)' }}>
                      <h3 style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 700, marginBlockEnd: '0.4rem' }}>{tr('ws.courtDesk.detail.moveTitle')}</h3>
                      <Field label={tr('ws.courtDesk.detail.newCourt')}>
                        <Select value={move.courtId} onChange={(courtId) => setMove({ ...move, courtId })} options={courts.map((c) => ({ value: c.id, label: pickName(locale, c) }))} />
                      </Field>
                      <Field label={tr('ws.courtDesk.detail.newDate')}>
                        <input type="date" style={inputStyle} value={move.date} onChange={(e) => e.target.value && setMove({ ...move, date: e.target.value })} />
                      </Field>
                      <Field label={tr('ws.courtDesk.detail.newTime')}>
                        <input type="time" step={STEP_MIN * 60} style={inputStyle} value={move.time} onChange={(e) => setMove({ ...move, time: e.target.value })} />
                      </Field>
                      <Button
                        kind="primary"
                        busy={busy === 'move'}
                        disabled={busy !== null || !/^\d{2}:\d{2}$/.test(move.time) || movePast}
                        disabledReason={movePast ? tr('ws.courtDesk.detail.movePast') : tr('ws.courtDesk.detail.moveNeedsTime')}
                        onClick={() => setPending('move')}
                      >
                        {tr('ws.courtDesk.detail.moveSubmit')}
                      </Button>
                    </div>
                  )}
                  {marks.includes('no_show') && (
                    // One click, like arrived and completed above: the guest did
                    // not turn up, and there is nothing to explain. The server
                    // asks for no reason either -- mark_reservation coalesces a
                    // missing one to 'no_show' -- so the "Reason required" modal
                    // this used to open was the app inventing a rule nothing
                    // downstream held it to (owner, 2026-09-23).
                    <Button icon="eyeOff" busy={busy === 'noShow'} disabled={busy !== null} onClick={() => void run('noShow')}>
                      {tr('ws.courtDesk.detail.noShow')}
                    </Button>
                  )}
                  <Button kind="danger" icon="ban" busy={busy === 'cancel'} disabled={busy !== null} onClick={() => setPending('cancel')}>
                    {tr('ws.courtDesk.detail.cancel')}
                  </Button>
                </div>
              )}
              {live && r.kind !== 'booking' && (
                <Button kind="danger" icon="ban" busy={busy === 'cancel'} disabled={busy !== null} onClick={() => setPending('cancel')}>
                  {tr('ws.courtDesk.detail.cancel')}
                </Button>
              )}
            </Panel>
          </div>
        )}
      </AsyncStateWrapper>

      {pending && (
        <ReasonCodePrompt
          action={actionLabel[pending]}
          reasonCodes={pending === 'cancel' ? CANCEL_REASONS : OVERRIDE_REASONS}
          busy={busy !== null}
          error={error}
          onSubmit={onReason}
          onCancel={() => {
            setPending(null);
            setError(null);
          }}
        />
      )}
    </div>
  );
}
