import { describe, expect, it } from 'vitest';
import {
  blocksToSend,
  courtsRecord,
  plannedWindows,
  readBlockAnswer,
  readCourtsStep,
  readTournamentContext,
} from './eventBlock';

const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const R1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const R2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// What app.tournament_context returns: two ranges on two days, court 1 in
// both, and the run's one block so far (the server writes instants with a
// +00:00 offset, the plan with the same instant in another spelling).
const CONTEXT = {
  name_en: 'Summer Cup',
  name_ar: 'كأس الصيف',
  class: 'A',
  format: 'americano',
  capacity: { unit: 'pairs', count: 16 },
  ranges: [
    {
      court_ids: [C1, C2],
      court_names: [{ en: 'Court 1', ar: 'ملعب ١' }, { en: 'Court 2', ar: 'ملعب ٢' }],
      from: '2026-10-09T15:00:00+00:00',
      to: '2026-10-09T19:00:00+00:00',
    },
    {
      court_ids: [C1],
      court_names: [{ en: 'Court 1', ar: 'ملعب ١' }],
      from: '2026-10-10T15:00:00+00:00',
      to: '2026-10-10T19:00:00+00:00',
    },
  ],
  blocked: [{ reservation_id: R1, court_id: C1, start_at: '2026-10-09T15:00:00Z', end_at: '2026-10-09T19:00:00Z' }],
};

describe('the desk’s event mode', () => {
  it('reads tournament_context, and never invents what it lacks', () => {
    const ctx = readTournamentContext(CONTEXT);
    expect(ctx.name).toEqual({ en: 'Summer Cup', ar: 'كأس الصيف' });
    expect(ctx.capacity).toEqual({ unit: 'pairs', count: 16 });
    expect(ctx.ranges).toHaveLength(2);
    expect(ctx.blocked).toHaveLength(1);
    const empty = readTournamentContext(null);
    expect(empty).toEqual({ name: { en: '', ar: '' }, tournamentClass: null, format: null, capacity: null, ranges: [], blocked: [] });
    // A range with no court or no window is dropped, not shown as a blank row.
    expect(readTournamentContext({ ranges: [{ court_ids: [], from: 'x', to: 'y' }, { court_ids: [C1] }] }).ranges).toEqual([]);
  });

  it('lists one window per court of each range, matched to the run’s block of that exact window', () => {
    const windows = plannedWindows(readTournamentContext(CONTEXT));
    expect(windows.map((w) => [w.courtName.en, w.from.slice(0, 10), w.reservationId])).toEqual([
      ['Court 1', '2026-10-09', R1],
      ['Court 2', '2026-10-09', null],
      ['Court 1', '2026-10-10', null],
    ]);
    // Only what is left goes to block_courts_for_event.
    expect(blocksToSend(windows)).toEqual([
      { court_id: C2, start_at: '2026-10-09T15:00:00+00:00', end_at: '2026-10-09T19:00:00+00:00' },
      { court_id: C1, start_at: '2026-10-10T15:00:00+00:00', end_at: '2026-10-10T19:00:00+00:00' },
    ]);
  });

  it('lists a court and window named twice in the plan once', () => {
    const twice = { ...CONTEXT, ranges: [CONTEXT.ranges[1], CONTEXT.ranges[1]] };
    expect(plannedWindows(readTournamentContext(twice))).toHaveLength(1);
  });

  it('a block of the same court at another time does not count for the window', () => {
    const shifted = { ...CONTEXT, blocked: [{ ...CONTEXT.blocked[0], end_at: '2026-10-09T18:00:00Z' }] };
    expect(plannedWindows(readTournamentContext(shifted)).every((w) => w.reservationId === null)).toBe(true);
  });

  it('reads the block answer: blocks, or what is in the way', () => {
    expect(readBlockAnswer({ blocked: CONTEXT.blocked, conflicts: [] })).toEqual({
      blocked: [{ reservationId: R1, courtId: C1, startAt: '2026-10-09T15:00:00Z', endAt: '2026-10-09T19:00:00Z' }],
      conflicts: [],
    });
    const answer = readBlockAnswer({
      blocked: [],
      conflicts: [{ reservation_id: R1, court_id: C2, start_at: 'a', end_at: 'b', kind: 'booking', status: 'confirmed' }],
    });
    expect(answer.conflicts).toEqual([{ reservationId: R1, courtId: C2, startAt: 'a', endAt: 'b', kind: 'booking', status: 'confirmed' }]);
    expect(readBlockAnswer(undefined)).toEqual({ blocked: [], conflicts: [] });
  });

  it('sends the courts step with the run’s blocks of the plan’s windows, and the note only when written', () => {
    const ctx = readTournamentContext(CONTEXT);
    expect(courtsRecord(ctx, '  ')).toEqual({ reservation_ids: [R1] });
    expect(courtsRecord(ctx, ' Moved one booking ')).toEqual({ reservation_ids: [R1], moved_note: 'Moved one booking' });
    // A block of an earlier plan, still live (it had started when the plan
    // moved), is not the desk's to send: the server counts the plan's only.
    const stale = readTournamentContext({
      ...CONTEXT,
      blocked: [
        ...CONTEXT.blocked,
        { reservation_id: R2, court_id: C2, start_at: '2026-10-01T15:00:00+00:00', end_at: '2026-10-01T19:00:00+00:00' },
      ],
    });
    expect(courtsRecord(stale, '')).toEqual({ reservation_ids: [R1] });
  });

  it('knows a tournament’s courts step, and whether the caller may send it', () => {
    expect(readCourtsStep({ run: { kind: 'tournament' }, step: { step_key: 'courts', status: 'open' }, can: { submit: true } })).toEqual({
      status: 'open', canSubmit: true, isCourtsStep: true,
    });
    expect(readCourtsStep({ run: { kind: 'tournament' }, step: { step_key: 'plan', status: 'open' }, can: { submit: false } })).toMatchObject({
      isCourtsStep: false, canSubmit: false,
    });
    expect(readCourtsStep(null)).toEqual({ status: null, canSubmit: false, isCourtsStep: false });
  });
});
