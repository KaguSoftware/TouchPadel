/**
 * When courts are busy: the occupancy heatmap full-bleed, with the hour and
 * weekday roll-ups as its margins (2026-10-19). They used to be two more bar
 * charts behind "Show more", saying the same thing a click away; now "which
 * hour", "which day" and "which hour of which day" read off one card. The
 * occupancy margins are the server's own roll-up (byHour, byDow: booked over
 * open minutes), never an average of cells; bookings and revenue add up.
 */
import { useState } from 'react';
import { useLocale } from '../../../../lib/i18n';
import { SegmentedControl } from '../../../../components/kit';
import { ChartCard } from '../../charts/ChartCard';
import { WeekHeatmap } from '../../charts/WeekHeatmap';
import { sumTotals } from '../../charts/geometry';
import { heatTwin } from '../../charts/twins';
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
  const hours: (number | null)[] = Array.from({ length: 24 }, () => null);
  for (const h of derived?.byHour ?? []) if (h.hour >= 0 && h.hour < 24) hours[h.hour] = h.openMinutes > 0 ? (h.occupancyPct ?? 0) : null;
  const days: (number | null)[] = Array.from({ length: 7 }, () => null);
  for (const d of derived?.byDow ?? []) if (d.dow >= 0 && d.dow < 7) days[d.dow] = d.openMinutes > 0 ? (d.occupancyPct ?? 0) : null;
  const totals =
    measure === 'occupancy'
      ? { hours, days, format: (n: number) => tr('ws.analytics.viz.average', { value: f.pct(n) }) }
      : { ...sumTotals(cells), format };
  return (
      <ChartCard
        title={tr('ws.analytics.courts.cards.heatmap')}
        tip={tr('ws.analytics.courts.tips.heatmap')}
        state={empty ? 'empty' : state}
        refreshing={refreshing}
        emptyKey="ws.analytics.courts.empty.heat"
        height={240}
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
        <WeekHeatmap cells={cells} f={f} format={format} unit={unit} hint={tr('ws.analytics.heatmap.hint')} totals={totals} />
      </ChartCard>
  );
}
