/**
 * The till's "Scanned orders" (Phase 2 Milestone 4b; 0238/0239). A waiter
 * photographs a handwritten order slip on the staff phone; it lands here live
 * (the `order_slip` event on the floor topic, which TillScreen subscribes to
 * and which invalidates SLIPS_KEY; the 30 s refetch is the safety net), is read
 * by the connected model and matched to the menu, and the cashier opens it
 * (SlipReview.tsx) to check it against the photo and send it to the kitchen.
 *
 * Two layouts, like WaiterCallsPanel: `aside` on the floor view lists every
 * slip still to send, then those sent or set aside today under a fold; `strip`
 * on the order view is one line with the count and the oldest slip's Open. It
 * renders nothing while there is nothing to show. The pure half is
 * slipLogic.ts.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDateTime, formatNumber, isolate } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { useLocale } from '../../../lib/i18n';
import { Button, ErrorText } from '../../../components/ui';
import { Panel, StatusBadge, type Tone } from '../../../components/kit';
import { CardTitle } from '../../ops/OpsVisuals';
import { SLIPS_KEY, SlipReview } from './SlipReview';
import { isWaiting, readSlips, type SlipStatus, type SlipSummary } from './slipLogic';

const STATUS_TONE: Record<SlipStatus, Tone> = {
  uploaded: 'neutral',
  reading: 'info',
  read: 'accent',
  failed: 'danger',
  sent: 'success',
  rejected: 'neutral',
};

export const SLIPS_QUERY = {
  queryKey: SLIPS_KEY,
  queryFn: () => appRpc<unknown>('slips_to_send', { p_venue_id: null }),
  refetchInterval: (query: { state: { data: unknown } }) =>
    readSlips(query.state.data).some((s) => s.status === 'reading') ? 4_000 : 30_000,
};

export function ScannedSlipsPanel({ layout = 'aside' }: { layout?: 'aside' | 'strip' }) {
  const { tr, locale } = useLocale();
  const q = useQuery(SLIPS_QUERY);
  const slips = useMemo(() => readSlips(q.data), [q.data]);
  const [open, setOpen] = useState<SlipSummary | null>(null);
  const waitingSlips = slips.filter((s) => isWaiting(s.status));
  const done = slips.filter((s) => !isWaiting(s.status));

  const review = open && <SlipReview key={open.id} slipId={open.id} uploadedBy={open.uploaded_by_name} onClose={() => setOpen(null)} />;

  if (layout === 'strip') {
    if (waitingSlips.length === 0) return review || null;
    const oldest = waitingSlips[waitingSlips.length - 1]!;
    return (
      <>
        <div
          data-testid="scanned-slips-strip"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--tp-sp-2)',
            paddingBlock: 'var(--tp-sp-1-5)',
            paddingInline: 'var(--tp-sp-3)',
            borderRadius: 'var(--tp-radius-ctl)',
            background: 'var(--tp-surface-2)',
            border: '1px solid var(--tp-border)',
          }}
        >
          <span style={{ flex: 1, fontWeight: 600 }}>
            {tr('ws.slips.panel.strip', { count: formatNumber(waitingSlips.length, locale) })}
          </span>
          <Button size="sm" kind="soft" icon="receipt" onClick={() => setOpen(oldest)}>
            {tr('ws.slips.panel.open')}
          </Button>
        </div>
        {review}
      </>
    );
  }

  if (slips.length === 0 && !q.isError) return review || null;

  const row = (s: SlipSummary) => (
    <li
      key={s.id}
      data-testid="scanned-slips.row"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--tp-sp-2)',
        flexWrap: 'wrap',
        paddingBlock: 'var(--tp-sp-1-5)',
        paddingInline: 'var(--tp-sp-2)',
        borderRadius: 'var(--tp-radius-ctl)',
        background: 'var(--tp-surface-2)',
      }}
    >
      <span style={{ display: 'grid', flex: '1 1 10rem', minInlineSize: 0 }}>
        <span style={{ fontWeight: 600 }}>
          {s.table_number
            ? tr('ws.slips.panel.table', { number: s.table_number })
            : s.table_number_read
              ? tr('ws.slips.panel.table', { number: s.table_number_read })
              : tr('ws.slips.panel.noTable')}
        </span>
        <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          <bdi>
            {s.sent_by_name && !isWaiting(s.status)
              ? tr('ws.slips.panel.sentBy', { name: isolate(s.sent_by_name) })
              : tr('ws.slips.panel.from', {
                  name: isolate(s.uploaded_by_name ?? '—'),
                  time: s.created_at ? formatDateTime(new Date(s.created_at), locale) : '—',
                })}
          </bdi>
          {s.line_count > 0 && isWaiting(s.status) && (
            <>
              {' · '}
              {tr('ws.slips.panel.lines', {
                matched: formatNumber(s.matched_count, locale),
                count: formatNumber(s.line_count, locale),
              })}
            </>
          )}
        </span>
      </span>
      <StatusBadge tone={STATUS_TONE[s.status]} label={tr(`ws.slips.status.${s.status}`)} />
      {isWaiting(s.status) && (
        <Button size="sm" kind="soft" icon="receipt" onClick={() => setOpen(s)}>
          {tr('ws.slips.panel.open')}
        </Button>
      )}
    </li>
  );

  return (
    <Panel
      title={<CardTitle icon="receipt">{tr('ws.slips.panel.title')}</CardTitle>}
      actions={
        waitingSlips.length > 0 ? (
          <StatusBadge tone="warn" label={tr('ws.slips.panel.badge', { count: formatNumber(waitingSlips.length, locale) })} />
        ) : undefined
      }
      data-testid="scanned-slips"
    >
      <ErrorText error={q.error} />
      {waitingSlips.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>{waitingSlips.map(row)}</ul>
      )}
      {done.length > 0 && (
        <details style={{ marginBlockStart: waitingSlips.length > 0 ? 'var(--tp-sp-2)' : 0 }}>
          <summary style={{ cursor: 'pointer', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
            {tr('ws.slips.panel.sentToday', { count: formatNumber(done.length, locale) })}
          </summary>
          <ul style={{ listStyle: 'none', margin: 0, marginBlockStart: 'var(--tp-sp-1)', padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
            {done.map(row)}
          </ul>
        </details>
      )}
      {review}
    </Panel>
  );
}
