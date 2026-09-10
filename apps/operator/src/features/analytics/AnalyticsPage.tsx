/**
 * `/analytics` — five zones over one data hook (operator-slice.md §5).
 *
 * The page is designed to stay USEFUL in sales-only mode: with PostHog not
 * configured and the AI degraded, every till-derived card still renders and the
 * engagement cards say why they are empty instead of showing zeros.
 */
import { useMemo } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { pickLocale } from '@touch/core';
import { Button } from '../../components/ui';
import { PageHeader } from '../../components/kit';
import { useLocale } from '../../lib/i18n';
import { ControlDeck } from './ControlDeck';
import { Zone, ZoneGrid, ZONES } from './Zone';
import { makeFormatters } from './format';
import { useAnalyticsData } from './useAnalyticsData';
import type { AnalyticsSearch } from './search';
import { CardShell, muted, type CardState } from './cards/CardShell';
import { Kpi } from './cards/Kpi';
import { OverviewCard } from './cards/OverviewCard';
import { AiInsightsCard } from './cards/AiInsightsCard';
import { PatternsCard } from './cards/PatternsCard';
import { MenuMatrixCard } from './cards/MenuMatrixCard';
import { PositionCard } from './cards/PositionCard';
import { ConversionTable } from './cards/ConversionTable';
import { TopProfit } from './cards/TopProfit';
import { HiddenGems } from './cards/HiddenGems';
import { Momentum } from './cards/Momentum';
import { BoughtTogether } from './cards/BoughtTogether';
import { PromoPerformance } from './cards/PromoPerformance';
import { LocalePrefs } from './cards/LocalePrefs';
import { ChartCard } from './charts/ChartCard';
import { HBarChart } from './charts/HBarChart';
import { SalesVsEngagementChart } from './charts/SalesVsEngagementChart';
import { AbandonedViewsChart } from './charts/AbandonedViewsChart';
import { FunnelBars } from './charts/FunnelBars';
import { ConversionBars } from './charts/ConversionBars';
import { WeekHeatmap } from './charts/WeekHeatmap';
import { PeakHoursChart } from './charts/PeakHoursChart';

export function AnalyticsPage() {
  const { tr, locale } = useLocale();
  const search = useSearch({ from: '/analytics' }) as AnalyticsSearch;
  const navigate = useNavigate();
  const f = useMemo(() => makeFormatters(locale), [locale]);
  const data = useAnalyticsData(search, locale);
  const { raw, derived, state } = data;

  const setSearch = (next: Partial<AnalyticsSearch>) => {
    void navigate({ to: '/analytics', search: { ...search, ...next } });
  };

  const salesState: CardState = state.salesLoading ? 'loading' : state.salesError ? 'error' : 'ready';
  const engState: CardState =
    state.engagement === 'loading' || state.salesLoading
      ? 'loading'
      : state.engagement === 'unconfigured'
        ? 'unconfigured'
        : state.engagement === 'error'
          ? 'error'
          : salesState;

  // A failed query must show a dash, not a 0 that reads as "nothing sold".
  const salesBroken = salesState === 'error';
  const engBroken = engState === 'error' || engState === 'unconfigured' || salesBroken;
  const k = derived?.kpis;
  const vsLabel = tr('analytics.kpi.vs', { range: f.dateRange(data.compareRange.from, data.compareRange.to) });
  const mutedReason = derived && !derived.salesDeltaReliable ? tr('analytics.kpi.mutedReason') : undefined;
  const name = (id: string, en: string, ar: string) => pickLocale({ en, ar }, locale) || id;

  const bestSellerRows = (raw?.bestSellers ?? [])
    .filter((b) => derived?.keep(b.id) ?? true)
    .slice(0, 8)
    .map((b) => ({ label: name(b.id, b.nameEn, b.nameAr), value: b.revenueIqd }));

  const tableRows = (raw?.posthog?.tableActivity ?? [])
    .slice(0, 8)
    .map((t) => ({ label: t.table || '—', value: t.sessions }));

  const categoryRows = (raw?.posthog?.categoryPopularity ?? []).slice(0, 8).map((c) => {
    const known = derived?.categoryNames.get(c.id);
    return { label: known ? pickLocale({ en: known.nameEn, ar: known.nameAr }, locale) : c.nameEn, value: c.selections };
  });

  return (
    <div style={{ minInlineSize: '1024px', paddingInline: 'var(--tp-sp-4)', paddingBlockEnd: 'var(--tp-sp-6)' }}>
      {/*
        This page had no title and no h1 at all: the only "Analytics" on it was a
        micro-label inside the control deck, so heading navigation opened on
        "Pulse" and the active rail item agreed with nothing (3.4, 3.6). The
        header scrolls away and the deck below it stays sticky, which is the
        order the owner reads them in.
      */}
      <PageHeader title={tr('analytics.title')} subtitle={f.dateRange(data.range.from, data.range.to)} />
      <ControlDeck search={search} setSearch={setSearch} data={data} menu={raw?.menu ?? []} />

      {/* ---------------- 01 Pulse ---------------- */}
      <Zone zone={ZONES[0]!}>
        <Notices data={data} />
        {/* Nine tiles in three columns — a clean 3×3 instead of an orphan row. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.6rem' }}>
          <Kpi
            label={tr('analytics.kpi.sales')}
            value={f.money(k?.salesIqd ?? 0)}
            delta={derived?.salesDeltaReliable ? derived.deltas.sales : null}
            reason={mutedReason}
            vsLabel={vsLabel}
            note={tr('analytics.kpi.salesNote')}
            loading={state.salesLoading}
            unavailable={salesBroken}
            f={f}
          />
          <Kpi label={tr('analytics.kpi.tabs')} value={f.num(k?.tabs ?? 0)} delta={derived?.deltas.tabs ?? null} vsLabel={vsLabel} loading={state.salesLoading} unavailable={salesBroken} f={f} />
          <Kpi
            label={tr('analytics.kpi.covers')}
            value={k?.coversEstimated == null ? '—' : f.num(k.coversEstimated)}
            estimated={k?.coversEstimated != null}
            reason={k?.coversEstimated != null ? tr('analytics.kpi.estimated') : undefined}
            loading={state.salesLoading}
            unavailable={salesBroken}
            f={f}
          />
          <Kpi
            label={tr('analytics.kpi.perPerson')}
            value={k?.perPersonIqd == null ? '—' : f.money(k.perPersonIqd)}
            estimated={k?.perPersonIqd != null}
            loading={state.salesLoading}
            unavailable={salesBroken}
            f={f}
          />
          <Kpi label={tr('analytics.kpi.visits')} value={f.num(k?.visits ?? 0)} delta={derived?.deltas.visits ?? null} vsLabel={vsLabel} loading={engState === 'loading'} unavailable={engBroken} f={f} />
          <Kpi label={tr('analytics.kpi.views')} value={f.num(k?.views ?? 0)} delta={derived?.deltas.views ?? null} vsLabel={vsLabel} loading={engState === 'loading'} unavailable={engBroken} f={f} />
          <Kpi label={tr('analytics.kpi.median')} value={f.duration(k?.medianSeconds ?? 0)} delta={derived?.deltas.median ?? null} vsLabel={vsLabel} loading={engState === 'loading'} unavailable={engBroken} f={f} />
          <Kpi label={tr('analytics.kpi.calls')} value={f.num(k?.waiterCalls ?? 0)} delta={derived?.deltas.calls ?? null} vsLabel={vsLabel} loading={state.salesLoading} unavailable={salesBroken} f={f} />
          <Kpi
            label={tr('analytics.kpi.basketToCall')}
            value={f.pct(k?.basketToCallPct ?? 0)}
            delta={derived?.deltas.basket ?? null}
            vsLabel={vsLabel}
            note={k && !engBroken ? tr('analytics.cards.sessions') + ': ' + f.num(k.basketToCallSample) : undefined}
            loading={engState === 'loading'}
            unavailable={engBroken}
            f={f}
          />
        </div>
      </Zone>

      {/* ---------------- 02 AI ---------------- */}
      <Zone zone={ZONES[1]!}>
        <ZoneGrid columns={1}>
          <OverviewCard derived={derived} preset={data.preset} state={salesState} f={f} />
          <ZoneGrid columns={2}>
            <AiInsightsCard raw={raw} derived={derived} stored={data.stored} state={salesState} f={f} />
            <PatternsCard raw={raw} derived={derived} stored={data.stored} state={salesState} f={f} />
          </ZoneGrid>
        </ZoneGrid>
      </Zone>

      {/* ---------------- 03 Menu decisions ---------------- */}
      <Zone zone={ZONES[2]!}>
        <ZoneGrid columns={2}>
          <MenuMatrixCard derived={derived} state={salesState} f={f} />
          <PositionCard derived={derived} state={salesState} f={f} />
        </ZoneGrid>
        <div style={{ marginBlockStart: '0.75rem' }}>
          <ConversionTable
            rows={derived?.itemConversion ?? []}
            state={engState}
            f={f}
            rangeLabel={`${data.range.from}_${data.range.to}`}
          />
        </div>
        <div style={{ marginBlockStart: '0.75rem' }}>
          <ZoneGrid columns={3}>
            <TopProfit derived={derived} state={salesState} f={f} />
            <HiddenGems derived={derived} state={engState} f={f} />
            <Momentum derived={derived} state={engState} f={f} />
            <BoughtTogether derived={derived} state={salesState} f={f} />
            <PromoPerformance raw={raw} state={salesState} f={f} />
          </ZoneGrid>
        </div>
      </Zone>

      {/* ---------------- 04 Sales & engagement ---------------- */}
      <Zone zone={ZONES[3]!}>
        <ChartCard
          title={tr('analytics.cards.salesVsEngagement')}
          state={salesState === 'ready' && (derived?.salesVsEngagement.length ?? 0) === 0 ? 'empty' : salesState}
          emptyKey="analytics.empty.sales"
          height={280}
          error={state.salesError}
          onRetry={data.refetchAll}
        >
          <SalesVsEngagementChart rows={derived?.salesVsEngagement ?? []} f={f} />
        </ChartCard>
        <div style={{ marginBlockStart: '0.75rem' }}>
          <ZoneGrid columns={2}>
            <ChartCard
              title={tr('analytics.cards.bestSellers')}
              state={salesState === 'ready' && bestSellerRows.length === 0 ? 'empty' : salesState}
              emptyKey="analytics.empty.sales"
            >
              <HBarChart rows={bestSellerRows} format={(n) => f.compact(n)} name={tr('analytics.cards.revenue')} />
            </ChartCard>
            <ChartCard
              title={tr('analytics.cards.lookedNotBought')}
              state={engState === 'ready' && (derived?.abandoned.length ?? 0) === 0 ? 'empty' : engState}
              emptyKey="analytics.empty.engagement"
              error={state.engagementError}
              onRetry={data.refetchAll}
            >
              <AbandonedViewsChart rows={derived?.abandoned ?? []} f={f} />
            </ChartCard>
            <ChartCard
              title={tr('analytics.cards.tableActivity')}
              state={engState === 'ready' && tableRows.length === 0 ? 'empty' : engState}
              emptyKey="analytics.empty.engagement"
            >
              <HBarChart rows={tableRows} format={(n) => f.num(n)} axisWidth={70} name={tr('analytics.cards.sessions')} />
            </ChartCard>
            <CardShell
              title={tr('analytics.cards.funnel')}
              state={engState === 'ready' && (raw?.posthog?.funnel.length ?? 0) === 0 ? 'empty' : engState}
              emptyKey="analytics.empty.engagement"
            >
              <FunnelBars steps={raw?.posthog?.funnel ?? []} f={f} />
            </CardShell>
            <CardShell
              title={tr('analytics.cards.priceBands')}
              state={engState === 'ready' && (derived?.priceBands.length ?? 0) === 0 ? 'empty' : engState}
              emptyKey="analytics.empty.engagement"
              note={tr('analytics.conversion.howToRead')}
            >
              <ConversionBars bands={derived?.priceBands ?? []} f={f} />
            </CardShell>
            <ChartCard
              title={tr('analytics.cards.categoryPop')}
              state={engState === 'ready' && categoryRows.length === 0 ? 'empty' : engState}
              emptyKey="analytics.empty.engagement"
            >
              <HBarChart rows={categoryRows} format={(n) => f.num(n)} name={tr('analytics.cards.sessions')} />
            </ChartCard>
          </ZoneGrid>
        </div>
      </Zone>

      {/* ---------------- 05 Time & language ---------------- */}
      <Zone zone={ZONES[4]!}>
        <CardShell
          title={tr('analytics.cards.heatmap')}
          state={engState === 'ready' && (raw?.posthog?.heatmap.length ?? 0) === 0 ? 'empty' : engState}
          emptyKey="analytics.empty.heatmap"
        >
          <WeekHeatmap cells={raw?.posthog?.heatmap ?? []} f={f} />
        </CardShell>
        <div style={{ marginBlockStart: '0.75rem' }}>
          <ZoneGrid columns={2}>
            <ChartCard
              title={tr('analytics.cards.peakHours')}
              state={engState === 'ready' && (raw?.posthog?.peakHours.some((h) => h.views > 0) ?? false) === false ? 'empty' : engState}
              emptyKey="analytics.empty.engagement"
            >
              <PeakHoursChart rows={raw?.posthog?.peakHours ?? []} f={f} />
            </ChartCard>
            <LocalePrefs raw={raw} state={engState} f={f} />
          </ZoneGrid>
        </div>
      </Zone>
    </div>
  );
}

/** Page-level notices: coverage gaps, business-day rule, engagement floor, no PostHog. */
function Notices({ data }: { data: ReturnType<typeof useAnalyticsData> }) {
  const { tr } = useLocale();
  const { derived, state } = data;
  const lines: string[] = [];
  if (derived && derived.coverage.missing.length > 0) {
    lines.push(tr('analytics.notices.coverage', { missing: derived.coverage.missing.length }));
  }
  lines.push(tr('analytics.notices.businessDayLine', { hour: String(data.startHour).padStart(2, '0') }));
  // Café settings unreadable → the deck is running on migration defaults; say so.
  if (state.settingsError != null) lines.push(tr('errors.generic'));
  if (state.engagement === 'unconfigured') lines.push(tr('analytics.notices.noPosthog'));
  if (derived && derived.engNow.clipped && data.raw?.floor) {
    lines.push(tr('analytics.notices.floor', { date: data.raw.floor }));
  }
  return (
    <div style={{ marginBlockEnd: '0.6rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
      {lines.map((line, i) => (
        <span key={`${i}-${line}`} style={muted}>
          {line}
        </span>
      ))}
      {state.salesError != null && (
        <Button onClick={data.refetchAll} style={{ fontSize: 'var(--tp-fs-sm)', paddingBlock: 'var(--tp-sp-1)' }}>
          {tr('common.retry')}
        </Button>
      )}
    </div>
  );
}
