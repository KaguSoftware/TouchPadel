/**
 * A job while it runs (plan §6.4): status, chunks done over chunks total,
 * running tokens by kind with the calculator's price, and Cancel. Polls the
 * `assistant_jobs` row every 2 s while the status is not terminal; the row is
 * written by the edge function, so the poll is the truth, not this screen.
 * When it reaches a finished state the chat's messages are read again, so
 * "Finished. The answer is in the chat" is true when it says so.
 * Since 0423 a paused job says why it paused, what it has cost, what the rest
 * should cost, and offers one button: Continue, which reads only the parts
 * left (in the background where the vendor has batch).
 */
import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatNumber } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { Button, ErrorText } from '../../components/ui';
import { StatusBadge, type Tone } from '../../components/kit';
import { formatUsd, priceFor, totalTokens, type PricingMap } from '../../lib/assistantPricing';
import { QK, TERMINAL_JOB_STATUSES, cancelJob, fetchJob, resumeJob, type JobRow, type JobStatus } from './api';
import { isExpiredPause, jobErrorCode, jobErrorKey, pauseOf, resumeMayHaveStarted, resumePrices, resumesInBackground } from './threadLogic';

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

export function JobProgress({
  jobId,
  initial,
  endedAway,
  model,
  pricing,
  fallbackMicrosPerMtok,
}: {
  jobId: string;
  initial?: JobRow;
  /** It ended while the owner was not watching it here (threadLogic.jobCards): say so. */
  endedAway?: boolean;
  model: string;
  pricing: PricingMap | null | undefined;
  fallbackMicrosPerMtok: number;
}) {
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

  // The answer a job writes is a new message: read the chat again once it ends.
  const finishedSeen = useRef(false);
  const finished = isTerminal(job?.status);
  const jobConversation = job?.conversation_id ?? null;
  useEffect(() => {
    if (!finished || finishedSeen.current) return;
    finishedSeen.current = true;
    if (jobConversation) {
      void qc.invalidateQueries({ queryKey: QK.messages(jobConversation) });
      void qc.invalidateQueries({ queryKey: QK.jobs(jobConversation) });
    }
    void qc.invalidateQueries({ queryKey: ['assistant', 'usage'] });
  }, [finished, jobConversation, qc]);

  const cancel = useMutation({
    mutationFn: () => cancelJob(jobId),
    onSuccess: () => {
      toast.ok(tr('ws.owner.assistant.job.cancelled'));
      void qc.invalidateQueries({ queryKey: QK.job(jobId) });
      if (job?.conversation_id) void qc.invalidateQueries({ queryKey: QK.jobs(job.conversation_id) });
    },
  });

  // 0423: Continue. A lost race (another press, another device) or a request
  // that broke may still have started it: the row is the truth, so read it again.
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: QK.job(jobId) });
    if (job?.conversation_id) void qc.invalidateQueries({ queryKey: QK.jobs(job.conversation_id) });
  };
  const resume = useMutation({
    mutationFn: () => resumeJob(jobId),
    onSuccess: (r) => {
      if (r?.status === 'running' || r?.status === 'done') toast.ok(tr('ws.owner.assistant.job.resumed'));
      refresh();
    },
    onError: (err) => {
      if (resumeMayHaveStarted(err)) refresh();
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
  const pause = pauseOf(job);
  const background = pause ? resumesInBackground(job, pause) : false;
  const restPrice = pause ? resumePrices(job, pause, background, model, pricing, fallbackMicrosPerMtok) : null;

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

      {tokens > 0 && !pause && (
        <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
          {tr('ws.owner.assistant.job.tokensSoFar', { price: iso(formatUsd(micros)) })}
        </p>
      )}

      {pause && restPrice && (
        <>
          <p style={{ color: 'var(--tp-warn-fg)' }}>
            {tr(`ws.owner.assistant.job.paused.${pause.reason}`, { done: iso(formatNumber(pause.done, locale)), total: iso(formatNumber(pause.total, locale)) })}
          </p>
          <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
            {tr('ws.owner.assistant.job.resumeCost', { spent: iso(formatUsd(micros)), rest: iso(formatUsd(restPrice.rest)), high: iso(formatUsd(restPrice.high)) })}
          </p>
          <div style={{ display: 'flex', gap: 'var(--tp-sp-3)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <Button size="sm" kind="primary" onClick={() => resume.mutate()} busy={resume.isPending} disabled={cancel.isPending}>
              {tr(background ? 'ws.owner.assistant.job.resume' : 'ws.owner.assistant.job.resumeLive')}
            </Button>
            <p style={{ flex: 1, minInlineSize: '10rem', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginBlockStart: '0.3rem' }}>
              {tr(background ? 'ws.owner.assistant.job.resumeHint' : 'ws.owner.assistant.job.resumeLiveHint')}
            </p>
          </div>
        </>
      )}
      {isExpiredPause(job) && <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.assistant.job.expired')}</p>}
      {status === 'done' && (
        <p data-job-ended={endedAway ? 'away' : 'here'} style={{ color: endedAway ? 'var(--tp-fg)' : 'var(--tp-muted-fg)', fontWeight: endedAway ? 600 : undefined }}>
          {tr(endedAway ? 'ws.owner.assistant.job.doneAway' : 'ws.owner.assistant.job.doneNote')}
        </p>
      )}
      {/* The stored error is "CODE: the server's English"; only the code is read, the catalog words it. */}
      {status === 'failed' && (
        <p role="alert" style={{ color: 'var(--tp-danger-fg)' }}>
          {tr(jobErrorKey(jobErrorCode(job.error)))}
        </p>
      )}
      {cancel.isError && <ErrorText error={cancel.error} />}
      {resume.isError && !resumeMayHaveStarted(resume.error) && <ErrorText error={resume.error} />}
      {q.isError && !job && <ErrorText error={q.error} />}
    </section>
  );
}
