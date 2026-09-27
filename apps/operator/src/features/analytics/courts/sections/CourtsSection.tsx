/**
 * Courts compared: the per-court table is the answer (every court, every
 * figure, one row each). The two per-court bar charts plot two of its
 * columns, so they fold behind "Show more" instead of repeating the table at
 * the same weight; and past a dozen courts they plot the highest twelve and
 * say so, because a bar chart of every court stops being readable long before
 * a table does.
 */
import { pickLocale } from '@touch/core';
import { useLocale } from '../../../../lib/i18n';
import { ChartCard } from '../../charts/ChartCard';
import { HBarChart } from '../../charts/HBarChart';
import { barTwin } from '../../charts/twins';
import { MoreCharts, ZoneGrid } from '../../Zone';
import { CourtTable } from '../cards/CourtTable';
import { topRows, CHART_COURTS } from '../courtRows';
import type { SectionProps } from './types';

export function CourtsSection({ raw, derived, state, refreshing, f, rangeLabel, selectedCourtId }: SectionProps & { selectedCourtId: string | null }) {
  const { tr, locale } = useLocale();
  const courts = raw?.summary.perCourt ?? [];
  const cafeByCourt = new Map((raw?.cafe.perCourt ?? []).map((c) => [c.courtId, c]));
  const rows = courts.map((court) => ({ court, cafe: cafeByCourt.get(court.courtId) ?? null }));
  const name = (c: { courtId: string; nameEn: string; nameAr: string }) => pickLocale({ en: c.nameEn, ar: c.nameAr }, locale) || c.courtId;
  const empty = state === 'ready' && courts.length === 0;
  const occAll = courts.map((c) => ({ label: name(c), value: c.occupancyPct ?? 0, highlight: c.courtId === selectedCourtId }));
  const revAll = courts.map((c) => ({ label: name(c), value: c.revPerOpenHourIqd ?? 0, highlight: c.courtId === selectedCourtId }));
  const occRows = topRows(occAll);
  const revRows = topRows(revAll);
  const capped = courts.length > CHART_COURTS ? tr('ws.analytics.courts.cards.topCourts', { n: f.num(CHART_COURTS), total: f.num(courts.length) }) : undefined;
  const noHours = derived?.noOpeningHours ?? false;
  return (
    <>
      <CourtTable rows={rows} state={empty ? 'empty' : state} refreshing={refreshing} selectedCourtId={selectedCourtId} f={f} tip={tr('ws.analytics.courts.tips.courtTable')} file={`courts-${rangeLabel}`} />
      <MoreCharts id="courts-compare" count={empty || courts.length < 2 ? 0 : 2}>
        <ZoneGrid columns={2}>
          <ChartCard
            title={tr('ws.analytics.courts.cards.occupancyByCourt')}
            tip={tr('ws.analytics.courts.tips.occupancy')}
            note={capped}
            state={empty || noHours ? 'empty' : state}
            refreshing={refreshing}
            emptyKey={noHours ? 'ws.analytics.courts.notices.noHours' : 'ws.analytics.courts.empty.bookings'}
            height={Math.max(120, 40 * occRows.length + 40)}
            twin={barTwin(occAll, tr('ws.reports.filters.court'), tr('ws.analytics.courts.units.occupancy'), `occupancy-by-court-${rangeLabel}`)}
          >
            <HBarChart rows={occRows} format={(n) => f.pct(n)} name={tr('ws.analytics.courts.units.occupancy')} axisWidth={110} />
          </ChartCard>
          <ChartCard
            title={tr('ws.analytics.courts.cards.revPerHourByCourt')}
            tip={tr('ws.analytics.courts.tips.revPerOpenHour')}
            note={capped}
            state={empty || noHours ? 'empty' : state}
            refreshing={refreshing}
            emptyKey={noHours ? 'ws.analytics.courts.notices.noHours' : 'ws.analytics.courts.empty.bookings'}
            height={Math.max(120, 40 * revRows.length + 40)}
            twin={barTwin(revAll, tr('ws.reports.filters.court'), tr('ws.analytics.courts.kpi.revPerOpenHour'), `revenue-per-hour-by-court-${rangeLabel}`)}
          >
            <HBarChart rows={revRows} format={(n) => f.compact(n)} name={tr('ws.analytics.courts.kpi.revPerOpenHour')} axisWidth={110} />
          </ChartCard>
        </ZoneGrid>
      </MoreCharts>
    </>
  );
}
