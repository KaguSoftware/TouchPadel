/**
 * 06.4 BookingDetailScreen — one reservation and every staff action against
 * it. Every override (move, shorten, extend, cancel, status change) goes
 * through ReasonCodePrompt before mutate() fires; the server writes the
 * audit row with actor + reason. A rule refusal (FORBIDDEN, NOT_MOVABLE, …)
 * renders as a refusal with the control still visible (spec R9).
 *
 * Notes are read-only here: no reservation RPC takes a notes argument
 * (move / extend / cancel / mark only), so there is no honest way to write
 * one. Stated on screen rather than faked.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { wallTimeToUtc } from '@touch/core';
import { formatDate, formatDateTime, formatTimeRange, VENUE_TZ } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { mutate } from '../../lib/mutate';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { QK, fetchActiveCourts, fetchVenueSettings } from '../../lib/queries';
import { errorToMessageKey } from '../../lib/errors';
import { useToast } from '../../components/toast';
import { useLocale, pickName } from '../../lib/i18n';
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
  PaymentStatusIndicator,
  ReasonCodePrompt,
} from '../../components/kit';
import { allowedMarks, isLive, isOverrideRefusal, paymentStatusFor } from './deskLogic';
import { ReservationBadge } from './deskStatus';
import type { CustomerRecord, ReservationRow } from './deskTypes';
import { OVERRIDE_REASONS, STEP_MIN } from './ReservationActionsDialog';
import { useTabLinks } from './useTradingNight';

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
  const tabLinksQ = useTabLinks(useMemo(() => (r ? [r.id] : []), [r]));

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
    void queryClient.invalidateQueries({ queryKey: ['reservationsWeek'] });
    void queryClient.invalidateQueries({ queryKey: ['series'] });
  }

  async function run(kind: ActionKind, reason: string) {
    if (!r) return;
    setBusy(kind);
    setError(null);
    setRefused(null);
    setDone(false);
    const durationMs = new Date(r.end_at).getTime() - new Date(r.start_at).getTime();
    try {
      switch (kind) {
        case 'arrived':
        case 'completed':
        case 'noShow':
          await mutate('reservation.update', { action: 'mark', reservationId: r.id, status: kind === 'noShow' ? 'no_show' : kind, reason });
          break;
        case 'shorten':
          await mutate('reservation.update', { action: 'extend', reservationId: r.id, newEndAt: new Date(new Date(r.end_at).getTime() - STEP_MIN * 60_000).toISOString(), reason });
          break;
        case 'extend':
          await mutate('reservation.update', { action: 'extend', reservationId: r.id, newEndAt: new Date(new Date(r.end_at).getTime() + STEP_MIN * 60_000).toISOString(), reason });
          break;
        case 'cancel':
          await mutate('reservation.update', { action: 'cancel', reservationId: r.id, reason });
          break;
        case 'move': {
          if (!move) return;
          const [hh, mm] = move.time.split(':').map(Number);
          const start = wallTimeToUtc(move.date, (hh ?? 0) * 60 + (mm ?? 0), tz);
          await mutate('reservation.update', {
            action: 'move',
            reservationId: r.id,
            courtId: move.courtId,
            startAt: start.toISOString(),
            endAt: new Date(start.getTime() + durationMs).toISOString(),
            reason,
          });
          setShowMove(false);
          break;
        }
      }
      setPending(null);
      setDone(true);
      toast.ok(tr('ws.courtDesk.detail.done'));
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
  const marks = r ? allowedMarks(r.status) : [];
  const minDurationMin = court?.duration_options?.length ? Math.min(...court.duration_options) : STEP_MIN;
  const durationMs = r ? new Date(r.end_at).getTime() - new Date(r.start_at).getTime() : 0;
  const canShorten = live && durationMs - STEP_MIN * 60_000 >= minDurationMin * 60_000;
  const customer = customerQ.data;
  const title = !r ? tr('ws.courtDesk.detail.title') : r.kind === 'booking' ? (r.guest_name ?? customer?.customer.full_name ?? tr('ws.courtDesk.detail.walkIn')) : tr(`ws.courtDesk.detail.kindLabel.${r.kind}`);

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
        eyebrow={tr('ws.courtDesk.detail.eyebrow')}
        title={title}
        subtitle={
          r ? (
            <span style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <bdi>{court ? pickName(locale, court) : ''}</bdi>
              <bdi>{formatDate(new Date(r.start_at), locale, tz)}</bdi>
              <bdi>{formatTimeRange(new Date(r.start_at), new Date(r.end_at), locale, tz)}</bdi>
              <ReservationBadge reservation={r} />
            </span>
          ) : undefined
        }
        actions={
          <>
            <Link to="/desk" className="tp-btn" data-kind="ghost" data-size="md">
              {tr('ws.courtDesk.detail.backToCalendar')}
            </Link>
            {r && r.kind === 'booking' && (
              <Button
                icon="receipt"
                title={tr('ws.courtDesk.detail.chargeCafeLead')}
                onClick={() => void navigate({ to: '/till', search: { reservation: r.id } as never })}
              >
                {tr('ws.courtDesk.detail.chargeCafe')}
              </Button>
            )}
          </>
        }
      />

      {search.customer && (
        <MessagePresenter
          tone="refused"
          message={tr('ws.courtDesk.customers.attachBooking') + ' — ' + tr('ws.courtDesk.detail.notesReadOnly')}
          style={{ marginBlockEnd: '0.75rem' }}
        />
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
              <Link to="/desk" className="tp-btn" data-kind="default" data-size="md">
                {tr('ws.courtDesk.detail.backToCalendar')}
              </Link>
            }
          />
        }
      >
        {r && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(18rem, 2fr)', gap: '1rem', alignItems: 'start' }}>
            <div style={{ display: 'grid', gap: '1rem' }}>
              <Panel>
                <DescriptionList
                  columns={2}
                  items={[
                    { label: tr('ws.courtDesk.detail.when'), value: <bdi>{formatDateTime(new Date(r.start_at), locale, tz)}</bdi> },
                    { label: tr('ws.courtDesk.detail.court'), value: <bdi>{court ? pickName(locale, court) : r.court_id}</bdi> },
                    {
                      label: tr('ws.courtDesk.detail.customer'),
                      value: (
                        <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <bdi>{r.guest_name ?? customer?.customer.full_name ?? tr('ws.courtDesk.detail.walkIn')}</bdi>
                          {customer?.flags.map((f, i) => (
                            <CustomerFlagBadge key={`${f.type}-${i}`} flag={f} />
                          ))}
                          {r.guest_id && (
                            <Link to="/desk/customers/$id" params={{ id: r.guest_id }} style={{ color: 'var(--tp-accent)', fontWeight: 600, fontSize: 'var(--tp-fs-sm)' }}>
                              {tr('ws.courtDesk.detail.openCustomer')}
                            </Link>
                          )}
                        </span>
                      ),
                    },
                    { label: tr('ws.courtDesk.detail.contact'), value: r.guest_phone ? <bdi dir="ltr">{r.guest_phone}</bdi> : '—' },
                    { label: tr('ws.courtDesk.detail.price'), value: <Money amount={r.price_iqd} />, numeric: true },
                    { label: tr('ws.courtDesk.detail.payment'), value: <PaymentStatusIndicator paymentStatus={paymentStatusFor(r, tabLinksQ.data)} size="sm" /> },
                    { label: tr('ws.courtDesk.detail.kind'), value: tr(`ws.courtDesk.detail.kindLabel.${r.kind}`) },
                    { label: tr('ws.courtDesk.detail.source'), value: r.source === 'mobile' || r.source === 'desk' ? tr(`ws.courtDesk.detail.sourceLabel.${r.source}`) : '—' },
                    ...(r.series_id
                      ? [
                          {
                            label: tr('ws.courtDesk.detail.series'),
                            value: (
                              <Link to="/desk/series/$id" params={{ id: r.series_id }} style={{ color: 'var(--tp-accent)', fontWeight: 600 }}>
                                {tr('ws.courtDesk.detail.viewSeries')}
                              </Link>
                            ),
                          },
                        ]
                      : []),
                  ]}
                />
              </Panel>
              <Panel title={tr('ws.courtDesk.detail.notes')}>
                {r.notes ? <p style={{ whiteSpace: 'pre-wrap' }}>{r.notes}</p> : <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.courtDesk.detail.noNotes')}</p>}
                <p style={{ marginBlockStart: '0.5rem', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.courtDesk.detail.notesReadOnly')}</p>
              </Panel>
            </div>

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
                    <Button icon="check" kind="primary" busy={busy === 'arrived'} disabled={busy !== null} onClick={() => setPending('arrived')}>
                      {tr('ws.courtDesk.detail.arrived')}
                    </Button>
                  )}
                  {marks.includes('completed') && (
                    <Button icon="checkCircle" busy={busy === 'completed'} disabled={busy !== null} onClick={() => setPending('completed')}>
                      {tr('ws.courtDesk.detail.completed')}
                    </Button>
                  )}
                  {marks.includes('no_show') && (
                    <Button icon="eyeOff" busy={busy === 'noShow'} disabled={busy !== null} onClick={() => setPending('noShow')}>
                      {tr('ws.courtDesk.detail.noShow')}
                    </Button>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    <Button
                      icon="minus"
                      busy={busy === 'shorten'}
                      disabled={busy !== null || !canShorten}
                      disabledReason={canShorten ? undefined : tr('ws.courtDesk.detail.shortenFloor', { minutes: tr('ws.courtDesk.common.minutes', { minutes: String(minDurationMin) }) })}
                      onClick={() => setPending('shorten')}
                    >
                      {tr('ws.courtDesk.detail.shorten')}
                    </Button>
                    <Button icon="plus" busy={busy === 'extend'} disabled={busy !== null} onClick={() => setPending('extend')}>
                      {tr('ws.courtDesk.detail.extend')}
                    </Button>
                  </div>
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
                        disabled={busy !== null || !/^\d{2}:\d{2}$/.test(move.time)}
                        disabledReason={tr('ws.courtDesk.detail.moveNeedsTime')}
                        onClick={() => setPending('move')}
                      >
                        {tr('ws.courtDesk.detail.moveSubmit')}
                      </Button>
                    </div>
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
