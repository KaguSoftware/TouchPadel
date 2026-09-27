/** When courts are busy: the occupancy heatmap full-bleed; the hour and weekday roll-ups one click away. */
import { useState } from 'react';
import { useLocale } from '../../../../lib/i18n';
import { SegmentedControl } from '../../../../components/kit';
import { ChartCard } from '../../charts/ChartCard';
import { CountBars } from '../../charts/CountBars';
import { WeekHeatmap } from '../../charts/WeekHeatmap';
import { barTwin, heatTwin } from '../../charts/twins';
import { MoreCharts, ZoneGrid } from '../../Zone';
import { weekdayName } from '../../copy';
import type { SectionProps } from './types';

type Measure = 'occupancy' | 'bookings' | 'revenue';

export function WhenSection({ raw, derived, state, refreshing, f, rangeLabel }: SectionProps) {
  const { tr } = useLocale();
  const [measure, setMeasure] = useState<Measure>('occupancy');
  const cells = (derived?.cells ?? []).map((c) => ({
    dow: c.dow,
    hour: c.hour,
    value: measure === 'occupancy' ? (c.occupancyPct ?? 0) : measure === 'bookings' ? c.bookings : c.revenueIqd,
    open: c.openMinutes > 0 || c.bookings > 0,
  }));
  const format = (n: number) => (measure === 'occupancy' ? f.pct(n) : measure === 'bookings' ? `${f.num(n)} ${tr('ws.analytics.courts.units.bookings').toLowerCase()}` : f.money(n));
  const unit = tr(measure === 'occupancy' ? 'ws.analytics.courts.units.occupancy' : measure === 'bookings' ? 'ws.analytics.courts.units.bookings' : 'ws.analytics.courts.units.revenue');
  const empty = state === 'ready' && (raw?.summary.kpis.bookings ?? 0) === 0;
  const hourRows = (derived?.byHour ?? []).map((h) => ({ label: f.hour(h.hour), value: h.occupancyPct ?? 0 }));
  // f.weekday, not a sliced name: three letters of an Arabic weekday is not a word ("الأ").
  const dowRows = (derived?.byDow ?? []).map((d) => ({ label: f.weekday(d.dow), value: d.occupancyPct ?? 0 }));
  return (
    <>
      <ChartCard
        title={tr('ws.analytics.courts.cards.heatmap')}
        tip={tr('ws.analytics.courts.tips.heatmap')}
        state={empty ? 'empty' : state}
        refreshing={refreshing}
        emptyKey="ws.analytics.courts.empty.heat"
        height={200}
        actions={
          <SegmentedControl<Measure>
            size="sm"
            aria-label={tr('ws.analytics.courts.cards.heatmap')}
            value={measure}
            onChange={setMeasure}
            options={[
              { value: 'occupancy', label: tr('ws.analytics.courts.units.occupancy') },
              { value: 'bookings', label: tr('ws.analytics.courts.units.bookings') },
              { value: 'revenue', label: tr('ws.analytics.courts.units.revenue') },
            ]}
          />
        }
        twin={heatTwin(
          [...cells].sort((a, b) => a.dow - b.dow || a.hour - b.hour).map((c) => ({ day: weekdayName(tr, c.dow), hour: f.hour(c.hour), value: c.open ? c.value : null })),
          tr('ws.reports.filters.group'),
          tr('ws.analytics.courts.cards.byHour'),
          unit,
          `court-heatmap-${measure}-${rangeLabel}`,
        )}
      >
        <WeekHeatmap cells={cells} f={f} format={format} unit={unit} hint={tr('ws.analytics.heatmap.hint')} />
      </ChartCard>
      <MoreCharts id="courts-when" count={empty ? 0 : 2}>
        <ZoneGrid columns={2}>
          <ChartCard
            title={tr('ws.analytics.courts.cards.byHour')}
            tip={tr('ws.analytics.courts.tips.byHour')}
            state={empty ? 'empty' : state}
            refreshing={refreshing}
            emptyKey="ws.analytics.courts.empty.heat"
            height={200}
            twin={barTwin(hourRows, tr('ws.analytics.courts.cards.byHour'), tr('ws.analytics.courts.units.occupancy'), `occupancy-by-hour-${rangeLabel}`)}
          >
            <CountBars rows={hourRows} format={(n) => f.pct(n)} name={tr('ws.analytics.courts.units.occupancy')} tickFontSize={10} interval={1} />
          </ChartCard>
          <ChartCard
            title={tr('ws.analytics.courts.cards.byWeekday')}
            tip={tr('ws.analytics.courts.tips.byWeekday')}
            state={empty ? 'empty' : state}
            refreshing={refreshing}
            emptyKey="ws.analytics.courts.empty.heat"
            height={200}
            twin={barTwin(dowRows, tr('ws.analytics.courts.cards.byWeekday'), tr('ws.analytics.courts.units.occupancy'), `occupancy-by-weekday-${rangeLabel}`)}
          >
            <CountBars rows={dowRows} format={(n) => f.pct(n)} name={tr('ws.analytics.courts.units.occupancy')} />
          </ChartCard>
        </ZoneGrid>
      </MoreCharts>
    </>
  );
}
