/**
 * "Wages due" on the management panel (0271): the owner's pay-day reminder.
 * The wages whose pay day is within the reminder window or past, earliest
 * first, three and then View more, and the way to the Wages page. It reads the rail badge's
 * own key (QK.wagesDue), so the two always agree.
 *
 * Quiet by design: nothing at zero, nothing on an error (the badge and the
 * page say the rest). It never asks who is signed in: the panel is the owner's
 * route, and the server refuses anyone else.
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { QK } from '../../lib/queryKeys';
import { useLocale } from '../../lib/i18n';
import { Button } from '../../components/ui';
import { Money, Panel, StatusBadge, ViewMore, useListCap } from '../../components/kit';
import { CardTitle } from '../ops/OpsVisuals';
import { monthLabel } from '../deductions/venueDate';
import { fetchWagesDue } from './api';
import { readWagesDue, wageTone } from './wagesLogic';
import { DueWhenText } from './DueWhenText';

export function WagesDueCard() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: QK.wagesDue, queryFn: fetchWagesDue, refetchInterval: 60_000 });
  const due = readWagesDue(q.data);
  const cap = useListCap(due.people);
  if (!q.isSuccess) return null;
  if (due.count === 0 || due.people.length === 0) return null;

  return (
    <Panel
      data-testid="wages.due-card"
      title={<CardTitle icon="banknote">{tr('ws.wages.card.title')}</CardTitle>}
      actions={
        <Button size="sm" kind="ghost" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/wages' })}>
          {tr('ws.wages.card.open')}
        </Button>
      }
      style={{ marginBlockEnd: 'var(--tp-sp-4)' }}
    >
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
        {cap.shown.map((r) => (
          <li
            key={`${r.staffId}:${r.month}`}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 'var(--tp-sp-3)',
              flexWrap: 'wrap',
              paddingBlock: 'var(--tp-sp-2)',
              borderBlockEnd: '1px solid var(--tp-border)',
              fontSize: 'var(--tp-fs-sm)',
            }}
          >
            <bdi style={{ fontWeight: 600, minInlineSize: '8rem' }}>{r.displayName}</bdi>
            <span style={{ color: 'var(--tp-muted-fg)' }}>{monthLabel(r.month, locale)}</span>
            <StatusBadge size="sm" tone={wageTone(r.status)} label={tr(`ws.wages.status.${r.status}`)} />
            <DueWhenText daysLeft={r.daysLeft} />
            <Money amount={r.netIqd} strong style={{ marginInlineStart: 'auto', whiteSpace: 'nowrap' }} />
          </li>
        ))}
      </ul>
      <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} />
    </Panel>
  );
}
