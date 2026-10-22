/**
 * "Needs you": the one to-do list on Today (opsLogic NEEDS, the 2026-10-16
 * rebuild). Every row has the same shape: a count in the colour of how urgent
 * it is, what it is, one plain line on what to do, and one thing at the end:
 *
 *   - a button to the screen that shows exactly those items;
 *   - "Review …" for the three queues (online refunds, lesson refunds, player
 *     reports), which open IN PLACE under their row with every action they had
 *     as panels of their own. They used to be three more panels, each in its
 *     own design, so the page had four to-do lists;
 *   - for late kitchen orders, "Tell the kitchen" as plain text, because no
 *     screen in this workspace cooks them and a button would pretend one did.
 *
 * Three rows show and the rest wait behind "View more" (owner call,
 * 2026-10-08); the order is opsLogic's, by who is waiting, never by count.
 * A read that failed is said beside the rows, with Retry, and never folded
 * away: a check that failed is not a check that passed.
 *
 * Observe's overview adds the owner's own rows (`extras`) after these.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatIQD, formatNumber, type MessageKey } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { can, useAuth } from '../../lib/auth';
import { QK } from '../../lib/queryKeys';
import { fetchPlan } from '../plan/api';
import { plansWaitingCount, readPlan } from '../plan/planLogic';
import { Button, Skeleton } from '../../components/ui';
import { LIST_CAP, Panel, ViewMore, useListCap } from '../../components/kit';
import { Icon, type IconName } from '../../components/icons';
import { CardTitle, MARK, MARK_FG, MARK_SOFT } from './OpsVisuals';
import { needsFor, overviewNeedCounts, type NeedKey, type NeedSeverity, type OpsOverview } from './opsLogic';
import { fetchProtocolsWaiting, protocolsWaitingTotal } from './protocolsWaiting';
import { fetchPurchasesToReceive } from '../stock/DriverPurchases';
import { readPurchases } from '../stock/driverPurchasesLogic';
import { usePeopleRecordCounts } from '../deductions/peopleRecordCounts';
import { useShiftDifferences } from '../tillShift/useShiftDifferences';
import { DepositAttentionPanel, useDepositAttention } from '../deposits/DepositAttentionPanel';
import { attentionKindOf } from '../deposits/depositAttentionLogic';
import { MatchReportsPanel, useMatchReportsQueue } from './MatchReportsPanel';
import { LessonRefundsDuePanel, useLessonRefundsQueue } from './LessonRefundsDuePanel';
import { QueueOpenerContext, type QueueKey } from './queueOpener';

/** A row another screen adds to "Needs you": something only its reader answers. */
export interface ExtraNeed {
  key: string;
  count: number;
  title: MessageKey;
  hint: MessageKey;
  action: MessageKey;
  href: string;
  icon: IconName;
}

/** What the embedding screen adds: its rows, whether its reads are still out, and the ones that failed. */
export interface FloorNowExtras {
  needs: readonly ExtraNeed[];
  loading: boolean;
  failed: readonly { refetch: () => unknown }[];
}

type Go = (href: string) => void;

/** Each row's words. The wave-5 rows keep the words that live with their screens, so Observe says the same. */
const COPY: Record<NeedKey, { title: MessageKey; hint: MessageKey; action: MessageKey }> = {
  waiterCalls: { title: 'ws.manager.ops.needs.waiterCalls', hint: 'ws.manager.ops.needs.waiterCallsHint', action: 'ws.manager.ops.needs.waiterCallsAction' },
  ticketsLate: { title: 'ws.manager.ops.needs.ticketsLate', hint: 'ws.manager.ops.needs.ticketsLateHint', action: 'ws.manager.ops.needs.ticketsLateNote' },
  deposits: { title: 'ws.manager.ops.needs.deposits', hint: 'ws.manager.ops.needs.depositsHint', action: 'ws.manager.ops.needs.depositsAction' },
  lessonRefunds: { title: 'ws.manager.ops.needs.lessonRefunds', hint: 'ws.manager.ops.needs.lessonRefundsHintNoTotal', action: 'ws.manager.ops.needs.lessonRefundsAction' },
  matchReports: { title: 'ws.manager.ops.needs.matchReports', hint: 'ws.manager.ops.needs.matchReportsHint', action: 'ws.manager.ops.needs.matchReportsAction' },
  expired: { title: 'ws.manager.ops.needs.expired', hint: 'ws.manager.ops.needs.expiredHint', action: 'ws.manager.ops.needs.expiredAction' },
  low: { title: 'ws.manager.ops.needs.low', hint: 'ws.manager.ops.needs.lowHint', action: 'ws.manager.ops.needs.lowAction' },
  purchases: { title: 'ws.manager.ops.needs.purchases', hint: 'ws.manager.ops.needs.purchasesHint', action: 'ws.manager.ops.needs.purchasesAction' },
  tillShifts: { title: 'ws.tillShift.ops.title', hint: 'ws.tillShift.ops.hint', action: 'ws.tillShift.ops.action' },
  protocols: { title: 'ws.manager.ops.needs.protocols', hint: 'ws.manager.ops.needs.protocolsHint', action: 'ws.manager.ops.needs.protocolsAction' },
  deductions: { title: 'ws.deductions.waiting.title', hint: 'ws.deductions.waiting.hint', action: 'ws.deductions.waiting.action' },
  incidents: { title: 'ws.incidents.waiting.title', hint: 'ws.incidents.waiting.hint', action: 'ws.incidents.waiting.action' },
  content: { title: 'ws.content.waiting.title', hint: 'ws.content.waiting.hint', action: 'ws.content.waiting.action' },
  plan: { title: 'ws.plan.needs.title', hint: 'ws.plan.needs.hint', action: 'ws.plan.needs.action' },
};

/** The three queues that open in place, and the row each one is. */
const QUEUE_OF: Partial<Record<NeedKey, QueueKey>> = { deposits: 'deposits', lessonRefunds: 'lessonRefunds', matchReports: 'matchReports' };

type RowAction = { kind: 'open'; href: string; label: string } | { kind: 'review'; queue: QueueKey; label: string } | { kind: 'none'; note: string };

interface Row {
  key: string;
  count: number;
  severity: NeedSeverity;
  title: string;
  hint: string;
  action: RowAction;
}

/** A read the list depends on, as much of it as the list needs. */
type Read = { isPending: boolean; isError: boolean; refetch: () => unknown };

/**
 * Every count the list shows beyond `ops_overview`'s own, from the reads the
 * rail badges and the queues already make (one cache each), plus which of
 * them are still out and which failed.
 */
function useWorkCounts() {
  const protocolsQ = useQuery({ queryKey: QK.protocolsWaiting, queryFn: fetchProtocolsWaiting, refetchInterval: 60_000 });
  const purchasesQ = useQuery({ queryKey: QK.purchasesToReceive, queryFn: fetchPurchasesToReceive, refetchInterval: 60_000 });
  // Marketing's plans waiting on the owner (0362): the rail badge's own read.
  const { staff } = useAuth();
  const planOn = can(staff, 'decidePlan');
  const planQ = useQuery({ queryKey: QK.planNow, queryFn: () => fetchPlan(null), enabled: planOn, refetchInterval: 60_000 });
  // Wave 5: deductions to decide, incidents to review, posts to approve, each only for a role its read admits.
  const people = usePeopleRecordCounts();
  // Wave 5: the day's till shifts counted short or over, the day-close step's own read.
  const shiftDiffs = useShiftDifferences(true);
  const deposits = useDepositAttention();
  const reports = useMatchReportsQueue();
  const lessons = useLessonRefundsQueue();

  const depositRows = deposits.data ?? [];
  // A refund Qi has not answered yet has nothing to press: amber, not red.
  const depositsUrgent = depositRows.some((r) => attentionKindOf(r) !== 'refundSlow');
  const lessonItems = lessons.allowed && lessons.status.kind === 'ready' ? lessons.status.data.items : [];
  const lessonTotal = lessons.allowed && lessons.status.kind === 'ready' ? lessons.status.data.total_iqd : null;

  const counts = {
    protocols: protocolsQ.data !== undefined ? protocolsWaitingTotal(protocolsQ.data) : 0,
    purchases: purchasesQ.data !== undefined ? readPurchases(purchasesQ.data).length : 0,
    deductions: people.deductions,
    incidents: people.incidents,
    content: people.content,
    plan: planOn && planQ.data !== undefined ? plansWaitingCount(readPlan(planQ.data)) : 0,
    tillShifts: shiftDiffs.count,
    deposits: depositRows.length,
    lessonRefunds: lessonItems.length,
    matchReports: reports.allowed && reports.status.kind === 'ready' ? reports.status.data.length : 0,
  } satisfies Partial<Record<NeedKey, number | undefined>>;

  // A queue the person may not open, or a server without it, is no read at all.
  const queueRead = (allowed: boolean, kind: string, q: { refetch: () => unknown }): Read | null =>
    !allowed || kind === 'absent' ? null : { isPending: kind === 'loading', isError: kind === 'failed', refetch: q.refetch };
  const reads: Read[] = [
    protocolsQ,
    purchasesQ,
    ...(planOn ? [planQ] : []),
    ...people.reads,
    ...(shiftDiffs.read ? [shiftDiffs.read] : []),
    { isPending: deposits.isPending, isError: deposits.isError && deposits.data === undefined, refetch: deposits.refetch },
    ...[queueRead(reports.allowed, reports.status.kind, reports.q), queueRead(lessons.allowed, lessons.status.kind, lessons.q)].filter((r): r is Read => r !== null),
  ];

  return {
    counts,
    severity: { deposits: depositsUrgent ? 'danger' : 'warn' } as Partial<Record<NeedKey, NeedSeverity>>,
    lessonTotal,
    loading: reads.some((r) => r.isPending),
    failed: reads.filter((r) => r.isError),
  };
}

export function NeedsYou({ data, go, extras }: { data: OpsOverview; go: Go; extras?: FloorNowExtras }) {
  const { tr, locale } = useLocale();
  const work = useWorkCounts();

  const own = needsFor({ ...overviewNeedCounts(data), ...work.counts }, work.severity).map((n): Row => {
    const copy = COPY[n.key];
    const queue = QUEUE_OF[n.key];
    const action: RowAction =
      n.action.kind === 'open'
        ? { kind: 'open', href: n.action.href, label: tr(copy.action) }
        : n.action.kind === 'review' && queue
          ? { kind: 'review', queue, label: tr(copy.action) }
          : { kind: 'none', note: tr(copy.action) };
    // The lesson row names the total due when the server sends one.
    const hint =
      n.key === 'lessonRefunds' && work.lessonTotal !== null
        ? tr('ws.manager.ops.needs.lessonRefundsHint', { amount: formatIQD(work.lessonTotal, locale) })
        : tr(copy.hint);
    return { key: n.key, count: n.count, severity: n.severity, title: tr(copy.title), hint, action };
  });
  // The embedding screen's rows (Observe: the owner's own) follow the floor's.
  const added = (extras?.needs ?? []).map(
    (n): Row => ({ key: n.key, count: n.count, severity: 'warn', title: tr(n.title), hint: tr(n.hint), action: { kind: 'open', href: n.href, label: tr(n.action) } }),
  );
  const rows = [...own, ...added];

  const failed = [...work.failed, ...(extras?.failed ?? [])];
  const loading = (work.loading || (extras?.loading ?? false)) && rows.length === 0;
  const clear = !loading && rows.length === 0 && failed.length === 0;

  const cap = useListCap(rows);
  const [open, setOpen] = useState<ReadonlySet<QueueKey>>(() => new Set());
  const rowEls = useRef(new Map<QueueKey, HTMLLIElement>());
  const [scrollTo, setScrollTo] = useState<QueueKey | null>(null);

  const toggle = useCallback((queue: QueueKey) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(queue)) next.delete(queue);
      else next.add(queue);
      return next;
    });
  }, []);

  // Another queue's "Online refunds" link: open that row, unfold the list if
  // it sits behind "View more", and bring it into view once it has rendered.
  const openQueue = (queue: QueueKey) => {
    setOpen((prev) => new Set(prev).add(queue));
    const index = rows.findIndex((r) => r.action.kind === 'review' && r.action.queue === queue);
    if (index >= LIST_CAP && !cap.open) cap.toggle();
    setScrollTo(queue);
  };
  useEffect(() => {
    if (!scrollTo) return;
    rowEls.current.get(scrollTo)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setScrollTo(null);
  }, [scrollTo]);

  return (
    <QueueOpenerContext.Provider value={openQueue}>
      <Panel
        data-testid="needs-you"
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
            <CardTitle icon={clear ? 'checkCircle' : 'alert'}>{tr('ws.manager.ops.needs.title')}</CardTitle>
            {rows.length > 0 && <CountPill count={rows.length} />}
          </span>
        }
      >
        {loading ? (
          <Skeleton lines={2} blockSize="2.25rem" />
        ) : clear ? (
          <p style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', margin: 0, fontWeight: 600, color: MARK_FG.success }}>
            <Icon name="checkCircle" size={18} style={{ color: MARK.success, flex: '0 0 auto' }} />
            {tr('ws.manager.ops.needs.clear')}
          </p>
        ) : (
          <>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {cap.shown.map((r, i) => (
                <NeedRow
                  key={r.key}
                  row={r}
                  first={i === 0}
                  go={go}
                  expanded={r.action.kind === 'review' && open.has(r.action.queue)}
                  onToggle={toggle}
                  rowRef={(el) => {
                    if (r.action.kind !== 'review') return;
                    if (el) rowEls.current.set(r.action.queue, el);
                    else rowEls.current.delete(r.action.queue);
                  }}
                />
              ))}
              {/* Said beside the rows and never folded under "View more". */}
              {failed.length > 0 && <FailedRow first={rows.length === 0} onRetry={() => failed.forEach((q) => void q.refetch())} />}
            </ul>
            <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} />
          </>
        )}
      </Panel>
    </QueueOpenerContext.Provider>
  );
}

function CountPill({ count }: { count: number }) {
  const { locale } = useLocale();
  return (
    <span
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        minInlineSize: '1.5rem',
        blockSize: '1.375rem',
        paddingInline: 'var(--tp-sp-1-5)',
        borderRadius: 'var(--tp-radius-pill)',
        background: 'var(--tp-neutral-soft)',
        color: 'var(--tp-neutral-fg)',
        fontSize: 'var(--tp-fs-xs)',
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        fontFamily: 'var(--tp-font-numeric)',
      }}
    >
      {formatNumber(count, locale)}
    </span>
  );
}

/** The count block's width, which the text column and an opened queue line up against. */
const CHIP_INLINE = '3rem';

const ROW = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  columnGap: 'var(--tp-sp-3)',
  rowGap: 'var(--tp-sp-2)',
  paddingBlock: 'var(--tp-sp-3)',
} as const;

function NeedRow({
  row,
  first,
  go,
  expanded,
  onToggle,
  rowRef,
}: {
  row: Row;
  first: boolean;
  go: Go;
  expanded: boolean;
  onToggle: (queue: QueueKey) => void;
  rowRef: (el: HTMLLIElement | null) => void;
}) {
  const { locale } = useLocale();
  const a = row.action;
  return (
    <li ref={rowRef} data-testid={`need-${row.key}`} style={{ ...ROW, borderBlockStart: first ? undefined : '1px solid var(--tp-border)' }}>
      <span
        style={{
          display: 'grid',
          placeItems: 'center',
          flex: '0 0 auto',
          minInlineSize: CHIP_INLINE,
          blockSize: '2.25rem',
          paddingInline: 'var(--tp-sp-2)',
          borderRadius: 'var(--tp-radius-ctl)',
          background: MARK_SOFT[row.severity],
          color: MARK_FG[row.severity],
          fontSize: 'var(--tp-fs-lg)',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          fontFamily: 'var(--tp-font-numeric)',
        }}
      >
        {formatNumber(row.count, locale)}
      </span>
      <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', flex: '1 1 16rem', minInlineSize: 0 }}>
        <strong style={{ color: 'var(--tp-fg)' }}>{row.title}</strong>
        <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{row.hint}</span>
      </span>
      <span style={{ flex: '0 0 auto', marginInlineStart: 'auto' }}>
        {a.kind === 'open' ? (
          <Button size="sm" iconEnd="arrowUpRight" onClick={() => go(a.href)}>
            {a.label}
          </Button>
        ) : a.kind === 'review' ? (
          <Button size="sm" iconEnd={expanded ? 'chevronUp' : 'chevronDown'} aria-expanded={expanded} onClick={() => onToggle(a.queue)}>
            {a.label}
          </Button>
        ) : (
          // Nothing here fixes it, so no button pretends to; the words stand where one would.
          <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600, color: 'var(--tp-muted-fg)' }}>{a.note}</span>
        )}
      </span>
      {a.kind === 'review' && expanded && (
        // A full line under the row, indented to the text column; the well
        // inside it holds the queue's own rows and their actions.
        <div style={{ flex: '1 0 100%', minInlineSize: 0, boxSizing: 'border-box', paddingInlineStart: `calc(${CHIP_INLINE} + var(--tp-sp-3))` }}>
          <div role="region" aria-label={row.title} style={{ paddingInline: 'var(--tp-sp-3)', borderRadius: 'var(--tp-radius-ctl)', background: 'var(--tp-surface-2)' }}>
            {a.queue === 'deposits' ? <DepositAttentionPanel bare /> : a.queue === 'lessonRefunds' ? <LessonRefundsDuePanel bare /> : <MatchReportsPanel bare />}
          </div>
        </div>
      )}
    </li>
  );
}

function FailedRow({ first, onRetry }: { first: boolean; onRetry: () => void }) {
  const { tr } = useLocale();
  return (
    <li role="alert" style={{ ...ROW, borderBlockStart: first ? undefined : '1px solid var(--tp-border)' }}>
      <span
        style={{
          display: 'grid',
          placeItems: 'center',
          flex: '0 0 auto',
          minInlineSize: CHIP_INLINE,
          blockSize: '2.25rem',
          borderRadius: 'var(--tp-radius-ctl)',
          background: MARK_SOFT.neutral,
        }}
      >
        <Icon name="wifiOff" size={18} style={{ color: MARK.danger }} />
      </span>
      <span style={{ flex: '1 1 16rem', minInlineSize: 0, fontWeight: 600 }}>{tr('ws.manager.ops.needs.failed')}</span>
      <span style={{ flex: '0 0 auto', marginInlineStart: 'auto' }}>
        <Button size="sm" icon="refresh" onClick={onRetry}>
          {tr('common.retry')}
        </Button>
      </span>
    </li>
  );
}
