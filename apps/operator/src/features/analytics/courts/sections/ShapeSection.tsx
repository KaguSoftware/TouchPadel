/** How people book: length, lead time and app against desk open; standing bookings and app holds one click away. */
import { useLocale } from '../../../../lib/i18n';
import { ChartCard } from '../../charts/ChartCard';
import { CountBars } from '../../charts/CountBars';
import { StackedBars } from '../../charts/StackedBars';
import { barTwin, seriesTwin } from '../../charts/twins';
import { MoreCharts, ZoneGrid } from '../../Zone';
import { shortBucket } from '../copy';
import { StatPair } from '../cards/StatPair';
import { rateText, spanText } from '../format';
import type { SectionProps } from './types';

export function ShapeSection({ raw, state, refreshing, f, rangeLabel }: SectionProps) {
  const { tr } = useLocale();
  const demand = raw?.demand;
  const empty = state === 'ready' && (raw?.summary.kpis.bookings ?? 0) === 0;
  const durationRows = (demand?.durations ?? []).map((d) => ({ label: tr('ws.analytics.courts.buckets.duration', { n: f.num(d.durationMin) }), value: d.bookings }));
  const leadRows = (demand?.leadTime.buckets ?? []).map((b) => ({ label: shortBucket(tr, 'byLeadTime', b.bucket), value: b.bookings }));
  const series = [
    { key: 'mobile', name: tr('ws.analytics.courts.series.mobile') },
    { key: 'desk', name: tr('ws.analytics.courts.series.desk') },
  ];
  // The lead-time buckets split by channel: how far ahead app bookings are made
  // against desk bookings, from the demand block (one source, no second RPC).
  const sourceRows = (demand?.leadTime.buckets ?? []).map((b) => ({ label: shortBucket(tr, 'byLeadTime', b.bucket), mobile: b.mobile, desk: b.desk }));
  const funnel = demand?.holdFunnel;
  // Revenue per booked hour, per length: the twin's third column and the card's note.
  const durationTwin = {
    columns: [
      { key: 'label', label: tr('ws.analytics.courts.cards.duration') },
      { key: 'value', label: tr('ws.analytics.courts.units.bookings'), numeric: true },
      { key: 'perHour', label: tr('ws.analytics.courts.cards.revPerBookedHour'), numeric: true },
    ],
    rows: (demand?.durations ?? []).map((d) => ({ label: tr('ws.analytics.courts.buckets.duration', { n: f.num(d.durationMin) }), value: d.bookings, perHour: d.revenuePerHourIqd })),
    file: `durations-${rangeLabel}`,
  };
  const durationNote = (demand?.durations ?? []).filter((d) => d.revenuePerHourIqd != null).map((d) => `${tr('ws.analytics.courts.buckets.duration', { n: f.num(d.durationMin) })}: ${f.money(d.revenuePerHourIqd ?? 0)}`);
  return (
    <>
      <ZoneGrid columns={3}>
        <ChartCard
          title={tr('ws.analytics.courts.cards.duration')}
          tip={tr('ws.analytics.courts.tips.duration')}
          note={durationNote.length > 0 ? `${tr('ws.analytics.courts.cards.revPerBookedHour')} · ${durationNote.join(' · ')}` : undefined}
          state={empty ? 'empty' : state}
          refreshing={refreshing}
          emptyKey="ws.analytics.courts.empty.bookings"
          height={200}
          twin={durationTwin}
        >
          <CountBars rows={durationRows} format={(n) => f.num(n)} name={tr('ws.analytics.courts.units.bookings')} />
        </ChartCard>
        <ChartCard
          title={tr('ws.analytics.courts.cards.leadTime')}
          tip={tr('ws.analytics.courts.tips.leadTime')}
          note={demand?.leadTime.medianMin != null ? `${tr('ws.analytics.courts.cards.medianLead')}: ${spanText(tr, f, demand.leadTime.medianMin)}` : undefined}
          state={empty ? 'empty' : state}
          refreshing={refreshing}
          emptyKey="ws.analytics.courts.empty.bookings"
          height={200}
          twin={barTwin(leadRows, tr('ws.analytics.courts.cards.leadTime'), tr('ws.analytics.courts.units.bookings'), `lead-time-${rangeLabel}`)}
        >
          <CountBars rows={leadRows} format={(n) => f.num(n)} name={tr('ws.analytics.courts.units.bookings')} />
        </ChartCard>
        <ChartCard
          title={tr('ws.analytics.courts.cards.sourceByHour')}
          tip={tr('ws.analytics.courts.tips.sourceByHour')}
          state={empty ? 'empty' : state}
          refreshing={refreshing}
          emptyKey="ws.analytics.courts.empty.bookings"
          height={200}
          twin={seriesTwin(sourceRows, tr('ws.analytics.courts.cards.leadTime'), series, `channel-by-lead-${rangeLabel}`)}
        >
          <StackedBars rows={sourceRows} series={series} format={(n) => f.num(n)} />
        </ChartCard>
      </ZoneGrid>
      <MoreCharts id="courts-shape" count={empty ? 0 : 2}>
        <ZoneGrid columns={2}>
          <StatPair
            title={tr('ws.analytics.courts.cards.seriesShare')}
            tip={tr('ws.analytics.courts.tips.seriesShare')}
            state={empty ? 'empty' : state}
            refreshing={refreshing}
            emptyKey="ws.analytics.courts.empty.bookings"
            items={[
              { label: tr('ws.analytics.courts.series.standing'), value: f.num(demand?.series.seriesBookings ?? 0), sub: demand ? rateText(tr, f, demand.series.seriesPct, demand.series.seriesBookings, demand.series.seriesBookings + demand.series.singleBookings) : undefined },
              { label: tr('ws.analytics.courts.series.single'), value: f.num(demand?.series.singleBookings ?? 0) },
            ]}
          />
          <StatPair
            title={tr('ws.analytics.courts.cards.holdFunnel')}
            tip={tr('ws.analytics.courts.tips.holdFunnel')}
            state={state === 'ready' && funnel && funnel.holdsEnded === 0 ? 'empty' : state}
            refreshing={refreshing}
            emptyKey="ws.analytics.courts.empty.holds"
            items={[
              // holds_ended counts every app hold that reached an end, converted ones included (0093).
              { label: tr('ws.analytics.courts.cards.holdsConverted'), value: f.num(funnel?.converted ?? 0), sub: funnel ? rateText(tr, f, funnel.conversionPct, funnel.converted, funnel.holdsEnded) : undefined },
              { label: tr('ws.analytics.courts.cards.holdsEnded'), value: f.num(Math.max(0, (funnel?.holdsEnded ?? 0) - (funnel?.converted ?? 0))) },
            ]}
          />
        </ZoneGrid>
      </MoreCharts>
    </>
  );
}
