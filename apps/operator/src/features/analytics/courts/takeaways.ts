/**
 * Each Courts section's answer, as the sentence the owner reads before any
 * chart. Built from the SAME payload the charts plot, never from anything the
 * charts do not show. A share is printed as its two counts ("3 of 15
 * bookings"), whatever the sample: a sentence is read without the chart
 * beside it, and a count cannot claim more certainty than it has. The
 * percentages live in the figures and charts, under the twenty-booking floor.
 *
 * A function returns null when the section has nothing to say (no bookings,
 * no opening hours for an occupancy sentence): the section's own empty state
 * speaks then, and a sentence must not repeat it.
 */
import { MIN_RATE_DENOM, pickLocale } from '@touch/core';
import type { Locale } from '@touch/i18n';
import { weekdayName, type Tr } from '../copy';
import type { Formatters } from '../format';
import type { DerivedCourts, RawCourts } from './derive';
import { spanText } from './format';

/** Open days a weekday-hour needs before it can be named the fullest. */
export const PEAK_MIN_OPEN_DAYS = 2;

const join = (...parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join(' ') || null;

/** When the courts fill: the fullest weekday-hour, then the busiest and quietest weekday. */
export function whenTakeaway(raw: RawCourts, derived: DerivedCourts, tr: Tr, f: Formatters): string | null {
  const k = raw.summary.kpis;
  if (k.bookings === 0 || derived.noOpeningHours) return null;
  // A weekday-hour that was open once cannot be "the fullest hour": one booking fills it.
  const open = derived.cells.filter((c) => c.openMinutes > 0 && c.occupancyPct != null && c.openDays >= PEAK_MIN_OPEN_DAYS);
  const peak = open.reduce<(typeof open)[number] | null>(
    (best, c) => (best === null || c.occupancyPct! > best.occupancyPct! || (c.occupancyPct === best.occupancyPct && c.bookings > best.bookings) ? c : best),
    null,
  );
  const days = derived.byDow.filter((d) => d.openMinutes > 0 && d.occupancyPct != null);
  const busy = days.reduce<(typeof days)[number] | null>((b, d) => (b === null || d.occupancyPct! > b.occupancyPct! ? d : b), null);
  const quiet = days.reduce<(typeof days)[number] | null>((b, d) => (b === null || d.occupancyPct! < b.occupancyPct! ? d : b), null);
  return join(
    peak && peak.bookings > 0
      ? tr('ws.analytics.courts.lead.whenPeak', {
          slot: `${weekdayName(tr, peak.dow)} ${f.hour(peak.hour)}`,
          pct: f.pct(peak.occupancyPct!),
          days: f.num(peak.openDays),
        })
      : null,
    busy && quiet && busy.dow !== quiet.dow
      ? tr('ws.analytics.courts.lead.whenDays', {
          busy: weekdayName(tr, busy.dow),
          busyPct: f.pct(busy.occupancyPct!),
          quiet: weekdayName(tr, quiet.dow),
          quietPct: f.pct(quiet.occupancyPct!),
        })
      : null,
    k.bookings < MIN_RATE_DENOM ? tr('ws.analytics.courts.lead.fewBookings', { n: f.num(k.bookings) }) : null,
  );
}

/** How the courts compare: the fullest and emptiest court (by bookings when there are no opening hours). */
export function courtsTakeaway(raw: RawCourts, derived: DerivedCourts, tr: Tr, f: Formatters, locale: Locale): string | null {
  const courts = raw.summary.perCourt;
  if (courts.length < 2 || raw.summary.kpis.bookings === 0) return null;
  const name = (c: (typeof courts)[number]) => pickLocale({ en: c.nameEn, ar: c.nameAr }, locale) || c.courtId;
  if (!derived.noOpeningHours) {
    const rated = courts.filter((c) => c.occupancyPct != null);
    if (rated.length < 2) return null;
    const best = rated.reduce((b, c) => (c.occupancyPct! > b.occupancyPct! ? c : b));
    const worst = rated.reduce((b, c) => (c.occupancyPct! < b.occupancyPct! ? c : b));
    if (best.occupancyPct === worst.occupancyPct) return tr('ws.analytics.courts.lead.courtsEven', { pct: f.pct(best.occupancyPct!) });
    return tr('ws.analytics.courts.lead.courtsOccupancy', { best: name(best), bestPct: f.pct(best.occupancyPct!), worst: name(worst), worstPct: f.pct(worst.occupancyPct!) });
  }
  const best = courts.reduce((b, c) => (c.bookings > b.bookings ? c : b));
  const worst = courts.reduce((b, c) => (c.bookings < b.bookings ? c : b));
  if (best.bookings === worst.bookings) return null;
  return tr('ws.analytics.courts.lead.courtsBookings', { best: name(best), bestN: f.num(best.bookings), worst: name(worst), worstN: f.num(worst.bookings) });
}

/** What was lost: the counts out of everything booked, what became of late cancellations, and whether there is enough to see a cluster. */
export function lossesTakeaway(raw: RawCourts, tr: Tr, f: Formatters): string | null {
  const k = raw.summary.kpis;
  if (k.cancellations + k.noShows === 0) return null;
  const late = raw.endings.cancellations.resold;
  return join(
    tr('ws.analytics.courts.lead.losses', { cancelled: f.num(k.cancellations), noShows: f.num(k.noShows), total: f.num(k.bookedTotal) }),
    late.cancelled > 0
      ? tr('ws.analytics.courts.lead.lossesLate', {
          late: f.num(late.cancelled),
          window: spanText(tr, f, raw.endings.policyWindowMin),
          resold: f.num(late.resoldN),
          empty: f.num(late.emptyN),
        })
      : null,
    k.bookedTotal < MIN_RATE_DENOM ? tr('ws.analytics.courts.lead.lossesThin') : null,
  );
}

/** How people book: the usual length, how far ahead, and the app's share. */
export function shapeTakeaway(raw: RawCourts, tr: Tr, f: Formatters): string | null {
  const k = raw.summary.kpis;
  if (k.bookings === 0) return null;
  const d = raw.demand;
  const top = d.durations.reduce<(typeof d.durations)[number] | null>((b, r) => (b === null || r.bookings > b.bookings ? r : b), null);
  const durTotal = d.durations.reduce((s, r) => s + r.bookings, 0);
  const channel = k.mobileBookings + k.deskBookings;
  return join(
    top && durTotal > 0
      ? tr('ws.analytics.courts.lead.shapeDuration', {
          length: tr('ws.analytics.courts.buckets.duration', { n: f.num(top.durationMin) }),
          n: f.num(top.bookings),
          total: f.num(durTotal),
        })
      : null,
    d.leadTime.medianMin != null ? tr('ws.analytics.courts.lead.shapeLead', { span: spanText(tr, f, d.leadTime.medianMin) }) : null,
    channel > 0 ? tr('ws.analytics.courts.lead.shapeApp', { n: f.num(k.mobileBookings), total: f.num(channel) }) : null,
  );
}

/** Who comes back: the returning share of identified bookings, and the regulars. */
export function guestsTakeaway(raw: RawCourts, tr: Tr, f: Formatters): string | null {
  const g = raw.guests;
  if (!g || g.identities === 0) return null;
  return join(
    g.identifiedBookings > 0
      ? tr('ws.analytics.courts.lead.guestsReturning', { n: f.num(g.returningBookings), total: f.num(g.identifiedBookings) })
      : null,
    g.regulars > 0 ? tr('ws.analytics.courts.lead.guestsRegulars', { regulars: f.num(g.regulars), lapsing: f.num(g.lapsingRegulars) }) : null,
  );
}

/** Court players at the cafe: the attach share and the spend per linked booking, or that nothing was linked. */
export function cafeTakeaway(raw: RawCourts, tr: Tr, f: Formatters): string | null {
  const a = raw.cafe.attach;
  if (a.liveBookings === 0) return null;
  if (a.linkedBookings === 0) return tr('ws.analytics.courts.lead.cafeNoLinks', { n: f.num(a.liveBookings) });
  return join(
    tr('ws.analytics.courts.lead.cafeAttach', { n: f.num(a.linkedBookings), total: f.num(a.liveBookings) }),
    a.cafePerLinkedIqd != null ? tr('ws.analytics.courts.lead.cafeSpend', { money: f.money(a.cafePerLinkedIqd) }) : null,
  );
}
