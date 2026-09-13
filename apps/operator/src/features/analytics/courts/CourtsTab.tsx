/**
 * `/analytics/courts` — the Courts tab: eight zones over one data hook.
 * The frame (title) and the sticky bar (tabs, filters, court select,
 * jump-nav) are shared with the Cafe tab; this file owns everything below.
 *
 * The tab is designed to stay honest on thin data: every rate prints as
 * "n of N" below its floor, every miner returns nothing below its sample
 * tier, comparisons mute when the compare window has gaps, and occupancy
 * shows a dash with a visible link when no opening hours are set.
 */
import { useMemo } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { pickLocale } from '@touch/core';
import { useLocale } from '../../../lib/i18n';
import { AnalyticsBar } from '../AnalyticsBar';
import { AnalyticsFrame } from '../AnalyticsFrame';
import { Notices } from '../Notices';
import { Zone, ZoneGrid } from '../Zone';
import { makeFormatters } from '../format';
import type { AnalyticsSearch } from '../search';
import type { CardState } from '../cards/CardShell';
import { CourtPatternsCard } from './cards/CourtPatternsCard';
import { courtPatternsCopy } from './copy';
import { CrossSection } from './sections/CrossSection';
import { CourtsSection } from './sections/CourtsSection';
import { GuestsSection } from './sections/GuestsSection';
import { LossesSection } from './sections/LossesSection';
import { PulseSection } from './sections/PulseSection';
import { ShapeSection } from './sections/ShapeSection';
import { WhenSection } from './sections/WhenSection';
import { useCourtsData } from './useCourtsData';
import { COURT_ZONES } from './zones';

export function CourtsTab() {
  const { tr, locale } = useLocale();
  const search = useSearch({ from: '/analytics' }) as AnalyticsSearch;
  const navigate = useNavigate();
  const f = useMemo(() => makeFormatters(locale), [locale]);
  // Court names reach the copy through the derivation, so the copy adapter
  // takes an empty map here and the miner resolves names from its own input.
  const copy = useMemo(() => courtPatternsCopy(tr, f, locale, new Map()), [tr, f, locale]);
  const data = useCourtsData(search, locale, copy);
  const { raw, derived, state } = data;

  const setSearch = (next: Partial<AnalyticsSearch>) => {
    void navigate({ to: '/analytics/courts', search: { ...search, ...next } });
  };

  const cardState: CardState = state.firstLoad ? 'loading' : state.error ? 'error' : 'ready';
  const vsLabel = tr('analytics.kpi.vs', { range: f.dateRange(data.compareRange.from, data.compareRange.to) });
  const rangeLabel = `${data.range.from}_${data.range.to}`;
  const courts = (raw?.summary.perCourt ?? []).map((c) => ({ id: c.courtId, label: pickLocale({ en: c.nameEn, ar: c.nameAr }, locale) || c.courtId }));
  const section = { raw, derived, state: cardState, refreshing: state.refreshing, f, rangeLabel };

  return (
    <AnalyticsFrame subtitle={f.dateRange(data.range.from, data.range.to)}>
      <AnalyticsBar
        tab="courts"
        search={search}
        setSearch={setSearch}
        zones={COURT_ZONES}
        compareBasis={data.compareBasis}
        courts={courts}
        deck={{
          startHour: data.startHour,
          live: data.live,
          refreshMinutes: data.refreshMinutes,
          setRefreshMinutes: data.setRefreshMinutes,
          autoRefreshActive: data.autoRefreshActive,
        }}
      />
      <Notices
        lines={[
          ...(derived?.noOpeningHours
            ? [
                <span key="hours">
                  {tr('ws.analytics.courts.notices.noHours')}{' '}
                  <Link to="/admin/settings" className="tp-link">
                    {tr('ws.analytics.courts.notices.noHoursLink')}
                  </Link>
                </span>,
              ]
            : []),
          ...(derived?.thin ? [tr('ws.analytics.courts.notices.thin')] : []),
          ...(derived && !derived.compareReliable && raw?.summaryPrev ? [tr('ws.analytics.courts.notices.compareMuted')] : []),
          ...(state.settingsError != null ? [tr('errors.generic')] : []),
        ]}
        onRetry={state.error != null ? data.refetchAll : undefined}
      />

      <Zone zone={COURT_ZONES[0]!}>
        <PulseSection {...section} vsLabel={vsLabel} />
      </Zone>

      <Zone zone={COURT_ZONES[1]!}>
        <ZoneGrid columns={1}>
          <CourtPatternsCard patterns={derived?.patterns ?? []} state={cardState} refreshing={state.refreshing} tip={tr('ws.analytics.courts.tips.patterns')} />
        </ZoneGrid>
      </Zone>

      <Zone zone={COURT_ZONES[2]!}>
        <WhenSection {...section} />
      </Zone>

      <Zone zone={COURT_ZONES[3]!}>
        <ShapeSection {...section} />
      </Zone>

      <Zone zone={COURT_ZONES[4]!}>
        <CourtsSection {...section} selectedCourtId={data.courtId} />
      </Zone>

      <Zone zone={COURT_ZONES[5]!}>
        <LossesSection {...section} />
      </Zone>

      <Zone zone={COURT_ZONES[6]!}>
        <GuestsSection {...section} />
      </Zone>

      <Zone zone={COURT_ZONES[7]!}>
        <CrossSection {...section} selectedCourtId={data.courtId} />
      </Zone>
    </AnalyticsFrame>
  );
}
