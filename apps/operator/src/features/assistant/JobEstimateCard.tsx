/**
 * The estimate before a job runs (plan §6.3). Three ways when the aggregate
 * path exists — aggregate first, live, batch — each button carrying the
 * calculator's price, and "Not now". Nothing runs until a press. Live is
 * disabled with the server's reason when the job is too big for one function
 * run; the batch button stays.
 */
import { formatNumber } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Button } from '../../components/ui';
import { formatTokens, formatUsd, priceFor, type PricingMap } from '../../lib/assistantPricing';
import type { JobEstimate, JobMode } from './api';

const iso = (s: string) => `⁨${s}⁩`;

export function estimatePrices(estimate: JobEstimate, model: string, pricing: PricingMap | null | undefined, fallback: number) {
  const live = priceFor({ model, input: estimate.tokens.input, cache_read: estimate.tokens.cache_read, output: estimate.tokens.output }, pricing, fallback);
  const high = priceFor({ model, input: estimate.tokens_high.input, cache_read: estimate.tokens_high.cache_read, output: estimate.tokens_high.output }, pricing, fallback);
  const aggregate = estimate.modes.aggregate ? priceFor({ model, input: estimate.modes.aggregate.tokens_est }, pricing, fallback) : null;
  // Decision 8: the Batch API halves the per-token price.
  return { live, high, batch: Math.round(live / 2), aggregate };
}

export function JobEstimateCard({
  estimate,
  model,
  pricing,
  fallbackMicrosPerMtok,
  busy,
  onAccept,
  onAggregate,
  onDismiss,
}: {
  estimate: JobEstimate;
  model: string;
  pricing: PricingMap | null | undefined;
  fallbackMicrosPerMtok: number;
  busy?: JobMode | 'aggregate' | null;
  onAccept: (mode: JobMode) => void;
  onAggregate: (tools: string[]) => void;
  onDismiss: () => void;
}) {
  const { tr, locale } = useLocale();
  const prices = estimatePrices(estimate, model, pricing, fallbackMicrosPerMtok);
  const agg = estimate.modes.aggregate;
  const liveAllowed = estimate.modes.live.allowed;

  return (
    <section
      data-job-estimate=""
      aria-label={tr('ws.owner.assistant.job.title')}
      style={{
        border: '1px solid var(--tp-border-strong)',
        borderRadius: 'var(--tp-radius-panel)',
        background: 'var(--tp-surface-2)',
        paddingBlock: 'var(--tp-sp-3)',
        paddingInline: 'var(--tp-sp-3)',
        display: 'grid',
        gap: 'var(--tp-sp-2)',
      }}
    >
      <h3 style={{ fontSize: 'var(--tp-fs-md)', fontWeight: 700, margin: 0 }}>{tr('ws.owner.assistant.job.title')}</h3>
      <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
        {tr('ws.owner.assistant.job.lead', { rows: iso(formatNumber(estimate.rows, locale)), chunks: iso(formatNumber(estimate.chunks, locale)) })}
      </p>

      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
        {agg && (
          <Way
            title={tr('ws.owner.assistant.job.aggregate')}
            hint={tr('ws.owner.assistant.job.aggregateHint', { n: iso(String(agg.calls.length)), tokens: iso(formatTokens(agg.tokens_est)) })}
            price={prices.aggregate ?? 0}
            kind="primary"
            busy={busy === 'aggregate'}
            disabled={!!busy}
            onPress={() => onAggregate(agg.calls.map((c) => c.tool))}
          />
        )}
        <Way
          title={tr('ws.owner.assistant.job.live')}
          hint={tr('ws.owner.assistant.job.liveHint', { rows: iso(formatNumber(estimate.rows, locale)), tokens: iso(formatTokens(estimate.tokens.total)) })}
          price={prices.live}
          kind={agg ? 'default' : 'primary'}
          busy={busy === 'live'}
          disabled={!!busy || !liveAllowed}
          disabledReason={!liveAllowed ? tr('ws.owner.assistant.job.liveDisabled', { reason: estimate.modes.live.reason ?? '' }) : undefined}
          onPress={() => onAccept('live')}
        />
        <Way
          title={tr('ws.owner.assistant.job.batch')}
          hint={tr('ws.owner.assistant.job.batchHint')}
          price={prices.batch}
          kind="default"
          busy={busy === 'batch'}
          disabled={!!busy}
          onPress={() => onAccept('batch')}
        />
      </div>

      <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
        {tr('ws.owner.assistant.job.high', { price: iso(formatUsd(prices.high)) })}
        {estimate.first_chunk_exact != null && <> {tr('ws.owner.assistant.job.firstChunk', { tokens: iso(formatTokens(estimate.first_chunk_exact)) })}</>}
      </p>

      {estimate.assumptions.length > 0 && (
        <details style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
          <summary style={{ cursor: 'pointer' }}>{tr('ws.owner.assistant.job.assumptions')}</summary>
          <ul style={{ margin: 0, marginBlockStart: 'var(--tp-sp-1)', paddingInlineStart: '1.25rem', display: 'grid', gap: '0.15rem' }}>
            {estimate.assumptions.map((a, i) => (
              <li key={i} dir="auto">
                {a}
              </li>
            ))}
            {estimate.per_tool.map((t) => (
              <li key={t.tool} dir="ltr" style={{ fontFamily: 'var(--tp-font-numeric)' }}>
                {t.tool}: {formatNumber(t.rows, locale)} rows × {t.tokens_per_row} tok{t.measured ? '' : ' (est.)'}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div>
        <Button kind="ghost" size="sm" onClick={onDismiss} disabled={!!busy}>
          {tr('ws.owner.assistant.job.notNow')}
        </Button>
      </div>
    </section>
  );
}

function Way({
  title,
  hint,
  price,
  kind,
  busy,
  disabled,
  disabledReason,
  onPress,
}: {
  title: string;
  hint: string;
  price: number;
  kind: 'primary' | 'default';
  busy?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onPress: () => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 'var(--tp-sp-3)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: '0 0 auto', minInlineSize: '11rem' }}>
        <Button kind={kind} onClick={onPress} busy={busy} disabled={disabled} disabledReason={disabledReason} style={{ inlineSize: '100%', justifyContent: 'space-between' }}>
          <span>{title}</span>
          <span dir="ltr" style={{ fontFamily: 'var(--tp-font-numeric)', marginInlineStart: 'var(--tp-sp-2)' }}>
            {formatUsd(price)}
          </span>
        </Button>
      </div>
      <p style={{ flex: 1, minInlineSize: '10rem', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockStart: '0.4rem' }}>{hint}</p>
    </div>
  );
}
