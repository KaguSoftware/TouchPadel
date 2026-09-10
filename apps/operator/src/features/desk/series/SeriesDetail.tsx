/**
 * 06.6 SeriesDetailScreen — an existing series and its occurrences. Played
 * occurrences render untouchable (muted, no actions). Editing one occurrence
 * opens the booking screen; cancelling one goes through the reservation
 * cancel RPC with a reason; cancelling the series makes the scope explicit
 * (future | all) before ReasonCodePrompt and cancel_series.
 * States: loading · ready · busy · error.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { formatDate, formatDateTime, formatNumber, formatTimeRange, VENUE_TZ } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { mutate } from '../../../lib/mutate';
import { QK, fetchActiveCourts, fetchVenueSettings } from '../../../lib/queries';
import { useToast } from '../../../components/toast';
import { useLocale, pickName } from '../../../lib/i18n';
import { Button, ErrorText, Modal, type ReasonCode } from '../../../components/ui';
import { AsyncStateWrapper, BookingStatusIndicator, DescriptionList, EmptyState, MessagePresenter, PageHeader, Panel, ReasonCodePrompt, StatusBadge } from '../../../components/kit';
import type { SeriesDetail, SeriesOccurrence } from '../deskTypes';
import { cancelScopeCount, occurrenceEditable, summarizeOccurrences } from './seriesLogic';

const CANCEL_REASONS = ['customer_request', 'weather', 'staff_error', 'duplicate', 'other'] as const;
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

type Scope = 'future' | 'all';
type Pending = { kind: 'occurrence'; occurrence: SeriesOccurrence } | { kind: 'series'; scope: Scope };

export function SeriesDetailScreen() {
  const { tr, locale } = useLocale();
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings });
  const courtsQ = useQuery({ queryKey: QK.courts, queryFn: fetchActiveCourts });
  const tz = settingsQ.data?.timezone ?? VENUE_TZ;
  const courtName = (cid: string) => pickName(locale, courtsQ.data?.find((c) => c.id === cid)) || cid;

  const seriesQ = useQuery({
    queryKey: ['series', id],
    queryFn: () => appRpc<SeriesDetail | null>('series_detail', { p_series_id: id }),
    retry: false,
    refetchInterval: 60_000,
  });
  const detail = seriesQ.data ?? null;
  const occurrences = detail?.occurrences ?? [];
  const summary = summarizeOccurrences(occurrences);
  const nowIso = new Date().toISOString();

  const [scopeDialog, setScopeDialog] = useState(false);
  const [scope, setScope] = useState<Scope>('future');
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['series', id] });
    void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    void queryClient.invalidateQueries({ queryKey: ['reservationsWeek'] });
  }

  async function confirm(code: ReasonCode, note: string) {
    if (!pending) return;
    setBusy(true);
    setError(null);
    const reason = note ? `${code}: ${note}` : code;
    try {
      if (pending.kind === 'occurrence') {
        await mutate('reservation.update', { action: 'cancel', reservationId: pending.occurrence.id, reason });
      } else {
        await appRpc('cancel_series', { p_series_id: id, p_scope: pending.scope, p_reason_code: code });
        toast.ok(tr('ws.courtDesk.seriesDetail.cancelled'));
      }
      setPending(null);
      invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const status = seriesQ.isError && !seriesQ.data ? 'error' : seriesQ.data === undefined ? 'loading' : seriesQ.data === null ? 'empty' : 'ready';
  const s = detail?.series;
  const cancelled = Boolean(s?.cancelled_at);
  const patternText = s
    ? s.pattern === 'weekdays'
      ? `${tr('ws.courtDesk.seriesDetail.patternLabel.weekdays')} · ${(s.weekdays ?? []).map((d) => tr(`ws.courtDesk.common.weekday.${WEEKDAY_KEYS[d] ?? 'sun'}`)).join(' ')}`
      : tr(`ws.courtDesk.seriesDetail.patternLabel.${s.pattern === 'fortnightly' ? 'fortnightly' : 'weekly'}`)
    : '';

  return (
    <div>
      <PageHeader
        eyebrow={tr('ws.courtDesk.seriesDetail.eyebrow')}
        title={s ? (s.guest_name ?? tr('ws.courtDesk.common.walkIn')) : tr('ws.courtDesk.seriesDetail.title')}
        subtitle={s ? `${courtName(s.court_id)} · ${patternText}` : undefined}
        actions={
          <>
            <Link to="/desk" className="tp-btn" data-kind="ghost" data-size="md">
              {tr('ws.courtDesk.detail.backToCalendar')}
            </Link>
            {s && !cancelled && (
              <Button
                kind="danger"
                icon="ban"
                disabled={busy || summary.upcoming === 0}
                disabledReason={summary.upcoming === 0 ? tr('ws.courtDesk.seriesDetail.nothingToCancel') : undefined}
                onClick={() => setScopeDialog(true)}
              >
                {tr('ws.courtDesk.seriesDetail.cancelSeries')}
              </Button>
            )}
          </>
        }
      />
      <AsyncStateWrapper status={status} error={seriesQ.error} onRetry={() => void seriesQ.refetch()} emptyContent={<EmptyState icon="repeat" title={tr('ws.courtDesk.seriesDetail.notFound')} />}>
        {s && (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {cancelled && <MessagePresenter tone="info" message={tr('ws.courtDesk.seriesDetail.seriesCancelled')} />}
            <Panel>
              <DescriptionList
                columns={3}
                items={[
                  { label: tr('ws.courtDesk.seriesDetail.pattern'), value: patternText },
                  { label: tr('ws.courtDesk.seriesDetail.court'), value: <bdi>{courtName(s.court_id)}</bdi> },
                  {
                    label: tr('ws.courtDesk.seriesDetail.customer'),
                    value: (
                      <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <bdi>{s.guest_name ?? tr('ws.courtDesk.common.walkIn')}</bdi>
                        {s.guest_phone && <bdi dir="ltr">{s.guest_phone}</bdi>}
                        {s.guest_id && (
                          <Link to="/desk/customers/$id" params={{ id: s.guest_id }} style={{ color: 'var(--tp-accent)', fontWeight: 600, fontSize: 'var(--tp-fs-sm)' }}>
                            {tr('ws.courtDesk.detail.openCustomer')}
                          </Link>
                        )}
                      </span>
                    ),
                  },
                  {
                    label: tr('ws.courtDesk.seriesDetail.range'),
                    value: (
                      <bdi>
                        {formatDate(new Date(`${s.starts_on}T12:00:00Z`), locale, 'UTC')} – {formatDate(new Date(`${s.ends_on}T12:00:00Z`), locale, 'UTC')}
                      </bdi>
                    ),
                  },
                  { label: tr('ws.courtDesk.series.time'), value: <bdi dir="ltr">{s.start_time.slice(0, 5)}</bdi> },
                  { label: tr('ws.courtDesk.series.duration'), value: tr('op.common.minutesShort', { minutes: s.duration_min }) },
                ]}
              />
              {s.notes && <p style={{ marginBlockStart: '0.75rem', color: 'var(--tp-muted-fg)' }}>{s.notes}</p>}
            </Panel>

            <Panel
              title={tr('ws.courtDesk.seriesDetail.occurrences')}
              padded={false}
              actions={
                <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
                  {tr('ws.courtDesk.seriesDetail.occurrencesLead', {
                    total: formatNumber(summary.total, locale),
                    played: formatNumber(summary.played, locale),
                    upcoming: formatNumber(summary.upcoming, locale),
                  })}
                </span>
              }
            >
              <ErrorText error={pending ? null : error} style={{ marginInline: '0.85rem' }} />
              <table className="tp-table" data-dense="true" aria-label={tr('ws.courtDesk.seriesDetail.occurrences')}>
                <thead>
                  <tr>
                    <th>{tr('ws.courtDesk.common.date')}</th>
                    <th>{tr('ws.courtDesk.common.time')}</th>
                    <th>{tr('ws.courtDesk.common.court')}</th>
                    <th>{tr('ws.courtDesk.common.status')}</th>
                    <th style={{ textAlign: 'end' }}>{tr('ws.courtDesk.common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {occurrences.map((o) => {
                    const editable = occurrenceEditable(o);
                    return (
                      <tr key={o.id} aria-disabled={o.played || undefined} style={{ opacity: o.played ? 'var(--tp-opacity-disabled)' : 1 }}>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <bdi>{formatDate(new Date(o.start_at), locale, tz)}</bdi>
                        </td>
                        <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                          <bdi>{formatTimeRange(new Date(o.start_at), new Date(o.end_at), locale, tz)}</bdi>
                        </td>
                        <td>
                          <bdi>{courtName(o.court_id)}</bdi>
                        </td>
                        <td>
                          <span style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center' }}>
                            <BookingStatusIndicator status={o.status} size="sm" />
                            {o.played && <StatusBadge size="sm" tone="neutral" icon="check" label={tr('ws.courtDesk.seriesDetail.played')} title={tr('ws.courtDesk.seriesDetail.untouchable')} />}
                          </span>
                        </td>
                        <td style={{ textAlign: 'end', whiteSpace: 'nowrap' }}>
                          {o.played ? (
                            <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.courtDesk.seriesDetail.untouchable')}</span>
                          ) : (
                            <span style={{ display: 'inline-flex', gap: '0.3rem' }}>
                              <Button size="sm" kind="ghost" iconEnd="chevronEnd" onClick={() => void navigate({ to: '/desk/bookings/$id', params: { id: o.id } })}>
                                {tr('ws.courtDesk.seriesDetail.openOccurrence')}
                              </Button>
                              {editable && (
                                <Button size="sm" kind="danger" disabled={busy} onClick={() => setPending({ kind: 'occurrence', occurrence: o })}>
                                  {tr('ws.courtDesk.seriesDetail.cancelOccurrence')}
                                </Button>
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>
          </div>
        )}
      </AsyncStateWrapper>

      {scopeDialog && (
        <Modal
          title={tr('ws.courtDesk.seriesDetail.cancelSeriesTitle')}
          subtitle={tr('ws.courtDesk.seriesDetail.scopeNote')}
          size="sm"
          onClose={() => setScopeDialog(false)}
          footer={
            <>
              <Button onClick={() => setScopeDialog(false)}>{tr('ws.courtDesk.seriesDetail.keep')}</Button>
              <Button
                kind="danger"
                disabled={cancelScopeCount(occurrences, scope, nowIso) === 0}
                disabledReason={tr('ws.courtDesk.seriesDetail.scopeEmpty')}
                onClick={() => {
                  setScopeDialog(false);
                  setPending({ kind: 'series', scope });
                }}
              >
                {tr('ws.courtDesk.seriesDetail.confirm')}
              </Button>
            </>
          }
        >
          <div role="radiogroup" aria-label={tr('ws.courtDesk.seriesDetail.scopeChoice')} style={{ display: 'grid', gap: '0.3rem' }}>
            {(['future', 'all'] as const).map((sc) => (
              <label key={sc} className="tp-row" data-clickable="true" data-selected={scope === sc ? 'true' : undefined} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingBlock: '0.4rem', paddingInline: '0.5rem', borderRadius: 'var(--tp-radius-ctl)', cursor: 'pointer' }}>
                <input type="radio" name="series-scope" value={sc} checked={scope === sc} onChange={() => setScope(sc)} />
                <span style={{ flex: 1 }}>{sc === 'future' ? tr('ws.courtDesk.seriesDetail.scopeFuture') : tr('ws.courtDesk.seriesDetail.scopeAll')}</span>
                <span style={{ color: 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums' }}>{tr('ws.courtDesk.record.occurrences', { count: formatNumber(cancelScopeCount(occurrences, sc, nowIso), locale) })}</span>
              </label>
            ))}
          </div>
        </Modal>
      )}

      {pending && (
        <ReasonCodePrompt
          action={
            pending.kind === 'series'
              ? tr('ws.courtDesk.seriesDetail.reasonCancelSeries', { count: formatNumber(cancelScopeCount(occurrences, pending.scope, nowIso), locale) })
              : tr('ws.courtDesk.seriesDetail.reasonCancelOne')
          }
          reasonCodes={CANCEL_REASONS}
          busy={busy}
          error={error}
          withNote={pending.kind === 'occurrence'}
          onSubmit={(code, note) => void confirm(code, note)}
          onCancel={() => {
            setPending(null);
            setError(null);
          }}
        >
          {pending.kind === 'occurrence' && (
            <p style={{ marginBlockEnd: '0.75rem', fontWeight: 600 }}>
              <bdi>{formatDateTime(new Date(pending.occurrence.start_at), locale, tz)}</bdi>
            </p>
          )}
        </ReasonCodePrompt>
      )}
    </div>
  );
}
