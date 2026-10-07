/**
 * 0314 usernames_frames and 0315 profiles_username_unique (Edit profile, Phase 2).
 *
 *   - app.username_check: invalid, reserved, taken, the caller's own name;
 *   - app.set_my_username: stored lower case, the refusals in order, a repeat
 *     as a duplicate, once every 7 days after the first, the given-up name
 *     held from others for 7 days and free to take back, a racing taker;
 *   - app.suggest_username: hassan.s, then hassan.s2; player1 for a name with
 *     no Latin letters;
 *   - frames: free frames set, earned frames FRAME_LOCKED, unknown FRAME_INVALID,
 *     app.my_frames lists the closed set;
 *   - account deletion empties the username (held 90 days) and resets the frame;
 *   - the grants: the guest and the desk read the columns, nobody writes them.
 *
 *   - 0316 earned frames: a completed court booking with nothing owed counts
 *     as a match played; an unpaid, cancelled or no-show one does not; 10
 *     unlock Regular, which the guest may then wear; Silver stays locked; no
 *     tournament win leaves Champion locked; my_frames reports the progress.
 *
 * Needs the local stack.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  anonClient,
  anonymousSessionClient,
  appRpc,
  createStaffOfRole,
  createTestCourt,
  serviceClient,
  shapedGuest,
  stackAvailable,
} from './helpers';

const up = await stackAvailable();
const tag = () => Math.random().toString(36).slice(2, 8);

describe.skipIf(!up)('0314 usernames and frames', () => {
  let svc: SupabaseClient;
  let desk: { id: string; client: SupabaseClient };

  const guest = async (name: string) =>
    shapedGuest(svc, `un-${tag()}`, { user_metadata: { full_name: name, phone: '+9647700000000' } });
  const row = async (id: string) =>
    (await svc.from('profiles').select('username, username_changed_at, avatar_frame, avatar_frame_style').eq('id', id).single())
      .data!;
  /** Push a guest's last change back, so the 7-day rule lets them change again. */
  const age = async (id: string, days: number) =>
    svc
      .from('profiles')
      .update({ username_changed_at: new Date(Date.now() - days * 86_400_000).toISOString() } as never)
      .eq('id', id);

  beforeAll(async () => {
    svc = serviceClient();
    desk = await createStaffOfRole(svc, 'court_desk', 'username');
  });

  afterAll(async () => {
    if (desk) await svc.from('staff').update({ is_active: false }).eq('id', desk.id);
  });

  describe('app.username_check', () => {
    it('is not granted to anon, and refuses an anonymous café session', async () => {
      expect((await appRpc(anonClient(), 'username_check', { p_username: 'x' })).error?.message ?? '').toMatch(
        /permission denied/i,
      );
      const anon = await anonymousSessionClient();
      expect((await appRpc(anon, 'username_check', { p_username: 'abc' })).error?.message).toBe('ACCOUNT_REQUIRED');
    });

    it('answers invalid, reserved, taken and available, in stored form', async () => {
      const a = await guest('Check Alpha');
      const b = await guest('Check Beta');
      const name = `chk${tag()}`;
      expect((await appRpc(a.client, 'set_my_username', { p_username: name })).error).toBeNull();

      const check = async (p: string) => (await appRpc(b.client, 'username_check', { p_username: p })).data;
      expect(await check('ab')).toMatchObject({ available: false, reason: 'invalid' });
      expect(await check('a..b')).toMatchObject({ available: false, reason: 'invalid' });
      expect(await check('.abc')).toMatchObject({ available: false, reason: 'invalid' });
      expect(await check('Touch_Fan')).toMatchObject({ username: 'touch_fan', available: false, reason: 'reserved' });
      expect(await check('ad.min')).toMatchObject({ available: false, reason: 'reserved' });
      // 0319: slurs and swear words, through dots, digit swaps and doubled letters;
      // a short word only as a whole part, so ordinary names stay free.
      for (const bad of ['n1gg3r', 'sh1t.happens', 'fuuuck', 'big_dick', 'coon', 'kosomak', 'ibn.el.kalb']) {
        expect(await check(bad)).toMatchObject({ available: false, reason: 'not_allowed' });
      }
      for (const fine of ['dickens', 'raccoon', 'therapist', 'montenegro', 'nazih', 'khawla', 'assad']) {
        expect((await check(fine))?.reason).not.toBe('not_allowed');
      }
      expect(await check(name.toUpperCase())).toMatchObject({ username: name, available: false, reason: 'taken' });
      expect(await check(`  Free${tag()}  `)).toMatchObject({ available: true, reason: null });
      // The owner's own name is available to them.
      expect((await appRpc(a.client, 'username_check', { p_username: name })).data).toMatchObject({ available: true });
    });
  });

  describe('app.set_my_username', () => {
    it('stores lower case, refuses in order, and repeats as a duplicate', async () => {
      const g = await guest('Set Gamma');
      expect((await appRpc(g.client, 'set_my_username', { p_username: 'a' })).error?.message).toBe('USERNAME_INVALID');
      expect((await appRpc(g.client, 'set_my_username', { p_username: 'support' })).error?.message).toBe(
        'USERNAME_RESERVED',
      );
      expect((await appRpc(g.client, 'set_my_username', { p_username: 'b1tch.99' })).error?.message).toBe(
        'USERNAME_NOT_ALLOWED',
      );
      const name = `Gam${tag()}`;
      const set = await appRpc(g.client, 'set_my_username', { p_username: name });
      expect(set.error).toBeNull();
      expect(set.data).toMatchObject({ username: name.toLowerCase(), duplicate: false });
      expect((await row(g.id)).username).toBe(name.toLowerCase());
      expect((await appRpc(g.client, 'set_my_username', { p_username: name })).data).toMatchObject({ duplicate: true });
    });

    it('USERNAME_TAKEN for another guest\'s name', async () => {
      const a = await guest('Taken One');
      const b = await guest('Taken Two');
      const name = `tkn${tag()}`;
      expect((await appRpc(a.client, 'set_my_username', { p_username: name })).error).toBeNull();
      expect((await appRpc(b.client, 'set_my_username', { p_username: name })).error?.message).toBe('USERNAME_TAKEN');
    });

    it('allows one change every 7 days after the first, with the next time in the detail', async () => {
      const g = await guest('Week Delta');
      expect((await appRpc(g.client, 'set_my_username', { p_username: `wk${tag()}` })).error).toBeNull();
      const soon = await appRpc(g.client, 'set_my_username', { p_username: `wk${tag()}` });
      expect(soon.error?.message).toBe('USERNAME_TOO_SOON');
      expect(Date.parse(String(soon.error?.details))).toBeGreaterThan(Date.now() + 6 * 86_400_000);
      await age(g.id, 8);
      expect((await appRpc(g.client, 'set_my_username', { p_username: `wk${tag()}` })).error).toBeNull();
    });

    it('holds a given-up name from others for 7 days, and its owner may take it back', async () => {
      const a = await guest('Hold Eps');
      const b = await guest('Hold Zeta');
      const old = `old${tag()}`;
      expect((await appRpc(a.client, 'set_my_username', { p_username: old })).error).toBeNull();
      await age(a.id, 8);
      expect((await appRpc(a.client, 'set_my_username', { p_username: `new${tag()}` })).error).toBeNull();

      expect((await appRpc(b.client, 'username_check', { p_username: old })).data).toMatchObject({ reason: 'taken' });
      expect((await appRpc(b.client, 'set_my_username', { p_username: old })).error?.message).toBe('USERNAME_TAKEN');

      await age(a.id, 8);
      expect((await appRpc(a.client, 'set_my_username', { p_username: old })).error).toBeNull();
      const held = await svc.from('username_holds').select('username').eq('username', old);
      expect(held.data).toEqual([]);
    });

    it('a guest cannot write the columns directly', async () => {
      const g = await guest('Direct Eta');
      for (const patch of [{ username: 'direct' }, { avatar_frame: 'touch-blue' }, { avatar_frame_style: 'lines' }]) {
        const res = await g.client.from('profiles').update(patch as never).eq('id', g.id);
        expect(res.error?.message ?? '').toMatch(/permission denied/i);
      }
    });
  });

  describe('app.suggest_username', () => {
    it('builds given + "." + family initial, then numbers', async () => {
      const given = `Zq${tag()}`;
      const a = await guest(`${given} Smith`);
      const first = (await appRpc(a.client, 'suggest_username', {})).data as { username: string };
      expect(first.username).toBe(`${given.toLowerCase()}.s`);
      expect((await appRpc(a.client, 'set_my_username', { p_username: first.username })).error).toBeNull();

      const b = await guest(`${given} Stone`);
      expect((await appRpc(b.client, 'suggest_username', {})).data).toEqual({ username: `${given.toLowerCase()}.s2` });
    });

    it('falls back to player<n> for a name with no Latin letters', async () => {
      const g = await guest('حسن علي');
      const s = (await appRpc(g.client, 'suggest_username', {})).data as { username: string };
      expect(s.username).toMatch(/^player\d+$/);
    });
  });

  describe('frames', () => {
    it('sets a free frame, refuses an earned one and an unknown id', async () => {
      const g = await guest('Frame Theta');
      expect((await row(g.id)).avatar_frame).toBe('brand-green');
      expect((await appRpc(g.client, 'set_my_frame', { p_frame: 'double-line' })).error).toBeNull();
      expect((await row(g.id)).avatar_frame).toBe('double-line');
      expect((await appRpc(g.client, 'set_my_frame', { p_frame: 'gold-racket' })).error?.message).toBe('FRAME_LOCKED');
      expect((await appRpc(g.client, 'set_my_frame', { p_frame: 'night-match' })).error?.message).toBe('FRAME_INVALID');
      // 0317: court-lines is a style now, not an id.
      expect((await appRpc(g.client, 'set_my_frame', { p_frame: 'court-lines' })).error?.message).toBe('FRAME_INVALID');
    });

    it('court lines are a free frame\'s style, refused on an earned frame', async () => {
      const g = await guest('Frame Style');
      expect((await row(g.id)).avatar_frame_style).toBe('solid');
      expect((await appRpc(g.client, 'set_my_frame', { p_frame: 'touch-blue', p_style: 'lines' })).error).toBeNull();
      expect(await row(g.id)).toMatchObject({ avatar_frame: 'touch-blue', avatar_frame_style: 'lines' });
      // Leaving the style out means solid.
      expect((await appRpc(g.client, 'set_my_frame', { p_frame: 'split-court' })).error).toBeNull();
      expect(await row(g.id)).toMatchObject({ avatar_frame: 'split-court', avatar_frame_style: 'solid' });
      expect((await appRpc(g.client, 'set_my_frame', { p_frame: 'regular', p_style: 'lines' })).error?.message).toBe('FRAME_INVALID');
      expect((await appRpc(g.client, 'set_my_frame', { p_frame: 'touch-blue', p_style: 'dotted' })).error?.message).toBe('FRAME_INVALID');
      // The table holds the same rule for any writer.
      const direct = await svc.from('profiles').update({ avatar_frame: 'champion', avatar_frame_style: 'lines' } as never).eq('id', g.id);
      expect(direct.error?.message).toMatch(/profiles_avatar_frame_style_chk/);
    });

    it('a frame_grants row opens every frame (0318), and only for that profile', async () => {
      const g = await guest('Frame Grant');
      const other = await guest('Frame Plain');
      expect((await svc.from('frame_grants' as never).insert({ profile_id: g.id, note: 'test' } as never)).error).toBeNull();
      expect((await appRpc(g.client, 'set_my_frame', { p_frame: 'champion' })).error).toBeNull();
      const mine = (await appRpc(g.client, 'my_frames', {})).data as { frames: { unlocked: boolean }[] };
      expect(mine.frames.every((f) => f.unlocked)).toBe(true);
      expect((await appRpc(other.client, 'set_my_frame', { p_frame: 'champion' })).error?.message).toBe('FRAME_LOCKED');
      // No client reads or writes the list.
      expect((await g.client.from('frame_grants' as never).insert({ profile_id: other.id } as never)).error).not.toBeNull();
    });

    it('app.my_frames lists the closed set with what is unlocked', async () => {
      const g = await guest('Frame Iota');
      const data = (await appRpc(g.client, 'my_frames', {})).data as {
        current: string;
        style: string;
        frames: { id: string; unlocked: boolean }[];
      };
      expect(data.current).toBe('brand-green');
      expect(data.style).toBe('solid');
      expect(data.frames.map((f) => f.id)).toEqual([
        'brand-green', 'touch-blue', 'court-white', 'split-court', 'double-line',
        'regular', 'silver-racket', 'gold-racket', 'champion',
      ]);
      expect(data.frames.filter((f) => f.unlocked)).toHaveLength(5);
    });

    it('the desk reads the username and frame beside the name', async () => {
      const g = await guest('Desk Kappa');
      const name = `dsk${tag()}`;
      expect((await appRpc(g.client, 'set_my_username', { p_username: name })).error).toBeNull();
      const atDesk = await desk.client.from('profiles').select('username, avatar_frame').eq('id', g.id).single();
      expect(atDesk.data).toEqual({ username: name, avatar_frame: 'brand-green' });
    });
  });

  it('account deletion empties the username, holds it 90 days and resets the frame', async () => {
    const g = await guest('Delete Lambda');
    const other = await guest('Delete Mu');
    const name = `del${tag()}`;
    expect((await appRpc(g.client, 'set_my_username', { p_username: name })).error).toBeNull();
    expect((await appRpc(g.client, 'set_my_frame', { p_frame: 'touch-blue', p_style: 'lines' })).error).toBeNull();
    expect((await appRpc(g.client, 'delete_my_account', { p_confirm: 'DELETE' })).error).toBeNull();

    expect(await row(g.id)).toEqual({
      username: null,
      username_changed_at: null,
      avatar_frame: 'brand-green',
      avatar_frame_style: 'solid',
    });
    const hold = await svc.from('username_holds').select('reason, released_at').eq('username', name).single();
    expect(hold.data?.reason).toBe('deleted');
    expect(Date.parse(hold.data!.released_at)).toBeGreaterThan(Date.now() + 89 * 86_400_000);
    expect((await appRpc(other.client, 'set_my_username', { p_username: name })).error?.message).toBe('USERNAME_TAKEN');
  });
});

describe.skipIf(!up)('0316 earned frames', () => {
  let svc: SupabaseClient;
  let court: string;
  let g: { id: string; client: SupabaseClient };

  type Frames = {
    played: number;
    tournaments_won: number;
    frames: { id: string; goal: number | null; progress: number | null; unlocked: boolean }[];
  };
  const frames = async () => (await appRpc(g.client, 'my_frames', {})).data as Frames;
  const frame = (f: Frames, id: string) => f.frames.find((x) => x.id === id)!;

  // One booking per hour, `days` ago, so none overlaps another.
  let slot = 0;
  const book = async (status: string, price: number) => {
    slot += 1;
    const start = new Date(Date.now() - (2 + slot) * 86_400_000);
    start.setUTCHours(8, 0, 0, 0);
    const { error } = await svc.from('reservations').insert({
      court_id: court, kind: 'booking', status, source: 'desk', guest_id: g.id,
      start_at: start.toISOString(), end_at: new Date(start.getTime() + 3_600_000).toISOString(),
      price_iqd: price, created_by_staff_id: null,
    });
    if (error) throw new Error(`seed ${status} booking failed: ${error.message}`);
  };

  beforeAll(async () => {
    svc = serviceClient();
    court = await createTestCourt(svc, `Frames ${tag()}`);
    g = await shapedGuest(svc, `frames-${tag()}`, { user_metadata: { full_name: 'Earned Nu', phone: '+9647700000000' } });
  });

  afterAll(async () => {
    if (court) await svc.from('courts').update({ is_active: false }).eq('id', court);
  });

  it('counts only finished, fully paid games', async () => {
    expect((await frames()).played).toBe(0);
    await book('completed', 0); // played, nothing owed: counts
    await book('completed', 40_000); // played, court fee still owed: does not count
    await book('cancelled', 0);
    await book('no_show', 0);
    await book('confirmed', 0); // booked, not played yet
    expect((await frames()).played).toBe(1);
  });

  it('unlocks Regular at 10 and lets the guest wear it; Silver and Champion stay locked', async () => {
    expect((await appRpc(g.client, 'set_my_frame', { p_frame: 'regular' })).error?.message).toBe('FRAME_LOCKED');
    for (let i = 0; i < 9; i += 1) await book('completed', 0);

    const f = await frames();
    expect(f.played).toBe(10);
    expect(frame(f, 'regular')).toEqual({ id: 'regular', goal: 10, progress: 10, unlocked: true });
    expect(frame(f, 'silver-racket')).toMatchObject({ goal: 50, progress: 10, unlocked: false });
    expect(frame(f, 'champion')).toMatchObject({ goal: 1, progress: 0, unlocked: false });
    expect(frame(f, 'brand-green')).toMatchObject({ goal: null, progress: null, unlocked: true });

    expect((await appRpc(g.client, 'set_my_frame', { p_frame: 'regular' })).error).toBeNull();
    expect((await appRpc(g.client, 'set_my_frame', { p_frame: 'silver-racket' })).error?.message).toBe('FRAME_LOCKED');
    expect((await appRpc(g.client, 'set_my_frame', { p_frame: 'champion' })).error?.message).toBe('FRAME_LOCKED');
  });

  it('the counting helpers are internal', async () => {
    for (const fn of ['matches_played', 'tournaments_won']) {
      const res = await appRpc(g.client, fn, { p_profile: g.id });
      expect(res.error?.message ?? '').toMatch(/permission denied|Could not find/i);
    }
  });
});
