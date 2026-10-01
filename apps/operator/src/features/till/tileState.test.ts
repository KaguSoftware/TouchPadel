import { describe, expect, it } from 'vitest';
import { deriveTileState, localIsoDate, tileInteractive, tillToday } from './tileState';

const TODAY = '2026-09-03';
const base = { orderable: true, soldOut: false, unavailableOn: null, hasActiveTab: true, today: TODAY };

describe('deriveTileState', () => {
  it('is ready when orderable and a tab is active', () => {
    expect(deriveTileState(base)).toBe('ready');
  });

  it('treats a missing availability row as orderable', () => {
    expect(deriveTileState({ ...base, orderable: undefined })).toBe('ready');
  });

  it('is inert (noTab) when orderable but no tab is selected', () => {
    expect(deriveTileState({ ...base, hasActiveTab: false })).toBe('noTab');
  });

  it('is staff-marked unavailable when sold_out is set', () => {
    expect(deriveTileState({ ...base, orderable: false, soldOut: true })).toBe('unavailable');
  });

  it('is staff-marked unavailable when paused for today', () => {
    expect(deriveTileState({ ...base, orderable: false, unavailableOn: TODAY })).toBe('unavailable');
  });

  it('is blocked by stock when not orderable and no staff column explains it', () => {
    expect(deriveTileState({ ...base, orderable: false })).toBe('blockedByStock');
  });

  it('does not credit a stale pause from another day to staff', () => {
    expect(deriveTileState({ ...base, orderable: false, unavailableOn: '2026-09-01' })).toBe('blockedByStock');
  });

  it('never lets the staff columns override an orderable verdict', () => {
    // A stale unavailable_on from yesterday with the view saying orderable: the tile is live.
    expect(deriveTileState({ ...base, unavailableOn: '2026-09-02' })).toBe('ready');
  });

  it('the disabled states win over the missing-tab state', () => {
    expect(deriveTileState({ ...base, orderable: false, soldOut: true, hasActiveTab: false })).toBe('unavailable');
  });
});

describe('tileInteractive', () => {
  it('only the ready state accepts input', () => {
    expect(tileInteractive('ready')).toBe(true);
    expect(tileInteractive('noTab')).toBe(false);
    expect(tileInteractive('unavailable')).toBe(false);
    expect(tileInteractive('blockedByStock')).toBe(false);
  });
});

describe('localIsoDate', () => {
  it('formats the local calendar date with zero padding', () => {
    expect(localIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(localIsoDate(new Date(2026, 11, 25))).toBe('2026-12-25');
  });
});

describe('tillToday — the venue business date the server stamps unavailable_on with', () => {
  // Baghdad is UTC+3 all year: 20:59:59Z is 23:59:59 at the venue.
  const at = (iso: string) => Date.parse(iso);

  it('turns at venue midnight with a 0 start hour, whatever the station clock says', () => {
    expect(tillToday(at('2026-10-01T20:59:59Z'), 0)).toBe('2026-10-01');
    expect(tillToday(at('2026-10-01T21:00:00Z'), 0)).toBe('2026-10-02');
  });

  it('keeps the night on the previous day until the business day starts', () => {
    // 01:30 at the venue with a 04:00 start is still the 1st's business day…
    expect(tillToday(at('2026-10-01T22:30:00Z'), 4)).toBe('2026-10-01');
    // …and 04:00 starts the 2nd.
    expect(tillToday(at('2026-10-02T01:00:00Z'), 4)).toBe('2026-10-02');
  });

  it('an item paused yesterday is not "unavailable today" after the turn', () => {
    const pausedOn = tillToday(at('2026-10-01T18:00:00Z'), 0);
    const tile = (now: number) =>
      deriveTileState({ orderable: false, soldOut: false, unavailableOn: pausedOn, hasActiveTab: true, today: tillToday(now, 0) });
    expect(tile(at('2026-10-01T20:00:00Z'))).toBe('unavailable');
    // The view keeps it unorderable until its stock or the pause clears; the
    // label no longer blames the pause once the day has moved on.
    expect(tile(at('2026-10-01T21:30:00Z'))).toBe('blockedByStock');
  });
});
