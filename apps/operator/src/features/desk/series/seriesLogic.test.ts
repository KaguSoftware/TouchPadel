import { describe, expect, it } from 'vitest';
import {
  bookableCount,
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
  it('refuses a first date the venue has already been through', () => {
    expect(draftProblem(base, '2026-09-07')).toBe('past');
    expect(draftProblem(base, '2026-09-06')).toBeNull(); // today itself is bookable
    expect(draftProblem(base, '2026-09-05')).toBeNull();
  });
  it('does not judge the date at all without a venue today', () => {
    expect(draftProblem({ ...base, startsOn: '2001-01-01' })).toBeNull();
  });
});

describe('resolvedEndsOn / seriesRpcArgs', () => {
  it('turns N sessions into the range holding exactly those N', () => {
    // Weekly: the first date plus N-1 weekly steps. 2026-09-06 is a Sunday.
    expect(resolvedEndsOn({ ...base, weeks: 1 })).toBe('2026-09-06');
    expect(resolvedEndsOn({ ...base, weeks: 4 })).toBe('2026-09-27');
    expect(resolvedEndsOn({ ...base, endMode: 'date', endsOn: '2026-12-31' })).toBe('2026-12-31');
  });

  it('spans a fortnightly series far enough to hold every session', () => {
    // The reported bug: "every 2 weeks" with 2 asked for a 13-day range, which
    // the server's 14-day step cleared in one jump — one booking, not two.
    const fortnightly = { ...base, pattern: 'fortnightly' as const };
    expect(resolvedEndsOn({ ...fortnightly, weeks: 1 })).toBe('2026-09-06');
    expect(resolvedEndsOn({ ...fortnightly, weeks: 2 })).toBe('2026-09-20');
    expect(resolvedEndsOn({ ...fortnightly, weeks: 8 })).toBe('2026-12-13');
  });

  it('keeps calendar weeks for the chosen-weekdays pattern', () => {
    // Three weekdays ticked is three sessions in one week, so the number
    // cannot be a session count here and still name a range.
    const weekdays = { ...base, pattern: 'weekdays' as const, weekdays: [0, 2, 4] };
    expect(resolvedEndsOn({ ...weekdays, weeks: 1 })).toBe('2026-09-12');
    expect(resolvedEndsOn({ ...weekdays, weeks: 4 })).toBe('2026-10-03');
  });

  it('treats a session count below one as one', () => {
    expect(resolvedEndsOn({ ...base, weeks: 0 })).toBe('2026-09-06');
    expect(resolvedEndsOn({ ...base, pattern: 'fortnightly', weeks: 0 })).toBe('2026-09-06');
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
      p_ends_on: '2026-09-27',
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
  it('counts what would be booked: a skipped clash drops out, a moved one stays, a stale skip on a free date does not count', () => {
    expect(bookableCount(occ, {})).toBe(occ.length);
    expect(
      bookableCount(occ, {
        '2026-09-13': { date: '2026-09-13', action: 'moveCourt', courtId: 'c2' },
        '2026-09-20': { date: '2026-09-20', action: 'skip' },
        '2026-09-06': { date: '2026-09-06', action: 'skip' },
      }),
    ).toBe(occ.length - 1);
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
