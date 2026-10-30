/**
 * 0373 tournament_seat_pick (Majed, 2026-10-29): the chair a guest taps on the seating board is
 * the chair they get, instead of the first open one.
 *
 *   * tournament_register(p_tournament_id, p_seat_no): the chair asked for, TOURNAMENT_SEAT_TAKEN
 *     when someone sits there, INVALID_ARGUMENT detail p_seat_no outside 1… max_entries, the lowest
 *     free chair with null or with the one-argument call a phone before 0373 sends;
 *   * a desk add (no seat_no) takes the lowest chair left, and that chair counts as taken;
 *   * a withdrawal frees the chair; a duplicate keeps it; a waitlisted entry has none;
 *   * tournament_public's entries carry each one's seat.
 *
 * Every case is one rolled-back psql transaction (stores-harness); without docker the suite skips.
 */
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { GUEST } from './matches-harness';
import { dockerReachable, Q, scenario, T } from './stores-harness';
import { answer, PUBLISH, refusal, RUN, TOUR_BRANCH, TOUR_SETUP } from './tournaments-plant';

const up = await stackAvailable();
const docker = up && dockerReachable();

describe.skipIf(!docker)('0373 tournament_register: the chair tapped', () => {
  it('seats a guest on the chair asked for, refuses a taken or unknown one, and fills the rest lowest first', () => {
    const r = scenario('tsp-seat', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      // Eight places: courts 1 and 2 on the board, chairs 1–8.
      RUN('r1', { count: 8 }),
      ...PUBLISH('pub', 'r1', 't1', { waitlist_max: 2 }),
      ...['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'g9'].map((g) => GUEST(g)),
      GUEST('walk'),

      // Court 2, chair 2.
      T('g1_6', 'g1', `select app.tournament_register({{t1}}, 6)`),
      T('g2_6', 'g2', `select app.tournament_register({{t1}}, 6)`),
      T('g2_0', 'g2', `select app.tournament_register({{t1}}, 0)`),
      T('g2_9', 'g2', `select app.tournament_register({{t1}}, 9)`),
      // No chair named, and the one-argument call of a phone before 0373.
      T('g2_null', 'g2', `select app.tournament_register({{t1}}, null)`),
      T('g3_old', 'g3', `select app.tournament_register({{t1}})`),
      T('g1_dup', 'g1', `select app.tournament_register({{t1}}, 3)`),
      // The desk adds a walk-in: no seat_no, the lowest chair left (3).
      T('walk', 'desk', `select app.tournament_add_entry({{t1}}, {{walk}})`),
      T('g4_3', 'g4', `select app.tournament_register({{t1}}, 3)`),
      T('g4_8', 'g4', `select app.tournament_register({{t1}}, 8)`),
      Q(
        'seats',
        `select jsonb_object_agg(v.name, s.seat_no)
           from app.tournament_seats({{t1}}) s
           join tournament_entries e on e.id = s.entry_id
           join pg_temp.vars v on v.val = e.guest_id::text`,
      ),
      T('public', 'g1', `select app.tournament_public({{t1}})`),

      // g1 leaves: chair 6 is free again and someone else takes it.
      T('g1_out', 'g1', `select app.tournament_withdraw({{t1}})`),
      T('g5_6', 'g5', `select app.tournament_register({{t1}}, 6)`),
      // Fill the rest (4, 5, 7), then the waitlist takes no chair.
      T('g6', 'g6', `select app.tournament_register({{t1}}, 7)`),
      T('g7', 'g7', `select app.tournament_register({{t1}}, null)`),
      T('g8', 'g8', `select app.tournament_register({{t1}}, 5)`),
      T('g9_wait', 'g9', `select app.tournament_register({{t1}}, 1)`),
      Q(
        'seats_full',
        `select jsonb_object_agg(v.name, s.seat_no)
           from app.tournament_seats({{t1}}) s
           join tournament_entries e on e.id = s.entry_id
           join pg_temp.vars v on v.val = e.guest_id::text`,
      ),
      Q(
        'g9_row',
        `select jsonb_build_object('status', e.status, 'seat_no', e.seat_no)
           from tournament_entries e where e.tournament_id = {{t1}}::uuid and e.guest_id = {{g9}}::uuid`,
      ),
    ]);

    expect(answer(r, 'g1_6')).toMatchObject({ status: 'registered', seat_no: 6, duplicate: false });
    expect(refusal(r, 'g2_6')).toBe('TOURNAMENT_SEAT_TAKEN');
    expect(refusal(r, 'g2_0')).toBe('INVALID_ARGUMENT:p_seat_no');
    expect(refusal(r, 'g2_9')).toBe('INVALID_ARGUMENT:p_seat_no');
    expect(answer(r, 'g2_null')).toMatchObject({ status: 'registered', seat_no: 1 });
    expect(answer(r, 'g3_old')).toMatchObject({ status: 'registered', seat_no: 2 });
    // A duplicate keeps the chair it has; the one it named is not taken.
    expect(answer(r, 'g1_dup')).toMatchObject({ status: 'registered', seat_no: 6, duplicate: true });
    // The walk-in sits on 3, so 3 is taken; 8 is not.
    expect(refusal(r, 'g4_3')).toBe('TOURNAMENT_SEAT_TAKEN');
    expect(answer(r, 'g4_8')).toMatchObject({ status: 'registered', seat_no: 8 });
    expect(answer(r, 'seats')).toEqual({ g1: 6, g2: 1, g3: 2, walk: 3, g4: 8 });

    // The board reads the same chairs (one transaction stamps one now(), so the order ties).
    const pub = answer(r, 'public') as { entries: { seat: number; mine: boolean }[] };
    expect(pub.entries.map((e) => e.seat).sort((a, b) => a - b)).toEqual([1, 2, 3, 6, 8]);
    expect(pub.entries.find((e) => e.mine)?.seat).toBe(6);

    expect(answer(r, 'g5_6')).toMatchObject({ status: 'registered', seat_no: 6 });
    expect(answer(r, 'g7')).toMatchObject({ status: 'registered', seat_no: 4 });
    expect(answer(r, 'g9_wait')).toMatchObject({ status: 'waitlisted', seat_no: null });
    expect(answer(r, 'seats_full')).toEqual({
      g2: 1,
      g3: 2,
      walk: 3,
      g7: 4,
      g8: 5,
      g5: 6,
      g6: 7,
      g4: 8,
    });
    expect(answer(r, 'g9_row')).toEqual({ status: 'waitlisted', seat_no: null });
  });
});
