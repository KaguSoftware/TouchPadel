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
 *
 * Reworked 2026-09-17, on the Courts tab's lines: the summary leads with
 * three figures and lists the rest in three named groups; every caveat is one
 * notice at the top (a missing guest-menu feed used to be a red "Something
 * went wrong" in five cards and a flat zero line in the trend); each section
 * opens with its answer as a sentence (./takeaways.ts) and folds the
 * refinements behind "Show more".
 */
import { useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { MIN_RATE_DENOM, describeBasis, isThinPeriod, pctDelta, pickLocale } from '@touch/core';
import { useLocale } from '../../../lib/i18n';
import { Button } from '../../../components/ui';
import { ExportButton, SegmentedControl } from '../../../components/kit';
import { AnalyticsBar } from '../AnalyticsBar';
import { AnalyticsFrame, usePeriodLine } from '../AnalyticsFrame';
import { Notices, type Notice } from '../Notices';
import { MoreCharts, Zone, ZoneGrid, CAFE_ZONES, gridColumns, type ZoneDef } from '../Zone';
import { basisCopy, patternsCopy, weekdayName } from '../copy';
import { mineCafeCandidates, toPatternWire } from '../patterns';
import { buildInsightsData } from '../payload';
import { avgOrderValue, sumBy } from '../derive';
import { makeFormatters } from '../format';
import { useAnalyticsData, type SqlKey } from '../useAnalyticsData';
import { useVenueRevenue } from '../useVenueRevenue';
import type { AnalyticsSearch } from '../search';
import { CardShell, type CardState } from '../cards/CardShell';
import { FigureGroup, FigureLine, Kpi } from '../cards/Kpi';
import { menuTakeaway, salesTakeaway, timeTakeaway } from './takeaways';
import { AiInsightsCard } from '../cards/AiInsightsCard';
import { AssistantComponentCard } from '../components/AssistantComponentCard';
import { PinnedComponents } from '../components/PinnedComponents';
import { componentParams } from '../components/params';
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
import { downloadCsv, toCsv } from '../csv';
import { useAnalyticsDrill } from '../drill';
import { pulseCsvRows, type PulseFigure } from '../pulseCsv';

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
  const drill = useAnalyticsDrill(data.range);

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
  const periodLine = usePeriodLine(f, data.range, data.compareRange);
  const name = (id: string, en: string, ar: string) => pickLocale({ en, ar }, locale) || id;
  const basisLine = derived ? describeBasis(derived.basis, basisCopy(tr, f)) : '';
  const thin = derived ? isThinPeriod(derived.basis) : false;
  const prev = raw?.posthogPrev ?? null;
  const ordersPrevTotal = raw && hasPrev ? sumBy(raw.dailyPrev, (r) => r.orders) : null;
  /**
   * Both windows under the twenty-order floor: "−80%" from 5 orders to 1 claims
   * a trend a handful of orders cannot carry, so the change is hidden and the
   * earlier figure is printed instead (the notice says why, once).
   */
  const smallSample = (k?.orders ?? 0) < MIN_RATE_DENOM && ordersPrevTotal != null && ordersPrevTotal < MIN_RATE_DENOM;
  const reliable = (derived?.salesDeltaReliable ?? false) && !smallSample;
  /** A money delta, muted (null) when the sales comparison is unreliable or the baseline never arrived. */
  const moneyDelta = (key: 'sales' | 'tabs' | 'cashCard' | 'discounts' | 'refunds' | 'waste' | 'orders' | 'avgOrderValue' | 'calls') => (reliable && hasPrev ? (derived?.deltas[key] ?? null) : null);
  const prevSum = (pick: (r: NonNullable<typeof raw>['dailyPrev'][number]) => number) => (raw && hasPrev ? sumBy(raw.dailyPrev, pick) : null);
  /** The comparison window's figure, formatted — only when it came back. */
  const was = (previous: number | null, fmt: (n: number) => string) => (previous == null ? null : fmt(previous));
  /** Guest-menu cards: a feed that is off or down is one notice, and a short muted line in the card. */
  const engState = (st: CardState): CardState => (st === 'error' && engBroken && engOnly === 'error' ? 'unavailable' : st);
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
  const pulseFigures = (): PulseFigure[] => {
    const p = prevSum;
    const eng = engOnly === 'ready';
    const ordersPrev = p((r) => r.orders);
    const grossPrev = p((r) => r.cafeGrossIqd);
    return [
      { label: tr('analytics.kpi.sales'), value: k?.salesIqd ?? null, previous: p((r) => r.revenueIqd) },
      { label: tr('ws.owner.panel.figures.cafeRevenue'), value: k?.cafeGrossIqd ?? null, previous: grossPrev },
      { label: tr('analytics.kpi.venueRevenue'), value: venue.current?.venueIqd ?? null, previous: venue.previous?.venueIqd ?? null },
      { label: tr('ws.analytics.drill.cash'), value: k?.cashIqd ?? null, previous: p((r) => r.cashIqd) },
      { label: tr('ws.analytics.drill.card'), value: k?.cardIqd ?? null, previous: p((r) => r.cardIqd) },
      { label: tr('analytics.kpi.discounts'), value: k?.discountIqd ?? null, previous: p((r) => r.discountIqd) },
      { label: tr('analytics.kpi.refunds'), value: k?.refundsIqd ?? null, previous: p((r) => r.refundsIqd) },
      { label: tr('analytics.kpi.waste'), value: k?.wasteIqd ?? null, previous: p((r) => r.wasteIqd) },
      { label: tr('analytics.kpi.tabs'), value: k?.tabs ?? null, previous: p((r) => r.tabs) },
      { label: tr('analytics.kpi.orders'), value: k?.orders ?? null, previous: ordersPrev },
      { label: tr('analytics.kpi.avgOrderValue'), value: k?.avgOrderValueIqd ?? null, previous: grossPrev != null && ordersPrev != null ? avgOrderValue(grossPrev, ordersPrev) : null },
      { label: tr('analytics.kpi.qrShare'), value: k?.qrShare.pct ?? null, previous: null },
      { label: tr('analytics.kpi.calls'), value: k?.waiterCalls ?? null, previous: p((r) => r.waiterCalls) },
      { label: tr('analytics.kpi.views'), value: eng ? (k?.views ?? null) : null, previous: eng && prev ? sumBy(prev.dailyEngagement, (r) => r.views) : null },
      { label: tr('analytics.kpi.median'), value: eng ? (k?.medianSeconds ?? null) : null, previous: eng && prev ? prev.sessionStats.medianSeconds : null },
      { label: tr('analytics.kpi.basketToCall'), value: eng ? (k?.basketToCallPct ?? null) : null, previous: eng && prev ? prev.basketToCall.pct : null },
    ];
  };
  const exportPulse = () => {
    const csv = toCsv(
      [tr('ws.analytics.pulseCsv.figure'), tr('ws.analytics.pulseCsv.value'), tr('ws.analytics.pulseCsv.previous'), tr('ws.analytics.pulseCsv.changeAbs'), tr('ws.analytics.pulseCsv.changePct')],
      pulseCsvRows(pulseFigures()),
    );
    downloadCsv(`cafe-pulse-${rangeLabel}.csv`, csv);
  };
  const hiddenGemIds = useMemo(() => new Set((derived?.hiddenGems ?? []).map((g) => g.id)), [derived]);

  const moneyCommon = { loading: moneyState === 'loading', unavailable: moneyState === 'error', f };
  const engCommon = { loading: engOnly === 'loading', unavailable: engBroken, f };
  const cashPrev = prevSum((r) => r.cashIqd);
  const cardPrev = prevSum((r) => r.cardIqd);
  const zone = (id: string): ZoneDef => CAFE_ZONES.find((z) => z.id === id)!;
  const ready = (st: CardState) => st === 'ready' && raw && derived;

  const notices: Notice[] = [];
  if (derived && hasDaily && hasPrev && smallSample && derived.salesDeltaReliable) {
    notices.push({ key: 'small', text: tr('ws.analytics.cafe.smallSample', { n: MIN_RATE_DENOM }) });
  } else if (derived && hasDaily && hasPrev && !reliable) {
    notices.push({ key: 'compare', text: tr('analytics.kpi.mutedReason', { range: f.dateRange(data.compareRange.from, data.compareRange.to) }) });
  }
  if (derived && hasDaily && derived.coverage.missing.length > 0) notices.push({ key: 'coverage', text: tr('analytics.notices.coverage', { missing: derived.coverage.missing.length }) });
  if (state.engagement === 'unconfigured') notices.push({ key: 'posthog', text: tr('analytics.notices.noPosthog') });
  if (state.engagement === 'error') {
    notices.push({
      key: 'posthog',
      text: tr('ws.analytics.cafe.engagementFailed'),
      action: (
        <Button size="sm" icon="refresh" onClick={data.refetchAll}>
          {tr('common.retry')}
        </Button>
      ),
    });
  }
  if (derived && derived.engNow.clipped && raw?.floor) notices.push({ key: 'floor', text: tr('analytics.notices.floor', { date: raw.floor }) });
  if (state.settingsError != null) notices.push({ key: 'settings', text: tr('ws.analytics.notices.settingsFailed') });

  const menuLead = ready(stateFor(NEEDS.matrix)) ? menuTakeaway(derived!, tr, f, locale) : null;
  const salesLead = ready(stateFor(NEEDS.bestSellers)) && moneyState === 'ready' ? salesTakeaway(raw!, derived!, tr, f, locale) : null;
  const timeLead = ready(stateFor(NEEDS.hourly)) ? timeTakeaway(raw!, tr, f) : null;

  return (
    <AnalyticsFrame subtitle={periodLine} actions={<ExportButton onExport={exportPulse} disabled={moneyState !== 'ready'} />}>
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
      <Notices notices={notices} onRetry={state.salesError != null ? data.refetchAll : undefined} />

      {/* ---------------- Summary: three lead figures, then the rest in named groups ---------------- */}
      <Zone zone={zone('pulse')}>
        <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: gridColumns(3, '13rem'), gap: 'var(--tp-sp-3)' }}>
            <Kpi
              label={tr('analytics.kpi.sales')}
              value={f.money(k?.salesIqd ?? 0)}
              delta={moneyDelta('sales')}
              previous={was(prevSum((r) => r.revenueIqd), f.money)}
              tip={tr('ws.analytics.cafe.tips.sales')}
              note={k ? tr('ws.analytics.grossNote', { amount: f.money(k.cafeGrossIqd) }) : undefined}
              drills={[{ onOpen: () => drill.open({ figure: 'cafeNet', label: tr('analytics.kpi.sales') }) }]}
              {...moneyCommon}
            />
            <Kpi
              label={tr('analytics.kpi.orders')}
              value={f.num(k?.orders ?? 0)}
              delta={moneyDelta('orders')}
              previous={was(prevSum((r) => r.orders), f.num)}
              tip={tr('ws.analytics.cafe.tips.orders')}
              drills={[{ onOpen: () => drill.open({ figure: 'orders', label: tr('analytics.kpi.orders') }) }]}
              {...moneyCommon}
            />
            <Kpi
              label={tr('analytics.kpi.avgOrderValue')}
              value={f.money(k?.avgOrderValueIqd ?? 0)}
              delta={moneyDelta('avgOrderValue')}
              previous={(() => {
                const g = prevSum((r) => r.cafeGrossIqd);
                const o = prevSum((r) => r.orders);
                return g != null && o != null && o > 0 ? f.money(avgOrderValue(g, o)) : null;
              })()}
              tip={tr('ws.analytics.cafe.tips.avgOrderValue')}
              {...moneyCommon}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: gridColumns(3, '18rem'), gap: 'var(--tp-sp-3)', alignItems: 'start' }}>
            <FigureGroup title={tr('ws.analytics.cafe.summary.taken')}>
              <FigureLine
                label={tr('ws.analytics.drill.cash')}
                value={f.money(k?.cashIqd ?? 0)}
                delta={reliable && hasPrev && cashPrev != null ? pctDelta(k?.cashIqd ?? 0, cashPrev) : null}
                previous={was(cashPrev, f.money)}
                tip={tr('ws.analytics.cafe.tips.cashCard')}
                note={cashShare != null ? tr('analytics.kpi.cashShare', { pct: f.pct(cashShare) }) : undefined}
                drills={[{ onOpen: () => drill.open({ figure: 'cash', label: tr('ws.analytics.drill.cash') }) }]}
                {...moneyCommon}
              />
              <FigureLine
                label={tr('ws.analytics.drill.card')}
                value={f.money(k?.cardIqd ?? 0)}
                delta={reliable && hasPrev && cardPrev != null ? pctDelta(k?.cardIqd ?? 0, cardPrev) : null}
                previous={was(cardPrev, f.money)}
                drills={[{ onOpen: () => drill.open({ figure: 'card', label: tr('ws.analytics.drill.card') }) }]}
                {...moneyCommon}
              />
              <FigureLine
                label={tr('analytics.kpi.venueRevenue')}
                value={f.money(venue.current?.venueIqd ?? 0)}
                delta={venueDelta}
                previous={venue.previous ? f.money(venue.previous.venueIqd) : null}
                tip={tr('ws.analytics.venue.revenueTip')}
                note={venue.current ? tr('analytics.kpi.venueSplit', { cafe: f.compact(venue.current.cafeIqd), courts: f.compact(venue.current.courtsIqd) }) : undefined}
                drills={[{ onOpen: () => drill.open({ figure: 'revenue', label: tr('analytics.kpi.venueRevenue') }) }]}
                loading={venue.state === 'loading'}
                unavailable={venue.state === 'error'}
                f={f}
              />
            </FigureGroup>
            <FigureGroup title={tr('ws.analytics.cafe.summary.givenAway')}>
              <FigureLine
                label={tr('analytics.kpi.discounts')}
                value={f.money(k?.discountIqd ?? 0)}
                delta={moneyDelta('discounts')}
                invert
                previous={was(prevSum((r) => r.discountIqd), f.money)}
                tip={tr('ws.analytics.cafe.tips.discounts')}
                drills={[{ onOpen: () => drill.open({ figure: 'discounts', label: tr('analytics.kpi.discounts') }) }]}
                {...moneyCommon}
              />
              <FigureLine
                label={tr('analytics.kpi.refunds')}
                value={f.money(k?.refundsIqd ?? 0)}
                delta={moneyDelta('refunds')}
                invert
                previous={was(prevSum((r) => r.refundsIqd), f.money)}
                tip={tr('ws.analytics.cafe.tips.refunds')}
                drills={[{ onOpen: () => drill.open({ figure: 'refunds', label: tr('analytics.kpi.refunds') }) }]}
                {...moneyCommon}
              />
              <FigureLine
                label={tr('analytics.kpi.waste')}
                value={f.money(k?.wasteIqd ?? 0)}
                delta={moneyDelta('waste')}
                invert
                previous={was(prevSum((r) => r.wasteIqd), f.money)}
                tip={tr('ws.analytics.cafe.tips.waste')}
                drills={[{ onOpen: () => drill.open({ figure: 'waste', label: tr('analytics.kpi.waste') }) }]}
                {...moneyCommon}
              />
            </FigureGroup>
            <FigureGroup title={tr('ws.analytics.cafe.summary.guests')}>
              <FigureLine
                label={tr('analytics.kpi.tabs')}
                value={f.num(k?.tabs ?? 0)}
                delta={moneyDelta('tabs')}
                previous={was(prevSum((r) => r.tabs), f.num)}
                tip={tr('ws.analytics.cafe.tips.tabs')}
                {...moneyCommon}
              />
              <FigureLine
                label={tr('analytics.kpi.qrShare')}
                value={k ? (k.qrShare.pct == null ? tr('ws.analytics.courts.kpi.nOfN', { n: f.num(k.qrShare.n), total: f.num(k.qrShare.d) }) : f.pct(k.qrShare.pct)) : '—'}
                delta={hasPrev && !smallSample ? (derived?.deltas.qrShare ?? null) : null}
                kind="points"
                tip={tr('ws.analytics.cafe.tips.qrShare')}
                note={k ? tr('analytics.kpi.qrSplit', { qr: f.num(k.qrOrders), till: f.num(k.tillOrders) }) : undefined}
                {...moneyCommon}
              />
              <FigureLine
                label={tr('analytics.kpi.calls')}
                value={f.num(k?.waiterCalls ?? 0)}
                delta={moneyDelta('calls')}
                neutral
                previous={was(prevSum((r) => r.waiterCalls), f.num)}
                tip={tr('ws.analytics.cafe.tips.calls')}
                {...moneyCommon}
              />
              {/* Guest-menu figures only when the feed answered: otherwise the notice says why, once. */}
              {!engBroken && (
                <>
                  <FigureLine
                    label={tr('analytics.kpi.views')}
                    value={f.num(k?.views ?? 0)}
                    delta={derived?.deltas.views ?? null}
                    previous={prev ? f.num(sumBy(prev.dailyEngagement, (r) => r.views)) : null}
                    tip={tr('ws.analytics.cafe.tips.views')}
                    {...engCommon}
                  />
                  <FigureLine
                    label={tr('analytics.kpi.median')}
                    value={f.duration(k?.medianSeconds ?? 0)}
                    delta={derived?.deltas.median ?? null}
                    neutral
                    previous={prev ? f.duration(prev.sessionStats.medianSeconds) : null}
                    tip={tr('ws.analytics.cafe.tips.median')}
                    {...engCommon}
                  />
                  <FigureLine
                    label={tr('analytics.kpi.basketToCall')}
                    value={f.pct(k?.basketToCallPct ?? 0)}
                    // A rate: whole points against the earlier window, never a percentage of a percentage.
                    delta={k && prev ? Math.round(k.basketToCallPct - prev.basketToCall.pct) : null}
                    kind="points"
                    previous={prev ? f.pct(prev.basketToCall.pct) : null}
                    tip={tr('ws.analytics.cafe.tips.basketToCall')}
                    note={k ? tr('ws.analytics.cafe.sessionsNote', { n: f.num(k.basketToCallSample) }) : undefined}
                    {...engCommon}
                  />
                </>
              )}
            </FigureGroup>
          </div>
        </div>
      </Zone>

      {/* ---------------- What stands out ---------------- */}
      <Zone zone={zone('ai')}>
        <ZoneGrid columns={2}>
          {/* The mined patterns first: they need no AI and are always there. */}
          <PatternsCard raw={allState === 'ready' ? raw : null} derived={allState === 'ready' ? derived : null} stored={data.stored} state={allState} f={f} />
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
          {/* The assistant-fed cards (plan §5.4): read from the component cache, never
              generated on open; Refresh and the nightly pre-warm are the only writers.
              The Groq insights card above stays until the eval set shows parity. */}
          <AssistantComponentCard
            componentKey="cafe_findings"
            title={tr('ws.analytics.components.titles.cafe_findings')}
            params={componentParams({ range: data.range, compareBasis: data.compareBasis, scope: 'cafe', locale })}
            f={f}
            fallback={() => (raw && derived && allState === 'ready' ? mineCafeCandidates(raw, derived, 0, patternsCopy(tr, f, locale)).map((c) => c.fallbackText) : [])}
          />
          <AssistantComponentCard
            componentKey="week_paragraph"
            title={tr('ws.analytics.components.titles.week_paragraph')}
            params={componentParams({ range: data.range, compareBasis: data.compareBasis, scope: 'cafe', locale })}
            f={f}
          />
          <AssistantComponentCard
            componentKey="what_changed"
            title={tr('ws.analytics.components.titles.what_changed')}
            params={componentParams({ range: data.range, compareBasis: data.compareBasis, scope: 'cafe', locale })}
            f={f}
          />
          <AssistantComponentCard
            componentKey="stock_watch"
            title={tr('ws.analytics.components.titles.stock_watch')}
            params={componentParams({ range: data.range, compareBasis: data.compareBasis, scope: 'cafe', locale })}
            f={f}
          />
          <PinnedComponents scope="cafe" range={data.range} compareBasis={data.compareBasis} f={f} />
        </ZoneGrid>
      </Zone>

      {/* ---------------- Menu ---------------- */}
      <Zone zone={zone('menu')} lead={menuLead}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 24rem), 1fr))', gap: 'var(--tp-sp-3)', alignItems: 'start' }}>
          <MenuMatrixCard derived={derived} state={stateFor(NEEDS.matrix)} f={f} />
          <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
            <TopProfit derived={derived} state={stateFor(NEEDS.matrix)} f={f} />
            <BoughtTogether derived={derived} state={stateFor(NEEDS.pairs)} f={f} />
          </div>
        </div>
        <MoreCharts id="cafe-menu" count={3}>
          <ConversionTable rows={derived?.itemConversion ?? []} hiddenGemIds={hiddenGemIds} state={engState(stateFor(NEEDS.conversion, true))} f={f} rangeLabel={rangeLabel} />
          <ZoneGrid columns={2}>
            <PositionCard derived={derived} state={stateFor(NEEDS.position)} f={f} />
            <Momentum derived={derived} state={engState(stateFor(NEEDS.names, true))} f={f} />
          </ZoneGrid>
        </MoreCharts>
      </Zone>

      {/* ---------------- Sales ---------------- */}
      <Zone zone={zone('sales')} lead={salesLead}>
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
            rows: (derived?.salesVsEngagement ?? []).map((r) => ({ date: f.date(r.date, true), revenue: r.revenue, views: engOnly === 'ready' ? r.views : null, waiterCalls: r.waiterCalls })),
            file: `sales-engagement-${rangeLabel}`,
          }}
        >
          <div style={{ display: 'grid', gridTemplateRows: '200px 150px', gap: 'var(--tp-sp-1)', blockSize: '100%' }}>
            <div>
              <SalesTrendChart rows={derived?.salesVsEngagement ?? []} f={f} />
            </div>
            <div>
              <EngagementTrendChart rows={derived?.salesVsEngagement ?? []} f={f} showViews={engOnly === 'ready'} />
            </div>
          </div>
        </ChartCard>
        <div style={{ marginBlockStart: 'var(--tp-sp-3)' }}>
          <ZoneGrid columns={2}>
            <ChartCard
              title={tr('analytics.cards.bestSellers')}
              tip={tr('ws.analytics.cafe.bestSellersTip')}
              state={stateFor(NEEDS.bestSellers) === 'ready' && bestSellerRows.length === 0 ? 'empty' : stateFor(NEEDS.bestSellers)}
              emptyKey="analytics.empty.sales"
              error={errorFor(NEEDS.bestSellers)}
              onRetry={data.refetchAll}
              twin={barTwin(bestSellerRows, tr('analytics.conversion.item'), tr('analytics.cards.revenue'), `best-sellers-${rangeLabel}`)}
            >
              <HBarChart rows={bestSellerRows} format={(n) => f.compact(n)} name={tr('analytics.cards.revenue')} />
            </ChartCard>
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
          </ZoneGrid>
        </div>
        <MoreCharts id="cafe-sales" count={4}>
          <ZoneGrid columns={2}>
            <ChartCard
              title={tr('analytics.cards.lookedNotBought')}
              state={engState(stateFor(NEEDS.abandoned, true) === 'ready' && (derived?.abandoned.length ?? 0) === 0 ? 'empty' : stateFor(NEEDS.abandoned, true))}
              emptyKey="analytics.empty.engagement"
              error={state.engagementError ?? errorFor(NEEDS.abandoned)}
              onRetry={data.refetchAll}
            >
              <AbandonedViewsChart rows={derived?.abandoned ?? []} f={f} />
            </ChartCard>
            <CardShell
              title={tr('analytics.cards.funnel')}
              state={engState(engOnly === 'ready' && (raw?.posthog?.funnel.length ?? 0) === 0 ? 'empty' : engOnly)}
              emptyKey="analytics.empty.engagement"
            >
              <FunnelBars steps={raw?.posthog?.funnel ?? []} f={f} />
            </CardShell>
            <ChartCard
              title={tr('analytics.cards.categoryPop')}
              state={engState(engOnly === 'ready' && categoryRows.length === 0 ? 'empty' : engOnly)}
              emptyKey="analytics.empty.engagement"
              twin={barTwin(categoryRows, tr('analytics.cards.categoryPop'), tr('analytics.cards.sessions'), `categories-${rangeLabel}`)}
            >
              <HBarChart rows={categoryRows} format={(n) => f.num(n)} name={tr('analytics.cards.sessions')} />
            </ChartCard>
            <PromoPerformance raw={raw} state={stateFor(NEEDS.promo)} f={f} />
          </ZoneGrid>
        </MoreCharts>
      </Zone>

      {/* ---------------- Busy times ---------------- */}
      <Zone zone={zone('time')} lead={timeLead}>
        <ChartCard
          title={tr('ws.analytics.cafe.tillHeatmap')}
          tip={tr('ws.analytics.cafe.tillHeatmapTip')}
          state={stateFor(NEEDS.hourly) === 'ready' && tillCells.every((c) => c.value === 0) ? 'empty' : stateFor(NEEDS.hourly)}
          emptyKey="analytics.empty.sales"
          height={200}
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
        <MoreCharts id="cafe-time" count={1}>
          <ChartCard
            title={tr('analytics.cards.heatmap')}
            tip={tr('ws.analytics.cafe.viewsHeatmapTip')}
            state={engState(engOnly === 'ready' && viewCells.length === 0 ? 'empty' : engOnly)}
            emptyKey="analytics.empty.heatmap"
            height={200}
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
        </MoreCharts>
      </Zone>
      {drill.layer}
    </AnalyticsFrame>
  );
}
