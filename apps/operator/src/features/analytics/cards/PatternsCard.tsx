/**
 * Patterns (zone 02). The STATISTICS are mined locally by `minePatterns` — the
 * model is only a quality gate that rewrites the wording. So this card works
 * fully with no AI configured: it renders each candidate's `fallbackText`, and
 * a successful judge pass simply replaces those sentences with better ones.
 */
import { useMemo, useState } from 'react';
import type { PatternCandidate, PatternLevel } from '@touch/core';
import type { Locale, MessageKey } from '@touch/i18n';
import { Button, ErrorText, Spinner } from '../../../components/ui';
import { useLocale } from '../../../lib/i18n';
import { analyticsRpc, insights as callInsights, type JudgedPattern } from '../../../lib/analyticsApi';
import { patternsCopy } from '../copy';
import type { Derived, RawAnalytics } from '../derive';
import type { Formatters } from '../format';
import { mineCafeCandidates, toPatternWire } from '../patterns';
import type { StoredSets } from '../useAnalyticsData';
import { CardShell, muted, type CardState } from './CardShell';
import { StatusBadge } from '../../../components/kit';

const KIND_KEY: Record<string, MessageKey> = {
  'co-move': 'analytics.patterns.kinds.coMove',
  basket: 'analytics.patterns.kinds.basket',
  time: 'analytics.patterns.kinds.time',
  segment: 'analytics.patterns.kinds.segment',
  margin: 'analytics.patterns.kinds.margin',
};

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

  // The same miner the insights payload carries as ground truth (../patterns.ts).
  const candidates = useMemo<PatternCandidate[]>(
    () => (raw && derived ? mineCafeCandidates(raw, derived, level, patternsCopy(tr, f, locale)) : []),
    [raw, derived, level, tr, f, locale],
  );

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
        scope: 'cafe',
        data: {
          rejections: stored.rejections.map((r) => r.text),
          patterns: candidates.map(toPatternWire),
        },
      });
      setDegraded(res.degraded);
      const out = res.patterns ?? [];
      setJudged(out);
      if (out.length > 0) {
        await analyticsRpc.savePatterns({ from: raw.range.from, to: raw.range.to, locale: locale as Locale, scope: 'cafe', patterns: out });
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
          {candidates.length > 0 && (
            <Button size="sm" disabled={busy} onClick={() => void judge()}>
              {tr('analytics.patterns.reword')}
            </Button>
          )}
          {/* Each step lowers the sample floor; the confidence badge on every line says what that costs. */}
          {level < 2 && (
            <Button size="sm" disabled={busy} onClick={() => setLevel((l) => Math.min(2, l + 1) as PatternLevel)}>
              {tr('analytics.patterns.rescan')}
            </Button>
          )}
        </>
      }
    >
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        <ErrorText error={error} />
        {rows.map(({ candidate, text }) => (
          <div key={candidate.id} style={{ borderInlineStart: '1px solid var(--tp-border)', paddingInlineStart: '0.55rem' }}>
            <div style={{ display: 'flex', gap: '0.3rem', marginBlockEnd: '0.15rem', flexWrap: 'wrap' }}>
              <StatusBadge size="sm" tone="accent" dot={false} label={KIND_KEY[candidate.kind] ? tr(KIND_KEY[candidate.kind]!) : candidate.kind} />
              <StatusBadge
                size="sm"
                tone={candidate.confidence === 'high' ? 'success' : candidate.confidence === 'low' ? 'warn' : 'neutral'}
                label={tr(`analytics.patterns.confidence.${candidate.confidence}`)}
              />
              <span style={muted}>{candidate.sampleLabel}</span>
            </div>
            <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)' }}>{text}</p>
          </div>
        ))}
      </div>
    </CardShell>
  );
}
