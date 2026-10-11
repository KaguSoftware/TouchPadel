import { describe, expect, it } from 'vitest';
import {
  coachesForLevel,
  parseCoachLevels,
  parseCoachProfile,
  parseCoachingPublic,
  showcaseLevelFor,
  showcaseOrder,
  showcaseSeed,
  teachesLevel,
  type CoachLevel,
} from '../logic';
import {
  COACH_ID,
  coachProfileFixture,
  coachingPublicFixture,
} from '../../../test/coachingFixtures';

// The Coaches tab (play-coaches contracts §4.2, §6): levels read defensively,
// a coach with none shows under every level, and the order is a daily shuffle,
// never the venue's ranking.

describe('parseCoachLevels', () => {
  it('keeps the known levels in the fixed order, once each', () => {
    expect(parseCoachLevels(['advanced', 'beginner', 'advanced'])).toEqual([
      'beginner',
      'advanced',
    ]);
  });

  it('drops what this build does not know', () => {
    expect(parseCoachLevels(['pro', 'intermediate', 3, null, 'Beginner'])).toEqual([
      'intermediate',
    ]);
  });

  it('reads anything that is not a list as no levels (= all levels)', () => {
    for (const v of [undefined, null, 'beginner', 7, { beginner: true }]) {
      expect(parseCoachLevels(v)).toEqual([]);
    }
  });

  it('is read on coaching_public coaches and on coach_profile’s coach', () => {
    expect(parseCoachingPublic(coachingPublicFixture()).coaches[0]!.levels).toEqual([
      'beginner',
      'intermediate',
    ]);
    expect(parseCoachProfile(coachProfileFixture()).coach!.levels).toEqual([
      'beginner',
      'intermediate',
    ]);
    // An older server that sends no `levels` hides nobody.
    const old = coachingPublicFixture();
    delete (old.coaches[0] as { levels?: unknown }).levels;
    expect(parseCoachingPublic(old).coaches[0]!.levels).toEqual([]);
    expect(
      parseCoachProfile(coachProfileFixture({ coach: { id: COACH_ID, levels: 'x' } })).coach!
        .levels,
    ).toEqual([]);
  });
});

describe('showcaseLevelFor', () => {
  it('maps the play level onto the switch; new reads as beginner', () => {
    expect(showcaseLevelFor('new')).toBe('beginner');
    expect(showcaseLevelFor('beginner')).toBe('beginner');
    expect(showcaseLevelFor('intermediate')).toBe('intermediate');
    expect(showcaseLevelFor('advanced')).toBe('advanced');
  });

  it('starts on All without a known level', () => {
    for (const v of [null, undefined, '', 'pro', 2]) expect(showcaseLevelFor(v)).toBe('all');
  });
});

const coach = (id: string, levels: CoachLevel[] = []) => ({ id, levels });

describe('coachesForLevel', () => {
  const list = [
    coach('a', ['beginner']),
    coach('b'),
    coach('c', ['intermediate', 'advanced']),
    coach('d', ['advanced']),
  ];

  it('All is everyone', () => {
    expect(coachesForLevel(list, 'all').map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('a coach with no levels shows under every level', () => {
    expect(coachesForLevel(list, 'beginner').map((c) => c.id)).toEqual(['a', 'b']);
    expect(coachesForLevel(list, 'intermediate').map((c) => c.id)).toEqual(['b', 'c']);
    expect(coachesForLevel(list, 'advanced').map((c) => c.id)).toEqual(['b', 'c', 'd']);
    expect(teachesLevel(coach('e'), 'advanced')).toBe(true);
  });

  it('keeps the order it was given', () => {
    const reversed = [...list].reverse();
    expect(coachesForLevel(reversed, 'advanced').map((c) => c.id)).toEqual(['d', 'c', 'b']);
  });
});

describe('showcaseOrder', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `00000000-0000-4000-8000-0000000000${10 + i}`);
  const list = ids.map((id) => coach(id));
  const order = (seed: string, input = list) => showcaseOrder(input, seed).map((c) => c.id);

  it('is stable for a seed, whatever order the server sent', () => {
    expect(order('2026-10-11')).toEqual(order('2026-10-11'));
    expect(order('2026-10-11', [...list].reverse())).toEqual(order('2026-10-11'));
  });

  it('keeps every coach exactly once', () => {
    expect([...order('2026-10-11')].sort()).toEqual([...ids].sort());
  });

  it('changes from day to day, so nobody is always first', () => {
    const days = Array.from({ length: 30 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
    const firsts = new Set(days.map((d) => order(d)[0]));
    // Thirty days over twelve coaches: many different people lead.
    expect(firsts.size).toBeGreaterThanOrEqual(6);
    expect(order('2026-10-11')).not.toEqual(order('2026-10-12'));
  });

  it('never follows the venue’s sortOrder', () => {
    const ranked = ids.map((id, i) => ({ id, sortOrder: i }));
    const days = Array.from({ length: 10 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
    const asRanked = days.filter(
      (d) =>
        showcaseOrder(ranked, d)
          .map((c) => c.id)
          .join() === ids.join(),
    );
    expect(asRanked).toEqual([]);
  });

  it('adding a coach moves nobody else relative to anyone', () => {
    const before = order('2026-10-11');
    const after = order('2026-10-11', [...list, coach('ffffffff-0000-4000-8000-000000000099')]);
    expect(after.filter((id) => ids.includes(id))).toEqual(before);
  });
});

describe('showcaseSeed', () => {
  it('is the venue-local date', () => {
    // 22:30 UTC on the 10th is 01:30 on the 11th in Baghdad.
    expect(showcaseSeed(new Date('2026-10-10T22:30:00Z'), 'Asia/Baghdad')).toBe('2026-10-11');
    expect(showcaseSeed(new Date('2026-10-10T20:30:00Z'), 'Asia/Baghdad')).toBe('2026-10-10');
  });

  it('falls back to the venue default zone', () => {
    expect(showcaseSeed(new Date('2026-10-10T22:30:00Z'), null)).toBe('2026-10-11');
  });
});
