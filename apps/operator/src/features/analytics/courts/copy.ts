/**
 * Adapters from `tr()` to the copy contracts the court miner expects, so the
 * deterministic patterns read in the operator's language (the LLM judge is
 * only a wording gate; these sentences are what shows when it is off).
 */
import { pickLocale, type CourtPatternsCopy, type EndingsDimension } from '@touch/core';
import type { Locale, MessageKey } from '@touch/i18n';
import { weekdayName, type Tr } from '../copy';
import type { Formatters } from '../format';
import { spanText } from './format';
import type { NoticeRow } from './shape';

const LEAD_KEY: Record<string, MessageKey> = {
  lt2h: 'ws.analytics.courts.buckets.lead.lt2h',
  '2_6h': 'ws.analytics.courts.buckets.lead.h2to6',
  '6_24h': 'ws.analytics.courts.buckets.lead.h6to24',
  '1_3d': 'ws.analytics.courts.buckets.lead.d1to3',
  '3_7d': 'ws.analytics.courts.buckets.lead.d3to7',
  '7d_plus': 'ws.analytics.courts.buckets.lead.d7plus',
};
const TYPE_KEY: Record<string, MessageKey> = {
  returning: 'ws.analytics.courts.type.returning',
  new: 'ws.analytics.courts.type.new',
  unidentified: 'ws.analytics.courts.type.unidentified',
};
const SOURCE_KEY: Record<string, MessageKey> = {
  mobile: 'ws.analytics.courts.series.mobile',
  desk: 'ws.analytics.courts.series.desk',
};
const SERIES_KEY: Record<string, MessageKey> = {
  series: 'ws.analytics.courts.series.standing',
  single: 'ws.analytics.courts.series.single',
};

const LEAD_SHORT: Record<string, MessageKey> = {
  lt2h: 'ws.analytics.courts.buckets.leadShort.lt2h',
  '2_6h': 'ws.analytics.courts.buckets.leadShort.h2to6',
  '6_24h': 'ws.analytics.courts.buckets.leadShort.h6to24',
  '1_3d': 'ws.analytics.courts.buckets.leadShort.d1to3',
  '3_7d': 'ws.analytics.courts.buckets.leadShort.d3to7',
  '7d_plus': 'ws.analytics.courts.buckets.leadShort.d7plus',
};
/**
 * A notice bucket's axis label from its own edges (0097): "after start",
 * "< 2 h", "2 h–4 h", "3 days+". The keys are dynamic because the venue's
 * policy window is one of the boundaries.
 */
export function noticeLabel(tr: Tr, f: Formatters, row: Pick<NoticeRow, 'loMin' | 'hiMin'>): string {
  if (row.loMin == null) return tr('ws.analytics.courts.buckets.noticeShort.afterStart');
  if (row.hiMin == null) return `${spanText(tr, f, row.loMin)}+`;
  if (row.loMin === 0) return `< ${spanText(tr, f, row.hiMin)}`;
  return `${spanText(tr, f, row.loMin)}–${spanText(tr, f, row.hiMin)}`;
}

/** The short form of a lead-time bucket, for chart axes where the full label collides. */
export function shortBucket(tr: Tr, dimension: 'byLeadTime', key: string): string {
  const k = dimension === 'byLeadTime' ? LEAD_SHORT[key] : undefined;
  return k ? tr(k) : key;
}

/** A breakdown key, in words. Exported so the loss cards label their bars the same way. */
export function segmentLabel(tr: Tr, f: Formatters, dimension: EndingsDimension, key: string): string {
  switch (dimension) {
    case 'byLeadTime':
      return LEAD_KEY[key] ? tr(LEAD_KEY[key]) : key;
    case 'byNotice':
      // Dynamic keys since 0097 ("120_240"); the losses section labels them from their edges.
      return key;
    case 'byType':
      return TYPE_KEY[key] ? tr(TYPE_KEY[key]) : key;
    case 'bySource':
      return SOURCE_KEY[key] ? tr(SOURCE_KEY[key]) : key;
    case 'byDuration':
      return tr('ws.analytics.courts.buckets.duration', { n: f.num(Number(key)) });
    case 'byHour':
      return f.hour(Number(key));
    case 'byDow':
      return weekdayName(tr, Number(key));
    case 'byCourt':
      return key;
    default:
      return SERIES_KEY[key] ? tr(SERIES_KEY[key]) : key;
  }
}

export function courtPatternsCopy(
  tr: Tr,
  f: Formatters,
  locale: Locale,
  courtNames: ReadonlyMap<string, { nameEn: string; nameAr: string }>,
): CourtPatternsCopy {
  const p = (k: string) => `ws.analytics.courts.patterns.${k}` as MessageKey;
  const court = (key: string) => {
    const c = courtNames.get(key);
    return c ? pickLocale({ en: c.nameEn, ar: c.nameAr }, locale) || key : key;
  };
  return {
    locale,
    weekday: (dow) => weekdayName(tr, dow),
    hour: (h) => f.hour(h),
    hourRange: (h0, h1) => `${f.hour(h0)}–${f.hour(h1 % 24)}`,
    slot: (weekday, hours) => `${weekday} ${hours}`,
    segment: (dimension, key) => (dimension === 'byCourt' ? court(key) : segmentLabel(tr, f, dimension, key)),
    regularsSubject: tr(p('regulars')),
    sample: {
      openDays: (n) => tr(p('sample.openDays'), { n: f.num(n) }),
      bookings: (n) => tr(p('sample.bookings'), { n: f.num(n) }),
      bookingsPair: (current, previous) => tr(p('sample.bookingsPair'), { current: f.num(current), previous: f.num(previous) }),
      regulars: (n) => tr(p('sample.regulars'), { n: f.num(n) }),
      linkedOrders: (count, total) => tr(p('sample.linkedOrders'), { count: f.num(count), total: f.num(total) }),
    },
    fallback: {
      deadSlot: (weekday, hours, occupancyPct, venuePct, openDays) =>
        tr(p('fallback.deadSlot'), { slot: `${weekday} ${hours}`, pct: f.pct(occupancyPct), venue: f.pct(venuePct), days: f.num(openDays) }),
      saturatedSlot: (weekday, hours, occupancyPct, openDays, holdsExpired) =>
        tr(p('fallback.saturatedSlot'), { slot: `${weekday} ${hours}`, pct: f.pct(occupancyPct), days: f.num(openDays), holds: f.num(holdsExpired) }),
      shiftUp: (subject, currentPct, previousPct, points) =>
        tr(p('fallback.shiftUp'), { subject, current: f.pct(currentPct), previous: f.pct(previousPct), points: f.num(points) }),
      shiftDown: (subject, currentPct, previousPct, points) =>
        tr(p('fallback.shiftDown'), { subject, current: f.pct(currentPct), previous: f.pct(previousPct), points: f.num(points) }),
      cancellationCluster: (subject, ratePct, basePct, n, total) =>
        tr(p('fallback.cancellationCluster'), { subject, rate: f.pct(ratePct), base: f.pct(basePct), n: f.num(n), total: f.num(total) }),
      noShowCluster: (subject, ratePct, basePct, n, total) =>
        tr(p('fallback.noShowCluster'), { subject, rate: f.pct(ratePct), base: f.pct(basePct), n: f.num(n), total: f.num(total) }),
      lapsing: (lapsing, regulars, pctShare) => tr(p('fallback.lapsing'), { lapsing: f.num(lapsing), regulars: f.num(regulars), pct: f.pct(pctShare) }),
      attachLow: (subject, attachPct, venuePct, bookings) =>
        tr(p('fallback.attachLow'), { subject, pct: f.pct(attachPct), venue: f.pct(venuePct), n: f.num(bookings) }),
      attachHigh: (subject, attachPct, venuePct, bookings) =>
        tr(p('fallback.attachHigh'), { subject, pct: f.pct(attachPct), venue: f.pct(venuePct), n: f.num(bookings) }),
      courtBasket: (item, lift, linkedWith, linkedTotal) =>
        tr(p('fallback.courtBasket'), { item, lift: f.num1(lift), with: f.num(linkedWith), total: f.num(linkedTotal) }),
    },
  };
}
