/**
 * The deterministic court patterns: one line per candidate, the kind as a
 * label, the sample it rests on printed verbatim (the honesty floor), and the
 * confidence as the same StatusBadge tones the cafe tab uses. Nothing here
 * calls a model; the AI reading sits in the card beside it when it is on.
 */
import type { CourtPatternCandidate, CourtPatternKind } from '@touch/core';
import type { MessageKey } from '@touch/i18n';
import { StatusBadge } from '../../../../components/kit';
import { useLocale } from '../../../../lib/i18n';
import { CardShell, muted, type CardState } from '../../cards/CardShell';

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
}: {
  patterns: readonly CourtPatternCandidate[];
  state: CardState;
  refreshing?: boolean;
  tip: string;
}) {
  const { tr } = useLocale();
  const shown = patterns.slice(0, 10);
  return (
    <CardShell
      title={tr('ws.analytics.courts.cards.patterns')}
      tip={tip}
      state={state === 'ready' && shown.length === 0 ? 'empty' : state}
      refreshing={refreshing}
      emptyKey="ws.analytics.courts.patterns.none"
      skeletonLines={5}
    >
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 'var(--tp-sp-2-5)' }}>
        {shown.map((p) => (
          <li key={p.id} style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>
              <StatusBadge size="sm" dot={false} tone="neutral" label={tr(KIND_KEY[p.kind])} />
              <StatusBadge size="sm" tone={TONE[p.confidence]} label={tr(`analytics.patterns.confidence.${p.confidence}` as MessageKey)} />
            </span>
            <span style={{ fontSize: 'var(--tp-fs-md)' }}>{p.fallbackText}</span>
            <span style={muted}>{p.sampleLabel}</span>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}
