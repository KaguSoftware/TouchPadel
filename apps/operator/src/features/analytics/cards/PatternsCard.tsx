/**
 * Patterns (zone 02). The STATISTICS are mined locally by `minePatterns` — the
 * model is only a quality gate that rewrites the wording. So this card works
 * fully with no AI configured: it renders each candidate's `fallbackText`, and
 * a successful judge pass simply replaces those sentences with better ones.
 */
import { useMemo, useState } from 'react';
import { minePatterns, type PatternCandidate, type PatternLevel } from '@touch/core';
import type { Locale, MessageKey } from '@touch/i18n';
import { Button, ErrorText, Spinner } from '../../../components/ui';
import { useLocale } from '../../../lib/i18n';
import { analyticsRpc, insights as callInsights, type JudgedPattern, type PatternCandidateWire } from '../../../lib/analyticsApi';
import { patternsCopy } from '../copy';
import type { Derived, RawAnalytics } from '../derive';
import type { Formatters } from '../format';
import type { StoredSets } from '../useAnalyticsData';
import { CardShell, Chip, muted, type CardState } from './CardShell';

const KIND_KEY: Record<string, MessageKey> = {
  'co-move': 'analytics.patterns.kinds.coMove',
  basket: 'analytics.patterns.kinds.basket',
  time: 'analytics.patterns.kinds.time',
  segment: 'analytics.patterns.kinds.segment',
  margin: 'analytics.patterns.kinds.margin',
};

function toWire(c: PatternCandidate): PatternCandidateWire {
  return {
    id: c.id,
    kind: c.kind,
    subjects: c.subjects,
    metrics: c.metrics,
    confidence: c.confidence,
    sampleLabel: c.sampleLabel,
    desc: c.desc,
    fallbackText: c.fallbackText,
  };
}

export function PatternsCard({
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
  const [level, setLevel] = useState<PatternLevel>(0);
  const [judged, setJudged] = useState<JudgedPattern[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [degraded, setDegraded] = useState(false);

  const candidates = useMemo<PatternCandidate[]>(() => {
    if (!raw || !derived) return [];
    const costs = new Map<string, { priceIqd: number; costIqd: number }>();
    for (const m of raw.menu) if (m.costIqd !== null && m.priceIqd > 0) costs.set(m.id, { priceIqd: m.priceIqd, costIqd: m.costIqd });
    return minePatterns(
      {
        soldByDay: raw.soldByDay.map((r) => ({ id: r.id, date: r.date, qty: r.qty, revenueIqd: r.revenueIqd })),
        recordedDays: raw.daily.map((d) => d.date),
        priceBands: derived.priceBands,
        locales: raw.posthog?.localePreferences.map((l) => ({
          locale: l.locale,
          sessions: l.sessions,
          topItems: l.topItems.map((t) => ({ id: t.id, rate: t.rate })),
        })),
        costs,
        names: derived.names,
        keep: derived.keep,
      },
      level,
      patternsCopy(tr, f, locale),
    );
  }, [raw, derived, level, tr, f, locale]);

  const storedRows = stored.patterns?.patterns ?? [];
  const byId = new Map((judged ?? storedRows).map((p) => [p.id, p]));
  const rows = candidates.map((c) => ({ candidate: c, text: byId.get(c.id)?.text ?? c.fallbackText }));

  async function judge() {
    if (!raw || candidates.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await callInsights({
        mode: 'patterns',
        lang: locale as 'ar' | 'en',
        range_from: raw.range.from,
        range_to: raw.range.to,
        compare_basis: raw.compareBasis,
        data: {
          kpis: {},
          daily: [],
          best_sellers: [],
          margins: null,
          bought_together: [],
          price_bands: [],
          promo: null,
          rejections: stored.rejections.map((r) => r.text),
          patterns: candidates.map(toWire),
        },
      });
      setDegraded(res.degraded);
      const out = res.patterns ?? [];
      setJudged(out);
      if (out.length > 0) {
        await analyticsRpc.savePatterns({ from: raw.range.from, to: raw.range.to, locale: locale as Locale, patterns: out });
        stored.reload();
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <CardShell
      title={tr('analytics.patterns.title')}
      state={state === 'ready' && rows.length === 0 ? 'empty' : state}
      emptyKey="analytics.empty.patterns"
      note={degraded ? tr('analytics.notices.noAi') : undefined}
      actions={
        <>
          {busy && <Spinner size="xs" />}
          <Button
            disabled={busy || candidates.length === 0}
            onClick={() => void judge()}
            style={{ fontSize: '0.8rem', paddingBlock: '0.25rem' }}
          >
            {tr('analytics.insights.recheck')}
          </Button>
          <Button
            disabled={busy || level >= 2}
            onClick={() => setLevel((l) => Math.min(2, l + 1) as PatternLevel)}
            style={{ fontSize: '0.8rem', paddingBlock: '0.25rem' }}
          >
            {tr('analytics.patterns.rescan')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        <ErrorText error={error} />
        {rows.map(({ candidate, text }) => (
          <div key={candidate.id} style={{ borderInlineStart: '1px solid var(--tp-border)', paddingInlineStart: '0.55rem' }}>
            <div style={{ display: 'flex', gap: '0.3rem', marginBlockEnd: '0.15rem', flexWrap: 'wrap' }}>
              <Chip tone="accent">{KIND_KEY[candidate.kind] ? tr(KIND_KEY[candidate.kind]!) : candidate.kind}</Chip>
              <Chip tone={candidate.confidence === 'high' ? 'good' : candidate.confidence === 'low' ? 'warn' : 'neutral'}>
                {tr(`analytics.patterns.confidence.${candidate.confidence}`)}
              </Chip>
              <span style={muted}>{candidate.sampleLabel}</span>
            </div>
            <p style={{ margin: 0, fontSize: '0.85rem' }}>{text}</p>
          </div>
        ))}
      </div>
    </CardShell>
  );
}
