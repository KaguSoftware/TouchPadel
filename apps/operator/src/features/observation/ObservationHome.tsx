/**
 * Observation home (/observation) — the landing screen of Management's
 * Observation section.
 *
 * The cards run from the shortest horizon outwards: right now, the pattern
 * over time, the three records you inspect, the two things waiting on you, and
 * the audit trail you reach for when one of the others raised a question.
 *
 * Above them sits WHAT IS WAITING ON A DECISION. This is the one part of
 * Management that is not a reading — a staff request sits unanswered until the
 * owner acts, and unlike an unclosed day or a stock alert nothing else in the
 * venue will surface it. So it is stated at the top with a count and a way in,
 * and when the queue is empty it says so plainly rather than disappearing: a
 * strip that vanishes when it is empty cannot be trusted to appear when it is
 * not.
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatNumber } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { SectionHome } from '../../components/SectionHome';
import { Button } from '../../components/ui';
import { Panel } from '../../components/kit';
import { Icon } from '../../components/icons';
import { REQUESTS_QUERY_KEY, type StaffRequestsPage } from './requestTypes';

type CardKey =
  | 'floorNow' | 'patterns' | 'bookings' | 'tills'
  | 'staffActivity' | 'requests' | 'marketing' | 'audit';

export function ObservationHomeScreen() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();

  const pendingQ = useQuery({
    queryKey: [...REQUESTS_QUERY_KEY, 'pending-count'],
    queryFn: () => appRpc<StaffRequestsPage>('staff_requests_page', { p_status: 'pending', p_limit: 1, p_offset: 0 }),
    refetchInterval: 60_000,
  });
  const pending = pendingQ.data?.pending ?? 0;

  return (
    <SectionHome
      sectionKey="observation"
      title={tr('ws.owner.observationHome.title')}
      lead={tr('ws.owner.observationHome.lead')}
      card={(key) => tr(`ws.owner.observationHome.cards.${key as CardKey}`)}
    >
      <Panel title={tr('ws.owner.observationHome.waiting.title')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-3)', flexWrap: 'wrap' }}>
          <span
            style={{
              display: 'inline-flex',
              inlineSize: '2rem',
              blockSize: '2rem',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '50%',
              background: pending > 0 ? 'var(--tp-warn-bg)' : 'var(--tp-rail)',
              color: pending > 0 ? 'var(--tp-warn-fg)' : 'var(--tp-rail-green)',
            }}
          >
            <Icon name={pending > 0 ? 'bell' : 'check'} size={16} />
          </span>
          <span style={{ flex: 1, minInlineSize: 0, fontWeight: pending > 0 ? 600 : 400 }}>
            {pendingQ.isPending
              ? '—'
              : pending === 0
                ? tr('ws.owner.observationHome.waiting.none')
                : tr(
                    pending === 1
                      ? 'ws.owner.observationHome.waiting.requests'
                      : 'ws.owner.observationHome.waiting.requestsPlural',
                    { count: formatNumber(pending, locale) },
                  )}
          </span>
          {pending > 0 && (
            <Button size="sm" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/observation/requests' })}>
              {tr('ws.owner.observationHome.waiting.open')}
            </Button>
          )}
        </div>
      </Panel>
      <div style={{ blockSize: 'var(--tp-sp-4)' }} />
    </SectionHome>
  );
}
