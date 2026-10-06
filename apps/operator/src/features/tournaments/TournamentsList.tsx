/**
 * `/desk/tournaments` (docs/design/tournaments/build-contracts-2026-10-03.md
 * §1.6 desk_tournaments; plan §5.1 "Routes"): the branch's tournaments from
 * yesterday to two months ahead, each opening `/desk/tournaments/$id`.
 * Publishing happens on the protocol run ("Publish as tournament"), so the
 * list has no create button; with the branch's switch off it says so.
 */
import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { VENUE_TZ, formatDate, formatNumber, formatTimeRange } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { useQuery } from '@tanstack/react-query';
import { QK, fetchVenueSettings } from '../../lib/queries';
import { Button, Skeleton } from '../../components/ui';
import {
  DataTable,
  EmptyState,
  MessagePresenter,
  PageHeader,
  StatusBadge,
  type Column,
} from '../../components/kit';
import { TOUR_STATUS_TONE, pickName, tournamentErrorText } from './tournamentLogic';
import type { DeskTournament } from './tournamentPayloads';
import { useDeskTournaments } from './useTournaments';

const DAY = 86_400_000;

/** The list's window: from the start of yesterday (UTC) for 62 days. */
export function listWindow(nowMs: number): { from: Date; to: Date } {
  const start = Math.floor(nowMs / DAY) * DAY - DAY;
  return { from: new Date(start), to: new Date(start + 62 * DAY) };
}

export function TournamentsListScreen() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  // One window per mount: the clock moving does not re-key the query.
  const win = useMemo(() => listWindow(Date.now()), []);
  const q = useDeskTournaments(win.from, win.to);
  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings });
  const tz = settingsQ.data?.timezone ?? VENUE_TZ;
  const open = (t: DeskTournament) =>
    void navigate({ to: '/desk/tournaments/$id', params: { id: t.id } });

  const columns: Column<DeskTournament>[] = [
    {
      key: 'name',
      header: tr('ws.tournaments.list.columns.name'),
      truncateTitle: (t) => pickName(locale, t.name_en, t.name_ar),
      render: (t) => (
        <bdi style={{ fontWeight: 600 }}>{pickName(locale, t.name_en, t.name_ar)}</bdi>
      ),
    },
    {
      key: 'when',
      header: tr('ws.tournaments.list.columns.when'),
      render: (t) =>
        t.starts_at && t.ends_at
          ? `${formatDate(new Date(t.starts_at), locale, tz)} · ${formatTimeRange(new Date(t.starts_at), new Date(t.ends_at), locale, tz)}`
          : '—',
    },
    {
      key: 'format',
      header: tr('ws.tournaments.list.columns.format'),
      render: (t) =>
        `${tr(`tournaments.common.format.${t.format}`)} · ${tr(`ws.matches.common.category.${t.category}`)}`,
    },
    {
      key: 'entries',
      header: tr('ws.tournaments.list.columns.entries'),
      render: (t) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
          <span>
            {tr('ws.tournaments.list.entries', {
              registered: formatNumber(t.registered, locale),
              max: formatNumber(t.max_entries, locale),
            })}
          </span>
          {t.waitlisted > 0 && (
            <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
              {tr('ws.tournaments.list.waitlisted', { count: formatNumber(t.waitlisted, locale) })}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'status',
      header: tr('ws.tournaments.list.columns.status'),
      render: (t) => (
        <StatusBadge
          size="sm"
          tone={TOUR_STATUS_TONE[t.status]}
          label={tr(`tournaments.common.status.${t.status}`)}
        />
      ),
    },
    {
      key: 'open',
      header: '',
      align: 'end',
      render: (t) => (
        <Button size="sm" onClick={() => open(t)}>
          {tr('ws.tournaments.list.open')}
        </Button>
      ),
    },
  ];

  const data = q.data;
  return (
    <div data-testid="tournaments-list">
      <PageHeader
        title={tr('ws.tournaments.list.title')}
        subtitle={tr('ws.tournaments.list.lead')}
      />
      {data === undefined && !q.isError && <Skeleton lines={4} />}
      {data === undefined && q.isError && (
        <MessagePresenter
          tone="refused"
          icon="wifiOff"
          message={tournamentErrorText(q.error, tr)}
        />
      )}
      {data === null && <EmptyState icon="trophy" title={tr('ws.tournaments.list.off')} />}
      {data && (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
          {!data.tournaments_enabled && (
            <MessagePresenter tone="info" message={tr('ws.tournaments.list.off')} />
          )}
          <DataTable
            columns={columns}
            rows={data.tournaments}
            rowKey={(t) => t.id}
            onRowClick={open}
            aria-label={tr('ws.tournaments.list.title')}
            emptyContent={
              <EmptyState
                compact
                icon="trophy"
                title={tr('ws.tournaments.list.empty')}
                body={tr('ws.tournaments.list.emptyHint')}
              />
            }
          />
        </div>
      )}
    </div>
  );
}
