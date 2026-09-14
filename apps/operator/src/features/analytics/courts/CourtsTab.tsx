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
import { CourtPatternsCard } from './cards/CourtPatternsCard';
import { courtPatternsCopy } from './copy';
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

  const setSearch = (next: Partial<AnalyticsSearch>) => {
    void navigate({ to: '/analytics/courts', search: { ...search, ...next } });
  };

  // The "all" aggregate the Insights and Patterns cards read: they need every RPC.
  const allState: CardState = state.loading ? 'loading' : state.error ? 'error' : 'ready';
  const vsLabel = tr('analytics.kpi.vs', { range: f.dateRange(data.compareRange.from, data.compareRange.to) });
  const rangeLabel = `${data.range.from}_${data.range.to}`;
  const courts = (activeCourts.data ?? []).map((c) => ({ id: c.id, label: pickLocale({ en: c.name_en, ar: c.name_ar }, locale) || c.id }));
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

      <Zone zone={COURT_ZONES[0]!}>
        <PulseSection {...section(NEEDS.pulse)} vsLabel={vsLabel} venue={venue} />
      </Zone>

      <Zone zone={COURT_ZONES[1]!}>
        <ZoneGrid columns={2}>
          <AiInsightsCard
            scope="courts"
            range={data.range}
            compareBasis={data.compareBasis}
            buildData={(extras) => (raw && derived && allState === 'ready' ? buildCourtsInsightsData(raw, derived, locale, tr, extras) : null)}
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
    </AnalyticsFrame>
  );
}
