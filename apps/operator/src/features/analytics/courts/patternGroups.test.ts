import { describe, expect, it } from 'vitest';
import type { CourtPatternCandidate } from '@touch/core';
import { groupPatterns, niceMax } from './patternGroups';

function cand(
  over: Partial<CourtPatternCandidate> &
    Pick<CourtPatternCandidate, 'id' | 'kind' | 'subjects' | 'metrics'>,
): CourtPatternCandidate {
  return {
    subjectIds: [],
    sampleSize: 30,
    confidence: 'medium',
    sampleLabel: '30 bookings',
    strength: 0.5,
    score: 1,
    desc: '',
    fallbackText: '',
    ...over,
  };
}

const cancel = (id: string, subject: string, dimension: string, rate: number, ratio: number) =>
  cand({
    id,
    kind: 'ending-cluster',
    subjects: [subject],
    metrics: {
      ending: 'cancellations',
      dimension,
      key: id,
      n: 9,
      bookingsTotal: 40,
      segRatePct: rate,
      baseRatePct: 4,
      ratio,
    },
  });

describe('groupPatterns', () => {
  it('groups by kind in the miner order and sorts rows by distance from their base', () => {
    const groups = groupPatterns([
      cancel('a', '60 min', 'byDuration', 22, 5.5),
      cand({
        id: 'd1',
        kind: 'dead-slot',
        subjects: ['Saturday', '09:00–18:00'],
        metrics: { occupancyPct: 1.6, houseHourPct: 1.9 },
      }),
      cancel('b', 'Court 2', 'byCourt', 30, 7.5),
      cand({
        id: 'd2',
        kind: 'dead-slot',
        subjects: ['Wednesday', '13:00–24:00'],
        metrics: { occupancyPct: 1.9, houseHourPct: 4.3 },
      }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['cancellations', 'deadSlot']);
    const [losses, quiet] = groups;
    expect(losses!.rows.map((r) => r.label)).toEqual(['Court 2', '60 min']);
    expect(losses!.sharedBase).toBe(4);
    // A court needs no "Court" line under it; a segment names its breakdown.
    expect(losses!.rows.map((r) => r.dimension)).toEqual([null, 'byDuration']);
    expect(quiet!.rows.map((r) => [r.label, r.hours])).toEqual([
      ['Wednesday', '13:00–24:00'],
      ['Saturday', '09:00–18:00'],
    ]);
    // Each quiet slot has its own venue figure, so the heading names none.
    expect(quiet!.sharedBase).toBeNull();
  });

  it('splits no-shows from cancellations and scales full slots to 100', () => {
    const groups = groupPatterns([
      cand({
        id: 'n',
        kind: 'ending-cluster',
        subjects: ['Friday'],
        metrics: {
          ending: 'noShows',
          dimension: 'byDow',
          segRatePct: 12,
          baseRatePct: 3,
          ratio: 4,
        },
      }),
      cand({
        id: 's',
        kind: 'saturated-slot',
        subjects: ['Friday', '20:00–22:00'],
        metrics: { occupancyPct: 96 },
      }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['noShows', 'saturatedSlot']);
    expect(groups[1]!.scaleMax).toBe(100);
    expect(groups[1]!.rows[0]!.base).toBeNull();
  });
});

describe('niceMax', () => {
  it('rounds up above the largest figure', () => {
    expect(niceMax(30)).toBe(35);
    expect(niceMax(4.3)).toBe(5);
    expect(niceMax(0)).toBe(10);
    expect(niceMax(99)).toBe(100);
  });
});
