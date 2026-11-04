import { describe, expect, it } from 'vitest';
import type { AvailabilityRow } from '../assemble';
import {
  parseSlotChange,
  patchWindow,
  pickPlaceholderRows,
  refreshDelayMs,
  REFRESH_JITTER_MS,
  windowPollMs,
  WINDOW_POLL_DOWN_MS,
  WINDOW_POLL_LIVE_MS,
} from '../live';

/** What app.rt_reservation (0382) sends: jsonb timestamps carry an offset. */
const payload = (over: Record<string, unknown> = {}) => ({
  court_id: 'c1',
  start_at: '2026-11-05T18:00:00+03:00',
  end_at: '2026-11-05T19:30:00+03:00',
  kind: 'hold',
  status: 'pending',
  busy: true,
  ...over,
});

/** The same slot as the view prints it (UTC). */
const row = (over: Partial<AvailabilityRow> = {}): AvailabilityRow => ({
  court_id: 'c1',
  start_at: '2026-11-05T15:00:00+00:00',
  end_at: '2026-11-05T16:30:00+00:00',
  kind: 'hold',
  ...over,
});

const other = row({ court_id: 'c2' });

describe('parseSlotChange', () => {
  it('reads the 0382 payload', () => {
    expect(parseSlotChange(payload())).toEqual({
      courtId: 'c1',
      startAt: '2026-11-05T18:00:00+03:00',
      endAt: '2026-11-05T19:30:00+03:00',
      kind: 'hold',
      busy: true,
    });
  });

  it('reads a lesson as a booking, as the view does (0280)', () => {
    expect(parseSlotChange(payload({ kind: 'lesson' }))?.kind).toBe('booking');
  });

  it('refuses what it cannot patch from, so the caller re-reads', () => {
    expect(parseSlotChange(undefined)).toBeNull();
    expect(parseSlotChange({})).toBeNull(); // an older server's bare event
    expect(parseSlotChange(payload({ busy: undefined }))).toBeNull();
    expect(parseSlotChange(payload({ kind: 'party' }))).toBeNull();
    expect(parseSlotChange(payload({ start_at: 'soon' }))).toBeNull();
    expect(parseSlotChange(payload({ court_id: null }))).toBeNull();
  });
});

describe('patchWindow', () => {
  const change = (over: Record<string, unknown> = {}) => parseSlotChange(payload(over))!;

  it('adds a newly taken slot', () => {
    const next = patchWindow([other], change());
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({
      court_id: 'c1',
      start_at: '2026-11-05T18:00:00+03:00',
      end_at: '2026-11-05T19:30:00+03:00',
      kind: 'hold',
    });
  });

  it('turns a hold into a booking on confirm, matching the instant across offsets', () => {
    const rows = [row(), other];
    const next = patchWindow(rows, change({ kind: 'booking', status: 'confirmed' }));
    expect(next).toHaveLength(2);
    expect(next[0]!.kind).toBe('booking');
    expect(rows[0]!.kind).toBe('hold'); // the cached rows are not mutated
  });

  it('removes a freed slot (released, expired, cancelled)', () => {
    const next = patchWindow([row(), other], change({ busy: false, status: 'expired' }));
    expect(next).toEqual([other]);
  });

  it('hands back the same array when nothing changed, so the grid cache holds', () => {
    const rows = [row(), other];
    expect(patchWindow(rows, change())).toBe(rows); // the same hold again
    expect(patchWindow(rows, change({ court_id: 'c3', busy: false }))).toBe(rows); // nothing there to free
  });

  it('does not free a different range on the same court', () => {
    const rows = [row()];
    const next = patchWindow(rows, change({ end_at: '2026-11-05T19:00:00+03:00', busy: false }));
    expect(next).toBe(rows);
  });
});

describe('windowPollMs', () => {
  it('a closed sheet polls nothing, channel or not', () => {
    expect(windowPollMs({ open: false, live: true })).toBe(false);
    expect(windowPollMs({ open: false, live: false })).toBe(false);
  });
  it('an open sheet with a live channel re-reads every five minutes', () => {
    expect(windowPollMs({ open: true, live: true })).toBe(WINDOW_POLL_LIVE_MS);
    expect(WINDOW_POLL_LIVE_MS).toBe(300_000);
  });
  it('an open sheet without the channel re-reads every minute', () => {
    expect(windowPollMs({ open: true, live: false })).toBe(WINDOW_POLL_DOWN_MS);
    expect(WINDOW_POLL_DOWN_MS).toBe(60_000);
  });
});

describe('refreshDelayMs', () => {
  it('spreads over 0 to the jitter window', () => {
    expect(refreshDelayMs(() => 0)).toBe(0);
    expect(refreshDelayMs(() => 0.5)).toBe(REFRESH_JITTER_MS / 2);
    expect(refreshDelayMs(() => 0.9999)).toBeLessThan(REFRESH_JITTER_MS);
  });
});

describe('pickPlaceholderRows', () => {
  it('takes the newest cached window of the branch', () => {
    const older = [row()];
    const newer = [other];
    expect(
      pickPlaceholderRows([
        { rows: older, updatedAt: 1 },
        { rows: undefined, updatedAt: 9 },
        { rows: newer, updatedAt: 5 },
      ]),
    ).toBe(newer);
  });
  it('has nothing to offer from an empty cache', () => {
    expect(pickPlaceholderRows([])).toBeUndefined();
    expect(pickPlaceholderRows([{ rows: undefined, updatedAt: 0 }])).toBeUndefined();
  });
});
