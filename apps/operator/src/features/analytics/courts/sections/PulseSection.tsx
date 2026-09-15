/** 01 Pulse: ten tiles in two rows of five, each with its comparison behind the delta. */
import { pctDelta } from '@touch/core';
import { useLocale } from '../../../../lib/i18n';
import { Kpi, type KpiCompare } from '../../cards/Kpi';
import type { VenueRevenue } from '../../useVenueRevenue';
import type { DrillTarget } from '../../drill';
import type { CourtKpiKey, KpiDelta } from '../derive';
import { hoursText, rateText } from '../format';
import type { SectionProps } from './types';

export function PulseSection({
  raw,
  derived,
  state,
  f,
  vsLabel,
  venue,
  openDrill,
  courtId,
}: SectionProps & { vsLabel: string; venue: VenueRevenue; openDrill: (target: DrillTarget) => void; courtId: string | null }) {
  const { tr } = useLocale();
  const k = raw?.summary.kpis;
  const cafe = raw?.cafe.attach;
  const loading = state === 'loading';
  const broken = state === 'error';
  const mutedReason = derived && !derived.compareReliable ? tr('ws.analytics.courts.notices.compareMuted') : undefined;
  const d = (key: CourtKpiKey): KpiDelta | undefined => derived?.deltas[key];
  const cmp = (key: CourtKpiKey, fmt: (n: number) => string): KpiCompare | undefined => {
    const x = d(key);
    return x && x.current != null && x.previous != null ? { label: vsLabel, current: fmt(x.current), previous: fmt(x.previous) } : undefined;
  };
  const noHours = derived?.noOpeningHours ?? false;
  const tile = (
    label: string,
    value: string,
    key: CourtKpiKey,
    fmt: (n: number) => string,
    tip: string,
    opts: { unavailable?: boolean; note?: string; invert?: boolean; drill?: DrillTarget['figure'] } = {},
  ) => (
    <Kpi
      label={label}
      value={value}
      delta={d(key)?.delta ?? null}
      reason={mutedReason}
      vsLabel={vsLabel}
      tip={tip}
      compare={cmp(key, fmt)}
      invert={opts.invert}
      note={opts.note}
      drills={opts.drill ? [{ onOpen: () => openDrill({ figure: opts.drill!, label, courtId }) }] : undefined}
      loading={loading}
      unavailable={broken || opts.unavailable}
      f={f}
    />
  );
  // Venue-wide, whatever the court filter says: cafe net plus every court's revenue.
  const venueDelta = venue.current && venue.previous && derived?.compareReliable ? pctDelta(venue.current.venueIqd, venue.previous.venueIqd) : null;
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2-5)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 'var(--tp-sp-2-5)' }}>
        {tile(tr('ws.analytics.courts.kpi.bookings'), f.num(k?.bookings ?? 0), 'bookings', f.num, tr('ws.analytics.courts.tips.bookings'), { drill: 'bookings' })}
        {tile(tr('ws.analytics.courts.kpi.bookedHours'), hoursText(f, k?.bookedMinutes ?? 0), 'bookedHours', (n) => f.num1(n), tr('ws.analytics.courts.tips.bookedHours'))}
        {tile(tr('ws.analytics.courts.kpi.occupancy'), k?.occupancyPct == null ? '—' : f.pct(k.occupancyPct), 'occupancy', f.pct, tr('ws.analytics.courts.tips.occupancy'), { unavailable: noHours })}
        {tile(tr('ws.analytics.courts.kpi.revenue'), f.money(k?.revenueIqd ?? 0), 'revenue', f.money, tr('ws.analytics.courts.tips.revenue'), { drill: 'padelRevenue' })}
        <Kpi
          label={tr('analytics.kpi.venueRevenue')}
          value={f.money(venue.current?.venueIqd ?? 0)}
          delta={venueDelta}
          reason={mutedReason}
          vsLabel={vsLabel}
          tip={tr('ws.analytics.venue.revenueTip')}
          note={venue.current ? tr('analytics.kpi.venueSplit', { cafe: f.compact(venue.current.cafeIqd), courts: f.compact(venue.current.courtsIqd) }) : undefined}
          compare={venue.current && venue.previous ? { label: vsLabel, current: f.money(venue.current.venueIqd), previous: f.money(venue.previous.venueIqd) } : undefined}
          drills={[{ onOpen: () => openDrill({ figure: 'revenue', label: tr('analytics.kpi.venueRevenue') }) }]}
          loading={venue.state === 'loading'}
          unavailable={venue.state === 'error'}
          f={f}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 'var(--tp-sp-2-5)' }}>
        {tile(tr('ws.analytics.courts.kpi.revPerOpenHour'), k?.revPerOpenHourIqd == null ? '—' : f.money(k.revPerOpenHourIqd), 'revPerOpenHour', f.money, tr('ws.analytics.courts.tips.revPerOpenHour'), { unavailable: noHours })}
        {tile(tr('ws.analytics.courts.kpi.pricePerBookedHour'), k?.pricePerBookedHourIqd == null ? '—' : f.money(k.pricePerBookedHourIqd), 'pricePerBookedHour', f.money, tr('ws.analytics.courts.tips.pricePerBookedHour'))}
        {tile(tr('ws.analytics.courts.kpi.cancelRate'), k ? rateText(tr, f, k.cancellationRatePct, k.cancellations, k.bookedTotal) : '—', 'cancellationRate', f.pct, tr('ws.analytics.courts.tips.cancelRate'), { invert: true, drill: 'cancellations' })}
        {tile(tr('ws.analytics.courts.kpi.noShowRate'), k ? rateText(tr, f, k.noShowRatePct, k.noShows, k.bookedTotal) : '—', 'noShowRate', f.pct, tr('ws.analytics.courts.tips.noShowRate'), {
          invert: true,
          drill: 'noShows',
          note: k ? tr('ws.analytics.courts.kpi.noShowsCount', { n: f.num(k.noShows) }) : undefined,
        })}
        {tile(tr('ws.analytics.courts.kpi.attachRate'), cafe ? rateText(tr, f, cafe.attachPct, cafe.linkedBookings, cafe.liveBookings) : '—', 'attachRate', f.pct, tr('ws.analytics.courts.tips.attachRate'))}
      </div>
    </div>
  );
}
