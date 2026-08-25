/**
 * Deterministic overview — `buildOverview` from @touch/core over the numbers the
 * page already has. No model call, so it can never invent a metric; the copy
 * comes from `analytics.overview.copy.*` in the catalog through `overviewCopy`.
 */
import { useMemo } from 'react';
import { buildOverview, type OverviewTone } from '@touch/core';
import type { MessageKey } from '@touch/i18n';
import { useLocale } from '../../../lib/i18n';
import { overviewCopy } from '../copy';
import type { Derived } from '../derive';
import type { Formatters } from '../format';
import { CardShell, Chip, muted, type CardState } from './CardShell';

const TONE_KEY: Record<OverviewTone, MessageKey> = {
  good: 'analytics.overview.toneStrong',
  neutral: 'analytics.overview.toneSteady',
  mixed: 'analytics.overview.toneSoft',
  weak: 'analytics.overview.toneWatch',
};

const TONE_CHIP: Record<OverviewTone, 'good' | 'neutral' | 'warn' | 'bad'> = {
  good: 'good',
  neutral: 'neutral',
  mixed: 'warn',
  weak: 'bad',
};

export function OverviewCard({
  derived,
  preset,
  state,
  f,
}: {
  derived: Derived | null;
  preset: string;
  state: CardState;
  f: Formatters;
}) {
  const { tr, locale } = useLocale();

  const overview = useMemo(() => {
    if (!derived) return null;
    const copy = overviewCopy(tr, f, locale);
    const k = derived.kpis;
    return buildOverview(
      {
        preset,
        kpis: {
          totalSalesIqd: k.salesIqd,
          totalCovers: k.coversEstimated ?? 0,
          avgSpendPerCoverIqd: k.perPersonIqd ?? 0,
          sessions: k.sessions,
          medianSeconds: k.medianSeconds,
          waiterCalls: k.waiterCalls,
          views: k.views,
          basketConversionPct: k.basketToCallPct,
        },
        deltas: {
          totalSales: derived.salesDeltaReliable ? derived.deltas.sales : null,
          avgSpendPerCover: null,
          totalCovers: derived.deltas.visits,
          basketConversion: derived.deltas.basket,
          views: derived.deltas.views,
          sessions: derived.deltas.visits,
        },
        itemConversion: derived.itemConversion,
        abandonedViews: derived.abandoned,
        bestSellers: derived.soldTotals
          .map((s) => ({ ...(derived.names.get(s.id) ?? { id: s.id, nameEn: s.id, nameAr: s.id }), qty: s.qty, revenueIqd: s.revenueIqd }))
          .sort((a, b) => b.qty - a.qty),
        menuEngineering: derived.menuEngineering,
      },
      copy,
    );
  }, [derived, preset, tr, f, locale]);

  const empty = overview !== null && overview.strengths.length === 0 && overview.push.length === 0 && overview.watch.length === 0;

  return (
    <CardShell
      title={tr('analytics.overview.title')}
      state={state === 'ready' && (overview === null || empty) ? 'empty' : state}
      emptyKey="analytics.overview.noData"
      actions={overview && <Chip tone={TONE_CHIP[overview.tone]}>{tr(TONE_KEY[overview.tone])}</Chip>}
    >
      {overview && (
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          <p style={{ margin: 0, fontSize: '0.95rem' }}>{overview.headline}</p>
          <Group titleKey="analytics.overview.strengths" lines={overview.strengths} />
          <Group titleKey="analytics.overview.push" lines={overview.push} />
          <Group titleKey="analytics.overview.watch" lines={overview.watch} />
        </div>
      )}
    </CardShell>
  );
}

function Group({ titleKey, lines }: { titleKey: MessageKey; lines: readonly string[] }) {
  const { tr } = useLocale();
  if (lines.length === 0) return null;
  return (
    <div>
      <span style={{ ...muted, display: 'block', fontWeight: 700 }}>{tr(titleKey)}</span>
      <ul style={{ margin: '0.2rem 0 0', paddingInlineStart: '1.1rem', fontSize: '0.85rem', display: 'grid', gap: '0.2rem' }}>
        {lines.map((line, i) => (
          <li key={`${i}-${line}`}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
