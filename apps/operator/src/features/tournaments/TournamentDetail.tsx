/**
 * One tournament at `/desk/tournaments/$id` (docs/design/tournaments/
 * build-contracts-2026-10-03.md §1.8 desk_tournament_detail; plan §5.1):
 * the header (format, category, status, the facts, See on calendar and, for
 * management, Cancel the tournament), the refunds a cancel left, and three
 * tabs: Entries (EntriesPanel), Rounds (RoundsBoard) and Standings (read-only).
 *
 * `?customer=<id>` (handed back by the customer picker) adds that customer
 * as a walk-in. A tournament the server will not show here
 * (TOURNAMENT_NOT_FOUND, or a server without tournaments) reads "not at this
 * branch" with a way back to the list.
 *
 * Reads `useTournamentDetail` (15 s, last data kept) plus the 'courts'
 * broadcast. Every write is a direct appRpc, online only.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import {
  VENUE_TZ,
  formatDate,
  formatDateTime,
  formatIQD,
  formatNumber,
  formatTimeRange,
  isolate,
} from '@touch/i18n';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { Button, Skeleton, Tabs } from '../../components/ui';
import {
  DataTable,
  EmptyState,
  MessagePresenter,
  PageHeader,
  Panel,
  ReasonCodePrompt,
  StatusBadge,
  type Column,
} from '../../components/kit';
import type { TourStandingRow } from '@touch/core/tournaments';
import { EntriesPanel } from './EntriesPanel';
import { RoundsBoard } from './RoundsBoard';
import { shortName } from './roundsLogic';
import { TOUR_STATUS_TONE, pickName, refundsDue, tournamentErrorText } from './tournamentLogic';
import { readCancelAnswer, type TournamentDetail } from './tournamentPayloads';
import {
  invalidateTournamentCourts,
  useTournamentCaps,
  useTournamentDetail,
  useTournamentsLive,
} from './useTournaments';

type TabId = 'entries' | 'rounds' | 'standings';

/** The reasons a desk cancel offers (op.reasons). */
const CANCEL_REASONS = ['court_needed', 'customer_request', 'staff_error', 'other'] as const;

export function TournamentDetailScreen() {
  const { tr } = useLocale();
  const { id } = useParams({ strict: false }) as { id: string };
  const search = useSearch({ strict: false }) as { customer?: string };
  const navigate = useNavigate();
  const q = useTournamentDetail(id);
  useTournamentsLive();

  const header = (
    <PageHeader
      eyebrow={tr('ws.tournaments.detail.eyebrow')}
      title={tr('ws.tournaments.detail.eyebrow')}
    />
  );
  const notFound = (
    <div>
      {header}
      <EmptyState
        icon="trophy"
        title={tr('ws.tournaments.detail.notFound')}
        action={
          <Button onClick={() => void navigate({ to: '/desk/tournaments' })}>
            {tr('ws.tournaments.detail.backToList')}
          </Button>
        }
      />
    </div>
  );

  if (q.data === null) return notFound;
  if (q.data === undefined) {
    if (q.isError) {
      if (q.error instanceof AppRpcError && q.error.code === 'TOURNAMENT_NOT_FOUND')
        return notFound;
      return (
        <div>
          {header}
          <MessagePresenter
            tone="refused"
            icon="wifiOff"
            message={tournamentErrorText(q.error, tr)}
          />
          <Button
            size="sm"
            icon="refresh"
            onClick={() => void q.refetch()}
            style={{ marginBlockStart: 'var(--tp-sp-2)' }}
          >
            {tr('common.retry')}
          </Button>
        </div>
      );
    }
    return (
      <div>
        {header}
        <Skeleton lines={5} />
      </div>
    );
  }
  // The previous tournament's data while another one loads: wait for this one.
  if (q.data.id !== id) {
    return (
      <div>
        {header}
        <Skeleton lines={5} />
      </div>
    );
  }
  return (
    <TournamentBody
      detail={q.data}
      addCustomer={search.customer}
      onCustomerHandled={() =>
        void navigate({
          to: '/desk/tournaments/$id',
          params: { id },
          search: {} as never,
          replace: true,
        })
      }
      onRefetch={() => void q.refetch()}
    />
  );
}

function TournamentBody({
  detail: d,
  addCustomer,
  onCustomerHandled,
  onRefetch,
}: {
  detail: TournamentDetail;
  addCustomer?: string;
  onCustomerHandled: () => void;
  onRefetch: () => void;
}) {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const caps = useTournamentCaps();
  const { reachable } = useStationReach();
  const tz = d.timezone ?? VENUE_TZ;
  const [tab, setTab] = useState<TabId>(
    d.status === 'running' || d.status === 'finished' ? 'rounds' : 'entries',
  );
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const name = pickName(locale, d.name_en, d.name_ar);
  const registered = d.entries.filter((e) => e.status === 'registered').length;
  const refunds = refundsDue(d);

  async function cancel(code: string, note: string) {
    setBusy(true);
    setError(null);
    try {
      readCancelAnswer(
        await appRpc('tournament_cancel', {
          p_tournament_id: d.id,
          p_reason: note ? `${code}: ${note}` : code,
        }),
      );
      toast.ok(tr('ws.tournaments.cancel.done'));
      setCancelling(false);
      invalidateTournamentCourts(qc);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const facts: { label: string; value: string }[] = [
    {
      label: tr('ws.tournaments.detail.facts.format'),
      value: tr(`tournaments.common.format.${d.format}`),
    },
    {
      label: tr('ws.tournaments.detail.facts.category'),
      value: tr(`ws.matches.common.category.${d.category}`),
    },
    {
      label: tr('ws.tournaments.detail.facts.points'),
      value: formatNumber(d.points_target, locale),
    },
    {
      label: tr('ws.tournaments.detail.facts.rounds'),
      value:
        d.rounds_planned !== null
          ? formatNumber(d.rounds_planned, locale)
          : tr('ws.tournaments.detail.facts.roundsUnset'),
    },
    {
      label: tr('ws.tournaments.detail.facts.fee'),
      value:
        d.entry_fee_iqd > 0 ? formatIQD(d.entry_fee_iqd, locale) : tr('tournaments.common.free'),
    },
    {
      label: tr('ws.tournaments.detail.facts.players'),
      value: tr('ws.tournaments.list.entries', {
        registered: formatNumber(registered, locale),
        max: formatNumber(d.max_entries, locale),
      }),
    },
    {
      label: tr('ws.tournaments.detail.facts.cutoff'),
      value: d.registration_closes_at
        ? formatDateTime(new Date(d.registration_closes_at), locale, tz)
        : '—',
    },
    {
      label: tr('ws.tournaments.detail.facts.courts'),
      value:
        d.courts
          .map((c) => isolate(pickName(locale, c.name_en, c.name_ar)))
          .join(locale === 'ar' ? '، ' : ', ') || '—',
    },
  ];
  const prize = pickName(locale, d.prize_en, d.prize_ar);
  if (prize) facts.push({ label: tr('ws.tournaments.detail.facts.prize'), value: prize });

  const when =
    d.starts_at && d.ends_at
      ? `${formatDate(new Date(d.starts_at), locale, tz)} · ${formatTimeRange(new Date(d.starts_at), new Date(d.ends_at), locale, tz)}`
      : '';

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }} data-testid="tournament-detail">
      <PageHeader
        eyebrow={tr('ws.tournaments.detail.eyebrow')}
        title={isolate(name)}
        subtitle={when}
        actions={
          <span
            style={{
              display: 'flex',
              gap: 'var(--tp-sp-2)',
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <StatusBadge
              tone={TOUR_STATUS_TONE[d.status]}
              label={tr(`tournaments.common.status.${d.status}`)}
            />
            {d.starts_at && (
              <Button
                icon="calendar"
                onClick={() =>
                  void navigate({
                    to: '/desk',
                    search: {
                      date: new Date(d.starts_at).toLocaleDateString('en-CA', { timeZone: tz }),
                    } as never,
                  })
                }
              >
                {tr('ws.tournaments.detail.seeOnCalendar')}
              </Button>
            )}
            {caps.publishTournaments && d.can.cancel && (
              <Button
                kind="danger"
                icon="ban"
                disabled={!reachable}
                onClick={() => setCancelling(true)}
              >
                {tr('ws.tournaments.cancel.action')}
              </Button>
            )}
          </span>
        }
      />

      {d.status === 'cancelled' && d.cancel_reason && (
        <MessagePresenter
          tone="refused"
          message={tr(`ws.tournaments.detail.cancelled.${d.cancel_reason}`)}
        />
      )}
      {d.status === 'finished' && (
        <MessagePresenter tone="success" message={tr('ws.tournaments.detail.finished')} />
      )}
      {!reachable && (
        <MessagePresenter
          tone="info"
          icon="wifiOff"
          message={tr('ws.tournaments.detail.offline')}
        />
      )}

      <Panel>
        <dl
          style={{
            margin: 0,
            display: 'grid',
            gap: 'var(--tp-sp-2) var(--tp-sp-4)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))',
          }}
        >
          {facts.map((f) => (
            <div key={f.label} style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
              <dt style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
                {f.label}
              </dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>{f.value}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      {refunds.length > 0 && caps.publishTournaments && (
        <Panel title={tr('ws.tournaments.refundsDue.title')} data-testid="tournament-refunds-due">
          <p
            style={{
              marginBlockStart: 0,
              fontSize: 'var(--tp-fs-sm)',
              color: 'var(--tp-muted-fg)',
            }}
          >
            {tr('ws.tournaments.refundsDue.lead')}
          </p>
          <ul
            style={{
              margin: 0,
              paddingInlineStart: 'var(--tp-sp-4)',
              display: 'grid',
              gap: 'var(--tp-sp-1)',
            }}
          >
            {refunds.map((e) => (
              <li key={e.entry_id}>
                {tr('ws.tournaments.refundsDue.row', {
                  name: isolate(e.full_name),
                  amount: formatIQD(e.refund_due_iqd, locale),
                })}
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            icon="receipt"
            onClick={() => void navigate({ to: '/till/tabs' })}
            style={{ marginBlockStart: 'var(--tp-sp-2)' }}
          >
            {tr('ws.tournaments.refundsDue.openTill')}
          </Button>
        </Panel>
      )}

      <Tabs<TabId>
        value={tab}
        onChange={setTab}
        items={[
          { id: 'entries', label: tr('ws.tournaments.detail.tabs.entries'), count: registered },
          { id: 'rounds', label: tr('ws.tournaments.detail.tabs.rounds'), count: d.rounds.length },
          { id: 'standings', label: tr('ws.tournaments.detail.tabs.standings') },
        ]}
      />
      {tab === 'entries' && (
        <EntriesPanel
          detail={d}
          caps={caps}
          addCustomer={addCustomer}
          onCustomerHandled={onCustomerHandled}
          onRefetch={onRefetch}
        />
      )}
      {tab === 'rounds' && (
        <RoundsBoard detail={d} canRun={caps.runTournaments} onRefetch={onRefetch} />
      )}
      {tab === 'standings' && <StandingsTable detail={d} />}

      {cancelling && (
        <ReasonCodePrompt
          action={tr('ws.tournaments.cancel.action')}
          reasonCodes={CANCEL_REASONS}
          noteMode="optional"
          busy={busy}
          error={error}
          onCancel={() => {
            setCancelling(false);
            setError(null);
          }}
          onSubmit={(code, note) => void cancel(code, note)}
        >
          <p style={{ marginBlockStart: 0 }}>{tr('ws.tournaments.cancel.lead')}</p>
        </ReasonCodePrompt>
      )}
    </div>
  );
}

/** The standings, as the server ranked them (app.tournament_standings, TD-8). Read-only. */
export function StandingsTable({ detail: d }: { detail: TournamentDetail }) {
  const { tr, locale } = useLocale();
  const byId = new Map(d.entries.map((e) => [e.entry_id, e]));
  const n = (v: number) => formatNumber(v, locale);
  const nameOf = (id: string) => {
    const e = byId.get(id);
    return e
      ? shortName(e.full_name) || tr('tournaments.common.player', { no: String(e.seed_no ?? '?') })
      : '—';
  };
  const columns: Column<TourStandingRow>[] = [
    {
      key: 'rank',
      header: tr('ws.tournaments.standings.columns.rank'),
      width: '4rem',
      numeric: true,
      render: (s) => n(s.rank),
    },
    {
      key: 'player',
      header: tr('ws.tournaments.standings.columns.player'),
      truncateTitle: (s) => nameOf(s.entry_id),
      render: (s) => (
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)', alignItems: 'center' }}>
          <bdi>{nameOf(s.entry_id)}</bdi>
          {s.withdrawn && (
            <StatusBadge
              size="sm"
              tone="neutral"
              label={tr('ws.tournaments.standings.withdrawn')}
            />
          )}
        </span>
      ),
    },
    {
      key: 'won',
      header: tr('ws.tournaments.standings.columns.won'),
      numeric: true,
      render: (s) => n(s.points_won),
    },
    {
      key: 'against',
      header: tr('ws.tournaments.standings.columns.against'),
      numeric: true,
      render: (s) => n(s.points_against),
    },
    {
      key: 'diff',
      header: tr('ws.tournaments.standings.columns.diff'),
      numeric: true,
      render: (s) => <bdi dir="ltr">{s.diff > 0 ? `+${s.diff}` : String(s.diff)}</bdi>,
    },
    {
      key: 'h2h',
      header: tr('ws.tournaments.standings.columns.h2h'),
      numeric: true,
      render: (s) => n(s.h2h),
    },
    {
      key: 'played',
      header: tr('ws.tournaments.standings.columns.played'),
      numeric: true,
      render: (s) => n(s.played),
    },
    {
      key: 'satOut',
      header: tr('ws.tournaments.standings.columns.satOut'),
      numeric: true,
      render: (s) => n(s.sat_out),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={d.standings}
      rowKey={(s) => s.entry_id}
      dense
      aria-label={tr('ws.tournaments.standings.title')}
      emptyContent={
        <span style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.tournaments.standings.empty')}</span>
      }
    />
  );
}
