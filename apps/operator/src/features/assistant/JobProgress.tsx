/**
 * A job while it runs (plan §6.4): status, chunks done over chunks total,
 * running tokens by kind with the calculator's price, and Cancel. Polls the
 * `assistant_jobs` row every 2 s while the status is not terminal; the row is
 * written by the edge function, so the poll is the truth, not this screen.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatNumber } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { Button, ErrorText } from '../../components/ui';
import { StatusBadge, type Tone } from '../../components/kit';
import { formatTokens, formatUsd, priceFor, totalTokens, type PricingMap } from '../../lib/assistantPricing';
import { QK, TERMINAL_JOB_STATUSES, cancelJob, fetchJob, type JobRow, type JobStatus } from './api';

export const JOB_POLL_MS = 2_000;

const TONE: Record<JobStatus, Tone> = {
  estimated: 'neutral',
  accepted: 'info',
  running: 'accent',
  reducing: 'accent',
  done: 'success',
  failed: 'danger',
  cancelled: 'neutral',
  over_estimate: 'warn',
};

const iso = (s: string) => `⁨${s}⁩`;

export function isTerminal(status: JobStatus | undefined): boolean {
  return status !== undefined && TERMINAL_JOB_STATUSES.includes(status);
}

export function JobProgress({ jobId, initial, model, pricing, fallbackMicrosPerMtok }: { jobId: string; initial?: JobRow; model: string; pricing: PricingMap | null | undefined; fallbackMicrosPerMtok: number }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: QK.job(jobId),
    queryFn: () => fetchJob(jobId),
    initialData: initial,
    refetchInterval: (query) => (isTerminal(query.state.data?.status) ? false : JOB_POLL_MS),
  });
  const job = q.data ?? initial ?? null;

  const cancel = useMutation({
    mutationFn: () => cancelJob(jobId),
    onSuccess: () => {
      toast.ok(tr('ws.owner.assistant.job.cancelled'));
      void qc.invalidateQueries({ queryKey: QK.job(jobId) });
      if (job?.conversation_id) void qc.invalidateQueries({ queryKey: QK.jobs(job.conversation_id) });
    },
  });

  if (!job) return null;
  const status = job.status;
  const total = job.chunks_total ?? job.estimate?.chunks ?? 0;
  const done = job.chunks_done ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : status === 'done' ? 100 : 0;
  const tokens = totalTokens(job.tokens);
  const micros = job.tokens.cost_micros ?? priceFor({ model: job.tokens.model ?? model, ...job.tokens }, pricing, fallbackMicrosPerMtok);
  const terminal = isTerminal(status);

  const onCancel = async () => {
    const ok = await confirm({
      title: tr('ws.owner.assistant.job.cancelTitle'),
      body: tr('ws.owner.assistant.job.cancelBody'),
      confirmLabel: tr('ws.owner.assistant.job.cancel'),
      kind: 'danger',
    });
    if (ok) cancel.mutate();
  };

  return (
    <section
      data-job-progress=""
      aria-label={tr('ws.owner.assistant.job.progressTitle')}
      style={{ border: '1px solid var(--tp-border)', borderRadius: 'var(--tp-radius-panel)', paddingBlock: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-3)', display: 'grid', gap: 'var(--tp-sp-1-5)', fontSize: 'var(--tp-fs-sm)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600 }}>{tr('ws.owner.assistant.job.progressTitle')}</span>
        <StatusBadge tone={TONE[status]} label={tr(`ws.owner.assistant.job.status.${status}`)} />
        {job.mode === 'batch' && !terminal && <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)' }}>{tr('ws.owner.assistant.job.batchWaiting')}</span>}
        {!terminal && (
          <Button size="sm" kind="ghost" icon="x" onClick={() => void onCancel()} busy={cancel.isPending} style={{ marginInlineStart: 'auto' }}>
            {tr('ws.owner.assistant.job.cancel')}
          </Button>
        )}
      </div>

      {job.plan?.question && <p dir="auto" style={{ color: 'var(--tp-muted-fg)' }}>{job.plan.question}</p>}

      {total > 0 && (
        <div style={{ display: 'grid', gap: '0.2rem' }}>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} style={{ blockSize: '0.4rem', borderRadius: 'var(--tp-radius-sm)', background: 'var(--tp-surface-2)', overflow: 'hidden' }}>
            <div style={{ inlineSize: `${pct}%`, blockSize: '100%', background: status === 'failed' ? 'var(--tp-danger-fg)' : 'var(--tp-accent)' }} />
          </div>
          <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
            {tr('ws.owner.assistant.job.chunks', { done: iso(formatNumber(done, locale)), total: iso(formatNumber(total, locale)) })}
          </span>
        </div>
      )}

      {tokens > 0 && (
        <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
          {tr('ws.owner.assistant.job.tokensSoFar', { tokens: iso(formatTokens(tokens)), price: iso(formatUsd(micros)) })}
        </p>
      )}

      {status === 'over_estimate' && <p style={{ color: 'var(--tp-warn-fg)' }}>{tr('ws.owner.assistant.job.overEstimate')}</p>}
      {status === 'done' && <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.assistant.job.doneNote')}</p>}
      {status === 'failed' && (
        <p role="alert" style={{ color: 'var(--tp-danger-fg)' }}>
          {tr('ws.owner.assistant.job.error', { error: job.error ?? '' })}
        </p>
      )}
      {cancel.isError && <ErrorText error={cancel.error} />}
      {q.isError && !job && <ErrorText error={q.error} />}
    </section>
  );
}
