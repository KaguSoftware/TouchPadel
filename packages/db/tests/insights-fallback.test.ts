/**
 * The degraded path of `analytics-insights` (functions/_shared/insightsFallback.ts)
 * fed by the REAL operator payload builders over the operator's own fixtures —
 * the exact bytes the card would POST. The fallback used to read fields the
 * payload never carried and printed empty names and "Sunday" for every heat
 * cell; this pins the contract from both ends: the builders type-check against
 * it and the fallback prints what they wrote.
 */
import { describe, expect, it } from 'vitest';
import { makeT } from '@touch/i18n';
import type { CafeInsightsPayload, CourtsInsightsPayload } from '../supabase/functions/_shared/insightsContract.ts';
import { templatedInsights } from '../supabase/functions/_shared/insightsFallback.ts';
import { collectAmounts, gateInsights } from '../supabase/functions/_shared/insightsGate.ts';
import { derive, type RawAnalytics } from '../../../apps/operator/src/features/analytics/derive';
import { buildInsightsData } from '../../../apps/operator/src/features/analytics/payload';
import {
  COMPARE_RANGE as CAFE_COMPARE_RANGE,
  RANGE as CAFE_RANGE,
  bestSellersJson,
  boughtTogetherJson,
  dailySalesJson,
  dailySalesPrevJson,
  hourlyJson,
  itemMarginsJson,
  menuSnapshotJson,
  promoJson,
  soldItemsJson,
} from '../../../apps/operator/src/features/analytics/fixtures';
import {
  parseBestSellers,
  parseBoughtTogether,
  parseDailySales,
  parseHourly,
  parseItemMargins,
  parseMenuSnapshot,
  parsePromoSales,
  parseSoldItems,
} from '../../../apps/operator/src/features/analytics/shape';
import { makeFormatters } from '../../../apps/operator/src/features/analytics/format';
import { courtPatternsCopy } from '../../../apps/operator/src/features/analytics/courts/copy';
import { deriveCourts, type RawCourts } from '../../../apps/operator/src/features/analytics/courts/derive';
import { buildCourtsInsightsData } from '../../../apps/operator/src/features/analytics/courts/payload';
import { COMPARE_RANGE, RANGE, cafeJson, cafePrevJson, demandJson, endingsJson, guestsJson, summaryJson, summaryPrevJson } from '../../../apps/operator/src/features/analytics/courts/fixtures';
import { parseCourtsCafe, parseCourtsDemand, parseCourtsEndings, parseCourtsGuests, parseCourtsSummary } from '../../../apps/operator/src/features/analytics/courts/shape';

const tr = makeT('en');
const f = makeFormatters('en');

function cafePayload(): CafeInsightsPayload {
  const raw: RawAnalytics = {
    preset: '7d',
    range: CAFE_RANGE,
    compareRange: CAFE_COMPARE_RANGE,
    compareBasis: 'prev',
    todayISO: '2026-09-14',
    excludedIds: [],
    daily: parseDailySales(dailySalesJson),
    dailyPrev: parseDailySales(dailySalesPrevJson),
    soldByDay: parseSoldItems(soldItemsJson),
    bestSellers: parseBestSellers(bestSellersJson),
    boughtTogether: parseBoughtTogether(boughtTogetherJson),
    margins: parseItemMargins(itemMarginsJson),
    promoSales: parsePromoSales(promoJson),
    menu: parseMenuSnapshot(menuSnapshotJson),
    hourly: parseHourly(hourlyJson),
    engagementStatus: 'unconfigured',
    floor: null,
    posthog: null,
    posthogPrev: null,
  };
  return buildInsightsData(raw, derive(raw), 'en', { rejections: [] });
}

function courtsPayload(): CourtsInsightsPayload {
  const raw: RawCourts = {
    range: RANGE,
    compareRange: COMPARE_RANGE,
    compareBasis: 'prev',
    todayISO: '2026-09-14',
    courtId: null,
    summary: parseCourtsSummary(summaryJson),
    demand: parseCourtsDemand(demandJson),
    endings: parseCourtsEndings(endingsJson),
    guests: parseCourtsGuests(guestsJson),
    cafe: parseCourtsCafe(cafeJson),
    summaryPrev: parseCourtsSummary(summaryPrevJson),
    demandPrev: parseCourtsDemand(demandJson),
    endingsPrev: parseCourtsEndings(endingsJson),
    cafePrev: parseCourtsCafe(cafePrevJson),
  };
  const copy = courtPatternsCopy(tr, f, 'en', new Map());
  return buildCourtsInsightsData(raw, deriveCourts(raw, copy), 'en', tr, { rejections: [] });
}

describe('cafe fallback over the operator payload', () => {
  const data = cafePayload();

  it('prints real item names, real dates and amounts the payload contains, each with a sample', () => {
    const out = templatedInsights({ scope: 'cafe', lang: 'en', data });
    expect(out.length).toBeGreaterThanOrEqual(3);
    for (const i of out) {
      expect(i.text, i.kind).not.toMatch(/undefined|null|\bNaN\b/);
      expect(i.text, i.kind).not.toMatch(/^\s|\s\s/);
      expect(i.sample, i.kind).toEqual(expect.any(Number));
    }
    const best = out.find((i) => i.kind === 'summary')!;
    expect(best.text).toBe('Water was the best seller: 140 sold for 140,000 IQD (57.1% of units).');
    expect(best.sample).toBe(140);
    // The pair reads from the rarer side, as the Bought together card does: Kahi (30 orders) triggers Latte.
    const pair = out.find((i) => i.kind === 'structural')!;
    expect(pair.text).toBe('Kahi and Latte were ordered together 20 times (67% of orders with Kahi, lift 3.3×) — try suggesting one when the other is added.');
    const day = out.find((i) => i.kind === 'movement')!;
    expect(day.text).toMatch(/^Busiest day was 2026-09-0\d: 100,000 IQD across 12 orders\.$/);
    // Every amount a templated sentence cites is a number the payload holds, so the gate keeps them all.
    const kept = gateInsights(out, { rejections: [], basis: data.basis, excludedNames: data.excluded_names, amounts: collectAmounts(data) });
    expect(kept).toHaveLength(out.length);
  });

  it('writes Arabic with Latin digits and the same names', () => {
    const out = templatedInsights({ scope: 'cafe', lang: 'ar', data });
    expect(out[0]!.text).toMatch(/^Water كان الأكثر مبيعاً: 140 وحدة بإيراد 140,000 د\.ع/);
    expect(out.every((i) => !/[٠-٩]/.test(i.text))).toBe(true);
  });
});

describe('courts fallback over the operator payload', () => {
  const data = courtsPayload();

  it('prints weekday labels from the payload, never "Sunday" for every cell, and court names', () => {
    expect(data.heatmap_top[0]).toMatchObject({ weekday: expect.any(Number), weekday_label: expect.any(String) });
    const out = templatedInsights({ scope: 'courts', lang: 'en', data });
    expect(out.length).toBeGreaterThanOrEqual(3);
    for (const i of out) {
      expect(i.text, i.kind).not.toMatch(/undefined|null|\bNaN\b/);
      expect(i.sample, i.kind).toEqual(expect.any(Number));
    }
    const slots = out.filter((i) => i.kind === 'occupancy');
    expect(slots).toHaveLength(2);
    // Two different cells: the fullest and the emptiest carry their own weekday and hour.
    expect(slots[0]!.subjects[0]).not.toBe(slots[1]!.subjects[0]);
    for (const s of slots) expect(s.subjects[0]).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\S* \d{2}:00$/);
    const canc = out.find((i) => i.kind === 'reliability')!;
    expect(canc.text).toMatch(/^\d+ bookings were cancelled/);
    expect(canc.sample).toBe(data.kpis.booked_total);
    const attach = out.find((i) => i.kind === 'attach')!;
    expect(attach.text).toMatch(/lowest on Court [AB] at/);
  });

  it('floors a segment rate on MIN_RATE_DENOM booked slots and labels every segment', () => {
    for (const s of [...data.endings.cancellations.top_segments, ...data.endings.no_shows.top_segments]) {
      expect(s.bookings_total).toBeGreaterThanOrEqual(20);
      expect(s.label).not.toBe('');
      expect(s.dim).toMatch(/^(hour|weekday|court|source|lead_time|guest_type)$/);
    }
  });
});
