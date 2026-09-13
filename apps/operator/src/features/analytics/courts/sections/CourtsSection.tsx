/** 05 Courts: the per-court table (the chart's twin is the chart) and two per-court bar charts. */
import { pickLocale } from '@touch/core';
import { useLocale } from '../../../../lib/i18n';
import { ChartCard } from '../../charts/ChartCard';
import { HBarChart } from '../../charts/HBarChart';
import { barTwin } from '../../charts/twins';
import { ZoneGrid } from '../../Zone';
import { CourtTable } from '../cards/CourtTable';
import type { SectionProps } from './types';

export function CourtsSection({ raw, derived, state, refreshing, f, rangeLabel, selectedCourtId }: SectionProps & { selectedCourtId: string | null }) {
  const { tr, locale } = useLocale();
  const courts = raw?.summary.perCourt ?? [];
  const cafeByCourt = new Map((raw?.cafe.perCourt ?? []).map((c) => [c.courtId, c]));
  const rows = courts.map((court) => ({ court, cafe: cafeByCourt.get(court.courtId) ?? null }));
  const name = (c: { courtId: string; nameEn: string; nameAr: string }) => pickLocale({ en: c.nameEn, ar: c.nameAr }, locale) || c.courtId;
  const empty = state === 'ready' && courts.length === 0;
  const occRows = courts.map((c) => ({ label: name(c), value: c.occupancyPct ?? 0, highlight: c.courtId === selectedCourtId }));
  const revRows = courts.map((c) => ({ label: name(c), value: c.revPerOpenHourIqd ?? 0, highlight: c.courtId === selectedCourtId }));
  const noHours = derived?.noOpeningHours ?? false;
  return (
    <>
      <CourtTable rows={rows} state={empty ? 'empty' : state} refreshing={refreshing} selectedCourtId={selectedCourtId} f={f} tip={tr('ws.analytics.courts.tips.courtTable')} file={`courts-${rangeLabel}`} />
      <div style={{ marginBlockStart: 'var(--tp-sp-3)' }}>
        <ZoneGrid columns={2}>
          <ChartCard
            title={tr('ws.analytics.courts.cards.occupancyByCourt')}
            tip={tr('ws.analytics.courts.tips.occupancy')}
            state={empty || noHours ? 'empty' : state}
            refreshing={refreshing}
            emptyKey={noHours ? 'ws.analytics.courts.notices.noHours' : 'ws.analytics.courts.empty.bookings'}
            height={Math.max(120, 40 * courts.length + 40)}
            twin={barTwin(occRows, tr('ws.reports.filters.court'), tr('ws.analytics.courts.units.occupancy'), `occupancy-by-court-${rangeLabel}`)}
          >
            <HBarChart rows={occRows} format={(n) => f.pct(n)} name={tr('ws.analytics.courts.units.occupancy')} axisWidth={110} />
          </ChartCard>
          <ChartCard
            title={tr('ws.analytics.courts.cards.revPerHourByCourt')}
            tip={tr('ws.analytics.courts.tips.revPerOpenHour')}
            state={empty || noHours ? 'empty' : state}
            refreshing={refreshing}
            emptyKey={noHours ? 'ws.analytics.courts.notices.noHours' : 'ws.analytics.courts.empty.bookings'}
            height={Math.max(120, 40 * courts.length + 40)}
            twin={barTwin(revRows, tr('ws.reports.filters.court'), tr('ws.analytics.courts.kpi.revPerOpenHour'), `revenue-per-hour-by-court-${rangeLabel}`)}
          >
            <HBarChart rows={revRows} format={(n) => f.compact(n)} name={tr('ws.analytics.courts.kpi.revPerOpenHour')} axisWidth={110} />
          </ChartCard>
        </ZoneGrid>
      </div>
    </>
  );
}
