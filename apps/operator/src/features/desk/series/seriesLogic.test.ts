import { describe, expect, it } from 'vitest';
import {
  cancelScopeCount,
  conflictCount,
  draftKey,
  draftProblem,
  occurrenceEditable,
  pruneResolutions,
  resolutionsForRpc,
  resolvedEndsOn,
  seriesRpcArgs,
  summarizeOccurrences,
  unresolvedDates,
  type SeriesDraft,
} from './seriesLogic';
import type { SeriesOccurrence, SeriesOccurrencePreview } from '../deskTypes';

const base: SeriesDraft = {
  courtId: 'c1',
  pattern: 'weekly',
  weekdays: [],
  startTime: '19:00',
  durationMin: 90,
  startsOn: '2026-09-06', // a Sunday
  endMode: 'weeks',
  weeks: 4,
  endsOn: '',
};

describe('draftProblem', () => {
  it('accepts a complete weekly draft', () => {
    expect(draftProblem(base)).toBeNull();
  });
  it('names the first missing piece', () => {
    expect(draftProblem({ ...base, courtId: '' })).toBe('court');
    expect(draftProblem({ ...base, pattern: 'weekdays', weekdays: [] })).toBe('weekdays');
    expect(draftProblem({ ...base, weeks: 0 })).toBe('weeks');
    expect(draftProblem({ ...base, endMode: 'date', endsOn: '2026-09-06' })).toBe('end');
    expect(draftProblem({ ...base, startTime: '7pm' })).toBe('time');
  });
});

describe('resolvedEndsOn / seriesRpcArgs', () => {
  it('turns N weeks into the day before the Nth repeat', () => {
    expect(resolvedEndsOn({ ...base, weeks: 1 })).toBe('2026-09-12');
    expect(resolvedEndsOn({ ...base, weeks: 4 })).toBe('2026-10-03');
    expect(resolvedEndsOn({ ...base, endMode: 'date', endsOn: '2026-12-31' })).toBe('2026-12-31');
  });
  it('sends the first date weekday for weekly/fortnightly and the chosen set, sorted and unique, for weekdays', () => {
    expect(seriesRpcArgs(base).p_weekdays).toEqual([0]);
    expect(seriesRpcArgs({ ...base, pattern: 'weekdays', weekdays: [4, 2, 2] }).p_weekdays).toEqual([2, 4]);
    expect(seriesRpcArgs(base)).toMatchObject({
      p_court_id: 'c1',
      p_pattern: 'weekly',
      p_start_time: '19:00',
      p_duration_min: 90,
      p_starts_on: '2026-09-06',
      p_ends_on: '2026-10-03',
    });
  });
  it('changes the draft key when anything the server sees changes', () => {
    expect(draftKey(base)).toBe(draftKey({ ...base }));
    expect(draftKey(base)).not.toBe(draftKey({ ...base, durationMin: 60 }));
  });
});

const occ: SeriesOccurrencePreview[] = [
  { date: '2026-09-06', startsAt: 'a', endsAt: 'b', conflict: null },
  { date: '2026-09-13', startsAt: 'a', endsAt: 'b', conflict: { existingReservationId: 'x', resolvable: true, alternativeCourtIds: ['c2'] } },
  { date: '2026-09-20', startsAt: 'a', endsAt: 'b', conflict: { existingReservationId: 'y', resolvable: false, alternativeCourtIds: [] } },
];

describe('resolutions', () => {
  it('lists every clashing date without a resolution', () => {
    expect(conflictCount(occ)).toBe(2);
    expect(unresolvedDates(occ, {})).toEqual(['2026-09-13', '2026-09-20']);
    expect(unresolvedDates(occ, { '2026-09-13': { date: '2026-09-13', action: 'moveCourt', courtId: 'c2' } })).toEqual(['2026-09-20']);
  });
  it('sends only resolutions for dates that clash, in occurrence order', () => {
    const res = {
      '2026-09-20': { date: '2026-09-20', action: 'skip' as const },
      '2026-09-13': { date: '2026-09-13', action: 'moveCourt' as const, courtId: 'c2' },
      '2026-09-06': { date: '2026-09-06', action: 'skip' as const }, // stale: no longer clashes
    };
    expect(resolutionsForRpc(occ, res)).toEqual([
      { date: '2026-09-13', action: 'moveCourt', courtId: 'c2' },
      { date: '2026-09-20', action: 'skip' },
    ]);
    expect(Object.keys(pruneResolutions(occ, res)).sort()).toEqual(['2026-09-13', '2026-09-20']);
  });
});

function o(over: Partial<SeriesOccurrence> & { id: string }): SeriesOccurrence {
  return {
    court_id: 'c1',
    kind: 'booking',
    status: 'confirmed',
    start_at: '2026-09-13T16:00:00.000Z',
    end_at: '2026-09-13T17:30:00.000Z',
    price_iqd: null,
    played: false,
    ...over,
  };
}

describe('series detail helpers', () => {
  const rows = [
    o({ id: 'p', played: true, status: 'completed', start_at: '2026-09-06T16:00:00.000Z' }),
    o({ id: 'c', status: 'cancelled' }),
    o({ id: 'now', status: 'arrived', start_at: '2026-09-10T16:00:00.000Z' }),
    o({ id: 'u1' }),
    o({ id: 'u2', start_at: '2026-09-20T16:00:00.000Z' }),
  ];
  it('summarises played / upcoming / cancelled', () => {
    expect(summarizeOccurrences(rows)).toEqual({ total: 5, played: 1, upcoming: 3, cancelled: 1 });
  });
  it('marks played and cancelled occurrences untouchable', () => {
    expect(occurrenceEditable(rows[0]!)).toBe(false);
    expect(occurrenceEditable(rows[1]!)).toBe(false);
    expect(occurrenceEditable(rows[3]!)).toBe(true);
  });
  it('counts what a cancel would touch per scope, never the played ones', () => {
    const now = '2026-09-10T16:30:00.000Z';
    expect(cancelScopeCount(rows, 'future', now)).toBe(2);
    expect(cancelScopeCount(rows, 'all', now)).toBe(3);
  });
});
