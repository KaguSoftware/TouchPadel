/**
 * 0390 (F-40, Majed 2026-11-01): the desk confirms each participant, and only
 * then are they in the tournament; a confirmed participant may still owe.
 *
 *   * the draw (tournament_set_rounds → tournament_rounds insert) refuses while a
 *     registered entry is unconfirmed: TOURNAMENT_UNCONFIRMED, detail the count;
 *   * tournament_confirm_entry: the court desk, a manager or the owner; a
 *     registered entry of an open or closed tournament; state-idempotent; it
 *     un-confirms too; a waitlisted entry is INVALID_TRANSITION; a cashier and a
 *     guest are FORBIDDEN;
 *   * leaving the registered list (withdrawn) clears the confirmation;
 *   * desk_tournament_detail carries confirmed_at / confirmed_by_name and
 *     can.confirm, and the entry's money is unchanged by confirming.
 *
 * One rolled-back psql transaction (stores-harness); without docker it skips.
 */
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { GUEST } from './matches-harness';
import { dockerReachable, KEEP, Q, scenario, T, X } from './stores-harness';
import { answer, PUBLISH, refusal, ROUNDS, RUN, TOUR_BRANCH, TOUR_SETUP } from './tournaments-plant';

const up = await stackAvailable();
const docker = up && dockerReachable();

interface Detail {
  can: { confirm: boolean };
  entries: Array<{ entry_id: string; confirmed_at: string | null; confirmed_by_name: string | null; owed_iqd: number }>;
}

describe.skipIf(!docker)('0390 tournament_confirm_entry (F-40)', () => {
  it('only confirmed entries are drawn; confirm is the desk’s, idempotent, and leaves the money alone', () => {
    const r = scenario('tcf390', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { count: 8, fee: 20000 }),
      ...PUBLISH('pub', 'r1', 't1', { waitlist_max: 2 }),
      // Six planted (already confirmed), two who register themselves, one on the waitlist.
      `select pg_temp.field('t1', 6, 'p');`,
      GUEST('g1'),
      GUEST('g2'),
      GUEST('g3'),
      T('g1_reg', 'g1', `select app.tournament_register({{t1}})`),
      T('g2_reg', 'g2', `select app.tournament_register({{t1}})`),
      T('g3_reg', 'g3', `select app.tournament_register({{t1}})`),
      KEEP('g1_e', `select id::text from tournament_entries where guest_id = {{g1}}::uuid`),
      KEEP('g2_e', `select id::text from tournament_entries where guest_id = {{g2}}::uuid`),
      KEEP('g3_e', `select id::text from tournament_entries where guest_id = {{g3}}::uuid`),
      Q('g3_status', `select to_jsonb(status) from tournament_entries where id = {{g3_e}}::uuid`),
      T('detail_open', 'desk', `select app.desk_tournament_detail({{t1}})`),
      // Closed by hand (pg_temp.close would confirm everyone).
      X(`update tournaments set status = 'closed', closed_at = now() where id = {{t1}}::uuid`),
      ...ROUNDS('draw_refused', 't1', 1, 1),
      T('cashier', 'cashier', `select app.tournament_confirm_entry({{g1_e}})`),
      T('guest', 'g1', `select app.tournament_confirm_entry({{g1_e}})`),
      T('waitlisted', 'desk', `select app.tournament_confirm_entry({{g3_e}})`),
      T('c1', 'desk', `select app.tournament_confirm_entry({{g1_e}})`),
      T('c1_again', 'desk', `select app.tournament_confirm_entry({{g1_e}}, true)`),
      T('c2', 'manager', `select app.tournament_confirm_entry({{g2_e}})`),
      T('u2', 'desk', `select app.tournament_confirm_entry({{g2_e}}, false)`),
      ...ROUNDS('draw_one_left', 't1', 1, 1),
      T('c2b', 'desk', `select app.tournament_confirm_entry({{g2_e}})`),
      T('detail', 'desk', `select app.desk_tournament_detail({{t1}})`),
      ...ROUNDS('draw', 't1', 1, 1),
      T('after_draw', 'desk', `select app.tournament_confirm_entry({{g1_e}}, false)`),
      Q('audit', `select to_jsonb(count(*)) from audit_log where entity_id in ({{g1_e}}, {{g2_e}}) and action like 'tournament.entry_%'`),
    ]);

    expect(answer(r, 'g3_status')).toBe('waitlisted');
    const open = answer<Detail>(r, 'detail_open');
    expect(open.can.confirm).toBe(true);
    expect(open.entries.find((e) => e.entry_id === r.g1_e?.data)?.confirmed_at ?? null).toBeNull();

    expect(refusal(r, 'draw_refused')).toBe('TOURNAMENT_UNCONFIRMED:2');
    expect(refusal(r, 'cashier')).toBe('FORBIDDEN');
    expect(refusal(r, 'guest')).toBe('FORBIDDEN');
    expect(refusal(r, 'waitlisted')).toBe('INVALID_TRANSITION:waitlisted');
    expect(answer(r, 'c1')).toMatchObject({ confirmed: true, changed: true });
    expect(answer(r, 'c1_again')).toMatchObject({ confirmed: true, changed: false });
    expect(answer(r, 'c2')).toMatchObject({ confirmed: true, changed: true });
    expect(answer(r, 'u2')).toMatchObject({ confirmed: false, changed: true });
    expect(refusal(r, 'draw_one_left')).toBe('TOURNAMENT_UNCONFIRMED:1');
    expect(answer(r, 'c2b')).toMatchObject({ confirmed: true });

    const d = answer<Detail>(r, 'detail');
    const g1 = d.entries.find((e) => e.confirmed_by_name !== null && e.confirmed_at !== null);
    expect(g1).toBeDefined();
    // Confirmed and still owing: payment is its own step.
    const owing = d.entries.filter((e) => e.confirmed_at !== null && e.owed_iqd === 20000);
    expect(owing.length).toBeGreaterThanOrEqual(2);

    expect(answer(r, 'draw')).toMatchObject({});
    expect(refusal(r, 'after_draw')).toBe('TOURNAMENT_NOT_OPEN:running');
    expect(answer<number>(r, 'audit')).toBe(4);
  });

  it('a withdrawn entry loses its confirmation', () => {
    const r = scenario('tcf390b', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { count: 8 }),
      ...PUBLISH('pub', 'r1', 't1', { waitlist_max: 2 }),
      `select pg_temp.field('t1', 1, 'p');`,
      X(`update tournament_entries set status = 'withdrawn', withdrawn_reason = 'staff' where id = {{p1_e}}::uuid`),
      Q('after', `select to_jsonb(confirmed_at) from tournament_entries where id = {{p1_e}}::uuid`),
    ]);
    expect(answer(r, 'after')).toBeNull();
  });
});
