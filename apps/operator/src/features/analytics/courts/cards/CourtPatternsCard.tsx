/**
 * The deterministic court patterns: one line per candidate, the kind as a
 * label, the sample it rests on printed verbatim (the honesty floor), and the
 * confidence as the same StatusBadge tones the cafe tab uses. Nothing here
 * calls a model; the AI reading sits in the card beside it when it is on.
 */
import { useState } from 'react';
import type { CompareBasis, CourtPatternCandidate, CourtPatternKind, DateRange } from '@touch/core';
import type { Locale, MessageKey } from '@touch/i18n';
import { StatusBadge } from '../../../../components/kit';
import { Button, ErrorText, Spinner } from '../../../../components/ui';
import { useLocale } from '../../../../lib/i18n';
import { analyticsRpc, insights as callInsights, type JudgedPattern } from '../../../../lib/analyticsApi';
import { CardShell, muted, type CardState } from '../../cards/CardShell';
import { toPatternWire } from '../../patterns';
import type { StoredSets } from '../../useAnalyticsData';

const KIND_KEY: Record<CourtPatternKind, MessageKey> = {
  'dead-slot': 'ws.analytics.courts.patterns.kinds.deadSlot',
  'saturated-slot': 'ws.analytics.courts.patterns.kinds.saturatedSlot',
  shift: 'ws.analytics.courts.patterns.kinds.shift',
  'ending-cluster': 'ws.analytics.courts.patterns.kinds.endingCluster',
  lapsing: 'ws.analytics.courts.patterns.kinds.lapsing',
  'attach-gap': 'ws.analytics.courts.patterns.kinds.attachGap',
  'court-basket': 'ws.analytics.courts.patterns.kinds.courtBasket',
};

const TONE: Record<CourtPatternCandidate['confidence'], 'success' | 'warn' | 'neutral'> = { high: 'success', medium: 'warn', low: 'neutral' };

export function CourtPatternsCard({
  patterns,
  state,
  refreshing,
  tip,
  range,
  compareBasis,
  courtId = null,
  stored,
}: {
  patterns: readonly CourtPatternCandidate[];
  state: CardState;
  refreshing?: boolean;
  tip: string;
  range: DateRange;
  compareBasis: CompareBasis;
  /** The tab's court filter (0098): the judged set is stored under this court; null = venue-wide. */
  courtId?: string | null;
  stored: StoredSets;
}) {
  const { tr, locale } = useLocale();
  const [judged, setJudged] = useState<JudgedPattern[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [degraded, setDegraded] = useState(false);
  const shown = patterns.slice(0, 10);
  // A judged sentence replaces the templated one for the same candidate id;
  // the statistics never change, only the wording.
  const byId = new Map((judged ?? stored.patterns?.patterns ?? []).map((p) => [p.id, p]));

  async function judge() {
    if (shown.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await callInsights({
        mode: 'patterns',
        lang: locale as 'ar' | 'en',
        range_from: range.from,
        range_to: range.to,
        compare_basis: compareBasis,
        scope: 'courts',
        data: {
          rejections: stored.rejections.map((r) => r.text),
          patterns: shown.map(toPatternWire),
        },
      });
      setDegraded(res.degraded);
      const out = res.patterns ?? [];
      setJudged(out);
      if (out.length > 0) {
        await analyticsRpc.savePatterns({ from: range.from, to: range.to, locale: locale as Locale, scope: 'courts', courtId, patterns: out });
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
      title={tr('ws.analytics.courts.cards.patterns')}
      tip={tip}
      state={state === 'ready' && shown.length === 0 ? 'empty' : state}
      refreshing={refreshing}
      note={degraded ? tr('analytics.notices.noAi') : undefined}
      emptyKey="ws.analytics.courts.patterns.none"
      skeletonLines={5}
      actions={
        <>
          {busy && <Spinner size="xs" />}
          {shown.length > 0 && (
            <Button size="sm" disabled={busy || state !== 'ready'} onClick={() => void judge()}>
              {tr('analytics.patterns.reword')}
            </Button>
          )}
        </>
      }
    >
      <ErrorText error={error} />
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 'var(--tp-sp-2-5)' }}>
        {shown.map((p) => (
          <li key={p.id} style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>
              <StatusBadge size="sm" dot={false} tone="neutral" label={tr(KIND_KEY[p.kind])} />
              <StatusBadge size="sm" tone={TONE[p.confidence]} label={tr(`analytics.patterns.confidence.${p.confidence}` as MessageKey)} />
            </span>
            <span style={{ fontSize: 'var(--tp-fs-md)' }}>{byId.get(p.id)?.text ?? p.fallbackText}</span>
            <span style={muted}>{p.sampleLabel}</span>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}
