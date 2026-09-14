/**
 * `/analytics/cafe` — the Cafe tab: five zones over one data hook
 * (operator-slice.md §5, reworked 2026-09-13). The frame (title) and the
 * sticky bar (tabs, filters, jump-nav) are shared with the Courts tab; this
 * file owns everything below the bar.
 *
 * The page is designed to stay USEFUL in sales-only mode: with PostHog not
 * configured and the AI degraded, every till-derived card still renders and the
 * engagement cards say why they are empty instead of showing zeros. Every
 * explanation sits behind an info button; what stays printed is state.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { describeBasis, isThinPeriod, pickLocale } from '@touch/core';
import { useLocale } from '../../../lib/i18n';
import { SegmentedControl } from '../../../components/kit';
import { AnalyticsBar } from '../AnalyticsBar';
import { AnalyticsFrame } from '../AnalyticsFrame';
import { Notices } from '../Notices';
import { Zone, ZoneGrid, CAFE_ZONES } from '../Zone';
import { basisCopy, weekdayName } from '../copy';
import { buildInsightsData } from '../payload';
import { sumBy } from '../derive';
import { makeFormatters } from '../format';
import { useAnalyticsData } from '../useAnalyticsData';
import type { AnalyticsSearch } from '../search';
import type { PriceBandKey } from '../shape';
import { CardShell, type CardState } from '../cards/CardShell';
import { Kpi, type KpiCompare } from '../cards/Kpi';
import { OverviewCard } from '../cards/OverviewCard';
import { AiInsightsCard } from '../cards/AiInsightsCard';
import { PatternsCard } from '../cards/PatternsCard';
import { MenuMatrixCard } from '../cards/MenuMatrixCard';
import { PositionCard } from '../cards/PositionCard';
import { ConversionTable } from '../cards/ConversionTable';
import { TopProfit } from '../cards/TopProfit';
import { HiddenGems } from '../cards/HiddenGems';
import { Momentum } from '../cards/Momentum';
import { BoughtTogether } from '../cards/BoughtTogether';
import { PromoPerformance } from '../cards/PromoPerformance';
import { LocalePrefs } from '../cards/LocalePrefs';
import { ChartCard } from '../charts/ChartCard';
import { barTwin, heatTwin } from '../charts/twins';
import { HBarChart } from '../charts/HBarChart';
import { CountBars } from '../charts/CountBars';
import { SalesTrendChart } from '../charts/SalesTrendChart';
import { EngagementTrendChart } from '../charts/EngagementTrendChart';
import { AbandonedViewsChart } from '../charts/AbandonedViewsChart';
import { FunnelBars } from '../charts/FunnelBars';
import { ConversionBars } from '../charts/ConversionBars';
import { WeekHeatmap } from '../charts/WeekHeatmap';
import { PeakHoursChart } from '../charts/PeakHoursChart';

const BAND_KEY: Record<PriceBandKey, 'lt3000' | 'b3000' | 'b6000' | 'gte10000'> = {
  lt3000: 'lt3000',
  '3000_5999': 'b3000',
  '6000_9999': 'b6000',
  gte10000: 'gte10000',
};

export function CafeTab() {
  const { tr, locale } = useLocale();
  const search = useSearch({ from: '/analytics' }) as AnalyticsSearch;
  const navigate = useNavigate();
  const f = useMemo(() => makeFormatters(locale), [locale]);
  const data = useAnalyticsData(search, locale);
  const { raw, derived, state } = data;
  const [tillMeasure, setTillMeasure] = useState<'orders' | 'revenue'>('orders');

  const setSearch = (next: Partial<AnalyticsSearch>) => {
    void navigate({ to: '/analytics/cafe', search: { ...search, ...next } });
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
  const compare = (current: string, previous: string): KpiCompare => ({ label: vsLabel, current, previous });
  const basisLine = derived ? describeBasis(derived.basis, basisCopy(tr, f)) : '';
  const thin = derived ? isThinPeriod(derived.basis) : false;
  const prev = raw?.posthogPrev ?? null;

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

  const tillCells = (raw?.hourly ?? []).map((c) => ({ dow: c.dow, hour: c.hour, value: tillMeasure === 'orders' ? c.orders : c.revenueIqd }));
  const tillFormat = (n: number) => (tillMeasure === 'orders' ? `${f.num(n)} ${tr('ws.analytics.cafe.toggleOrders').toLowerCase()}` : f.money(n));
  const viewCells = (raw?.posthog?.heatmap ?? []).map((c) => ({ dow: c.dow, hour: c.hour, value: c.views }));
  // The shared twin builders (charts/twins.ts), so both tabs hand the table view the same rows.
  const heatCells = (cells: readonly { dow: number; hour: number; value: number }[]) =>
    [...cells].sort((a, b) => a.dow - b.dow || a.hour - b.hour).map((c) => ({ day: weekdayName(tr, c.dow), hour: f.hour(c.hour), value: c.value }));
  const rangeLabel = `${data.range.from}_${data.range.to}`;
  const bandRows = (raw?.priceBandSales ?? []).map((b) => ({ label: tr(`ws.analytics.cafe.bands.${BAND_KEY[b.band]}`), value: b.qty }));

  return (
    <AnalyticsFrame subtitle={f.dateRange(data.range.from, data.range.to)}>
      <AnalyticsBar
        tab="cafe"
        search={search}
        setSearch={setSearch}
        zones={CAFE_ZONES}
        compareBasis={data.compareBasis}
        deck={{
          startHour: data.startHour,
          live: data.live,
          refreshMinutes: data.refreshMinutes,
          setRefreshMinutes: data.setRefreshMinutes,
          autoRefreshActive: data.autoRefreshActive,
          cafe: {
            coversMultiplier: data.coversMultiplier,
            setCoversMultiplier: data.setCoversMultiplier,
            excludedIds: data.excludedIds,
            menu: raw?.menu ?? [],
          },
        }}
      />
      <Notices
        lines={[
          ...(derived && derived.coverage.missing.length > 0 ? [tr('analytics.notices.coverage', { missing: derived.coverage.missing.length })] : []),
          ...(state.settingsError != null ? [tr('errors.generic')] : []),
          ...(state.engagement === 'unconfigured' ? [tr('analytics.notices.noPosthog')] : []),
          ...(derived && derived.engNow.clipped && raw?.floor ? [tr('analytics.notices.floor', { date: raw.floor })] : []),
        ]}
        onRetry={state.salesError != null ? data.refetchAll : undefined}
      />

      {/* ---------------- 01 Pulse: the money row, then the engagement row ---------------- */}
      <Zone zone={CAFE_ZONES[0]!}>
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2-5)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 'var(--tp-sp-2-5)' }}>
            <Kpi
              label={tr('analytics.kpi.sales')}
              value={f.money(k?.salesIqd ?? 0)}
              delta={derived?.salesDeltaReliable ? derived.deltas.sales : null}
              reason={mutedReason}
              vsLabel={vsLabel}
              tip={tr('ws.analytics.cafe.tips.sales')}
              compare={raw ? compare(f.money(k?.salesIqd ?? 0), f.money(sumBy(raw.dailyPrev, (r) => r.revenueIqd))) : undefined}
              loading={state.salesLoading}
              unavailable={salesBroken}
              f={f}
            />
            <Kpi
              label={tr('analytics.kpi.tabs')}
              value={f.num(k?.tabs ?? 0)}
              delta={derived?.deltas.tabs ?? null}
              vsLabel={vsLabel}
              tip={tr('ws.analytics.cafe.tips.tabs')}
              compare={raw ? compare(f.num(k?.tabs ?? 0), f.num(sumBy(raw.dailyPrev, (r) => r.tabs))) : undefined}
              loading={state.salesLoading}
              unavailable={salesBroken}
              f={f}
            />
            <Kpi
              label={tr('analytics.kpi.covers')}
              value={k?.coversEstimated == null ? '—' : f.num(k.coversEstimated)}
              estimated={k?.coversEstimated != null}
              reason={k?.coversEstimated != null ? tr('analytics.kpi.estimated') : undefined}
              tip={tr('ws.analytics.cafe.tips.covers')}
              loading={state.salesLoading}
              unavailable={salesBroken}
              f={f}
            />
            <Kpi
              label={tr('analytics.kpi.perPerson')}
              value={k?.perPersonIqd == null ? '—' : f.money(k.perPersonIqd)}
              estimated={k?.perPersonIqd != null}
              tip={tr('ws.analytics.cafe.tips.perPerson')}
              loading={state.salesLoading}
              unavailable={salesBroken}
              f={f}
            />
            <Kpi
              label={tr('analytics.kpi.calls')}
              value={f.num(k?.waiterCalls ?? 0)}
              delta={derived?.deltas.calls ?? null}
              vsLabel={vsLabel}
              tip={tr('ws.analytics.cafe.tips.calls')}
              neutral
              compare={raw ? compare(f.num(k?.waiterCalls ?? 0), f.num(sumBy(raw.dailyPrev, (r) => r.waiterCalls))) : undefined}
              loading={state.salesLoading}
              unavailable={salesBroken}
              f={f}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 'var(--tp-sp-2-5)' }}>
            <Kpi
              label={tr('analytics.kpi.visits')}
              value={f.num(k?.visits ?? 0)}
              delta={derived?.deltas.visits ?? null}
              vsLabel={vsLabel}
              tip={tr('ws.analytics.cafe.tips.visits')}
              compare={prev ? compare(f.num(k?.visits ?? 0), f.num(prev.sessionStats.visits)) : undefined}
              loading={engState === 'loading'}
              unavailable={engBroken}
              f={f}
            />
            <Kpi
              label={tr('analytics.kpi.views')}
              value={f.num(k?.views ?? 0)}
              delta={derived?.deltas.views ?? null}
              vsLabel={vsLabel}
              tip={tr('ws.analytics.cafe.tips.views')}
              compare={prev ? compare(f.num(k?.views ?? 0), f.num(sumBy(prev.dailyEngagement, (r) => r.views))) : undefined}
              loading={engState === 'loading'}
              unavailable={engBroken}
              f={f}
            />
            <Kpi
              label={tr('analytics.kpi.median')}
              value={f.duration(k?.medianSeconds ?? 0)}
              delta={derived?.deltas.median ?? null}
              vsLabel={vsLabel}
              tip={tr('ws.analytics.cafe.tips.median')}
              neutral
              compare={prev ? compare(f.duration(k?.medianSeconds ?? 0), f.duration(prev.sessionStats.medianSeconds)) : undefined}
              loading={engState === 'loading'}
              unavailable={engBroken}
              f={f}
            />
            <Kpi
              label={tr('analytics.kpi.basketToCall')}
              value={f.pct(k?.basketToCallPct ?? 0)}
              delta={derived?.deltas.basket ?? null}
              vsLabel={vsLabel}
              tip={tr('ws.analytics.cafe.tips.basketToCall')}
              note={k && !engBroken ? tr('analytics.cards.sessions') + ': ' + f.num(k.basketToCallSample) : undefined}
              compare={prev ? compare(f.pct(k?.basketToCallPct ?? 0), f.pct(prev.basketToCall.pct)) : undefined}
              loading={engState === 'loading'}
              unavailable={engBroken}
              f={f}
            />
          </div>
        </div>
      </Zone>

      {/* ---------------- 02 Insights ---------------- */}
      <Zone zone={CAFE_ZONES[1]!}>
        <ZoneGrid columns={1}>
          <OverviewCard derived={derived} preset={data.preset} state={salesState} f={f} />
          <ZoneGrid columns={2}>
            <AiInsightsCard
              scope="cafe"
              range={data.range}
              compareBasis={data.compareBasis}
              buildData={(extras) => (raw && derived ? buildInsightsData(raw, derived, locale, extras) : null)}
              note={
                basisLine || thin ? (
                  <>
                    {basisLine && `${tr('analytics.insights.basis')}: ${basisLine}`}
                    {basisLine && thin && ' · '}
                    {thin && tr('analytics.notices.thinPeriod')}
                  </>
                ) : undefined
              }
              stored={data.stored}
              state={salesState}
              f={f}
            />
            <PatternsCard raw={raw} derived={derived} stored={data.stored} state={salesState} f={f} />
          </ZoneGrid>
        </ZoneGrid>
      </Zone>

      {/* ---------------- 03 Menu decisions ---------------- */}
      <Zone zone={CAFE_ZONES[2]!}>
        <ZoneGrid columns={2}>
          <MenuMatrixCard derived={derived} state={salesState} f={f} />
          <PositionCard derived={derived} state={salesState} f={f} />
        </ZoneGrid>
        <div style={{ marginBlockStart: 'var(--tp-sp-3)' }}>
          <ConversionTable rows={derived?.itemConversion ?? []} state={engState} f={f} rangeLabel={rangeLabel} />
        </div>
        <div style={{ marginBlockStart: 'var(--tp-sp-3)' }}>
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
      <Zone zone={CAFE_ZONES[3]!}>
        <ChartCard
          title={tr('analytics.cards.salesVsEngagement')}
          tip={tr('ws.analytics.cafe.trendTip')}
          state={salesState === 'ready' && (derived?.salesVsEngagement.length ?? 0) === 0 ? 'empty' : salesState}
          emptyKey="analytics.empty.sales"
          height={360}
          error={state.salesError}
          onRetry={data.refetchAll}
          twin={{
            columns: [
              { key: 'date', label: tr('ws.reports.filters.group') },
              { key: 'revenue', label: tr('analytics.cards.revenue'), numeric: true },
              { key: 'views', label: tr('analytics.cards.viewsSeries'), numeric: true },
              { key: 'waiterCalls', label: tr('analytics.cards.callsSeries'), numeric: true },
            ],
            rows: (derived?.salesVsEngagement ?? []).map((r) => ({ date: f.date(r.date, true), revenue: r.revenue, views: r.views, waiterCalls: r.waiterCalls })),
            file: `sales-engagement-${rangeLabel}`,
          }}
        >
          <div style={{ display: 'grid', gridTemplateRows: '200px 150px', gap: 'var(--tp-sp-1)', blockSize: '100%' }}>
            <div>
              <SalesTrendChart rows={derived?.salesVsEngagement ?? []} f={f} />
            </div>
            <div>
              <EngagementTrendChart rows={derived?.salesVsEngagement ?? []} f={f} />
            </div>
          </div>
        </ChartCard>
        <div style={{ marginBlockStart: 'var(--tp-sp-3)' }}>
          <ZoneGrid columns={2}>
            <ChartCard
              title={tr('analytics.cards.bestSellers')}
              state={salesState === 'ready' && bestSellerRows.length === 0 ? 'empty' : salesState}
              emptyKey="analytics.empty.sales"
              twin={barTwin(bestSellerRows, tr('analytics.conversion.item'), tr('analytics.cards.revenue'), `best-sellers-${rangeLabel}`)}
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
              twin={barTwin(tableRows, tr('analytics.cards.tableActivity'), tr('analytics.cards.sessions'), `table-activity-${rangeLabel}`)}
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
              tip={tr('analytics.conversion.howToRead')}
              state={engState === 'ready' && (derived?.priceBands.length ?? 0) === 0 ? 'empty' : engState}
              emptyKey="analytics.empty.engagement"
            >
              <ConversionBars bands={derived?.priceBands ?? []} f={f} />
            </CardShell>
            <ChartCard
              title={tr('ws.analytics.cafe.priceBandSales')}
              tip={tr('ws.analytics.cafe.priceBandSalesTip')}
              state={salesState === 'ready' && bandRows.every((b) => b.value === 0) ? 'empty' : salesState}
              emptyKey="analytics.empty.sales"
              height={200}
              twin={barTwin(bandRows, tr('ws.analytics.cafe.priceBandSales'), tr('analytics.cards.quantity'), `price-band-sales-${rangeLabel}`)}
            >
              <CountBars rows={bandRows} format={(n) => f.num(n)} name={tr('analytics.cards.quantity')} emphasise="none" />
            </ChartCard>
            <ChartCard
              title={tr('analytics.cards.categoryPop')}
              state={engState === 'ready' && categoryRows.length === 0 ? 'empty' : engState}
              emptyKey="analytics.empty.engagement"
              twin={barTwin(categoryRows, tr('analytics.cards.categoryPop'), tr('analytics.cards.sessions'), `categories-${rangeLabel}`)}
            >
              <HBarChart rows={categoryRows} format={(n) => f.num(n)} name={tr('analytics.cards.sessions')} />
            </ChartCard>
          </ZoneGrid>
        </div>
      </Zone>

      {/* ---------------- 05 Time & language ---------------- */}
      <Zone zone={CAFE_ZONES[4]!}>
        <ChartCard
          title={tr('ws.analytics.cafe.tillHeatmap')}
          tip={tr('ws.analytics.cafe.tillHeatmapTip')}
          state={salesState === 'ready' && tillCells.every((c) => c.value === 0) ? 'empty' : salesState}
          emptyKey="analytics.empty.sales"
          height={230}
          actions={
            <SegmentedControl<'orders' | 'revenue'>
              size="sm"
              aria-label={tr('ws.analytics.cafe.tillHeatmap')}
              value={tillMeasure}
              onChange={setTillMeasure}
              options={[
                { value: 'orders', label: tr('ws.analytics.cafe.toggleOrders') },
                { value: 'revenue', label: tr('ws.analytics.cafe.toggleRevenue') },
              ]}
            />
          }
          twin={heatTwin(heatCells(tillCells), tr('ws.reports.filters.group'), tr('analytics.cards.peakHours'), tillMeasure === 'orders' ? tr('ws.analytics.cafe.toggleOrders') : tr('ws.analytics.cafe.toggleRevenue'), `orders-heatmap-${rangeLabel}`)}
        >
          <WeekHeatmap cells={tillCells} f={f} format={tillFormat} unit={tr('ws.analytics.cafe.tillHeatmap')} hint={tr('ws.analytics.heatmap.hint')} />
        </ChartCard>
        <div style={{ marginBlockStart: 'var(--tp-sp-3)' }}>
          <ChartCard
            title={tr('analytics.cards.heatmap')}
            tip={tr('ws.analytics.cafe.viewsHeatmapTip')}
            state={engState === 'ready' && viewCells.length === 0 ? 'empty' : engState}
            emptyKey="analytics.empty.heatmap"
            height={230}
            twin={heatTwin(heatCells(viewCells), tr('ws.reports.filters.group'), tr('analytics.cards.peakHours'), tr('analytics.cards.viewsSeries'), `views-heatmap-${rangeLabel}`)}
          >
            <WeekHeatmap
              cells={viewCells}
              f={f}
              format={(n) => `${f.num(n)} ${tr('analytics.cards.viewsSeries').toLowerCase()}`}
              unit={tr('analytics.cards.viewsSeries')}
              hint={tr('ws.analytics.heatmap.hint')}
            />
          </ChartCard>
        </div>
        <div style={{ marginBlockStart: 'var(--tp-sp-3)' }}>
          <ZoneGrid columns={2}>
            <ChartCard
              title={tr('analytics.cards.peakHours')}
              state={engState === 'ready' && (raw?.posthog?.peakHours.some((h) => h.views > 0) ?? false) === false ? 'empty' : engState}
              emptyKey="analytics.empty.engagement"
              twin={barTwin((raw?.posthog?.peakHours ?? []).map((h) => ({ label: f.hour(h.hour), value: h.views })), tr('analytics.cards.peakHours'), tr('analytics.cards.viewsSeries'), `peak-hours-${rangeLabel}`)}
            >
              <PeakHoursChart rows={raw?.posthog?.peakHours ?? []} f={f} />
            </ChartCard>
            <LocalePrefs raw={raw} state={engState} f={f} />
          </ZoneGrid>
        </div>
      </Zone>
    </AnalyticsFrame>
  );
}
