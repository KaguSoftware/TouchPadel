/**
 * The Today board's "Open matches needing players" group
 * (docs/design/open-matches/operator.md §5.9): the night's filling and
 * waiting matches, and booked ones with a free seat, by start
 * (matchLogic.needsPlayersRows). Pure presentation: data in, events out.
 *
 * States:
 *  - matches off, none listed: hidden;
 *  - matches off, some listed (R10): the rows, and a line saying new matches
 *    are off while these carry on (Add player stays: the desk can still add
 *    seats);
 *  - matches on, none tonight: "No open matches tonight" and Start;
 *  - a failed read: the §5.5 notice with Retry; RPC_MISSING: hidden.
 *
 * Every write it leads to is online only (DF-11): offline, Start and Add
 * player stay on screen, disabled, with the reason.
 */
import type { ReactNode } from 'react';
import { formatNumber, formatTime, formatTimeRange, type MessageKey } from '@touch/i18n';
import { Button } from '../../components/ui';
import { Panel, StatusBadge, ViewMore, useListCap, type Tone } from '../../components/kit';
import { Icon } from '../../components/icons';
import { useLocale } from '../../lib/i18n';
import { MATCH_SEATS, matchTone, needsPlayersRows, type MatchReadStatus, type NeedsPlayersTag } from './matchLogic';
import { MatchReadNotice } from './MatchReadNotice';
import { categoryKey } from './OpenMatchesStrip';
import type { OpenMatches } from './matchPayloads';

const TAGS: Record<NeedsPlayersTag, { key: MessageKey; tone: Tone }> = {
  approve: { key: 'ws.matches.common.tag.approve', tone: 'neutral' },
  link: { key: 'ws.matches.common.tag.link', tone: 'neutral' },
  lastCourt: { key: 'ws.matches.today.lastCourt', tone: 'warn' },
  waitingCourt: { key: 'ws.matches.common.status.awaiting_court', tone: 'warn' },
  bookedSeatFree: { key: 'ws.matches.today.bookedSeatFree', tone: 'info' },
};

export interface NeedsPlayersPanelProps {
  status: MatchReadStatus<OpenMatches>;
  tz: string;
  /** CAPABILITY_ROLES.runMatches: Start and Add player. */
  runMatches: boolean;
  /** The station reaches the server (lib/stationReach): every match write is online only. */
  reachable: boolean;
  onAddPlayer: (matchId: string) => void;
  onOpenMatch: (matchId: string) => void;
  onStartMatch: () => void;
  /** The page lists any day, and starting happens on the calendar: no Start button. */
  hideStart?: boolean;
  /** Courts › Open matches: one coloured card per match instead of the Today board's rows. */
  cards?: boolean;
  onRetry: () => void;
}

export function NeedsPlayersPanel(p: NeedsPlayersPanelProps) {
  const { tr, locale } = useLocale();
  const title = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
      <Icon name="users" size={16} style={{ color: 'var(--tp-muted-fg)' }} />
      {tr('ws.matches.today.title')}
    </span>
  );
  const offline = p.reachable ? undefined : tr('ws.matches.offline.needsConnection');
  const rows = p.status.kind === 'ready' ? needsPlayersRows(p.status.data) : [];
  const cap = useListCap(rows);

  if (p.status.kind === 'failed') {
    return (
      <Panel title={title}>
        <MatchReadNotice status={p.status} onRetry={p.onRetry} tz={p.tz} />
      </Panel>
    );
  }
  if (p.status.kind !== 'ready') return null;

  const open = p.status.data;
  const enabled = open.matches_enabled;
  if (!enabled && rows.length === 0) return null;

  const start =
    enabled && p.runMatches && !p.hideStart ? (
      <Button size="sm" kind="primary" icon="plus" disabled={!p.reachable} disabledReason={offline} onClick={p.onStartMatch}>
        {tr('ws.matches.today.startMatch')}
      </Button>
    ) : undefined;

  if (p.cards) {
    return (
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
        <MatchReadNotice status={p.status} onRetry={p.onRetry} tz={p.tz} compact />
        {!enabled && <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.matches.today.off')}</p>}
        {rows.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--tp-muted-fg)' }}>{tr('ws.matches.today.none')}</p>
        ) : (
          <ul aria-label={tr('ws.matches.today.title')} className="tp-match-grid">
            {cap.shown.map((row) => {
              const m = row.match;
              const when = formatTimeRange(new Date(m.start_at), new Date(m.end_at), locale, p.tz);
              const organiser = m.organiser?.full_name ?? tr('ws.matches.common.openMatch');
              return (
                <li key={m.match_id} className="tp-match-card tp-tone" data-tone={matchTone(m.match_id)} data-testid={`match-card-${m.match_id}`}>
                  <span className="tp-branch-band">
                    <strong>
                      <bdi>{organiser}</bdi>
                    </strong>
                    <StatusBadge size="sm" tone="accent" dot={false} label={tr(categoryKey(m.category))} />
                  </span>
                  <span className="tp-branch-body">
                    <span className="tp-strip-tiles">
                      <span className="tp-strip-tile">
                        <span className="tp-strip-tile-band">{tr('ws.matches.today.tilePlayers')}</span>
                        <span className="tp-strip-tile-value">
                          {row.taken === null ? '—' : formatNumber(row.taken, locale)}/{formatNumber(MATCH_SEATS, locale)}
                        </span>
                      </span>
                      <span className="tp-strip-tile">
                        <span className="tp-strip-tile-band">{tr('ws.matches.today.tileStarts')}</span>
                        <span className="tp-strip-tile-value">
                          <bdi>{formatTime(new Date(m.start_at), locale, p.tz)}</bdi>
                        </span>
                      </span>
                    </span>
                    <span className="tp-match-lines">
                      <bdi>{when}</bdi>
                      {row.requests > 0 && <span>{tr('ws.matches.today.requests', { count: formatNumber(row.requests, locale) })}</span>}
                      {row.deadlineAt && (
                        <Figure warn={row.deadlineWarn}>{tr('ws.matches.today.closes', { time: formatTime(new Date(row.deadlineAt), locale, p.tz) })}</Figure>
                      )}
                    </span>
                    {row.tags.length > 0 && (
                      <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}>
                        {row.tags.map((tag) => (
                          <StatusBadge key={tag} size="sm" tone={TAGS[tag].tone} label={tr(TAGS[tag].key)} />
                        ))}
                      </span>
                    )}
                    <span className="tp-match-actions">
                      {p.runMatches && row.canAddPlayer && (
                        <Button
                          size="sm"
                          icon="plus"
                          disabled={!p.reachable}
                          disabledReason={offline}
                          onClick={() => p.onAddPlayer(m.match_id)}
                          aria-label={`${tr('ws.matches.today.addPlayer')} ${when}`}
                        >
                          {tr('ws.matches.today.addPlayer')}
                        </Button>
                      )}
                      <Button size="sm" kind="primary" className="tp-match-end" onClick={() => p.onOpenMatch(m.match_id)} aria-label={`${tr('ws.matches.today.open')} ${when}`}>
                        {tr('ws.matches.today.open')}
                      </Button>
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} style={{ marginBlockStart: 0 }} />
      </div>
    );
  }

  return (
    <Panel title={title} actions={start}>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
        <MatchReadNotice status={p.status} onRetry={p.onRetry} tz={p.tz} compact />
        {!enabled && <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.matches.today.off')}</p>}
        {rows.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--tp-muted-fg)' }}>{tr('ws.matches.today.none')}</p>
        ) : (
          <ul aria-label={tr('ws.matches.today.title')} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
            {cap.shown.map((row) => {
              const m = row.match;
              const when = formatTimeRange(new Date(m.start_at), new Date(m.end_at), locale, p.tz);
              // In its own <bdi>: the element isolates the name.
              const organiser = m.organiser?.full_name ?? tr('ws.matches.common.openMatch');
              return (
                <li
                  key={m.match_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--tp-sp-3)',
                    flexWrap: 'wrap',
                    paddingBlock: 'var(--tp-sp-2)',
                    paddingInline: 'var(--tp-sp-3)',
                    borderRadius: 'var(--tp-radius-ctl)',
                    background: 'var(--tp-surface-2)',
                  }}
                >
                  <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: '8rem' }}>
                    <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                      <bdi>{when}</bdi>
                    </strong>
                    <span>
                      <StatusBadge size="sm" tone="accent" dot={false} label={tr(categoryKey(m.category))} />
                    </span>
                  </span>
                  <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', flex: '1 1 14rem', minInlineSize: 0 }}>
                    <strong>
                      <bdi>{organiser}</bdi>
                    </strong>
                    <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1) var(--tp-sp-3)', flexWrap: 'wrap', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                      <Figure>
                        {tr('ws.matches.today.players', {
                          taken: row.taken === null ? '—' : formatNumber(row.taken, locale),
                          total: formatNumber(MATCH_SEATS, locale),
                        })}
                      </Figure>
                      {row.requests > 0 && <Figure>{tr('ws.matches.today.requests', { count: formatNumber(row.requests, locale) })}</Figure>}
                      {row.deadlineAt && (
                        <Figure warn={row.deadlineWarn}>{tr('ws.matches.today.closes', { time: formatTime(new Date(row.deadlineAt), locale, p.tz) })}</Figure>
                      )}
                    </span>
                    {row.tags.length > 0 && (
                      <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}>
                        {row.tags.map((tag) => (
                          <StatusBadge key={tag} size="sm" tone={TAGS[tag].tone} label={tr(TAGS[tag].key)} />
                        ))}
                      </span>
                    )}
                  </span>
                  <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)', alignItems: 'center', marginInlineStart: 'auto' }}>
                    {p.runMatches && row.canAddPlayer && (
                      <Button
                        size="sm"
                        icon="plus"
                        disabled={!p.reachable}
                        disabledReason={offline}
                        onClick={() => p.onAddPlayer(m.match_id)}
                        aria-label={`${tr('ws.matches.today.addPlayer')} ${when}`}
                      >
                        {tr('ws.matches.today.addPlayer')}
                      </Button>
                    )}
                    <Button size="sm" kind="ghost" iconEnd="chevronEnd" onClick={() => p.onOpenMatch(m.match_id)} aria-label={`${tr('ws.matches.today.open')} ${when}`}>
                      {tr('ws.matches.today.open')}
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} style={{ marginBlockStart: 0 }} />
      </div>
    </Panel>
  );
}

function Figure({ children, warn }: { children: ReactNode; warn?: boolean }) {
  return <span style={{ color: warn ? 'var(--tp-warn-fg)' : undefined, fontWeight: warn ? 600 : undefined, fontVariantNumeric: 'tabular-nums' }}>{children}</span>;
}
