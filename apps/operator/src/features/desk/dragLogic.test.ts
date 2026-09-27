import { describe, expect, it } from 'vitest';
import { dropRefusal, dropStartMin, grabRowOffset } from './dragLogic';
import type { ReservationRow } from './deskTypes';

const SLOT = 30;
const OPEN = 9 * 60;
const CLOSE = 26 * 60; // 02:00 the next morning

function res(over: Partial<ReservationRow> = {}): ReservationRow {
  return {
    id: 'a',
    court_id: 'c1',
    kind: 'booking',
    status: 'confirmed',
    start_at: '2026-09-22T21:00:00.000Z',
    end_at: '2026-09-22T22:00:00.000Z',
    guest_id: null,
    guest_name: 'Ameen',
    guest_phone: null,
    price_iqd: 70000,
    hold_expires_at: null,
    notes: null,
    ...over,
  } as ReservationRow;
}

describe('grabRowOffset', () => {
  it('is 0 for a one-row block, wherever it is held', () => {
    expect(grabRowOffset(0, 40, 1)).toBe(0);
    expect(grabRowOffset(39, 40, 1)).toBe(0);
  });

  it('names the row under the hand on a taller block', () => {
    expect(grabRowOffset(5, 80, 2)).toBe(0);
    expect(grabRowOffset(60, 80, 2)).toBe(1);
    expect(grabRowOffset(70, 120, 3)).toBe(1);
  });

  it('stays inside the block when the pointer is past its edge', () => {
    expect(grabRowOffset(-10, 80, 2)).toBe(0);
    expect(grabRowOffset(500, 80, 2)).toBe(1);
  });

  it('is 0 when the block has no measured height (test DOM, hidden column)', () => {
    expect(grabRowOffset(10, 0, 4)).toBe(0);
  });
});

describe('dropStartMin', () => {
  it('moves the block as far as the hand moved, not to the pointer', () => {
    // A 00:00-01:00 booking held by its SECOND row, dragged up one row: the
    // pointer sits on 23:30 and the booking must start at 23:00, not 23:30.
    expect(dropStartMin(23 * 60 + 30, 1, 2, OPEN, CLOSE, SLOT)).toBe(23 * 60);
  });

  it('puts the start under the pointer when the block was held by its top row', () => {
    expect(dropStartMin(23 * 60 + 30, 0, 2, OPEN, CLOSE, SLOT)).toBe(23 * 60 + 30);
  });

  it('never starts before the night opens', () => {
    expect(dropStartMin(OPEN, 2, 2, OPEN, CLOSE, SLOT)).toBe(OPEN);
  });

  it('rests the tail against the last row rather than hanging off the end', () => {
    expect(dropStartMin(CLOSE - SLOT, 0, 2, OPEN, CLOSE, SLOT)).toBe(CLOSE - 2 * SLOT);
  });

  /*
   * The bottom of the night, reached from either grip row. On a screen shorter
   * than the night the pointer used to hit the edge of the window first, so the
   * grid auto-scrolls and the pointer is clamped to the last row (see
   * slotUnderPointer); whichever row of the block was taken hold of, the last
   * legal start is the same one — 01:00 for a one-hour booking on a 02:00 close.
   */
  it('reaches the last legal start from any grip row', () => {
    const lastRow = CLOSE - SLOT; // 01:30, the final row of the grid
    expect(dropStartMin(lastRow, 1, 2, OPEN, CLOSE, SLOT)).toBe(CLOSE - 2 * SLOT);
    expect(dropStartMin(lastRow, 0, 2, OPEN, CLOSE, SLOT)).toBe(CLOSE - 2 * SLOT);
    // And a 90-minute booking stops a row earlier, not off the end.
    expect(dropStartMin(lastRow, 2, 3, OPEN, CLOSE, SLOT)).toBe(CLOSE - 3 * SLOT);
  });
});

describe('dropRefusal', () => {
  const now = Date.UTC(2026, 8, 22, 22, 0, 0);
  const base = { reservations: [] as ReservationRow[], ignoreId: 'a', courtId: 'c1', nowMs: now };

  it('refuses a start dragged into the past', () => {
    expect(
      dropRefusal({
        ...base,
        startMs: now - 3_600_000,
        endMs: now,
        originalStartMs: now + 3_600_000,
      }),
    ).toBe('past');
  });

  it('allows a court change on a game that is already running', () => {
    const started = now - 1_800_000;
    expect(
      dropRefusal({ ...base, courtId: 'c2', startMs: started, endMs: now + 1_800_000, originalStartMs: started }),
    ).toBeNull();
  });

  it('refuses a destination another booking already holds', () => {
    const other = res({ id: 'b', start_at: new Date(now + 3_600_000).toISOString(), end_at: new Date(now + 7_200_000).toISOString() });
    expect(
      dropRefusal({
        ...base,
        reservations: [other],
        startMs: now + 5_400_000,
        endMs: now + 9_000_000,
        originalStartMs: now + 86_400_000,
      }),
    ).toBe('taken');
  });

  it('does not count the booking being dragged as its own conflict', () => {
    const self = res({ start_at: new Date(now + 3_600_000).toISOString(), end_at: new Date(now + 7_200_000).toISOString() });
    expect(
      dropRefusal({
        ...base,
        reservations: [self],
        startMs: now + 5_400_000,
        endMs: now + 9_000_000,
        originalStartMs: now + 3_600_000,
      }),
    ).toBeNull();
  });

  it('ignores a cancelled row sitting on the destination', () => {
    const dead = res({ id: 'b', status: 'cancelled', start_at: new Date(now + 3_600_000).toISOString(), end_at: new Date(now + 7_200_000).toISOString() });
    expect(
      dropRefusal({
        ...base,
        reservations: [dead],
        startMs: now + 5_400_000,
        endMs: now + 9_000_000,
        originalStartMs: now + 86_400_000,
      }),
    ).toBeNull();
  });
});
