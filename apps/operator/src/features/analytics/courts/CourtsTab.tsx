/**
 * `/analytics/courts` — the Courts tab: eight sections over one data hook.
 * The frame (title, period) and the sticky bar (tabs, filters, court select,
 * jump-nav) are shared with the Cafe tab; this file owns everything below.
 *
 * Reworked 2026-09-17 for the owner who opens it to decide something, not to
 * browse 35 charts of equal weight:
 *  - the summary leads with four figures, the rest are rows beneath;
 *  - every caveat (comparison not reliable, thin period, no opening hours) is
 *    one notice at the top instead of a line under every tile;
 *  - each section opens with its answer as a sentence (./takeaways.ts), keeps
 *    the chart that shows it, and folds the refinements behind "Show more";
 *  - sections run in the order the owner asks: how are we doing, what stands
 *    out, when is it busy, which courts, what we lose, how people book, who
 *    comes back, what they spend at the cafe.
 *
 * The tab is designed to stay honest on thin data: every rate prints as
 * "n of N" below its floor, every miner returns nothing below its sample
 * tier, comparisons mute when the compare window has gaps, and occupancy
 * shows a dash with a visible link when no opening hours are set. Every
 * section declares the RPCs it reads (`NEEDS`), so one failing RPC breaks
 * one section, never the page.
 */
import { useMemo } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { ExportButton } from '../../../components/kit';
import { useQuery } from '@tanstack/react-query';
import { MIN_RATE_DENOM, pickLocale } from '@touch/core';
import { useLocale } from '../../../lib/i18n';
import { QK, fetchActiveCourts } from '../../../lib/queries';
import { AnalyticsBar } from '../AnalyticsBar';
import { AnalyticsFrame, usePeriodLine } from '../AnalyticsFrame';
import { Notices, type Notice } from '../Notices';
import { Zone, ZoneGrid, type ZoneDef } from '../Zone';
import { makeFormatters } from '../format';
import type { AnalyticsSearch } from '../search';
import type { CardState } from '../cards/CardShell';
import { AiInsightsCard } from '../cards/AiInsightsCard';
import { useVenueRevenue } from '../useVenueRevenue';
import { downloadCsv, toCsv } from '../csv';
import { useAnalyticsDrill } from '../drill';
import { pulseCsvRows, type PulseFigure } from '../pulseCsv';
import { CourtPatternsCard } from './cards/CourtPatternsCard';
import { courtPatternsCopy } from './copy';
import { toPatternWire } from '../patterns';
import { buildCourtsInsightsData } from './payload';
import { CrossSection } from './sections/CrossSection';
import { CourtsSection } from './sections/CourtsSection';
import { GuestsSection } from './sections/GuestsSection';
import { LossesSection } from './sections/LossesSection';
import { PulseSection } from './sections/PulseSection';
import { ShapeSection } from './sections/ShapeSection';
import { WhenSection } from './sections/WhenSection';
import { useCourtsData, type CourtsQueryKey } from './useCourtsData';
import { smallCourtSample } from './derive';
import { COURT_ZONES } from './zones';
import { cafeTakeaway, courtsTakeaway, guestsTakeaway, lossesTakeaway, shapeTakeaway, whenTakeaway } from './takeaways';

/** The RPCs each section reads. */
const NEEDS = {
  pulse: ['analytics_courts_summary', 'analytics_courts_cafe'],
  when: ['analytics_courts_summary'],
  shape: ['analytics_courts_demand', 'analytics_courts_summary'],
  courts: ['analytics_courts_summary', 'analytics_courts_cafe'],
  losses: ['analytics_courts_endings', 'analytics_courts_summary'],
  guests: ['analytics_courts_guests'],
  cross: ['analytics_courts_cafe', 'analytics_courts_summary'],
} satisfies Record<string, readonly CourtsQueryKey[]>;

export function CourtsTab() {
  const { tr, locale } = useLocale();
  const search = useSearch({ from: '/analytics' }) as AnalyticsSearch;
  const navigate = useNavigate();
  const f = useMemo(() => makeFormatters(locale), [locale]);
  // Court names reach the copy through the derivation, so the copy adapter
  // takes an empty map here and the miner resolves names from its own input.
  const copy = useMemo(() => courtPatternsCopy(tr, f, locale, new Map()), [tr, f, locale]);
  const data = useCourtsData(search, locale, copy);
  const { raw, derived, state, stateFor } = data;
  const venue = useVenueRevenue(data.range, data.compareRange);
  // The filter's options come from the venue's courts, not from the filtered
  // payload: with court A selected the payload lists only A, and B would vanish.
  const activeCourts = useQuery({ queryKey: QK.courts, queryFn: fetchActiveCourts, staleTime: 60_000 });
  const drill = useAnalyticsDrill(data.range);

  const setSearch = (next: Partial<AnalyticsSearch>) => {
    void navigate({ to: '/analytics/courts', search: { ...search, ...next } });
  };

  // The "all" aggregate the Insights and Patterns cards read: they need every RPC.
  const allState: CardState = state.loading ? 'loading' : state.error ? 'error' : 'ready';
  const periodLine = usePeriodLine(f, data.range, data.compareRange);
  const rangeLabel = `${data.range.from}_${data.range.to}`;
  const courts = (activeCourts.data ?? []).map((c) => ({ id: c.id, label: pickLocale({ en: c.name_en, ar: c.name_ar }, locale) || c.id }));
  const exportPulse = () => {
    const k = raw?.summary.kpis;
    const kp = raw?.summaryPrev?.kpis ?? null;
    const dv = (key: keyof NonNullable<typeof derived>['deltas']) => derived?.deltas[key] ?? { current: null, previous: null };
    const figures: PulseFigure[] = [
      { label: tr('ws.analytics.courts.kpi.bookings'), value: k?.bookings ?? null, previous: kp?.bookings ?? null },
      { label: tr('ws.analytics.courts.kpi.bookedHours'), value: dv('bookedHours').current, previous: dv('bookedHours').previous },
      { label: tr('ws.analytics.courts.kpi.occupancy'), value: k?.occupancyPct ?? null, previous: kp?.occupancyPct ?? null },
      { label: tr('ws.analytics.courts.kpi.revenue'), value: k?.revenueIqd ?? null, previous: kp?.revenueIqd ?? null },
      { label: tr('analytics.kpi.venueRevenue'), value: venue.current?.venueIqd ?? null, previous: venue.previous?.venueIqd ?? null },
      { label: tr('ws.analytics.courts.kpi.revPerOpenHour'), value: k?.revPerOpenHourIqd ?? null, previous: kp?.revPerOpenHourIqd ?? null },
      { label: tr('ws.analytics.courts.kpi.pricePerBookedHour'), value: k?.pricePerBookedHourIqd ?? null, previous: kp?.pricePerBookedHourIqd ?? null },
      { label: tr('ws.analytics.courts.units.cancellations'), value: k?.cancellations ?? null, previous: kp?.cancellations ?? null },
      { label: tr('ws.analytics.courts.kpi.cancelRate'), value: k?.cancellationRatePct ?? null, previous: kp?.cancellationRatePct ?? null },
      { label: tr('ws.analytics.courts.units.noShows'), value: k?.noShows ?? null, previous: kp?.noShows ?? null },
      { label: tr('ws.analytics.courts.kpi.noShowRate'), value: k?.noShowRatePct ?? null, previous: kp?.noShowRatePct ?? null },
      { label: tr('ws.analytics.courts.kpi.attachRate'), value: raw?.cafe.attach.attachPct ?? null, previous: raw?.cafePrev?.attach.attachPct ?? null },
    ];
    const csv = toCsv(
      [tr('ws.analytics.pulseCsv.figure'), tr('ws.analytics.pulseCsv.value'), tr('ws.analytics.pulseCsv.previous'), tr('ws.analytics.pulseCsv.changeAbs'), tr('ws.analytics.pulseCsv.changePct')],
      pulseCsvRows(figures),
    );
    downloadCsv(`courts-pulse-${rangeLabel}.csv`, csv);
  };
  const section = (keys: readonly CourtsQueryKey[]) => ({ raw, derived, state: stateFor(keys), refreshing: state.refreshing, f, rangeLabel });
  /** A section's sentence, once its queries are in. */
  const lead = (keys: readonly CourtsQueryKey[], build: () => string | null) => (raw && derived && stateFor(keys) === 'ready' ? build() : null);
  const zone = (id: string): ZoneDef => COURT_ZONES.find((z) => z.id === id)!;

  const notices: Notice[] = [];
  if (derived && raw?.summaryPrev && derived.compareReliable && smallCourtSample(raw)) {
    notices.push({ key: 'small', text: tr('ws.analytics.courts.notices.smallSample', { n: MIN_RATE_DENOM }) });
  } else if (derived && raw?.summaryPrev && !derived.compareReliable) {
    notices.push({ key: 'compare', text: tr('ws.analytics.courts.notices.compareMuted', { range: f.dateRange(data.compareRange.from, data.compareRange.to) }) });
  }
  if (derived?.thin && stateFor(NEEDS.when) === 'ready') notices.push({ key: 'thin', text: tr('ws.analytics.courts.notices.thin') });
  if (derived?.noOpeningHours && stateFor(NEEDS.when) === 'ready') {
    notices.push({
      key: 'hours',
      text: tr('ws.analytics.courts.notices.noHours'),
      action: (
        <Link to="/admin/settings" className="tp-link" style={{ fontWeight: 600 }}>
          {tr('ws.analytics.courts.notices.noHoursLink')}
        </Link>
      ),
    });
  }
  if (state.settingsError != null) notices.push({ key: 'settings', text: tr('ws.analytics.notices.settingsFailed') });

  return (
    <AnalyticsFrame subtitle={periodLine} actions={<ExportButton onExport={exportPulse} disabled={stateFor(NEEDS.pulse) !== 'ready'} />}>
      <AnalyticsBar tab="courts" search={search} setSearch={setSearch} zones={COURT_ZONES} compareBasis={data.compareBasis} courts={courts} deck={{ startHour: data.startHour }} />
      <Notices notices={notices} onRetry={state.error != null ? data.refetchAll : undefined} />

      <Zone zone={zone('pulse')}>
        <PulseSection {...section(NEEDS.pulse)} venue={venue} openDrill={drill.open} courtId={data.courtId ?? null} />
      </Zone>

      <Zone zone={zone('insights')}>
        <ZoneGrid columns={2}>
          {/* The mined patterns first: they need no AI and are always there. */}
          <CourtPatternsCard
            patterns={allState === 'ready' ? (derived?.patterns ?? []) : []}
            state={allState}
            refreshing={state.refreshing}
            tip={tr('ws.analytics.courts.tips.patterns')}
            range={data.range}
            compareBasis={data.compareBasis}
            courtId={data.courtId}
            stored={data.stored}
          />
          <AiInsightsCard
            scope="courts"
            range={data.range}
            compareBasis={data.compareBasis}
            courtId={data.courtId}
            live={data.live}
            buildData={(extras) =>
              raw && derived && allState === 'ready'
                ? buildCourtsInsightsData(raw, derived, locale, tr, { ...extras, patterns: derived.patterns.map(toPatternWire) })
                : null
            }
            tip={tr('ws.analytics.courts.tips.insights')}
            stored={data.stored}
            state={allState}
            refreshing={state.refreshing}
            f={f}
          />
        </ZoneGrid>
      </Zone>

      <Zone zone={zone('when')} lead={lead(NEEDS.when, () => whenTakeaway(raw!, derived!, tr, f))}>
        <WhenSection {...section(NEEDS.when)} />
      </Zone>

      <Zone zone={zone('courts')} lead={lead(NEEDS.courts, () => courtsTakeaway(raw!, derived!, tr, f, locale))}>
        <CourtsSection {...section(NEEDS.courts)} selectedCourtId={data.courtId} />
      </Zone>

      <Zone zone={zone('losses')} lead={lead(NEEDS.losses, () => lossesTakeaway(raw!, tr, f))}>
        <LossesSection {...section(NEEDS.losses)} />
      </Zone>

      <Zone zone={zone('shape')} lead={lead(NEEDS.shape, () => shapeTakeaway(raw!, tr, f))}>
        <ShapeSection {...section(NEEDS.shape)} />
      </Zone>

      <Zone zone={zone('guests')} lead={lead(NEEDS.guests, () => guestsTakeaway(raw!, tr, f))}>
        <GuestsSection {...section(NEEDS.guests)} />
      </Zone>

      <Zone zone={zone('cafe')} lead={lead(NEEDS.cross, () => cafeTakeaway(raw!, tr, f))}>
        <CrossSection {...section(NEEDS.cross)} selectedCourtId={data.courtId} />
      </Zone>
      {drill.layer}
    </AnalyticsFrame>
  );
}
