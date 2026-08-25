/**
 * Last 20 `telegram_outbox` rows (RLS: manager|owner read), refetched every
 * 10 s; Retry re-queues through `app.retry_telegram_outbox` (owner).
 */
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { formatDate, formatTime } from '@touch/i18n';
import { supabase } from '../../../lib/supabase';
import { appRpc } from '../../../lib/appRpc';
import { useLocale } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { Button, ErrorText, Skeleton } from '../../../components/ui';

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

export function StatusChip({ status }: { status: OutboxStatus }) {
  const { tr } = useLocale();
  const tone =
    status === 'sent'
      ? { background: 'var(--tp-accent-2)', color: 'var(--tp-accent-2-contrast)' }
      : status === 'failed'
        ? { background: 'var(--tp-danger)', color: 'var(--tp-danger-contrast)' }
        : { background: 'var(--tp-muted)', color: 'var(--tp-fg)' };
  const label =
    status === 'skipped' ? tr('op.telegram.statusSkipped') : tr(`op.telegram.status.${status}`);
  return (
    <span
      style={{
        ...tone,
        display: 'inline-block',
        paddingBlock: '0.1rem',
        paddingInline: '0.5rem',
        borderRadius: '999px',
        fontSize: '0.75rem',
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
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
  const th: React.CSSProperties = {
    textAlign: 'start',
    fontSize: '0.75rem',
    color: 'var(--tp-muted-fg)',
    paddingBlock: '0.3rem',
    paddingInline: '0.4rem',
    borderBlockEnd: '1px solid var(--tp-border)',
  };
  const td: React.CSSProperties = {
    paddingBlock: '0.4rem',
    paddingInline: '0.4rem',
    borderBlockEnd: '1px solid var(--tp-border)',
    verticalAlign: 'top',
    fontSize: '0.85rem',
  };

  return (
    <div>
      <ErrorText error={outboxQ.error} />
      {outboxQ.isLoading && <Skeleton lines={4} />}
      {outboxQ.isSuccess && rows.length === 0 && (
        <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('op.telegram.emptyOutbox')}</p>
      )}
      {rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ inlineSize: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>{tr('op.telegram.kind')}</th>
                <th style={th}>{tr('op.telegram.created')}</th>
                <th style={th}>{tr('op.telegram.sentAt')}</th>
                <th style={th}>{tr('op.telegram.attemptsCol')}</th>
                <th style={th}>{tr('op.telegram.lastError')}</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      <StatusChip status={r.status} />
                      <span dir="ltr">{r.kind}</span>
                    </div>
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{when(r.created_at, locale)}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{when(r.sent_at, locale)}</td>
                  <td style={{ ...td, textAlign: 'center' }} dir="ltr">
                    {r.attempts}
                  </td>
                  <td style={{ ...td, color: r.last_error ? 'var(--tp-danger)' : 'var(--tp-muted-fg)' }} dir="ltr">
                    {r.last_error ?? '—'}
                  </td>
                  <td style={td}>
                    {r.status !== 'queued' && (
                      <Button kind="ghost" disabled={retry.isPending} onClick={() => retry.mutate(r.id)}>
                        {tr('op.telegram.retry')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
