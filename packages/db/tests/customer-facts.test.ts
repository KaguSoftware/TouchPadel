/**
 * 0368 customer_facts (docs/design/customers/contracts-2026-10-24.md §1): who the customer is.
 *
 *   * the age band — the guest writes their own (changeable, the same value answers duplicate),
 *     a band outside the six is INVALID_AGE_BAND and writes nothing, the desk corrects or clears
 *     it, a cashier may not, and the band and its stamp are written together or not at all;
 *   * the confirmed level — a coach, the court desk, a manager or the owner judges it (the role is
 *     stamped), a cashier and a plain guest are FORBIDDEN, a bad level is INVALID_PLAY_PROFILE, a
 *     note with no level is INVALID_ARGUMENT, clearing empties the whole block, and half a block
 *     written directly breaks profiles_level_confirmed_stamp;
 *   * the measurement — app.level_suggestions scores a player against the levels of the people
 *     they beat, says nothing under five scored games, never says "new", and
 *     app.customer_level_reviews lists only the players whose suggestion disagrees with the
 *     record, so confirming it takes the row off the list;
 *   * the interests — app.customer_interest_tags turns what a player did into behaviour words
 *     (courts, regular, evenings, ranked …), earns no day-part word under three plays, and never
 *     carries a figure;
 *   * account deletion empties all seven columns (profiles_media_tombstone), and a merge gives
 *     keep the band and the whole judgment block it lacks.
 *
 * Every case is one rolled-back psql transaction (stores-harness); without docker it skips.
 */
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { E } from './matches-harness';
import { dockerReachable, Q, scenario, T, X } from './stores-harness';
import { BASE, BK, CG, code, FACTS, GR, out, SUGGEST, TAGS } from './customers-plant';

const up = await stackAvailable();
const docker = up && dockerReachable();
const NIL = '00000000-0000-4000-8000-000000000000';

interface Facts {
  band: string | null;
  band_at: boolean;
  claimed: string | null;
  confirmed: string | null;
  confirmed_at: boolean;
  by_desk: boolean | null;
  role: string | null;
  note: string | null;
  effective: string | null;
}

describe.skipIf(!docker)('0368 the age band', () => {
  it('is the guest’s own, changeable, and refuses anything outside the six', () => {
    const r = scenario('cf-band', [
      ...BASE,
      CG('ana'),
      T('first', 'ana', `select app.set_my_age_band('25_34')`),
      FACTS('after_first', 'ana'),
      T('same', 'ana', `select app.set_my_age_band('25_34')`),
      T('changed', 'ana', `select app.set_my_age_band('35_44')`),
      T('bad', 'ana', `select app.set_my_age_band('ancient')`),
      FACTS('after_bad', 'ana'),
      T('null', 'ana', `select app.set_my_age_band(null)`),
    ]);
    expect(out<{ age_band: string; duplicate: boolean }>(r, 'first')).toMatchObject({
      age_band: '25_34',
      duplicate: false,
    });
    expect(out<Facts>(r, 'after_first')).toMatchObject({ band: '25_34', band_at: true });
    expect(out<{ duplicate: boolean }>(r, 'same').duplicate).toBe(true);
    expect(out<{ age_band: string }>(r, 'changed').age_band).toBe('35_44');
    expect(code(r, 'bad')).toBe('INVALID_AGE_BAND');
    expect(code(r, 'null')).toBe('INVALID_AGE_BAND');
    // The refusals changed nothing.
    expect(out<Facts>(r, 'after_bad').band).toBe('35_44');
  });

  it('is corrected or cleared by the desk, and by no cashier', () => {
    const r = scenario('cf-band-desk', [
      ...BASE,
      CG('ben', null, '18_24'),
      T('cashier', 'cashier', `select app.staff_set_customer_age_band({{ben}}::uuid, '45_54')`),
      T('desk', 'desk', `select app.staff_set_customer_age_band({{ben}}::uuid, '45_54')`),
      FACTS('after_desk', 'ben'),
      T('again', 'desk', `select app.staff_set_customer_age_band({{ben}}::uuid, '45_54')`),
      T('cleared', 'manager', `select app.staff_set_customer_age_band({{ben}}::uuid, null)`),
      FACTS('after_clear', 'ben'),
      T('unknown', 'desk', `select app.staff_set_customer_age_band('${NIL}'::uuid, '18_24')`),
      T('bad', 'desk', `select app.staff_set_customer_age_band({{ben}}::uuid, 'teen')`),
    ]);
    expect(code(r, 'cashier')).toBe('FORBIDDEN');
    expect(out<{ age_band: string }>(r, 'desk').age_band).toBe('45_54');
    expect(out<Facts>(r, 'after_desk')).toMatchObject({ band: '45_54', band_at: true });
    expect(out<{ duplicate: boolean }>(r, 'again').duplicate).toBe(true);
    expect(out<Facts>(r, 'after_clear')).toMatchObject({ band: null, band_at: false });
    expect(code(r, 'unknown')).toBe('CUSTOMER_NOT_FOUND');
    expect(code(r, 'bad')).toBe('INVALID_AGE_BAND');
  });

  it('holds its stamp together under a direct write', () => {
    const r = scenario('cf-band-stamp', [
      ...BASE,
      CG('cal'),
      E('half', null, `with u as (update profiles set age_band_set_at = now()
                                   where id = {{cal}}::uuid returning 1)
                        select to_jsonb(count(*)) from u`),
    ]);
    expect(code(r, 'half')).toMatch(/profiles_age_band_stamp/);
  });
});

describe.skipIf(!docker)('0368 the confirmed level', () => {
  it('is written by the desk, a manager, the owner and a coach, and by nobody else', () => {
    const r = scenario('cf-level-who', [
      ...BASE,
      CG('dia', 'beginner'),
      CG('eli'),
      `select pg_temp.cf_coach('eli');`,
      T('guest', 'dia', `select app.staff_set_customer_level({{dia}}::uuid, 'advanced')`),
      T('cashier', 'cashier', `select app.staff_set_customer_level({{dia}}::uuid, 'advanced')`),
      T('desk', 'desk', `select app.staff_set_customer_level({{dia}}::uuid, 'intermediate', 'Rallies well')`),
      FACTS('after_desk', 'dia'),
      T('coach', 'eli', `select app.staff_set_customer_level({{dia}}::uuid, 'advanced')`),
      Q('after_coach', `select jsonb_build_object('role', p.level_confirmed_role, 'level', p.level_confirmed,
                                                  'note', p.level_note, 'by_coach', p.level_confirmed_by = {{eli}}::uuid)
                          from profiles p where p.id = {{dia}}::uuid`),
      T('owner', 'owner', `select app.staff_set_customer_level({{dia}}::uuid, 'advanced')`),
      T('cleared', 'manager', `select app.staff_set_customer_level({{dia}}::uuid, null)`),
      FACTS('after_clear', 'dia'),
    ]);
    expect(code(r, 'guest')).toBe('FORBIDDEN');
    expect(code(r, 'cashier')).toBe('FORBIDDEN');
    expect(out<Facts>(r, 'after_desk')).toMatchObject({
      claimed: 'beginner',
      confirmed: 'intermediate',
      confirmed_at: true,
      by_desk: true,
      role: 'court_desk',
      note: 'Rallies well',
      effective: 'intermediate',
    });
    // A coach re-judging replaces the whole block, note included.
    expect(out<Record<string, unknown>>(r, 'after_coach')).toEqual({
      role: 'coach', level: 'advanced', note: null, by_coach: true,
    });
    expect(out<{ duplicate: boolean }>(r, 'owner').duplicate).toBe(true);
    // Clearing puts the claimed level back in charge and leaves no judgment behind.
    expect(out<Facts>(r, 'after_clear')).toMatchObject({
      claimed: 'beginner', confirmed: null, confirmed_at: false, role: null, note: null,
      effective: 'beginner',
    });
  });

  it('refuses a level outside the four, a note with no level and an unknown customer', () => {
    const r = scenario('cf-level-refusals', [
      ...BASE,
      CG('fay'),
      T('bad', 'desk', `select app.staff_set_customer_level({{fay}}::uuid, 'pro')`),
      T('note_only', 'desk', `select app.staff_set_customer_level({{fay}}::uuid, null, 'nice player')`),
      T('unknown', 'desk', `select app.staff_set_customer_level('${NIL}'::uuid, 'beginner')`),
      FACTS('untouched', 'fay'),
      E('half', null, `with u as (update profiles set level_confirmed = 'advanced'
                                   where id = {{fay}}::uuid returning 1)
                        select to_jsonb(count(*)) from u`),
    ]);
    expect(code(r, 'bad')).toBe('INVALID_PLAY_PROFILE');
    expect(code(r, 'note_only')).toBe('INVALID_ARGUMENT');
    expect(code(r, 'unknown')).toBe('CUSTOMER_NOT_FOUND');
    expect(out<Facts>(r, 'untouched')).toMatchObject({ confirmed: null, note: null });
    expect(code(r, 'half')).toMatch(/profiles_level_confirmed_stamp/);
  });
});

describe.skipIf(!docker)('0368 the measurement', () => {
  it('scores a player against the levels they beat, and says nothing under five games', () => {
    // Four intermediate opponents; "gil" wins all five games, so the score is 2 + 0.5.
    const r = scenario('cf-suggest', [
      ...BASE,
      CG('gil', 'beginner'),
      CG('mate', 'intermediate'),
      CG('op1', 'intermediate'),
      CG('op2', 'intermediate'),
      GR('gil', 'mate', 'op1', 'op2', 'a', 30),
      GR('gil', 'mate', 'op1', 'op2', 'a', 25),
      GR('gil', 'mate', 'op1', 'op2', 'a', 20),
      GR('gil', 'mate', 'op1', 'op2', 'a', 15),
      SUGGEST('four', 'gil'),
      GR('gil', 'mate', 'op1', 'op2', 'a', 10),
      SUGGEST('five', 'gil'),
      SUGGEST('loser', 'op1'),
      Q('rows', `select to_jsonb(count(*)) from app.level_suggestions(array[{{gil}}::uuid])`),
    ]);
    // Four scored games say nothing at all.
    expect(out<unknown>(r, 'four')).toBeNull();
    expect(out<Record<string, unknown>>(r, 'five')).toMatchObject({
      level: 'advanced', games: 5, wins: 5, losses: 0,
    });
    // The other side lost all five to a beginner-claiming pair: beginner, clamped.
    expect(out<Record<string, unknown>>(r, 'loser')).toMatchObject({
      level: 'beginner', games: 5, wins: 0, losses: 5,
    });
    expect(out<number>(r, 'rows')).toBe(1);
  });

  it('queues only the players whose games disagree, and confirming takes them off it', () => {
    const r = scenario('cf-reviews', [
      ...BASE,
      CG('hal', 'advanced'),
      CG('hmate', 'beginner'),
      CG('hop1', 'beginner'),
      CG('hop2', 'beginner'),
      GR('hal', 'hmate', 'hop1', 'hop2', 'b', 30),
      GR('hal', 'hmate', 'hop1', 'hop2', 'b', 25),
      GR('hal', 'hmate', 'hop1', 'hop2', 'b', 20),
      GR('hal', 'hmate', 'hop1', 'hop2', 'b', 15),
      GR('hal', 'hmate', 'hop1', 'hop2', 'b', 10),
      T('guest', 'hal', `select app.customer_level_reviews(30)`),
      T('before', 'desk', `select app.customer_level_reviews(30)`),
      T('confirm', 'desk', `select app.staff_set_customer_level({{hal}}::uuid, 'beginner')`),
      T('after', 'desk', `select app.customer_level_reviews(30)`),
    ]);
    expect(code(r, 'guest')).toBe('FORBIDDEN');
    const before = out<Array<Record<string, unknown>>>(r, 'before');
    const hal = before.find((row) => row.claimed === 'advanced' && row.games === 5);
    expect(hal, JSON.stringify(before)).toBeTruthy();
    expect(hal).toMatchObject({ claimed: 'advanced', confirmed: null, suggested: 'beginner', wins: 0 });
    expect(hal!.last_played_at).toBeTruthy();
    const after = out<Array<Record<string, unknown>>>(r, 'after');
    expect(after.some((row) => row.profile_id === hal!.profile_id)).toBe(false);
  });
});

describe.skipIf(!docker)('0368 the interests, derived and never asked', () => {
  it('earns behaviour words from what the player did, and no day-part word under three plays', () => {
    const r = scenario('cf-tags', [
      ...BASE,
      CG('ivy'),
      CG('imate'),
      CG('iop1'),
      CG('iop2'),
      BK('ivy', 5, 19),
      TAGS('one_play', 'ivy'),
      BK('ivy', 4, 20),
      BK('ivy', 3, 21),
      TAGS('three_plays', 'ivy'),
      BK('ivy', 2, 19),
      TAGS('four_plays', 'ivy'),
      GR('ivy', 'imate', 'iop1', 'iop2', 'a', 5),
      TAGS('with_result', 'ivy'),
      // Outside the window: nothing at all.
      TAGS('narrow_window', 'ivy', 1),
    ]);
    // One booking is not two, so not even `courts`; a day-part share needs three plays.
    expect(out<string[]>(r, 'one_play')).toEqual([]);
    expect(out<string[]>(r, 'three_plays')).toEqual(['courts', 'evenings']);
    expect(out<string[]>(r, 'four_plays')).toEqual(['courts', 'regular', 'evenings']);
    expect(out<string[]>(r, 'with_result')).toEqual(['courts', 'regular', 'evenings', 'ranked']);
    expect(out<string[]>(r, 'narrow_window')).toEqual([]);
  });

  it('carries no figure and no money, only words', () => {
    const r = scenario('cf-tags-shape', [
      ...BASE,
      CG('jad'),
      BK('jad', 3, 18),
      BK('jad', 2, 18),
      TAGS('tags', 'jad'),
    ]);
    for (const tag of out<string[]>(r, 'tags')) expect(tag).toMatch(/^[a-z]+$/);
  });
});

describe.skipIf(!docker)('0368 deletion and merge', () => {
  it('empties all seven columns on the tombstone', () => {
    const r = scenario('cf-tombstone', [
      ...BASE,
      CG('kim', 'beginner', '25_34'),
      T('confirm', 'desk', `select app.staff_set_customer_level({{kim}}::uuid, 'advanced', 'Strong serve')`),
      FACTS('before', 'kim'),
      X(`update profiles set deleted_at = now() where id = {{kim}}::uuid`),
      Q('after', `select jsonb_build_object(
                    'band', p.age_band, 'band_at', p.age_band_set_at, 'confirmed', p.level_confirmed,
                    'confirmed_at', p.level_confirmed_at, 'by', p.level_confirmed_by,
                    'role', p.level_confirmed_role, 'note', p.level_note)
                    from profiles p where p.id = {{kim}}::uuid`),
    ]);
    expect(out<Facts>(r, 'before')).toMatchObject({ band: '25_34', confirmed: 'advanced', note: 'Strong serve' });
    expect(out<Record<string, unknown>>(r, 'after')).toEqual({
      band: null, band_at: null, confirmed: null, confirmed_at: null, by: null, role: null, note: null,
    });
  });

  it('gives keep the band and the whole judgment block it lacks', () => {
    const r = scenario('cf-merge', [
      ...BASE,
      CG('keep'),
      CG('drop', 'beginner', '35_44'),
      T('judge', 'desk', `select app.staff_set_customer_level({{drop}}::uuid, 'intermediate', 'From the drop')`),
      E('merge', null, `select app.merge_profiles_internal({{keep}}::uuid, {{drop}}::uuid, 'customer-facts test')`),
      FACTS('keep_after', 'keep'),
    ]);
    out<Record<string, unknown>>(r, 'merge');
    expect(out<Facts>(r, 'keep_after')).toMatchObject({
      band: '35_44', band_at: true, confirmed: 'intermediate', role: 'court_desk', note: 'From the drop',
    });
  });
});
