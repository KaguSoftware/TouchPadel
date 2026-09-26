/**
 * Courts summary. Ten equal tiles used to answer "how are the courts doing?"
 * with no order among them, each repeating the same comparison caveat. Now:
 *
 *  1. Four LEAD figures, the ones an owner decides on: how many bookings, how
 *     full the courts were, what they earned, and what was lost to
 *     cancellations and no-shows (one figure, both counts named, each opening
 *     its own transactions).
 *  2. The SUPPORTING figures as rows: booked hours, what an hour sells for,
 *     what an open hour earns, the cafe attach, and the whole venue's revenue.
 *
 * The separate cancellation-rate and no-show-rate tiles folded into the lead
 * "Cancelled or no-show" figure; each rate is still in the court table, the
 * losses charts and the CSV. Rates move in points, amounts in percent.
 */
import { pctDelta } from '@touch/core';
import { useLocale } from '../../../../lib/i18n';
import { FigureGroup, FigureLine, Kpi } from '../../cards/Kpi';
import type { VenueRevenue } from '../../useVenueRevenue';
import type { DrillTarget } from '../../drill';
import { smallCourtSample, type CourtKpiKey } from '../derive';
import { gridColumns } from '../../Zone';
import { hoursText, rateText } from '../format';
import type { SectionProps } from './types';

export function PulseSection({
  raw,
  derived,
  state,
  f,
  venue,
  openDrill,
  courtId,
}: SectionProps & { venue: VenueRevenue; openDrill: (target: DrillTarget) => void; courtId: string | null }) {
  const { tr } = useLocale();
  const k = raw?.summary.kpis;
  const kp = raw?.summaryPrev?.kpis ?? null;
  const cafe = raw?.cafe.attach;
  const loading = state === 'loading';
  const broken = state === 'error';
  // Both windows under the twenty-booking floor: a "−80%" from 5 bookings to 1 is noise, so no change is printed (see CourtsTab's notice).
  const reliable = (derived?.compareReliable ?? false) && !smallCourtSample(raw);
  const noHours = derived?.noOpeningHours ?? false;
  const delta = (key: CourtKpiKey) => (reliable ? (derived?.deltas[key]?.delta ?? null) : null);
  /** The earlier figure, only when a comparison window came back at all. */
  const was = (value: number | null | undefined, fmt: (n: number) => string) => (kp && value != null ? fmt(value) : null);
  const drill = (figure: DrillTarget['figure'], label: string) => ({ label, onOpen: () => openDrill({ figure, label, courtId }) });
  const common = { loading, unavailable: broken, f };

  const lost = k ? k.cancellations + k.noShows : 0;
  const lostPct = k && k.bookedTotal > 0 ? (lost / k.bookedTotal) * 100 : null;
  const lostPrevPct = kp && kp.bookedTotal > 0 ? ((kp.cancellations + kp.noShows) / kp.bookedTotal) * 100 : null;
  const lostDelta = reliable && lostPct != null && lostPrevPct != null ? Math.round(lostPct - lostPrevPct) : null;
  const venueDelta = venue.current && venue.previous && reliable ? pctDelta(venue.current.venueIqd, venue.previous.venueIqd) : null;
  const events = raw?.summary.eventMinutes ?? 0;
  const eventsPrev = raw?.summaryPrev?.eventMinutes ?? 0;

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: gridColumns(4, '11rem'), gap: 'var(--tp-sp-3)' }}>
        <Kpi
          label={tr('ws.analytics.courts.kpi.bookings')}
          value={f.num(k?.bookings ?? 0)}
          delta={delta('bookings')}
          previous={was(kp?.bookings, f.num)}
          tip={tr('ws.analytics.courts.tips.bookings')}
          drills={[drill('bookings', tr('ws.analytics.courts.kpi.bookings'))]}
          {...common}
        />
        <Kpi
          label={tr('ws.analytics.courts.kpi.occupancy')}
          value={k?.occupancyPct == null ? '—' : f.pct(k.occupancyPct)}
          delta={delta('occupancy')}
          kind="points"
          previous={was(kp?.occupancyPct, f.pct)}
          tip={tr('ws.analytics.courts.tips.occupancy')}
          note={noHours ? tr('ws.analytics.courts.notices.noHoursShort') : undefined}
          {...common}
        />
        <Kpi
          label={tr('ws.analytics.courts.kpi.revenue')}
          value={f.money(k?.revenueIqd ?? 0)}
          delta={delta('revenue')}
          previous={was(kp?.revenueIqd, f.money)}
          tip={tr('ws.analytics.courts.tips.revenue')}
          drills={[drill('padelRevenue', tr('ws.analytics.courts.kpi.revenue'))]}
          {...common}
        />
        <Kpi
          label={tr('ws.analytics.courts.kpi.lost')}
          value={k ? rateText(tr, f, lostPct, lost, k.bookedTotal) : '—'}
          delta={lostDelta}
          kind="points"
          invert
          previous={kp && lostPrevPct != null ? rateText(tr, f, lostPrevPct, kp.cancellations + kp.noShows, kp.bookedTotal) : null}
          tip={tr('ws.analytics.courts.tips.lost')}
          note={k ? tr('ws.analytics.courts.kpi.lostSplit', { cancelled: f.num(k.cancellations), noShows: f.num(k.noShows) }) : undefined}
          drills={[drill('cancellations', tr('ws.analytics.courts.units.cancellations')), drill('noShows', tr('ws.analytics.courts.units.noShows'))]}
          {...common}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: gridColumns(2), gap: 'var(--tp-sp-3)', alignItems: 'start' }}>
        <FigureGroup title={tr('ws.analytics.courts.summary.time')}>
          <FigureLine
            label={tr('ws.analytics.courts.kpi.bookedHours')}
            value={hoursText(f, k?.bookedMinutes ?? 0)}
            delta={delta('bookedHours')}
            previous={kp ? hoursText(f, kp.bookedMinutes) : null}
            tip={tr('ws.analytics.courts.tips.bookedHours')}
            {...common}
          />
          <FigureLine
            label={tr('ws.analytics.courts.kpi.pricePerBookedHour')}
            value={k?.pricePerBookedHourIqd == null ? '—' : f.money(k.pricePerBookedHourIqd)}
            delta={delta('pricePerBookedHour')}
            previous={was(kp?.pricePerBookedHourIqd, f.money)}
            tip={tr('ws.analytics.courts.tips.pricePerBookedHour')}
            {...common}
          />
          <FigureLine
            label={tr('ws.analytics.courts.kpi.revPerOpenHour')}
            value={k?.revPerOpenHourIqd == null ? '—' : f.money(k.revPerOpenHourIqd)}
            delta={noHours ? null : delta('revPerOpenHour')}
            previous={was(kp?.revPerOpenHourIqd, f.money)}
            tip={tr('ws.analytics.courts.tips.revPerOpenHour')}
            loading={loading}
            unavailable={broken || noHours}
            f={f}
          />
          {/* Tournament hours (event_court_blocks): inside the open hours the
              rates above divide by, so they are named here rather than left to
              read as unsold time. Shown only when a tournament held a court. */}
          {(events > 0 || eventsPrev > 0) && (
            <FigureLine
              label={tr('ws.events.courts.eventHours')}
              value={hoursText(f, events)}
              previous={raw?.summaryPrev ? hoursText(f, eventsPrev) : null}
              tip={tr('ws.events.courts.eventHoursTip')}
              {...common}
            />
          )}
        </FigureGroup>
        <FigureGroup title={tr('ws.analytics.courts.summary.beyond')}>
          <FigureLine
            label={tr('ws.analytics.courts.kpi.attachRate')}
            value={cafe ? rateText(tr, f, cafe.attachPct, cafe.linkedBookings, cafe.liveBookings) : '—'}
            delta={delta('attachRate')}
            kind="points"
            previous={raw?.cafePrev && raw.cafePrev.attach.liveBookings > 0 ? rateText(tr, f, raw.cafePrev.attach.attachPct, raw.cafePrev.attach.linkedBookings, raw.cafePrev.attach.liveBookings) : null}
            tip={tr('ws.analytics.courts.tips.attachRate')}
            {...common}
          />
          {/* Venue-wide, whatever the court filter says: cafe net plus every court's revenue. */}
          <FigureLine
            label={tr('analytics.kpi.venueRevenue')}
            value={f.money(venue.current?.venueIqd ?? 0)}
            delta={venueDelta}
            previous={venue.previous ? f.money(venue.previous.venueIqd) : null}
            tip={tr('ws.analytics.venue.revenueTip')}
            note={venue.current ? tr('analytics.kpi.venueSplit', { cafe: f.compact(venue.current.cafeIqd), courts: f.compact(venue.current.courtsIqd) }) : undefined}
            drills={[{ label: tr('analytics.kpi.venueRevenue'), onOpen: () => openDrill({ figure: 'revenue', label: tr('analytics.kpi.venueRevenue') }) }]}
            loading={venue.state === 'loading'}
            unavailable={venue.state === 'error'}
            f={f}
          />
        </FigureGroup>
      </div>
    </div>
  );
}
