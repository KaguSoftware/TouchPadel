/**
 * `/desk/tournaments` (docs/design/tournaments/build-contracts-2026-10-03.md
 * §1.6 desk_tournaments; plan §5.1 "Routes"): the branch's tournaments from
 * yesterday to two months ahead, each opening `/desk/tournaments/$id`.
 * Publishing happens on the protocol run ("Publish as tournament"); "Add
 * tournament" opens that protocol's start form (addTournament.ts). With the
 * branch's switch off the list says so.
 *
 * Laid out as cards (2026-10-05 redesign, option D): the totals, a status
 * filter, then one card per tournament with its date tile, status, format and
 * how full it is. Figures in layoutLogic.ts.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { VENUE_TZ, countPhrase, formatDate, formatNumber, formatTimeRange } from '@touch/i18n';
import { TOUR_STATUSES } from '@touch/core/tournaments';
import { useLocale } from '../../lib/i18n';
import { useQuery } from '@tanstack/react-query';
import { QK, fetchVenueSettings } from '../../lib/queries';
import { useAuth } from '../../lib/auth';
import { Button, Skeleton } from '../../components/ui';
import {
  EmptyState,
  HeadlineFigure,
  MessagePresenter,
  PageHeader,
  StatusBadge,
} from '../../components/kit';
import { TOUR_STATUS_TONE, pickName, tournamentErrorText } from './tournamentLogic';
import type { DeskTournament } from './tournamentPayloads';
import { useDeskTournaments } from './useTournaments';
import { addTournamentTarget } from './addTournament';
import { fillPercent, filterTournaments, listTotals, type ListFilter } from './layoutLogic';
import { DateTile, FillBar } from './TournamentParts';

const DAY = 86_400_000;

/** The list's window: from the start of yesterday (UTC) for 62 days. */
export function listWindow(nowMs: number): { from: Date; to: Date } {
  const start = Math.floor(nowMs / DAY) * DAY - DAY;
  return { from: new Date(start), to: new Date(start + 62 * DAY) };
}

const FILTERS: readonly ListFilter[] = ['all', ...TOUR_STATUSES];

export function TournamentsListScreen() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const { staff } = useAuth();
  const addTournament = addTournamentTarget(staff?.role);
  // One window per mount: the clock moving does not re-key the query.
  const win = useMemo(() => listWindow(Date.now()), []);
  const q = useDeskTournaments(win.from, win.to);
  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings });
  const tz = settingsQ.data?.timezone ?? VENUE_TZ;
  const [filter, setFilter] = useState<ListFilter>('all');
  const open = (t: DeskTournament) =>
    void navigate({ to: '/desk/tournaments/$id', params: { id: t.id } });
  const n = (v: number) => formatNumber(v, locale);

  const data = q.data;
  const all = data?.tournaments ?? [];
  const totals = listTotals(all);
  const shown = filterTournaments(all, filter);

  return (
    <div data-testid="tournaments-list" style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
      <PageHeader
        title={tr('ws.tournaments.list.title')}
        subtitle={tr('ws.tournaments.list.lead')}
        actions={
          addTournament && (
            <Button
              kind="primary"
              icon="plus"
              onClick={() => void navigate(addTournament as never)}
            >
              {tr('ws.tournaments.list.add')}
            </Button>
          )
        }
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
        <>
          {!data.tournaments_enabled && (
            <MessagePresenter tone="info" message={tr('ws.tournaments.list.off')} />
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))',
              gap: 'var(--tp-sp-3)',
            }}
          >
            {(
              [
                ['upcoming', totals.upcoming],
                ['running', totals.running],
                ['players', totals.players],
                ['waitlisted', totals.waitlisted],
              ] as const
            ).map(([key, value]) => (
              // HeadlineFigure wears the figure colours by place: blue, green, black, light blue.
              <HeadlineFigure
                key={key}
                label={tr(`ws.tournaments.list.totals.${key}`)}
                value={n(value)}
              />
            ))}
          </div>

          <div
            style={{
              display: 'flex',
              gap: 'var(--tp-sp-2)',
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <div
              role="group"
              aria-label={tr('ws.tournaments.list.filters')}
              style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}
            >
              {FILTERS.map((f) => {
                const on = filter === f;
                const label =
                  f === 'all'
                    ? tr('ws.tournaments.list.all')
                    : tr(`tournaments.common.status.${f}`);
                return (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setFilter(f)}
                    className="tp-tour-chip"
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {/* How many the chosen chip shows, at the end of the row. */}
            <span
              aria-live="polite"
              style={{
                marginInlineStart: 'auto',
                fontSize: 'var(--tp-fs-sm)',
                color: 'var(--tp-muted-fg)',
              }}
            >
              {countPhrase('ws.tournaments.list.count', shown.length, locale)}
            </span>
          </div>

          {shown.length === 0 ? (
            <EmptyState
              compact
              icon="trophy"
              title={tr('ws.tournaments.list.empty')}
              body={filter === 'all' ? tr('ws.tournaments.list.emptyHint') : undefined}
            />
          ) : (
            <ul
              aria-label={tr('ws.tournaments.list.title')}
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'grid',
                // At most three to a row; fewer once a card would drop under 20rem.
                gridTemplateColumns:
                  'repeat(auto-fill, minmax(max(20rem, calc((100% - 2 * var(--tp-sp-4)) / 3)), 1fr))',
                gap: 'var(--tp-sp-4)',
              }}
            >
              {shown.map((t) => (
                <li key={t.id} style={{ display: 'flex' }}>
                  <TournamentCard t={t} tz={tz} onOpen={() => open(t)} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function TournamentCard({ t, tz, onOpen }: { t: DeskTournament; tz: string; onOpen: () => void }) {
  const { tr, locale } = useLocale();
  const name = pickName(locale, t.name_en, t.name_ar);
  const over = t.status === 'finished' || t.status === 'cancelled';
  const tag = (label: string) => (
    <span
      style={{
        fontSize: 'var(--tp-fs-xs)',
        fontWeight: 600,
        padding: 'var(--tp-sp-1) var(--tp-sp-2-5)',
        lineHeight: 1.2,
        borderRadius: 'var(--tp-radius-pill)',
        background: 'var(--tp-surface-2)',
        color: 'var(--tp-fg)',
      }}
    >
      {label}
    </span>
  );
  return (
    <button
      type="button"
      onClick={onOpen}
      className="tp-tour-card"
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        textAlign: 'start',
        padding: 0,
        font: 'inherit',
        color: 'var(--tp-fg)',
        background: 'var(--tp-surface)',
        border: '1px solid var(--tp-border)',
        borderRadius: 'var(--tp-radius-dialog)',
        overflow: 'hidden',
        cursor: 'pointer',
      }}
    >
      <span
        style={{
          display: 'flex',
          gap: 'var(--tp-sp-3)',
          alignItems: 'flex-start',
          padding: 'var(--tp-sp-4) var(--tp-sp-4) var(--tp-sp-3)',
          inlineSize: '100%',
          boxSizing: 'border-box',
        }}
      >
        <DateTile at={t.starts_at} tz={tz} status={t.status} />
        <span
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 'var(--tp-sp-1-5)',
            minInlineSize: 0,
            flex: 1,
          }}
        >
          <StatusBadge
            size="sm"
            tone={TOUR_STATUS_TONE[t.status]}
            label={tr(`tournaments.common.status.${t.status}`)}
          />
          <bdi
            title={name}
            style={{
              fontSize: 'var(--tp-fs-xl)',
              fontWeight: 700,
              lineHeight: 1.3,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              overflowWrap: 'anywhere',
            }}
          >
            {name}
          </bdi>
          {t.starts_at && t.ends_at && (
            <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
              {/* The day too: the date tile is aria-hidden, so this line carries it for a screen reader. */}
              {`${formatDate(new Date(t.starts_at), locale, tz)} · ${formatTimeRange(new Date(t.starts_at), new Date(t.ends_at), locale, tz)}`}
            </span>
          )}
          <span
            style={{
              display: 'flex',
              gap: 'var(--tp-sp-1-5)',
              flexWrap: 'wrap',
              marginBlockStart: 'var(--tp-sp-1)',
            }}
          >
            {tag(tr(`tournaments.common.format.${t.format}`))}
            {tag(tr(`ws.matches.common.category.${t.category}`))}
          </span>
        </span>
      </span>
      <span
        style={{
          display: 'grid',
          gap: 'var(--tp-sp-2)',
          padding: 'var(--tp-sp-3) var(--tp-sp-4)',
          borderBlockStart: '1px solid var(--tp-border)',
          inlineSize: '100%',
          boxSizing: 'border-box',
          marginBlockStart: 'auto',
        }}
      >
        <span
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 'var(--tp-sp-2)',
            fontSize: 'var(--tp-fs-sm)',
          }}
        >
          <span>
            {tr('ws.tournaments.list.entries', {
              registered: formatNumber(t.registered, locale),
              max: formatNumber(t.max_entries, locale),
            })}
          </span>
          {t.waitlisted > 0 && (
            <span style={{ color: 'var(--tp-muted-fg)' }}>
              {tr('ws.tournaments.list.waitlisted', { count: formatNumber(t.waitlisted, locale) })}
            </span>
          )}
        </span>
        <FillBar
          decorative
          percent={fillPercent(t.registered, t.max_entries)}
          color={
            t.status === 'running'
              ? 'var(--tp-accent-2)'
              : over
                ? 'var(--tp-border-strong)'
                : 'var(--tp-accent)'
          }
        />
      </span>
    </button>
  );
}
