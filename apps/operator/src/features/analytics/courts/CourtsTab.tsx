/**
 * `/analytics/courts` — the Courts tab: eight zones over one data hook.
 * The frame (title) and the sticky bar (tabs, filters, court select,
 * jump-nav) are shared with the Cafe tab; this file owns everything below.
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
import { pickLocale } from '@touch/core';
import { useLocale } from '../../../lib/i18n';
import { QK, fetchActiveCourts } from '../../../lib/queries';
import { AnalyticsBar } from '../AnalyticsBar';
import { AnalyticsFrame } from '../AnalyticsFrame';
import { Notices } from '../Notices';
import { Zone, ZoneGrid } from '../Zone';
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
import { COURT_ZONES } from './zones';

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
  const vsLabel = tr('analytics.kpi.vs', { range: f.dateRange(data.compareRange.from, data.compareRange.to) });
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

  return (
    <AnalyticsFrame subtitle={f.dateRange(data.range.from, data.range.to)}>
      <AnalyticsBar tab="courts" search={search} setSearch={setSearch} zones={COURT_ZONES} compareBasis={data.compareBasis} courts={courts} deck={{ startHour: data.startHour }} />
      <Notices
        lines={[
          ...(derived?.noOpeningHours && stateFor(NEEDS.when) === 'ready'
            ? [
                <span key="hours">
                  {tr('ws.analytics.courts.notices.noHours')}{' '}
                  <Link to="/admin/settings" className="tp-link">
                    {tr('ws.analytics.courts.notices.noHoursLink')}
                  </Link>
                </span>,
              ]
            : []),
          ...(derived?.thin && stateFor(NEEDS.when) === 'ready' ? [tr('ws.analytics.courts.notices.thin')] : []),
          ...(derived && !derived.compareReliable && raw?.summaryPrev ? [tr('ws.analytics.courts.notices.compareMuted')] : []),
          ...(state.settingsError != null ? [tr('errors.generic')] : []),
        ]}
        onRetry={state.error != null ? data.refetchAll : undefined}
      />

      <Zone zone={COURT_ZONES[0]!} actions={<ExportButton onExport={exportPulse} disabled={stateFor(NEEDS.pulse) !== 'ready'} />}>
        <PulseSection {...section(NEEDS.pulse)} vsLabel={vsLabel} venue={venue} openDrill={drill.open} courtId={data.courtId ?? null} />
      </Zone>

      <Zone zone={COURT_ZONES[1]!}>
        <ZoneGrid columns={2}>
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
            note={derived?.thin ? tr('ws.analytics.courts.notices.thin') : undefined}
            tip={tr('ws.analytics.courts.tips.patterns')}
            stored={data.stored}
            state={allState}
            refreshing={state.refreshing}
            f={f}
          />
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
        </ZoneGrid>
      </Zone>

      <Zone zone={COURT_ZONES[2]!}>
        <WhenSection {...section(NEEDS.when)} />
      </Zone>

      <Zone zone={COURT_ZONES[3]!}>
        <ShapeSection {...section(NEEDS.shape)} />
      </Zone>

      <Zone zone={COURT_ZONES[4]!}>
        <CourtsSection {...section(NEEDS.courts)} selectedCourtId={data.courtId} />
      </Zone>

      <Zone zone={COURT_ZONES[5]!}>
        <LossesSection {...section(NEEDS.losses)} />
      </Zone>

      <Zone zone={COURT_ZONES[6]!}>
        <GuestsSection {...section(NEEDS.guests)} />
      </Zone>

      <Zone zone={COURT_ZONES[7]!}>
        <CrossSection {...section(NEEDS.cross)} selectedCourtId={data.courtId} />
      </Zone>
      {drill.layer}
    </AnalyticsFrame>
  );
}
