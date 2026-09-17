/**
 * Last 20 `telegram_outbox` rows (RLS: manager|owner read), refetched every
 * 10 s; Send again re-queues through `app.retry_telegram_outbox` (owner).
 *
 * Each row is said in words: "New order", not `order_new`; the group by its
 * name where the bot has seen it, not only a number. The retry button used to
 * sit on every row with a disabled-reason under each queued one, so a normal
 * queue of waiting messages printed "This message has not been attempted yet"
 * down the whole table. It now appears only where resending means something —
 * a message that failed or was skipped; a queued row's status already says
 * it is waiting. Resending a message that was already delivered only
 * posted it to the group twice, so that is no longer offered.
 */
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { formatDate, formatNumber, formatTime, isolate } from '@touch/i18n';
import { supabase } from '../../../lib/supabase';
import { appRpc } from '../../../lib/appRpc';
import { useLocale } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { Button } from '../../../components/ui';
import { AsyncStateWrapper, DataTable, EmptyState, StatusBadge, TableSkeleton, asyncStatus, type Column, type Tone } from '../../../components/kit';
import { useTelegramChats } from './DetectedGroups';
import { isKnownKind } from './telegramStatus';

export const OUTBOX_QUERY_KEY: QueryKey = ['telegramOutbox'];

export type OutboxStatus = 'queued' | 'sent' | 'failed' | 'skipped';

export interface OutboxRow {
  id: number;
  kind: string;
  /** The group this row is addressed to (snapshot at enqueue; Retry re-targets it at the saved group, 0091). */
  chat_id: string;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
}

/** One colour, one label, one shape, defined once (rulebook 10.6) — on the shared badge. */
const STATUS_TONE: Record<OutboxStatus, Tone> = {
  sent: 'success',
  failed: 'danger',
  queued: 'warn',
  skipped: 'neutral',
};

export function StatusChip({ status }: { status: OutboxStatus }) {
  const { tr } = useLocale();
  const label = status === 'skipped' ? tr('op.telegram.statusSkipped') : tr(`op.telegram.status.${status}`);
  return <StatusBadge size="sm" tone={STATUS_TONE[status]} label={label} />;
}

function when(iso: string | null, locale: 'en' | 'ar'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${formatDate(d, locale)} ${formatTime(d, locale)}`;
}

export function useOutbox() {
  return useQuery({
    queryKey: OUTBOX_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('telegram_outbox')
        .select('id, kind, chat_id, status, attempts, last_error, created_at, sent_at')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as OutboxRow[];
    },
    refetchInterval: 10_000,
  });
}

export function OutboxList() {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const outboxQ = useOutbox();
  const chatsQ = useTelegramChats();
  const titles = new Map((chatsQ.data ?? []).map((c) => [c.chat_id, c.title]));

  const retry = useMutation({
    mutationFn: (id: number) => appRpc('retry_telegram_outbox', { p_id: id }),
    onSuccess: () => {
      toast.ok(tr('op.toast.enqueued'));
      void queryClient.invalidateQueries({ queryKey: OUTBOX_QUERY_KEY });
    },
    onError: (e) => toast.err(e),
  });

  const rows = outboxQ.data ?? [];

  const columns: Column<OutboxRow>[] = [
    {
      key: 'kind',
      header: tr('op.telegram.kind'),
      render: (r) => <span style={{ fontWeight: 600 }}>{isKnownKind(r.kind) ? tr(`ws.manager.settings.telegram.kinds.${r.kind}`) : <span dir="ltr">{r.kind}</span>}</span>,
    },
    { key: 'status', header: tr('ws.manager.settings.telegram.outboxStatus'), render: (r) => <StatusChip status={r.status} /> },
    {
      key: 'chat',
      header: tr('ws.manager.settings.telegram.outboxGroup'),
      truncate: true,
      truncateTitle: (r) => titles.get(r.chat_id) ?? r.chat_id,
      render: (r) => {
        const title = titles.get(r.chat_id);
        return title ? (
          <bdi>{isolate(title)}</bdi>
        ) : (
          <span dir="ltr" style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: 'var(--tp-muted-fg)' }}>
            {r.chat_id}
          </span>
        );
      },
    },
    { key: 'created', header: tr('op.telegram.created'), render: (r) => <span style={{ whiteSpace: 'nowrap' }}>{when(r.created_at, locale)}</span> },
    { key: 'sent', header: tr('op.telegram.sentAt'), render: (r) => <span style={{ whiteSpace: 'nowrap' }}>{when(r.sent_at, locale)}</span> },
    { key: 'attempts', header: tr('op.telegram.attemptsCol'), numeric: true, render: (r) => formatNumber(r.attempts, locale) },
    {
      key: 'error',
      header: tr('op.telegram.lastError'),
      truncate: true,
      truncateTitle: (r) => r.last_error ?? '',
      render: (r) =>
        r.last_error ? (
          <span dir="ltr" style={{ color: 'var(--tp-danger-fg)' }}>
            {r.last_error}
          </span>
        ) : (
          <span style={{ color: 'var(--tp-muted-fg)' }}>—</span>
        ),
    },
    {
      key: 'retry',
      header: <span className="tp-sr-only">{tr('op.telegram.retry')}</span>,
      align: 'end',
      render: (r) =>
        r.status === 'failed' || r.status === 'skipped' ? (
          <Button kind="ghost" size="sm" icon="refresh" disabled={retry.isPending} onClick={() => retry.mutate(r.id)}>
            {tr('op.telegram.retry')}
          </Button>
        ) : null,
    },
  ];

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', marginBlockStart: 'var(--tp-sp-3)' }}>
      <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.manager.settings.telegram.outboxLead')}</p>
      <AsyncStateWrapper
        status={asyncStatus(outboxQ, (d) => d.length === 0)}
        error={outboxQ.error}
        onRetry={() => void outboxQ.refetch()}
        skeleton={<TableSkeleton columns={columns} rows={4} />}
        emptyContent={<EmptyState icon="bell" title={tr('op.telegram.emptyOutbox')} body={tr('ws.manager.settings.telegram.outboxEmptyBody')} />}
      >
        <DataTable columns={columns} rows={rows} rowKey={(r) => String(r.id)} dense aria-label={tr('op.telegram.outbox')} />
      </AsyncStateWrapper>
    </div>
  );
}
