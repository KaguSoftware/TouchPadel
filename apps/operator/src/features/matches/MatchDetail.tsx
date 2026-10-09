/**
 * One open match at `/desk/matches/$id` (docs/design/open-matches/operator.md
 * §5.12), for every status: the header (time, category, status, the fill
 * deadline, join and visibility tags, the court once booked; Copy invite link,
 * Cancel match, Open booking), the banner of §5.12.1, the Players panel
 * (§5.13), the requests of an ask-to-join match (read only: the organiser
 * answers them in the app), the invite link and the history (§5.12.2).
 *
 * `?customer=<id>` (a customer handed back from search or create) opens Add
 * player with that customer picked. A sandbox match (App Review) says so and
 * offers nothing; a match the server will not show here (MATCH_NOT_FOUND, or
 * a server without matches: RPC_MISSING) reads "not at this branch" with a
 * way back to Today.
 *
 * Reads through `useMatchDetail` (20 s, last data kept) plus the 'courts'
 * broadcast (useMatchesLive): a booking that bumps or books the match
 * refreshes it at once. Cancel is a direct app.desk_cancel_match (DF-11,
 * online only).
 */
import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { countPhrase, formatDateTime, formatNumber, formatTime, formatTimeRange, isolate, VENUE_TZ, type Locale, type MessageKey } from '@touch/i18n';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { QK, fetchVenueSettings } from '../../lib/queries';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Skeleton, type ReasonCode } from '../../components/ui';
import { CustomerFlagBadge, EmptyState, MessagePresenter, PageHeader, Panel, ReasonCodePrompt, StatusBadge, ViewMore, useListCap, type MessageTone, type Tone } from '../../components/kit';
import { AddSeatDialog } from './AddSeatDialog';
import {
  byCategory,
  endedSentenceKey,
  eventKey,
  inviteUrl,
  matchActionsOf,
  matchErrorText,
  matchStatusKey,
  openSeatNumbers,
  messageCodeText,
  reasonText,
  MATCH_SEATS,
  type Tr,
} from './matchLogic';
import type { MatchDetail, MatchEvent } from './matchPayloads';
import { MatchPlayersPanel } from './MatchPlayersPanel';
import { MatchReadNotice } from './MatchReadNotice';
import { invalidateMatchSeats, useMatchCaps, useMatchDetail, useMatchRead, useMatchesLive } from './useMatches';

/** The desk cancel reasons (§5.12): the reason form of R42. */
const CANCEL_REASONS: readonly ReasonCode[] = ['customer_request', 'court_needed', 'staff_error', 'duplicate', 'other'];

const STATUS_TONE: Record<string, Tone> = {
  filling: 'accent',
  awaiting_court: 'warn',
  booked: 'success',
  played: 'neutral',
  no_show: 'danger',
  cancelled: 'danger',
  bumped: 'danger',
  expired: 'neutral',
};

const LIVE = new Set(['filling', 'awaiting_court', 'booked']);

/**
 * The banner under the header (§5.12.1): a live match's state, or the
 * sentence of how it ended. An unknown status prints raw, neutral.
 */
export function bannerOf(detail: MatchDetail, tr: Tr, locale: Locale, tz: string): { tone: MessageTone; text: string } {
  const m = detail.match;
  const court = pickName(locale, { name_en: m.court_name_en ?? '', name_ar: m.court_name_ar ?? '' }) || '—';
  switch (m.status) {
    case 'filling': {
      const taken = MATCH_SEATS - openSeatNumbers(detail.seats).length;
      return {
        tone: 'info',
        text: tr(byCategory(m.category, 'ws.matches.detail.banner.filling'), {
          taken: formatNumber(taken, locale),
          total: formatNumber(MATCH_SEATS, locale),
          players: countPhrase(m.category === 'women' ? 'ws.matches.count.playersF' : 'ws.matches.count.players', MATCH_SEATS - taken, locale),
          time: m.fill_deadline_at ? formatTime(new Date(m.fill_deadline_at), locale, tz) : '—',
        }),
      };
    }
    case 'awaiting_court':
      return { tone: 'info', text: tr('ws.matches.detail.banner.awaitingCourt') };
    case 'booked':
      return { tone: 'info', text: tr('ws.matches.detail.banner.booked', { court: isolate(court) }) };
    default: {
      const key = endedSentenceKey(m.status, m.ended_reason);
      if (!key) return { tone: 'info', text: m.status };
      return { tone: m.status === 'played' ? 'success' : 'refused', text: tr(key) };
    }
  }
}

/** One history row (§5.12.2): the type's sentence, "· {actor}" appended; automatic events read "automatic". */
export function eventSentence(e: MatchEvent, tr: Tr): string {
  const key = eventKey(e.type);
  const seat = e.seat_no !== null ? String(e.seat_no) : '—';
  const text = key ? tr(key, { seat, reason: reasonText(e.code, tr), code: messageCodeText(e.code, tr) }) : e.type;
  const actor = e.actor_name ? isolate(e.actor_name) : e.actor === null || e.actor === 'system' ? tr('ws.matches.detail.history.automatic') : null;
  return actor ? `${text} · ${actor}` : text;
}

export function MatchDetailScreen() {
  const { tr } = useLocale();
  const { id } = useParams({ strict: false }) as { id: string };
  const search = useSearch({ strict: false }) as { customer?: string };
  const navigate = useNavigate();
  const q = useMatchDetail(id);
  const status = useMatchRead(q);
  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings });
  const tz = settingsQ.data?.timezone ?? VENUE_TZ;
  useMatchesLive();

  const backToToday = <Button onClick={() => void navigate({ to: '/desk/today' })}>{tr('ws.matches.detail.backToToday')}</Button>;
  const notFound = (
    <div>
      <PageHeader eyebrow={tr('ws.matches.common.openMatch')} title={tr('ws.matches.common.openMatch')} />
      <EmptyState icon="users" title={tr('ws.matches.detail.notFound')} action={backToToday} />
    </div>
  );

  if (status.kind === 'absent') return notFound;
  if (status.kind === 'loading') {
    return (
      <div>
        <PageHeader eyebrow={tr('ws.matches.common.openMatch')} title={tr('ws.matches.common.openMatch')} />
        <Skeleton lines={5} />
      </div>
    );
  }
  if (status.kind === 'failed') {
    if (status.error instanceof AppRpcError && status.error.code === 'MATCH_NOT_FOUND') return notFound;
    return (
      <div>
        <PageHeader eyebrow={tr('ws.matches.common.openMatch')} title={tr('ws.matches.common.openMatch')} />
        <MatchReadNotice status={status} onRetry={() => void q.refetch()} tz={tz} />
      </div>
    );
  }
  return (
    <MatchScreen
      detail={status.data}
      tz={tz}
      stale={status.stale ? <MatchReadNotice status={status} onRetry={() => void q.refetch()} tz={tz} /> : null}
      handedCustomer={search.customer}
      onHandedDone={() => void navigate({ to: '/desk/matches/$id', params: { id }, search: {} as never, replace: true })}
    />
  );
}

function MatchScreen({
  detail,
  tz,
  stale,
  handedCustomer,
  onHandedDone,
}: {
  detail: MatchDetail;
  tz: string;
  stale: ReactNode;
  handedCustomer?: string;
  onHandedDone: () => void;
}) {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const caps = useMatchCaps();
  const { reachable } = useStationReach();
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [refusal, setRefusal] = useState<unknown>(null);

  const m = detail.match;
  const actions = matchActionsOf(m, reachable, caps);
  const offline = tr('ws.matches.offline.needsConnection');
  const start = new Date(m.start_at);
  const end = new Date(m.end_at);
  const categoryKey = m.category === 'open' || m.category === 'women' || m.category === 'men' ? (`ws.matches.common.category.${m.category}` as const) : null;
  const statusKey = matchStatusKey(m.status);
  const court = pickName(locale, { name_en: m.court_name_en ?? '', name_ar: m.court_name_ar ?? '' });
  const live = LIVE.has(m.status);
  const url = m.share_token ? inviteUrl(m.share_token, import.meta.env.VITE_GUEST_SITE_URL, import.meta.env.PROD) : null;
  const banner = bannerOf(detail, tr, locale, tz);
  const handing = Boolean(handedCustomer) && caps.runMatches && !m.sandbox;

  async function copyLink() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.ok(tr('ws.matches.detail.linkCopied'));
    } catch {
      toast.err(tr('ws.matches.detail.copyFailed'));
    }
  }

  async function cancel(code: ReasonCode, note: string) {
    setBusy(true);
    setError(null);
    setRefusal(null);
    try {
      await appRpc('desk_cancel_match', { p_match_id: m.id, p_reason: note ? `${code}: ${note}` : code });
      invalidateMatchSeats(qc);
      toast.ok(tr('ws.matches.detail.cancelled'));
      setCancelling(false);
    } catch (e) {
      invalidateMatchSeats(qc);
      if (e instanceof AppRpcError && e.code === 'MATCH_NOT_FILLING') {
        // It booked meanwhile: a booked match is cancelled from its booking.
        setCancelling(false);
        setRefusal(e);
      } else {
        setError(e);
      }
    } finally {
      setBusy(false);
    }
  }

  const openBooking = m.reservation_id ? (
    <Button icon="calendar" onClick={() => void navigate({ to: '/desk/bookings/$id', params: { id: m.reservation_id! } })}>
      {tr('ws.matches.detail.openBooking')}
    </Button>
  ) : null;

  return (
    <div>
      <PageHeader
        eyebrow={tr('ws.matches.common.openMatch')}
        title={tr('ws.matches.detail.title', { time: formatTimeRange(start, end, locale, tz), category: categoryKey ? tr(categoryKey) : m.category })}
        subtitle={
          <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusBadge tone={STATUS_TONE[m.status] ?? 'neutral'} label={statusKey ? tr(statusKey) : m.status} />
            {m.status === 'filling' && m.fill_deadline_at && <bdi>{tr('ws.matches.detail.closes', { time: formatTime(new Date(m.fill_deadline_at), locale, tz) })}</bdi>}
            {m.join_policy === 'approve' && <StatusBadge size="sm" dot={false} tone="neutral" label={tr('ws.matches.common.tag.approve')} />}
            {m.visibility === 'link' && <StatusBadge size="sm" dot={false} tone="neutral" icon="link" label={tr('ws.matches.common.tag.link')} />}
            {m.court_id && court && <bdi>{court}</bdi>}
          </span>
        }
        actions={
          <>
            {actions.copyLink.show && live && url && (
              <Button icon="link" onClick={() => void copyLink()}>
                {tr('ws.matches.detail.copyLink')}
              </Button>
            )}
            {actions.cancel.show && (
              <Button kind="danger" icon="ban" disabled={actions.cancel.blockedBy !== null} disabledReason={actions.cancel.blockedBy ? offline : undefined} onClick={() => setCancelling(true)}>
                {tr('ws.matches.detail.cancel')}
              </Button>
            )}
            {openBooking}
          </>
        }
      />

      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', marginBlockEnd: 'var(--tp-sp-4)' }}>
        {stale}
        <MessagePresenter tone={banner.tone} message={banner.text} />
        {m.sandbox && <MessagePresenter tone="info" icon="lock" message={tr('ws.matches.detail.sandbox')} />}
        {refusal != null && (
          <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <MessagePresenter tone="refused" message={matchErrorText(refusal, { tr, locale, tz })} style={{ flex: 1 }} />
            {openBooking}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))', gap: 'var(--tp-sp-4)', alignItems: 'start' }}>
        <MatchPlayersPanel matchId={m.id} onMatchScreen />

        {m.join_policy === 'approve' && live && <RequestsPanel detail={detail} tz={tz} />}

        {actions.copyLink.show && live && url && (
          <Panel title={tr('ws.matches.detail.invite.title')}>
            <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
              <code dir="ltr" style={{ overflowWrap: 'anywhere', fontSize: 'var(--tp-fs-sm)' }}>
                {url}
              </code>
              {m.visibility === 'link' && <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.matches.detail.invite.linkOnly')}</p>}
              <div>
                <Button size="sm" icon="link" onClick={() => void copyLink()}>
                  {tr('ws.matches.detail.copyLink')}
                </Button>
              </div>
            </div>
          </Panel>
        )}

        <HistoryPanel events={detail.events} tz={tz} />
      </div>

      {cancelling && (
        <ReasonCodePrompt
          action={tr('ws.matches.detail.cancel')}
          reasonCodes={CANCEL_REASONS}
          noteMode="optional"
          busy={busy}
          error={null}
          onCancel={() => {
            setCancelling(false);
            setError(null);
          }}
          onSubmit={(code, note) => void cancel(code, note)}
        >
          <p style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>{tr('ws.matches.detail.cancelBody')}</p>
          {error != null && <ErrorText error={error} message={matchErrorText(error, { tr, locale, tz })} />}
        </ReasonCodePrompt>
      )}

      {handing && handedCustomer && <AddSeatDialog matchId={m.id} customerId={handedCustomer} onClose={onHandedDone} />}
    </div>
  );
}

/** The requests of an ask-to-join match (§5.12), read only: the organiser answers them in the app. */
/** The match's history, in the server's order. Owner's rule (2026-10-08): three events, then "View more". */
function HistoryPanel({ events, tz }: { events: readonly MatchEvent[]; tz: string }) {
  const { tr, locale } = useLocale();
  const cap = useListCap(events);
  return (
    <Panel title={tr('ws.matches.detail.history.title')}>
      {events.length === 0 ? (
        <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.matches.detail.history.empty')}</p>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
          {cap.shown.map((e, i) => (
            <li key={`${e.at ?? ''}-${e.type}-${i}`} style={{ display: 'flex', gap: 'var(--tp-sp-3)', fontSize: 'var(--tp-fs-sm)' }}>
              <bdi style={{ color: 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums', flex: '0 0 auto' }}>
                {e.at ? formatDateTime(new Date(e.at), locale, tz) : '—'}
              </bdi>
              <span>{eventSentence(e, tr)}</span>
            </li>
          ))}
        </ol>
      )}
      <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} />
    </Panel>
  );
}

function RequestsPanel({ detail, tz }: { detail: MatchDetail; tz: string }) {
  const { tr, locale } = useLocale();
  const requests = detail.requests;
  const cap = useListCap(requests);
  const figure = (key: MessageKey, n: number | null) => tr(key, { count: n === null ? '—' : formatNumber(n, locale) });
  return (
    <Panel title={tr('ws.matches.detail.requests.title', { count: formatNumber(requests.length, locale) })}>
      <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', marginBlockEnd: 'var(--tp-sp-2)' }}>
        {tr(byCategory(detail.match.category, 'ws.matches.detail.requests.lead'))}
      </p>
      {requests.length === 0 ? (
        <p>{tr('ws.matches.detail.requests.empty')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
          {cap.shown.map((r) => (
            <li key={r.request_id} style={{ display: 'grid', gap: 'var(--tp-sp-1)', paddingBlockStart: 'var(--tp-sp-2)', borderBlockStart: '1px solid var(--tp-border)' }}>
              <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>
                  <bdi>{r.full_name ?? '—'}</bdi>
                </strong>
                {r.phone && (
                  <bdi dir="ltr" style={{ color: 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums' }}>
                    {r.phone}
                  </bdi>
                )}
                {r.flags.map((f, i) => (
                  <CustomerFlagBadge key={`${f.type}-${i}`} flag={f} />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 'var(--tp-sp-3)', flexWrap: 'wrap', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                <span>{figure('ws.matches.detail.requests.seats', r.seats_requested)}</span>
                <span>{figure('ws.matches.detail.requests.games', r.games_played)}</span>
                <span>{figure('ws.matches.detail.requests.noShows', r.no_shows)}</span>
                {r.created_at && <span>{tr('ws.matches.detail.requests.askedAt', { time: formatTime(new Date(r.created_at), locale, tz) })}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} />
    </Panel>
  );
}
