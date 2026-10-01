/**
 * The calendar's strip of the night's open matches that hold no court yet
 * (docs/design/open-matches/operator.md §5.8): a filling match has no
 * reservation, so no court column can show it. One chip per `filling` or
 * `awaiting_court` match, by start, each a link to its screen:
 * "21:00–22:30 · Women · 3/4 · closes 19:00", or "… · 4/4 · waiting for a
 * court" in the warn tone.
 *
 * Day view only, mounted after the book-for strip. Hidden when there are none,
 * when matches are off, and when the server has no matches (RPC_MISSING); a
 * failed first read is one muted line (§5.5), and data kept from an earlier
 * read carries "Last updated".
 */
import { Link } from '@tanstack/react-router';
import { formatTime, formatTimeRange, isolateLtr, type MessageKey } from '@touch/i18n';
import { Icon } from '../../components/icons';
import { useLocale } from '../../lib/i18n';
import { MATCH_SEATS, type MatchReadStatus } from './matchLogic';
import { MatchReadNotice } from './MatchReadNotice';
import type { OpenMatch, OpenMatches } from './matchPayloads';

/** The strip's matches: waiting for players or for a court, by start. */
export function stripMatches(open: OpenMatches | null | undefined): OpenMatch[] {
  if (!open || !open.matches_enabled) return [];
  return open.matches
    .filter((m) => m.status === 'filling' || m.status === 'awaiting_court')
    .sort((a, b) => a.start_at.localeCompare(b.start_at) || a.match_id.localeCompare(b.match_id));
}

export function categoryKey(category: string): MessageKey {
  return category === 'women' ? 'ws.matches.common.category.women' : category === 'men' ? 'ws.matches.common.category.men' : 'ws.matches.common.category.open';
}

/** "3/4", LTR-isolated; "—" when the server did not say. */
export function fillText(taken: number | null | undefined): string {
  return typeof taken === 'number' ? isolateLtr(`${taken}/${MATCH_SEATS}`) : '—';
}

export function OpenMatchesStrip({ status, onRetry, tz }: { status: MatchReadStatus<OpenMatches>; onRetry: () => void; tz: string }) {
  const { tr, locale } = useLocale();
  if (status.kind === 'failed') return <MatchReadNotice status={status} onRetry={onRetry} tz={tz} compact />;
  if (status.kind !== 'ready') return null;
  const matches = stripMatches(status.data);
  if (matches.length === 0) return null;
  return (
    <nav
      aria-label={tr('ws.matches.calendar.strip')}
      style={{ display: 'grid', gap: 'var(--tp-sp-1)', flexShrink: 0, marginBlockEnd: 'var(--tp-sp-3)' }}
    >
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-2)' }}>
        {matches.map((m) => {
          const awaiting = m.status === 'awaiting_court';
          const params = {
            time: formatTimeRange(new Date(m.start_at), new Date(m.end_at), locale, tz),
            category: tr(categoryKey(m.category)),
            fill: fillText(m.seats_taken),
            deadline: m.fill_deadline_at ? formatTime(new Date(m.fill_deadline_at), locale, tz) : '—',
          };
          const text = awaiting
            ? tr('ws.matches.calendar.stripAwaiting', params)
            : m.fill_deadline_at
              ? tr('ws.matches.calendar.stripChip', params)
              : tr('ws.matches.calendar.stripChipOpen', params);
          return (
            <li key={m.match_id}>
              <Link
                to="/desk/matches/$id"
                params={{ id: m.match_id }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--tp-sp-1)',
                  paddingBlock: 'var(--tp-sp-1)',
                  paddingInline: 'var(--tp-sp-2)',
                  borderRadius: 'var(--tp-radius-pill)',
                  border: `1px solid ${awaiting ? 'var(--tp-warn)' : 'var(--tp-border)'}`,
                  background: awaiting ? 'var(--tp-warn-soft)' : 'var(--tp-surface)',
                  color: awaiting ? 'var(--tp-warn-fg)' : 'var(--tp-fg)',
                  fontSize: 'var(--tp-fs-sm)',
                  fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums',
                  textDecoration: 'none',
                }}
              >
                <Icon name="users" size={14} />
                <bdi>{text}</bdi>
              </Link>
            </li>
          );
        })}
      </ul>
      <MatchReadNotice status={status} onRetry={onRetry} tz={tz} compact />
    </nav>
  );
}
