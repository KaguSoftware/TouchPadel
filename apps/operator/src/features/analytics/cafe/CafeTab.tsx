/**
 * `/analytics/cafe` — the Cafe tab: five zones over one data hook
 * (operator-slice.md §5, reworked 2026-09-13, cut down 2026-09-15). The frame
 * (title) and the sticky bar (tabs, filters, jump-nav) are shared with the
 * Courts tab; this file owns everything below the bar.
 *
 * Every card declares the queries it needs (`NEEDS`), so one failing RPC
 * breaks one card and the rest keep their numbers. The page stays USEFUL in
 * sales-only mode: with PostHog not configured and the AI degraded, every
 * till-derived card still renders and the engagement cards say why they are
 * empty instead of showing zeros. Every explanation sits behind an info
 * button; what stays printed is state.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { describeBasis, isThinPeriod, pctDelta, pickLocale } from '@touch/core';
import { useLocale } from '../../../lib/i18n';
import { SegmentedControl } from '../../../components/kit';
import { AnalyticsBar } from '../AnalyticsBar';
import { AnalyticsFrame } from '../AnalyticsFrame';
import { Notices } from '../Notices';
import { Zone, ZoneGrid, CAFE_ZONES } from '../Zone';
import { basisCopy, patternsCopy, weekdayName } from '../copy';
import { mineCafeCandidates, toPatternWire } from '../patterns';
import { buildInsightsData } from '../payload';
import { sumBy } from '../derive';
import { makeFormatters } from '../format';
import { useAnalyticsData, type SqlKey } from '../useAnalyticsData';
import { useVenueRevenue } from '../useVenueRevenue';
import type { AnalyticsSearch } from '../search';
import { CardShell, type CardState } from '../cards/CardShell';
import { Kpi, type KpiCompare } from '../cards/Kpi';
import { AiInsightsCard } from '../cards/AiInsightsCard';
import { PatternsCard } from '../cards/PatternsCard';
import { MenuMatrixCard } from '../cards/MenuMatrixCard';
import { PositionCard } from '../cards/PositionCard';
import { ConversionTable } from '../cards/ConversionTable';
import { TopProfit } from '../cards/TopProfit';
import { Momentum } from '../cards/Momentum';
import { BoughtTogether } from '../cards/BoughtTogether';
import { PromoPerformance } from '../cards/PromoPerformance';
import { ChartCard } from '../charts/ChartCard';
import { barTwin, heatTwin } from '../charts/twins';
import { HBarChart } from '../charts/HBarChart';
import { SalesTrendChart } from '../charts/SalesTrendChart';
import { EngagementTrendChart } from '../charts/EngagementTrendChart';
import { AbandonedViewsChart } from '../charts/AbandonedViewsChart';
import { FunnelBars } from '../charts/FunnelBars';
import { PriceBandBars, bandLabel } from '../charts/PriceBandBars';
import { WeekHeatmap } from '../charts/WeekHeatmap';

/** The queries each card needs; `eng` adds the PostHog batch. */
const NEEDS = {
  money: ['dailySales'] as const,
  matrix: ['soldItems', 'itemMargins', 'menuSnapshot'] as const,
  position: ['soldItems', 'menuSnapshot'] as const,
  conversion: ['soldItems', 'menuSnapshot'] as const,
  pairs: ['boughtTogether', 'menuSnapshot'] as const,
  promo: ['promo'] as const,
  bestSellers: ['bestSellers'] as const,
  abandoned: ['soldItems', 'menuSnapshot'] as const,
  bands: ['soldItems', 'menuSnapshot'] as const,
  hourly: ['hourly'] as const,
  names: ['menuSnapshot'] as const,
} satisfies Record<string, readonly SqlKey[]>;

export function CafeTab() {
  const { tr, locale } = useLocale();
  const search = useSearch({ from: '/analytics' }) as AnalyticsSearch;
  const navigate = useNavigate();
  const f = useMemo(() => makeFormatters(locale), [locale]);
  const data = useAnalyticsData(search, locale);
  const { raw, derived, state, stateFor, errorFor } = data;
  const venue = useVenueRevenue(data.range, data.compareRange);
  const [tillMeasure, setTillMeasure] = useState<'orders' | 'revenue'>('orders');

  const setSearch = (next: Partial<AnalyticsSearch>) => {
    void navigate({ to: '/analytics/cafe', search: { ...search, ...next } });
  };

  // The "all" aggregate the Insights and Patterns cards read: they need every number.
  const allState: CardState = state.salesLoading ? 'loading' : state.salesError ? 'error' : 'ready';
  const moneyState = stateFor(NEEDS.money);
  const engOnly = stateFor([], true);
  const engBroken = engOnly === 'error' || engOnly === 'unconfigured';
  const k = derived?.kpis;
  const hasDaily = state.sql.dailySales === 'ready';
  const hasPrev = state.sql.dailySalesPrev === 'ready';
  const vsLabel = tr('analytics.kpi.vs', { range: f.dateRange(data.compareRange.from, data.compareRange.to) });
  const mutedReason = derived && !derived.salesDeltaReliable ? tr('analytics.kpi.mutedReason') : undefined;
  const name = (id: string, en: string, ar: string) => pickLocale({ en, ar }, locale) || id;
  const compare = (current: string, previous: string): KpiCompare => ({ label: vsLabel, current, previous });
  const basisLine = derived ? describeBasis(derived.basis, basisCopy(tr, f)) : '';
  const thin = derived ? isThinPeriod(derived.basis) : false;
  const prev = raw?.posthogPrev ?? null;
  const reliable = derived?.salesDeltaReliable ?? false;
  /** A money delta, muted (null) when the sales comparison is unreliable or the baseline never arrived. */
  const moneyDelta = (key: 'sales' | 'tabs' | 'cashCard' | 'discounts' | 'refunds' | 'calls') => (reliable && hasPrev ? (derived?.deltas[key] ?? null) : null);
  const prevSum = (pick: (r: NonNullable<typeof raw>['dailyPrev'][number]) => number) => (raw && hasPrev ? sumBy(raw.dailyPrev, pick) : null);
  const cmp = (current: string, previous: number | null, fmt: (n: number) => string) => (previous == null ? undefined : compare(current, fmt(previous)));
  const cashTotal = (k?.cashIqd ?? 0) + (k?.cardIqd ?? 0);
  const cashShare = cashTotal > 0 ? ((k?.cashIqd ?? 0) / cashTotal) * 100 : null;
  const venueDelta = venue.current && venue.previous && reliable ? pctDelta(venue.current.venueIqd, venue.previous.venueIqd) : null;

  const bestSellerRows = (raw?.bestSellers ?? [])
    .filter((b) => derived?.keep(b.id) ?? true)
    .slice(0, 8)
    .map((b) => ({ label: name(b.id, b.nameEn, b.nameAr), value: b.revenueIqd }));

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
  const bands = derived?.priceBands ?? [];
  const bandsTwin = {
    columns: [
      { key: 'label', label: tr('analytics.cards.priceBands') },
      { key: 'views', label: tr('analytics.conversion.views'), numeric: true },
      { key: 'sold', label: tr('analytics.cards.quantity'), numeric: true },
      { key: 'revenue', label: tr('analytics.cards.revenue'), numeric: true },
    ],
    rows: bands.map((b) => ({ label: bandLabel(f, b), views: engOnly === 'ready' ? b.views : null, sold: b.sold, revenue: b.revenueIqd })),
    file: `price-bands-${rangeLabel}`,
  };
  const hiddenGemIds = useMemo(() => new Set((derived?.hiddenGems ?? []).map((g) => g.id)), [derived]);

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
          cafe: {
            excludedIds: data.excludedIds,
            menu: raw?.menu ?? [],
          },
        }}
      />
      <Notices
        lines={[
          ...(derived && hasDaily && derived.coverage.missing.length > 0 ? [tr('analytics.notices.coverage', { missing: derived.coverage.missing.length })] : []),
          ...(state.settingsError != null ? [tr('errors.generic')] : []),
          ...(state.engagement === 'unconfigured' ? [tr('analytics.notices.noPosthog')] : []),
          ...(derived && derived.engNow.clipped && raw?.floor ? [tr('analytics.notices.floor', { date: raw.floor })] : []),
        ]}
        onRetry={state.salesError != null ? data.refetchAll : undefined}
      />

      {/* ---------------- 01 Pulse: the money row, then the activity row ---------------- */}
      <Zone zone={CAFE_ZONES[0]!}>
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2-5)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 'var(--tp-sp-2-5)' }}>
            <Kpi
              label={tr('analytics.kpi.sales')}
              value={f.money(k?.salesIqd ?? 0)}
              delta={moneyDelta('sales')}
              reason={mutedReason}
              vsLabel={vsLabel}
              tip={tr('ws.analytics.cafe.tips.sales')}
              compare={cmp(f.money(k?.salesIqd ?? 0), prevSum((r) => r.revenueIqd), f.money)}
              loading={moneyState === 'loading'}
              unavailable={moneyState === 'error'}
              f={f}
            />
            <Kpi
              label={tr('analytics.kpi.venueRevenue')}
              value={f.money(venue.current?.venueIqd ?? 0)}
              delta={venueDelta}
              reason={mutedReason}
              vsLabel={vsLabel}
              tip={tr('ws.analytics.venue.revenueTip')}
              note={venue.current ? tr('analytics.kpi.venueSplit', { cafe: f.compact(venue.current.cafeIqd), courts: f.compact(venue.current.courtsIqd) }) : undefined}
              compare={venue.current && venue.previous ? compare(f.money(venue.current.venueIqd), f.money(venue.previous.venueIqd)) : undefined}
              loading={venue.state === 'loading'}
              unavailable={venue.state === 'error'}
              f={f}
            />
            <Kpi
              label={tr('analytics.kpi.cashCard')}
              value={`${f.num(k?.cashIqd ?? 0)} / ${f.num(k?.cardIqd ?? 0)}`}
              delta={moneyDelta('cashCard')}
              reason={mutedReason}
              vsLabel={vsLabel}
              tip={tr('ws.analytics.cafe.tips.cashCard')}
              note={cashShare != null ? tr('analytics.kpi.cashShare', { pct: f.pct(cashShare) }) : undefined}
              compare={cmp(f.money(cashTotal), prevSum((r) => r.cashIqd + r.cardIqd), f.money)}
              loading={moneyState === 'loading'}
              unavailable={moneyState === 'error'}
              f={f}
            />
            <Kpi
              label={tr('analytics.kpi.discounts')}
              value={f.money(k?.discountIqd ?? 0)}
              delta={moneyDelta('discounts')}
              reason={mutedReason}
              vsLabel={vsLabel}
              tip={tr('ws.analytics.cafe.tips.discounts')}
              compare={cmp(f.money(k?.discountIqd ?? 0), prevSum((r) => r.discountIqd), f.money)}
              invert
              loading={moneyState === 'loading'}
              unavailable={moneyState === 'error'}
              f={f}
            />
            <Kpi
              label={tr('analytics.kpi.refunds')}
              value={f.money(k?.refundsIqd ?? 0)}
              delta={moneyDelta('refunds')}
              reason={mutedReason}
              vsLabel={vsLabel}
              tip={tr('ws.analytics.cafe.tips.refunds')}
              compare={cmp(f.money(k?.refundsIqd ?? 0), prevSum((r) => r.refundsIqd), f.money)}
              invert
              loading={moneyState === 'loading'}
              unavailable={moneyState === 'error'}
              f={f}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 'var(--tp-sp-2-5)' }}>
            <Kpi
              label={tr('analytics.kpi.tabs')}
              value={f.num(k?.tabs ?? 0)}
              delta={moneyDelta('tabs')}
              vsLabel={vsLabel}
              tip={tr('ws.analytics.cafe.tips.tabs')}
              compare={cmp(f.num(k?.tabs ?? 0), prevSum((r) => r.tabs), f.num)}
              loading={moneyState === 'loading'}
              unavailable={moneyState === 'error'}
              f={f}
            />
            <Kpi
              label={tr('analytics.kpi.qrShare')}
              value={k ? (k.qrShare.pct == null ? tr('ws.analytics.courts.kpi.nOfN', { n: f.num(k.qrShare.n), total: f.num(k.qrShare.d) }) : f.pct(k.qrShare.pct)) : '—'}
              delta={hasPrev ? (derived?.deltas.qrShare ?? null) : null}
              vsLabel={vsLabel}
              tip={tr('ws.analytics.cafe.tips.qrShare')}
              note={k ? tr('analytics.kpi.qrSplit', { qr: f.num(k.qrOrders), till: f.num(k.tillOrders) }) : undefined}
              loading={moneyState === 'loading'}
              unavailable={moneyState === 'error'}
              f={f}
            />
            <Kpi
              label={tr('analytics.kpi.calls')}
              value={f.num(k?.waiterCalls ?? 0)}
              delta={moneyDelta('calls')}
              vsLabel={vsLabel}
              tip={tr('ws.analytics.cafe.tips.calls')}
              neutral
              compare={cmp(f.num(k?.waiterCalls ?? 0), prevSum((r) => r.waiterCalls), f.num)}
              loading={moneyState === 'loading'}
              unavailable={moneyState === 'error'}
              f={f}
            />
            <Kpi
              label={tr('analytics.kpi.views')}
              value={f.num(k?.views ?? 0)}
              delta={derived?.deltas.views ?? null}
              vsLabel={vsLabel}
              tip={tr('ws.analytics.cafe.tips.views')}
              compare={prev ? compare(f.num(k?.views ?? 0), f.num(sumBy(prev.dailyEngagement, (r) => r.views))) : undefined}
              loading={engOnly === 'loading'}
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
              loading={engOnly === 'loading'}
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
              loading={engOnly === 'loading'}
              unavailable={engBroken}
              f={f}
            />
          </div>
        </div>
      </Zone>

      {/* ---------------- 02 Insights ---------------- */}
      <Zone zone={CAFE_ZONES[1]!}>
        <ZoneGrid columns={2}>
          <AiInsightsCard
            scope="cafe"
            range={data.range}
            compareBasis={data.compareBasis}
            live={data.live}
            buildData={(extras) =>
              raw && derived && allState === 'ready'
                ? buildInsightsData(raw, derived, locale, {
                    ...extras,
                    // The Patterns card's level-0 candidates, as ground truth the model may not bend.
                    patterns: mineCafeCandidates(raw, derived, 0, patternsCopy(tr, f, locale)).map(toPatternWire),
                  })
                : null
            }
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
            state={allState}
            f={f}
          />
          <PatternsCard raw={allState === 'ready' ? raw : null} derived={allState === 'ready' ? derived : null} stored={data.stored} state={allState} f={f} />
        </ZoneGrid>
      </Zone>

      {/* ---------------- 03 Menu decisions ---------------- */}
      <Zone zone={CAFE_ZONES[2]!}>
        <ZoneGrid columns={2}>
          <MenuMatrixCard derived={derived} state={stateFor(NEEDS.matrix)} f={f} />
          <PositionCard derived={derived} state={stateFor(NEEDS.position)} f={f} />
        </ZoneGrid>
        <div style={{ marginBlockStart: 'var(--tp-sp-3)' }}>
          <ConversionTable rows={derived?.itemConversion ?? []} hiddenGemIds={hiddenGemIds} state={stateFor(NEEDS.conversion, true)} f={f} rangeLabel={rangeLabel} />
        </div>
        <div style={{ marginBlockStart: 'var(--tp-sp-3)' }}>
          <ZoneGrid columns={3}>
            <TopProfit derived={derived} state={stateFor(NEEDS.matrix)} f={f} />
            <Momentum derived={derived} state={stateFor(NEEDS.names, true)} f={f} />
            <BoughtTogether derived={derived} state={stateFor(NEEDS.pairs)} f={f} />
          </ZoneGrid>
        </div>
      </Zone>

      {/* ---------------- 04 Sales & engagement ---------------- */}
      <Zone zone={CAFE_ZONES[3]!}>
        <ChartCard
          title={tr('analytics.cards.salesVsEngagement')}
          tip={tr('ws.analytics.cafe.trendTip')}
          state={moneyState === 'ready' && (derived?.salesVsEngagement.length ?? 0) === 0 ? 'empty' : moneyState}
          emptyKey="analytics.empty.sales"
          height={360}
          error={errorFor(NEEDS.money)}
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
              state={stateFor(NEEDS.bestSellers) === 'ready' && bestSellerRows.length === 0 ? 'empty' : stateFor(NEEDS.bestSellers)}
              emptyKey="analytics.empty.sales"
              error={errorFor(NEEDS.bestSellers)}
              onRetry={data.refetchAll}
              twin={barTwin(bestSellerRows, tr('analytics.conversion.item'), tr('analytics.cards.revenue'), `best-sellers-${rangeLabel}`)}
            >
              <HBarChart rows={bestSellerRows} format={(n) => f.compact(n)} name={tr('analytics.cards.revenue')} />
            </ChartCard>
            <ChartCard
              title={tr('analytics.cards.lookedNotBought')}
              state={stateFor(NEEDS.abandoned, true) === 'ready' && (derived?.abandoned.length ?? 0) === 0 ? 'empty' : stateFor(NEEDS.abandoned, true)}
              emptyKey="analytics.empty.engagement"
              error={state.engagementError ?? errorFor(NEEDS.abandoned)}
              onRetry={data.refetchAll}
            >
              <AbandonedViewsChart rows={derived?.abandoned ?? []} f={f} />
            </ChartCard>
            <CardShell
              title={tr('analytics.cards.funnel')}
              state={engOnly === 'ready' && (raw?.posthog?.funnel.length ?? 0) === 0 ? 'empty' : engOnly}
              emptyKey="analytics.empty.engagement"
            >
              <FunnelBars steps={raw?.posthog?.funnel ?? []} f={f} />
            </CardShell>
            <ChartCard
              title={tr('analytics.cards.priceBands')}
              tip={tr('ws.analytics.cafe.priceBandsTip')}
              state={stateFor(NEEDS.bands) === 'ready' && bands.every((b) => b.sold === 0 && b.views === 0) ? 'empty' : stateFor(NEEDS.bands)}
              emptyKey="analytics.empty.sales"
              height={Math.max(160, 62 * bands.length)}
              error={errorFor(NEEDS.bands)}
              onRetry={data.refetchAll}
              twin={bandsTwin}
            >
              <PriceBandBars bands={bands} f={f} hasViews={engOnly === 'ready'} />
            </ChartCard>
            <ChartCard
              title={tr('analytics.cards.categoryPop')}
              state={engOnly === 'ready' && categoryRows.length === 0 ? 'empty' : engOnly}
              emptyKey="analytics.empty.engagement"
              twin={barTwin(categoryRows, tr('analytics.cards.categoryPop'), tr('analytics.cards.sessions'), `categories-${rangeLabel}`)}
            >
              <HBarChart rows={categoryRows} format={(n) => f.num(n)} name={tr('analytics.cards.sessions')} />
            </ChartCard>
            <PromoPerformance raw={raw} state={stateFor(NEEDS.promo)} f={f} />
          </ZoneGrid>
        </div>
      </Zone>

      {/* ---------------- 05 Time ---------------- */}
      <Zone zone={CAFE_ZONES[4]!}>
        <ChartCard
          title={tr('ws.analytics.cafe.tillHeatmap')}
          tip={tr('ws.analytics.cafe.tillHeatmapTip')}
          state={stateFor(NEEDS.hourly) === 'ready' && tillCells.every((c) => c.value === 0) ? 'empty' : stateFor(NEEDS.hourly)}
          emptyKey="analytics.empty.sales"
          height={230}
          error={errorFor(NEEDS.hourly)}
          onRetry={data.refetchAll}
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
          twin={heatTwin(heatCells(tillCells), tr('ws.reports.filters.group'), tr('ws.analytics.courts.cards.byHour'), tillMeasure === 'orders' ? tr('ws.analytics.cafe.toggleOrders') : tr('ws.analytics.cafe.toggleRevenue'), `orders-heatmap-${rangeLabel}`)}
        >
          <WeekHeatmap cells={tillCells} f={f} format={tillFormat} unit={tr('ws.analytics.cafe.tillHeatmap')} hint={tr('ws.analytics.heatmap.hint')} />
        </ChartCard>
        <div style={{ marginBlockStart: 'var(--tp-sp-3)' }}>
          <ChartCard
            title={tr('analytics.cards.heatmap')}
            tip={tr('ws.analytics.cafe.viewsHeatmapTip')}
            state={engOnly === 'ready' && viewCells.length === 0 ? 'empty' : engOnly}
            emptyKey="analytics.empty.heatmap"
            height={230}
            twin={heatTwin(heatCells(viewCells), tr('ws.reports.filters.group'), tr('ws.analytics.courts.cards.byHour'), tr('analytics.cards.viewsSeries'), `views-heatmap-${rangeLabel}`)}
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
      </Zone>
    </AnalyticsFrame>
  );
}
