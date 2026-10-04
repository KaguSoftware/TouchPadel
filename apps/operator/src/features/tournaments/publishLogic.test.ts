import { describe, expect, it } from 'vitest';
import {
  canOfferPublish,
  cutoffInstant,
  draftFromPlan,
  fieldOfSetting,
  planBlocker,
  publishErrors,
  publishSettings,
  readPlanFacts,
} from './publishLogic';

// "Publish as tournament" (tournaments build contracts §1.6 publish, §1.9).

const TZ = 'Asia/Baghdad'; // UTC+3, no DST
const PLAN = {
  class: 'B',
  name_en: 'Autumn Americano',
  name_ar: 'أمريكانو الخريف',
  format: 'americano',
  capacity: { unit: 'players', count: 16 },
  entry_fee_iqd: 25000,
  ranges: [
    { court_ids: ['c1', 'c2'], from: '2026-10-09T15:00:00Z', to: '2026-10-09T19:00:00Z' },
    { court_ids: ['c3'], from: '2026-10-09T16:00:00Z', to: '2026-10-09T19:00:00Z' },
  ],
};
const NOW = Date.parse('2026-10-03T09:00:00Z');

describe('readPlanFacts', () => {
  it('reads the name, fee, capacity, format and one window per court, and the first start', () => {
    const f = readPlanFacts(PLAN);
    expect(f).toMatchObject({
      nameEn: 'Autumn Americano',
      tournamentClass: 'B',
      format: 'americano',
      formatUnplayable: false,
      capacityUnit: 'players',
      maxEntries: 16,
      feeIqd: 25000,
      firstStart: '2026-10-09T15:00:00.000Z',
    });
    expect(f.windows.map((w) => w.courtId)).toEqual(['c1', 'c2', 'c3']);
  });

  it('caps the entries at 64, reads a missing fee (type 2) as free, and marks knockout unplayable', () => {
    const f = readPlanFacts({
      ...PLAN,
      capacity: { unit: 'players', count: 90 },
      entry_fee_iqd: undefined,
      format: 'knockout',
    });
    expect(f.maxEntries).toBe(64);
    expect(f.feeIqd).toBe(0);
    expect(f.format).toBeNull();
    expect(planBlocker(f)).toBe('format');
  });

  it('refuses pairs and fewer than four players before any field', () => {
    expect(planBlocker(readPlanFacts({ ...PLAN, capacity: { unit: 'pairs', count: 8 } }))).toBe(
      'capacity_unit',
    );
    expect(planBlocker(readPlanFacts({ ...PLAN, capacity: { unit: 'players', count: 3 } }))).toBe(
      'capacity_count',
    );
    expect(planBlocker(readPlanFacts(PLAN))).toBeNull();
  });
});

describe('the draft', () => {
  const facts = readPlanFacts(PLAN);

  it('opens on the plan format, open, 24 points, 4 minimum, 8 waitlist, the cut-off 2 h before the first block in the venue zone', () => {
    const d = draftFromPlan(facts, TZ);
    expect(d).toMatchObject({
      format: 'americano',
      category: 'open',
      pointsTarget: '24',
      minEntries: '4',
      waitlistMax: '8',
    });
    // 15:00Z − 2 h = 13:00Z = 16:00 in Baghdad.
    expect(d.cutoffDate).toBe('2026-10-09');
    expect(d.cutoffTime).toBe('16:00');
    expect(cutoffInstant(d, TZ)?.toISOString()).toBe('2026-10-09T13:00:00.000Z');
    expect(publishErrors(d, facts, TZ, NOW)).toEqual({});
  });

  it('checks each field the way the server does', () => {
    const d = draftFromPlan(facts, TZ);
    expect(publishErrors({ ...d, pointsTarget: '7' }, facts, TZ, NOW).pointsTarget).toEqual({
      kind: 'range',
      min: 8,
      max: 64,
    });
    expect(publishErrors({ ...d, minEntries: '17' }, facts, TZ, NOW).minEntries).toEqual({
      kind: 'range',
      min: 4,
      max: 16,
    });
    expect(publishErrors({ ...d, waitlistMax: '' }, facts, TZ, NOW).waitlistMax).toEqual({
      kind: 'required',
    });
    expect(publishErrors({ ...d, format: 'mexicano' }, facts, TZ, NOW).rounds).toEqual({
      kind: 'required',
    });
    expect(
      publishErrors({ ...d, format: 'mexicano', rounds: '31' }, facts, TZ, NOW).rounds,
    ).toEqual({ kind: 'range', min: 1, max: 30 });
    expect(publishErrors({ ...d, cutoffTime: '18:30' }, facts, TZ, NOW).cutoffDate).toEqual({
      kind: 'cutoffLate',
    });
    expect(publishErrors(d, facts, TZ, Date.parse('2026-10-09T14:00:00Z')).cutoffDate).toEqual({
      kind: 'cutoffPast',
    });
    expect(publishErrors({ ...d, prizeEn: 'x'.repeat(201) }, facts, TZ, NOW).prizeEn).toEqual({
      kind: 'tooLong',
      max: 200,
    });
  });

  it('sends every key, rounds only for Mexicano, blank prizes as null', () => {
    const d = draftFromPlan(facts, TZ);
    expect(publishSettings({ ...d, prizeEn: ' Racket ' }, TZ)).toEqual({
      format: 'americano',
      category: 'open',
      points_target: 24,
      min_entries: 4,
      waitlist_max: 8,
      registration_closes_at: '2026-10-09T13:00:00.000Z',
      prize_en: 'Racket',
      prize_ar: null,
    });
    expect(publishSettings({ ...d, format: 'mexicano', rounds: '6' }, TZ)).toMatchObject({
      format: 'mexicano',
      rounds: 6,
    });
  });

  it('puts a settings refusal on its field', () => {
    expect(fieldOfSetting('registration_closes_at')).toBe('cutoffDate');
    expect(fieldOfSetting('points_target')).toBe('pointsTarget');
    expect(fieldOfSetting('nope')).toBeNull();
  });

  it('offers Publish on a done tournament run to a role that publishes', () => {
    expect(canOfferPublish({ kind: 'tournament', status: 'done' }, true)).toBe(true);
    expect(canOfferPublish({ kind: 'tournament', status: 'active' }, true)).toBe(false);
    expect(canOfferPublish({ kind: 'price_promo', status: 'done' }, true)).toBe(false);
    expect(canOfferPublish({ kind: 'tournament', status: 'done' }, false)).toBe(false);
  });
});
