/**
 * AssistantComponentCard — one assistant-fed card on the analytics page
 * (plan §5.4; migration 0141; the assistant-component edge function).
 *
 * On mount the card READS the cache (one RPC, no model). A hit renders the
 * typed content with its sources row, "written {date}", the token figure and
 * a Hide button on every finding. A miss renders the last answer greyed with
 * "the numbers have changed since this was written", a Refresh button that
 * prints what the last generation would cost again, and — for the findings
 * cards — the page's own deterministic patterns so the card is never empty.
 * Nothing generates without a press (DECIDE 12): the nightly pre-warm is the
 * only other writer.
 *
 * The buttons say what they do and what is billed. A model that is not set up
 * is a plain note, not a red error: the last answer and the fallback are still
 * true.
 */
import { useRef, useState, type ReactNode } from 'react';
import type { InsightWire } from '@touch/core';
import { Button, ErrorText, Spinner } from '../../../components/ui';
import { useConfirm } from '../../../components/ConfirmDialog';
import { useToast } from '../../../components/toast';
import { useLocale } from '../../../lib/i18n';
import { formatTokens, formatUsd, priceFor, totalTokens } from '../../../lib/assistantPricing';
import type { Formatters } from '../format';
import { CardShell, muted } from '../cards/CardShell';
import { rangeSearch } from '../../assistant/Sources';
import type { ComponentParams } from './params';
import { ContentView } from './renderers';
import { useAssistantComponent, useComponentPricing, type CacheView, type ComponentSource } from './useAssistantComponent';

export interface AssistantComponentCardProps {
  componentKey: string;
  title: string;
  params: ComponentParams;
  f: Formatters;
  /** EXPLANATION behind the info button. Defaults to the shared components tip. */
  tip?: ReactNode;
  /** The page's deterministic sentences, shown on a miss so the card is never empty (findings cards). Called lazily. */
  fallback?: () => readonly string[];
  /** A pinned card: its question under the title and a remove button. */
  pinned?: { question: string; onArchive: () => void };
}

function SourcesLine({ sources }: { sources: readonly ComponentSource[] | null | undefined }) {
  const { tr } = useLocale();
  if (!sources || !sources.length) return null;
  return (
    <p style={{ ...muted, display: 'flex', flexWrap: 'wrap', gap: '0.25rem 0.6rem' }}>
      <span style={{ fontWeight: 600 }}>{tr('ws.analytics.components.sources')}:</span>
      {sources.map((s, i) => {
        const range = rangeSearch(s.args);
        return (
          <span key={`${i}-${s.name}`} title={range ? `${range.from} → ${range.to}` : undefined} style={{ color: s.error ? 'var(--tp-warn-fg)' : undefined }}>
            {s.name}
            {s.row_count != null && ` · ${tr('ws.analytics.components.rows', { n: s.row_count })}`}
          </span>
        );
      })}
    </p>
  );
}

export function AssistantComponentCard({ componentKey, title, params, f, tip, fallback, pinned }: AssistantComponentCardProps) {
  const { tr } = useLocale();
  const confirm = useConfirm();
  const toast = useToast();
  const reasonRef = useRef('');
  const [error, setError] = useState<unknown>(null);
  const component = useAssistantComponent(componentKey, params);
  const pricing = useComponentPricing();

  const verdict = component.verdict;
  const shown: CacheView | null = verdict ? (verdict.hit ? verdict : verdict.last) : null;
  const stale = verdict !== undefined && !verdict.hit && verdict.last !== null;
  const degraded = verdict?.degraded === true;
  const fresh = verdict?.hit === true && verdict.fresh === true;
  const tokens = shown?.tokens ?? null;
  const tokenTotal = tokens ? totalTokens(tokens) : 0;
  const cost =
    tokens && pricing.data
      ? tokens.cost_micros ?? priceFor({ model: tokens.model ?? '', ...tokens }, pricing.data.pricing, pricing.data.fallback_micros_per_mtok)
      : null;
  const fallbackLines = !verdict?.hit && fallback ? fallback() : [];

  async function refresh() {
    setError(null);
    try {
      const res = await component.refresh(false);
      if (res.degraded) toast.info(tr('ws.analytics.components.degraded'));
    } catch (e) {
      setError(e);
    }
  }

  async function hide(finding: InsightWire) {
    reasonRef.current = '';
    const ok = await confirm({
      title: tr('ws.analytics.components.hide'),
      body: (
        <div>
          <p style={{ marginBlockStart: 0 }}>{tr('ws.analytics.components.rejectPrompt')}</p>
          <p style={{ ...muted, fontStyle: 'italic' }}>{finding.text}</p>
          <label style={{ display: 'block', fontSize: 'var(--tp-fs-sm)' }}>
            {tr('ws.analytics.components.rejectReason')}
            <textarea
              rows={2}
              style={{ inlineSize: '100%', boxSizing: 'border-box', marginBlockStart: '0.2rem' }}
              onChange={(e) => {
                reasonRef.current = e.target.value;
              }}
            />
          </label>
        </div>
      ),
      kind: 'danger',
    });
    if (!ok) return;
    setError(null);
    try {
      toast.ok(tr('ws.analytics.components.hidden'));
      await component.reject(finding.text, reasonRef.current.trim() || undefined);
    } catch (e) {
      setError(e);
    }
  }

  const state = component.status === 'loading' ? 'loading' : component.status === 'error' ? 'error' : 'ready';

  return (
    <CardShell
      title={title}
      state={state}
      error={component.status === 'error' ? component.error : undefined}
      onRetry={component.reload}
      tip={tip ?? tr(pinned ? 'ws.analytics.components.pinnedTip' : 'ws.analytics.components.tip')}
      note={
        pinned ? (
          <span>
            {tr('ws.analytics.components.pinned')} · {pinned.question.split('\n')[0]}
          </span>
        ) : undefined
      }
      actions={
        <>
          {component.busy && <Spinner size="xs" label={tr('ws.analytics.components.writing')} />}
          {pinned && (
            <Button size="sm" kind="ghost" onClick={pinned.onArchive} disabled={component.busy}>
              {tr('ws.analytics.components.archive')}
            </Button>
          )}
          <Button size="sm" icon="refresh" disabled={component.busy || state !== 'ready'} onClick={() => void refresh()} title={tr('ws.analytics.components.refreshBilled')}>
            {cost != null ? tr('ws.analytics.components.refreshPrice', { cost: formatUsd(cost) }) : tr('ws.analytics.components.refresh')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {shown && (
          <p style={muted}>
            {fresh ? tr('ws.analytics.components.fresh') : tr('ws.analytics.components.generatedAt', { date: f.dateTime(shown.generated_at) })}
            {tokenTotal > 0 && ` · ${tr('ws.analytics.components.cost', { tokens: formatTokens(tokenTotal), cost: cost != null ? formatUsd(cost) : '—' })}`}
          </p>
        )}
        {stale && <p style={{ ...muted, color: 'var(--tp-warn-fg)' }}>{tr('ws.analytics.components.stale')}</p>}
        {degraded && <p style={muted}>{tr('ws.analytics.components.degraded')}</p>}
        <ErrorText error={error} />
        {shown ? (
          <div aria-busy={component.busy || undefined} style={{ opacity: stale || component.busy ? 0.6 : 1, transition: 'opacity var(--tp-dur-fast) var(--tp-ease-out)' }}>
            <ContentView content={shown.content} params={params} f={f} onHide={verdict?.hit ? (fnd) => void hide(fnd) : undefined} busy={component.busy} />
          </div>
        ) : (
          <p style={muted}>{tr('ws.analytics.components.neverWritten')}</p>
        )}
        {shown?.gate?.status === 'unverified' && shown.gate.unverified.length > 0 && (
          <p style={{ ...muted, color: 'var(--tp-warn-fg)' }}>
            {tr('ws.analytics.components.unverified', { list: shown.gate.unverified.map((u) => u.raw).join(', ') })}
          </p>
        )}
        {shown && <SourcesLine sources={shown.sources} />}
        {fallbackLines.length > 0 && (
          <div>
            <p style={{ ...muted, fontWeight: 600, marginBlockEnd: '0.2rem' }}>{tr('ws.analytics.components.fallbackTitle')}</p>
            <ul style={{ margin: 0, paddingInlineStart: '1.1rem', fontSize: 'var(--tp-fs-sm)', display: 'grid', gap: '0.2rem' }}>
              {fallbackLines.slice(0, 5).map((t, i) => (
                <li key={`${i}-${t}`}>{t}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </CardShell>
  );
}
