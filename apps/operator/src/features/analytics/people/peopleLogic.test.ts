/**
 * The People tab's parser (0369; customers contracts §2): the payload read
 * defensively, the buckets in their printed order, and the sentences' inputs.
 */
import { describe, expect, it } from 'vitest';
import { biggestBucket, claimLean, freshFor, parsePeople, peakFor, peopleEmpty } from './peopleLogic';

const payload = {
  period: { from: '2026-10-01', to: '2026-10-24' },
  known: {
    guests: 19,
    withGenders: 16,
    withAges: 16,
    withLevels: 16,
    judgedLevels: 2,
    plays: 38,
    bookings: 38,
    spend_iqd: 450000,
    coveragePct: 84,
    newGuests: 19,
    returningGuests: 0,
  },
  // Out of order on purpose: the parser puts them in the printed order.
  genders: [
    { bucket: 'unknown', guests: 3, plays: 6, bookings: 6, spend_iqd: 0, share: 16 },
    { bucket: 'male', guests: 5, plays: 10, bookings: 10, spend_iqd: 50000, share: 26 },
    { bucket: 'female', guests: 11, plays: 22, bookings: 22, spend_iqd: 400000, share: 58 },
  ],
  ages: [{ bucket: '25_34', guests: 11, plays: 22, bookings: 22, spend_iqd: 400000, share: 58 }],
  levels: [{ bucket: 'intermediate', guests: 11, judged: 1, plays: 22, share: 58 }],
  judged: { checked: 6, agree: 1, higher: 4, lower: 1, unclaimed: 0 },
  interests: [
    { bucket: 'cafe', guests: 4, share: 21 },
    { bucket: 'courts', guests: 19, share: 100 },
    { bucket: 'unheard_of', guests: 9, share: 47 },
  ],
  segments: [{ who: 'female', band: '25_34', level: 'intermediate', guests: 11, plays: 22, spend_iqd: 400000 }],
  peak: [
    { key: 'female', dow: 3, hour: 19, plays: 8 },
    { key: 'female', dow: 1, hour: 19, plays: 6 },
    { key: 'male', dow: 9, hour: 20, plays: 4 },
  ],
  fresh: [{ key: 'female', newGuests: 11, returningGuests: 0 }],
};

describe('parsePeople', () => {
  it('reads the crowd and its coverage', () => {
    const d = parsePeople(payload);
    expect(d.period).toEqual({ from: '2026-10-01', to: '2026-10-24' });
    expect(d.known.guests).toBe(19);
    expect(d.known.coveragePct).toBe(84);
    expect(d.known.spendIqd).toBe(450000);
    expect(peopleEmpty(d)).toBe(false);
  });

  it('prints the buckets in their own order, unknown last', () => {
    const d = parsePeople(payload);
    expect(d.genders.map((b) => b.bucket)).toEqual(['female', 'male', 'unknown']);
    expect(d.genders[0]!.guests).toBe(11);
    expect(d.levels[0]!.judged).toBe(1);
  });

  it('keeps only the interest tags it knows, in the server’s order, and drops the empty ones', () => {
    const d = parsePeople(payload);
    expect(d.interests.map((r) => r.bucket)).toEqual(['courts', 'cafe']);
  });

  it('drops a slot with an impossible weekday, and finds a bucket’s slots', () => {
    const d = parsePeople(payload);
    expect(d.peak).toHaveLength(2);
    expect(peakFor(d, 'female').map((s) => s.dow)).toEqual([3, 1]);
    expect(peakFor(d, 'male')).toEqual([]);
    expect(freshFor(d, 'female')).toEqual({ key: 'female', newGuests: 11, returningGuests: 0 });
    expect(freshFor(d, 'male')).toBeNull();
  });

  it('survives an empty answer and a server without 0369', () => {
    const d = parsePeople({});
    expect(d.known.guests).toBe(0);
    expect(d.known.coveragePct).toBeNull();
    expect(d.genders).toEqual([]);
    expect(d.interests).toEqual([]);
    expect(d.segments).toEqual([]);
    expect(peopleEmpty(d)).toBe(true);
    expect(parsePeople(null).known.guests).toBe(0);
  });
});

describe('claimLean', () => {
  it('says nothing under five judgments', () => {
    expect(claimLean({ checked: 4, agree: 4, higher: 0, lower: 0, unclaimed: 0 })).toBeNull();
  });

  it('names the way the claims lean', () => {
    expect(claimLean({ checked: 6, agree: 1, higher: 4, lower: 1, unclaimed: 0 })).toBe('over');
    expect(claimLean({ checked: 6, agree: 1, higher: 1, lower: 4, unclaimed: 0 })).toBe('under');
    expect(claimLean({ checked: 6, agree: 5, higher: 1, lower: 0, unclaimed: 0 })).toBe('agree');
  });
});

describe('biggestBucket', () => {
  it('ignores unknown and other', () => {
    const d = parsePeople(payload);
    expect(biggestBucket(d.genders)?.bucket).toBe('female');
    expect(biggestBucket([{ bucket: 'unknown', guests: 9, plays: 0, bookings: 0, spendIqd: 0, share: 100, judged: 0 }])).toBeNull();
    expect(biggestBucket([])).toBeNull();
  });
});
