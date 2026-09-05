/**
 * AI findings (operator-slice.md §5.3 zone 02).
 *
 * The edge function is STATELESS: this card gathers the numbers, POSTs them and
 * persists the answer itself through the owner RPCs.
 *   Generate → {mode:'insights'} → save_analytics_insights
 *   Re-check → {mode:'revalidate', prior_insights} → save (ongoing + new)
 *   ✕       → confirm (+ optional reason) → reject_insight FIRST (so the server
 *             filter knows about it), THEN {mode:'replace_rejected'}, then save.
 * A degraded response (no GROQ key) still carries templated findings — the card
 * says so rather than pretending a model spoke.
 */
import { useRef, useState } from 'react';
import { describeBasis, isThinPeriod } from '@touch/core';
import type { Locale } from '@touch/i18n';
import { Button, ErrorText, Spinner } from '../../../components/ui';
import { useConfirm } from '../../../components/ConfirmDialog';
import { useToast } from '../../../components/toast';
import { useLocale } from '../../../lib/i18n';
import { analyticsRpc, insights as callInsights, type Insight } from '../../../lib/analyticsApi';
import { basisCopy } from '../copy';
import type { Derived, RawAnalytics } from '../derive';
import type { Formatters } from '../format';
import { buildInsightsData } from '../payload';
import type { StoredSets } from '../useAnalyticsData';
import { CardShell, muted, type CardState } from './CardShell';
import { StatusBadge } from '../../../components/kit';

type Busy = null | 'generate' | 'recheck' | 'replace';

export function AiInsightsCard({
  raw,
  derived,
  stored,
  state,
  f,
}: {
  raw: RawAnalytics | null;
  derived: Derived | null;
  stored: StoredSets;
  state: CardState;
  f: Formatters;
}) {
  const { tr, locale } = useLocale();
  const confirm = useConfirm();
  const toast = useToast();
  const reasonRef = useRef('');
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<unknown>(null);
  const [degraded, setDegraded] = useState(false);
  const [live, setLive] = useState<Insight[] | null>(null);

  const latest = stored.insights[0] ?? null;
  const shown = live ?? latest?.insights ?? [];
  const rejectedTexts = stored.rejections.map((r) => r.text);
  const ready = raw !== null && derived !== null;

  async function save(list: Insight[]) {
    if (!raw) return;
    await analyticsRpc.saveInsights({
      from: raw.range.from,
      to: raw.range.to,
      basis: raw.compareBasis,
      locale: locale as Locale,
      insights: list,
    });
    stored.reload();
  }

  async function run(mode: 'insights' | 'revalidate' | 'replace_rejected', prior?: string[]) {
    if (!raw || !derived) return;
    setBusy(mode === 'insights' ? 'generate' : mode === 'revalidate' ? 'recheck' : 'replace');
    setError(null);
    try {
      const res = await callInsights({
        mode,
        lang: locale as 'ar' | 'en',
        range_from: raw.range.from,
        range_to: raw.range.to,
        compare_basis: raw.compareBasis,
        data: buildInsightsData(raw, derived, locale, { priorInsights: prior, rejections: rejectedTexts }),
      });
      setDegraded(res.degraded);
      setLive(res.insights);
      await save(res.insights);
      if (mode === 'replace_rejected' && res.insights.length === 0) toast.info(tr('analytics.insights.noReplacement'));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function reject(insight: Insight) {
    reasonRef.current = '';
    const ok = await confirm({
      title: tr('analytics.insights.reject'),
      body: (
        <div>
          <p style={{ marginBlockStart: 0 }}>{tr('analytics.insights.rejectPrompt')}</p>
          <p style={{ ...muted, fontStyle: 'italic' }}>{insight.text}</p>
          <label style={{ display: 'block', fontSize: 'var(--tp-fs-sm)' }}>
            {tr('analytics.insights.rejectReason')}
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
    try {
      // Reject first: `replace_rejected` must run with the rejection already stored.
      await analyticsRpc.rejectInsight(insight.text, reasonRef.current.trim() || undefined);
      stored.reload();
      toast.ok(tr('analytics.insights.rejected'));
      const remaining = shown.filter((i) => i.text !== insight.text);
      setLive(remaining);
      await run('replace_rejected', remaining.map((i) => i.text));
    } catch (err) {
      setError(err);
    }
  }

  const basisLine = derived ? describeBasis(derived.basis, basisCopy(tr, f)) : '';
  const thin = derived ? isThinPeriod(derived.basis) : false;

  return (
    <CardShell
      title={tr('analytics.insights.title')}
      state={state === 'ready' && shown.length === 0 && busy === null ? 'empty' : state}
      emptyKey="analytics.insights.empty"
      note={
        <>
          {tr('analytics.insights.source')}
          {basisLine && ` · ${tr('analytics.insights.basis')}: ${basisLine}`}
          {thin && ` · ${tr('analytics.notices.thinPeriod')}`}
        </>
      }
      actions={
        <>
          {busy && <Spinner size="xs" label={tr('analytics.insights.checking')} />}
          <Button
            disabled={!ready || busy !== null}
            onClick={() => void run('insights')}
            style={{ fontSize: 'var(--tp-fs-sm)', paddingBlock: '0.25rem' }}
          >
            {tr('analytics.insights.generate')}
          </Button>
          <Button
            disabled={!ready || busy !== null || shown.length === 0}
            onClick={() => void run('revalidate', shown.map((i) => i.text))}
            style={{ fontSize: 'var(--tp-fs-sm)', paddingBlock: '0.25rem' }}
          >
            {tr('analytics.insights.recheck')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {degraded && <p style={{ ...muted, color: 'var(--tp-danger)' }}>{tr('analytics.insights.degraded')}</p>}
        {busy === 'replace' && <p style={muted}>{tr('analytics.insights.replacing')}</p>}
        <ErrorText error={error} />
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.45rem' }}>
          {shown.map((insight, i) => (
            <li key={`${i}-${insight.text}`} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
              <StatusBadge
                size="sm"
                tone={insight.confidence === 'high' ? 'success' : insight.confidence === 'low' ? 'warn' : 'neutral'}
                label={tr(`analytics.patterns.confidence.${insight.confidence}`)}
              />
              <span style={{ flex: 1, fontSize: 'var(--tp-fs-md)' }}>
                {insight.text}
                {insight.status === 'ongoing' && (
                  <span style={{ marginInlineStart: '0.4rem' }}>
                    <StatusBadge size="sm" tone="neutral" dot={false} label={tr('analytics.insights.ongoing')} />
                  </span>
                )}
              </span>
              <Button
                kind="ghost"
                aria-label={tr('analytics.insights.reject')}
                title={tr('analytics.insights.reject')}
                disabled={busy !== null}
                onClick={() => void reject(insight)}
                style={{ paddingBlock: '0.1rem', paddingInline: '0.35rem' }}
              >
                ✕
              </Button>
            </li>
          ))}
        </ul>
        {stored.insights.length > 1 && (
          <details>
            <summary style={{ ...muted, cursor: 'pointer' }}>{tr('analytics.insights.history')}</summary>
            <div style={{ display: 'grid', gap: '0.4rem', marginBlockStart: '0.4rem' }}>
              {stored.insights.slice(1).map((row) => (
                <div key={row.id}>
                  <span style={muted}>{tr('analytics.insights.generatedAt', { date: f.date(row.created_at.slice(0, 10), true) })}</span>
                  <ul style={{ margin: '0.15rem 0 0', paddingInlineStart: '1.1rem', fontSize: 'var(--tp-fs-sm)' }}>
                    {row.insights.map((i) => (
                      <li key={i.text}>{i.text}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </CardShell>
  );
}
