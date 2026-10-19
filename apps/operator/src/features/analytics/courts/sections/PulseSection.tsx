/**
 * Courts summary. Ten equal tiles used to answer "how are the courts doing?"
 * with no order among them, each repeating the same comparison caveat. Now:
 *
 *  1. Four LEAD figures, the ones an owner decides on: how many bookings, how
 *     full the courts were, what padel earned (court bookings plus the Touch
 *     Shop, 0346; court bookings alone once a court is picked, since the shop
 *     is not tied to a court), and what was lost to
 *     cancellations and no-shows (one figure, both counts named, each opening
 *     its own transactions).
 *  2. The SUPPORTING figures as rows: booked hours, what an hour sells for,
 *     what an open hour earns, the cafe attach, and the whole venue's revenue.
 *
 * Each lead tile carries a picture of its figure (2026-10-19): the days of
 * the period as a line under bookings and revenue, a ring for occupancy, a
 * two-part ring for what was lost (cancelled, then no-show, in the losses
 * charts' colours). Beside the two figure cards, the venue's revenue as one
 * ring (MixCard).
 *
 * The separate cancellation-rate and no-show-rate tiles folded into the lead
 * "Cancelled or no-show" figure; each rate is still in the court table, the
 * losses charts and the CSV. Rates move in points, amounts in percent.
 */
import { MIN_RATE_DENOM, pctDelta } from '@touch/core';
import { useLocale } from '../../../../lib/i18n';
import { FigureGroup, FigureLine, Kpi } from '../../cards/Kpi';
import type { VenueRevenue } from '../../useVenueRevenue';
import type { ShopData } from '../useShopData';
import type { DrillTarget } from '../../drill';
import { smallCourtSample, type CourtKpiKey } from '../derive';
import { ZoneFrame, gridColumns } from '../../Zone';
import { hoursText, rateText } from '../format';
import { RingMeter, Swatch } from '../../charts/Donut';
import { useChartColors } from '../../charts/colors';
import { MixCard } from '../../cards/MixCard';
import { addSeries, daySeries } from '../../spark';
import type { SectionProps } from './types';

export function PulseSection({
  raw,
  derived,
  state,
  f,
  venue,
  shop,
  openDrill,
  courtId,
  range,
}: SectionProps & { venue: VenueRevenue; shop: ShopData; openDrill: (target: DrillTarget) => void; courtId: string | null; range: { from: string; to: string } }) {
  const { tr } = useLocale();
  const { SERIES_1, SERIES_2 } = useChartColors();
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
  // Padel revenue: court bookings plus the shop, whole-venue only. With a court
  // picked, or the shop figures failing, the tile is the court bookings alone.
  const withShop = courtId == null && shop.state !== 'error';
  const shopNow = shop.current?.kpis.netIqd ?? 0;
  const padel = (k?.revenueIqd ?? 0) + (withShop ? shopNow : 0);
  const padelPrev = kp && (!withShop || shop.previous) ? kp.revenueIqd + (withShop ? (shop.previous?.kpis.netIqd ?? 0) : 0) : null;
  const padelDelta = !withShop ? delta('revenue') : reliable && padelPrev != null ? pctDelta(padel, padelPrev) : null;
  const bookingsSpark = raw ? daySeries(range, raw?.summary.byDay, (d) => d.bookings, (d) => f.date(d), f.num) : null;
  const revenueSpark = raw
    ? addSeries(
        daySeries(range, raw?.summary.byDay, (d) => d.revenueIqd, (d) => f.date(d), f.compact),
        withShop ? daySeries(range, shop.current?.byDay, (d) => d.netIqd, (d) => f.date(d), f.compact) : null,
      )
    : null;
  const cancelledPct = k && k.bookedTotal > 0 ? (k.cancellations / k.bookedTotal) * 100 : 0;
  const noShowPct = k && k.bookedTotal > 0 ? (k.noShows / k.bookedTotal) * 100 : 0;
  const events = raw?.summary.eventMinutes ?? 0;
  const eventsPrev = raw?.summaryPrev?.eventMinutes ?? 0;

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
      {/* The Breakdown frame (Sait, 2026-10-19): four lead tiles, then two cards. */}
      <ZoneFrame
        // The lead tiles keep their shape and their row; every tile and card
        // takes the six card colours by place (Sait, 2026-10-19).
        lead={
          <div style={{ display: 'grid', gridTemplateColumns: gridColumns(4, '11rem'), gap: 'var(--tp-sp-3)' }}>
            <Kpi
              tone="green"
              label={tr('ws.analytics.courts.kpi.bookings')}
              value={f.num(k?.bookings ?? 0)}
              delta={delta('bookings')}
              previous={was(kp?.bookings, f.num)}
              tip={tr('ws.analytics.courts.tips.bookings')}
              spark={bookingsSpark}
              drills={[drill('bookings', tr('ws.analytics.courts.kpi.bookings'))]}
              {...common}
            />
            <Kpi
              tone="violet"
              label={tr('ws.analytics.courts.kpi.occupancy')}
              value={k?.occupancyPct == null ? '—' : f.pct(k.occupancyPct)}
              delta={delta('occupancy')}
              kind="points"
              previous={was(kp?.occupancyPct, f.pct)}
              tip={tr('ws.analytics.courts.tips.occupancy')}
              note={noHours ? tr('ws.analytics.courts.notices.noHoursShort') : undefined}
              aside={
                k?.occupancyPct == null ? undefined : (
                  <RingMeter pct={k.occupancyPct} size={52} label={tr('ws.analytics.viz.meter', { label: tr('ws.analytics.courts.kpi.occupancy'), pct: f.pct(k.occupancyPct) })} />
                )
              }
              {...common}
            />
            <Kpi
              tone="rose"
              label={tr(withShop ? 'ws.analytics.courts.kpi.padelRevenue' : 'ws.analytics.courts.kpi.revenue')}
              value={f.money(padel)}
              delta={padelDelta}
              previous={padelPrev == null ? null : f.money(padelPrev)}
              tip={tr(withShop ? 'ws.analytics.courts.tips.padelRevenue' : 'ws.analytics.courts.tips.revenue')}
              note={withShop && k && shop.current ? tr('ws.analytics.courts.kpi.padelSplit', { courts: f.compact(k.revenueIqd), shop: f.compact(shopNow) }) : undefined}
              spark={revenueSpark}
              drills={[drill('padelRevenue', tr('ws.analytics.courts.kpi.revenue'))]}
              loading={loading || (withShop && shop.state === 'loading')}
              unavailable={broken}
              f={f}
            />
            <Kpi
              tone="sky"
              label={tr('ws.analytics.courts.kpi.lost')}
              value={k ? rateText(tr, f, lostPct, lost, k.bookedTotal) : '—'}
              delta={lostDelta}
              kind="points"
              invert
              previous={kp && lostPrevPct != null ? rateText(tr, f, lostPrevPct, kp.cancellations + kp.noShows, kp.bookedTotal) : null}
              tip={tr('ws.analytics.courts.tips.lost')}
              note={
                k ? (
                  <span style={{ display: 'inline-flex', flexWrap: 'wrap', columnGap: 'var(--tp-sp-2)', alignItems: 'baseline' }}>
                    <span>
                      <Swatch color={SERIES_1} />
                      {tr('ws.analytics.viz.cancelledN', { n: f.num(k.cancellations) })}
                    </span>
                    <span>
                      <Swatch color={SERIES_2} />
                      {tr('ws.analytics.viz.noShowsN', { n: f.num(k.noShows) })}
                    </span>
                  </span>
                ) : undefined
              }
              aside={
                k && k.bookedTotal >= MIN_RATE_DENOM ? (
                  <RingMeter
                    size={52}
                    parts={[
                      { pct: cancelledPct, color: SERIES_1 },
                      { pct: noShowPct, color: SERIES_2 },
                    ]}
                    label={tr('ws.analytics.viz.lostRing', { pct: f.pct(cancelledPct + noShowPct) })}
                  />
                ) : undefined
              }
              drills={[drill('cancellations', tr('ws.analytics.courts.units.cancellations')), drill('noShows', tr('ws.analytics.courts.units.noShows'))]}
              {...common}
            />
          </div>
        }
      >
        <FigureGroup tone="teal" title={tr('ws.analytics.courts.summary.time')}>
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
        <FigureGroup tone="gold" title={tr('ws.analytics.courts.summary.beyond')}>
          <FigureLine
            label={tr('ws.analytics.courts.kpi.attachRate')}
            value={cafe ? rateText(tr, f, cafe.attachPct, cafe.linkedBookings, cafe.liveBookings) : '—'}
            delta={delta('attachRate')}
            kind="points"
            previous={raw?.cafePrev && raw.cafePrev.attach.liveBookings > 0 ? rateText(tr, f, raw.cafePrev.attach.attachPct, raw.cafePrev.attach.linkedBookings, raw.cafePrev.attach.liveBookings) : null}
            tip={tr('ws.analytics.courts.tips.attachRate')}
            {...common}
          />
          {/* Venue-wide, whatever the court filter says: cafe net plus padel (every court's revenue and the shop). */}
          <FigureLine
            label={tr('analytics.kpi.venueRevenue')}
            value={f.money(venue.current?.venueIqd ?? 0)}
            delta={venueDelta}
            previous={venue.previous ? f.money(venue.previous.venueIqd) : null}
            tip={tr('ws.analytics.venue.revenueTip')}
            note={venue.current ? tr('ws.analytics.venue.split', { cafe: f.compact(venue.current.cafeIqd), padel: f.compact(venue.current.padelIqd) }) : undefined}
            drills={[{ label: tr('analytics.kpi.venueRevenue'), onOpen: () => openDrill({ figure: 'revenue', label: tr('analytics.kpi.venueRevenue') }) }]}
            loading={venue.state === 'loading'}
            unavailable={venue.state === 'error'}
            f={f}
          />
        </FigureGroup>
        <MixCard venue={venue} tone="green" f={f} />
      </ZoneFrame>
    </div>
  );
}
