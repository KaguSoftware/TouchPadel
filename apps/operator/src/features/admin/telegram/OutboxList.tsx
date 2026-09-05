/**
 * Last 20 `telegram_outbox` rows (RLS: manager|owner read), refetched every
 * 10 s; Retry re-queues through `app.retry_telegram_outbox` (owner).
 *
 * The hand-rolled <table> with its own `th`/`td` style objects is gone: it was
 * a fifth spelling of the shared table (12px headers, no row-height floor, no
 * loading or empty treatment) sitting one import away from DataTable.
 */
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { formatDate, formatTime } from '@touch/i18n';
import { supabase } from '../../../lib/supabase';
import { appRpc } from '../../../lib/appRpc';
import { useLocale } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { Button, ErrorText } from '../../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  ResultCount,
  StatusBadge,
  TableSkeleton,
  asyncStatus,
  type Column,
  type Tone,
} from '../../../components/kit';

export const OUTBOX_QUERY_KEY: QueryKey = ['telegramOutbox'];

export type OutboxStatus = 'queued' | 'sent' | 'failed' | 'skipped';

export interface OutboxRow {
  id: number;
  kind: string;
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

export function OutboxList() {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();

  const outboxQ = useQuery({
    queryKey: OUTBOX_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('telegram_outbox')
        .select('id, kind, status, attempts, last_error, created_at, sent_at')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as OutboxRow[];
    },
    refetchInterval: 10_000,
  });

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
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center', flexWrap: 'wrap' }}>
          <StatusChip status={r.status} />
          <span dir="ltr">{r.kind}</span>
        </span>
      ),
    },
    { key: 'created', header: tr('op.telegram.created'), render: (r) => <span style={{ whiteSpace: 'nowrap' }}>{when(r.created_at, locale)}</span> },
    { key: 'sent', header: tr('op.telegram.sentAt'), render: (r) => <span style={{ whiteSpace: 'nowrap' }}>{when(r.sent_at, locale)}</span> },
    { key: 'attempts', header: tr('op.telegram.attemptsCol'), numeric: true, render: (r) => <span dir="ltr">{r.attempts}</span> },
    {
      key: 'error',
      header: tr('op.telegram.lastError'),
      truncate: true,
      truncateTitle: (r) => r.last_error ?? '',
      render: (r) => (
        <span dir="ltr" style={{ color: r.last_error ? 'var(--tp-danger-fg)' : 'var(--tp-muted-fg)' }}>
          {r.last_error ?? '—'}
        </span>
      ),
    },
    {
      key: 'retry',
      header: '',
      align: 'end',
      render: (r) => (
        <Button
          kind="ghost"
          size="sm"
          icon="refresh"
          disabled={r.status === 'queued' || retry.isPending}
          // Rulebook 4.3 in its cheapest form: the button used to VANISH on a
          // queued row, so the operator could not tell "cannot retry yet" from
          // "this venue cannot retry at all".
          disabledReason={r.status === 'queued' ? tr('ws.manager.settings.telegram.retryDisabled') : undefined}
          onClick={() => retry.mutate(r.id)}
        >
          {tr('op.telegram.retry')}
        </Button>
      ),
    },
  ];

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
      <div style={{ display: 'flex', gap: 'var(--tp-sp-3)', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.manager.settings.telegram.outboxLead')}</p>
        <ResultCount shown={rows.length} total={rows.length} />
      </div>
      <ErrorText error={outboxQ.error} />
      <AsyncStateWrapper
        status={asyncStatus(outboxQ, (d) => d.length === 0)}
        error={outboxQ.error}
        onRetry={() => void outboxQ.refetch()}
        skeleton={<TableSkeleton columns={columns} rows={4} />}
        emptyContent={
          <EmptyState icon="bell" title={tr('op.telegram.emptyOutbox')} body={tr('ws.manager.settings.telegram.outboxEmptyBody')} />
        }
      >
        <DataTable columns={columns} rows={rows} rowKey={(r) => String(r.id)} aria-label={tr('op.telegram.outbox')} />
      </AsyncStateWrapper>
    </div>
  );
}
