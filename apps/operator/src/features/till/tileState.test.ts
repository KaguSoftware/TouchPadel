import { describe, expect, it } from 'vitest';
import { deriveTileState, localIsoDate, tileInteractive } from './tileState';

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
