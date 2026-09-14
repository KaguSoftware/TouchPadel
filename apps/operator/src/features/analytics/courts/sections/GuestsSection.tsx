/** 07 Guests: anonymous counts only. Returning against new, visit frequency, regulars, the weekly series. */
import { useLocale } from '../../../../lib/i18n';
import { ChartCard } from '../../charts/ChartCard';
import { CountBars } from '../../charts/CountBars';
import { StackedBars } from '../../charts/StackedBars';
import { barTwin, seriesTwin } from '../../charts/twins';
import { ZoneGrid } from '../../Zone';
import { StatPair } from '../cards/StatPair';
import { rateText } from '../format';
import type { SectionProps } from './types';

const VISIT_LABEL: Record<string, 'one' | 'two3' | 'four6' | 'seven'> = { '1': 'one', '2_3': 'two3', '4_6': 'four6', '7_plus': 'seven' };

export function GuestsSection({ raw, state, refreshing, f, rangeLabel }: SectionProps) {
  const { tr } = useLocale();
  const g = raw?.guests ?? null;
  const empty = state === 'ready' && (g?.identities ?? 0) === 0;
  const freqRows = (g?.visitBuckets ?? []).map((b) => ({ label: tr(`ws.analytics.courts.buckets.visits.${VISIT_LABEL[b.bucket] ?? 'one'}`), value: b.identities }));
  const weekSeries = [
    { key: 'newIdentities', name: tr('ws.analytics.courts.type.new') },
    { key: 'returningIdentities', name: tr('ws.analytics.courts.type.returning') },
  ];
  const weekRows = (g?.byWeek ?? []).map((w) => ({ label: f.date(w.weekStart), newIdentities: w.newIdentities, returningIdentities: w.returningIdentities }));
  const identifiedPct = g && g.identifiedBookings + g.unidentifiedBookings > 0 ? (g.identifiedBookings / (g.identifiedBookings + g.unidentifiedBookings)) * 100 : 0;
  return (
    <>
      <ZoneGrid columns={3}>
        <StatPair
          title={tr('ws.analytics.courts.cards.returning')}
          tip={tr('ws.analytics.courts.tips.returning')}
          note={g && !empty ? tr('ws.analytics.courts.notices.identified', { pct: f.pct(identifiedPct) }) : undefined}
          state={empty ? 'empty' : state}
          refreshing={refreshing}
          emptyKey="ws.analytics.courts.empty.guests"
          items={[
            { label: tr('ws.analytics.courts.type.returning'), value: f.num(g?.returningBookings ?? 0), sub: g ? rateText(tr, f, g.returningPct, g.returningBookings, g.identifiedBookings) : undefined },
            { label: tr('ws.analytics.courts.type.new'), value: f.num(g?.newBookings ?? 0) },
          ]}
        />
        <ChartCard
          title={tr('ws.analytics.courts.cards.frequency')}
          tip={tr('ws.analytics.courts.tips.frequency')}
          state={empty ? 'empty' : state}
          refreshing={refreshing}
          emptyKey="ws.analytics.courts.empty.guests"
          height={180}
          twin={barTwin(freqRows, tr('ws.analytics.courts.cards.frequency'), tr('ws.analytics.courts.units.identities'), `visit-frequency-${rangeLabel}`)}
        >
          <CountBars rows={freqRows} format={(n) => f.num(n)} name={tr('ws.analytics.courts.units.identities')} />
        </ChartCard>
        <StatPair
          title={tr('ws.analytics.courts.cards.regulars')}
          tip={tr('ws.analytics.courts.tips.regulars')}
          state={empty ? 'empty' : state}
          refreshing={refreshing}
          emptyKey="ws.analytics.courts.empty.guests"
          items={[
            { label: tr('ws.analytics.courts.cards.regulars'), value: f.num(g?.regulars ?? 0), sub: g?.regularsBookingsPct == null ? undefined : `${f.pct(g.regularsBookingsPct)} ${tr('ws.analytics.courts.units.bookings').toLowerCase()}` },
            { label: tr('ws.analytics.courts.cards.lapsing'), value: f.num(g?.lapsingRegulars ?? 0) },
          ]}
        />
      </ZoneGrid>
      <div style={{ marginBlockStart: 'var(--tp-sp-3)' }}>
        <ChartCard
          title={tr('ws.analytics.courts.cards.byWeek')}
          tip={tr('ws.analytics.courts.tips.byWeek')}
          state={empty || (state === 'ready' && weekRows.length === 0) ? 'empty' : state}
          refreshing={refreshing}
          emptyKey="ws.analytics.courts.empty.guests"
          height={200}
          twin={seriesTwin(weekRows, tr('ws.analytics.courts.cards.byWeek'), weekSeries, `guests-by-week-${rangeLabel}`)}
        >
          <StackedBars rows={weekRows} series={weekSeries} format={(n) => f.num(n)} interval={weekRows.length > 16 ? 1 : 0} />
        </ChartCard>
      </div>
    </>
  );
}
