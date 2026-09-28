/**
 * 0249 — the hold ladder. A guest who lets holds lapse waits, then is
 * suspended and listed for the day close.
 *
 *   1st strike  hold_warning on the next hold, nothing refused
 *   2nd         HOLD_COOLDOWN for 2 hours
 *   3rd         HOLD_COOLDOWN for 1 day
 *   4th         BOOKING_SUSPENDED for 7 days + app.hold_reviews at the branch
 *
 * A lapse is simulated by moving the hold's hold_expires_at into the past (and
 * created_at, for a release "after 90 seconds"); the waits are skipped by
 * moving hold_standing.blocked_until into the past, as the clock would.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  guestClient,
  appRpc,
  createTestCourt,
  ensureTestRateRule,
  futureSlot,
  outcome,
  SEED_STAFF,
  VENUE_A_ID,
  DEV_PASSWORD,
} from './helpers';

const up = await stackAvailable();

interface Standing {
  id: string;
  key: string;
  strikes: number;
  blocked_until: string | null;
  needs_review: boolean;
  review_venue_id: string | null;
  banned_at: string | null;
}

describe.skipIf(!up)('0249 hold ladder', () => {
  let svc: SupabaseClient;
  let manager: SupabaseClient;
  let desk: SupabaseClient;
  let courtId: string;

  const tryHold = (guest: SupabaseClient) =>
    appRpc(guest, 'hold_slot', {
      p_court_id: courtId,
      p_start_at: futureSlot().start.toISOString(),
      p_duration_min: 60,
    }).then(outcome);

  const hold = async (guest: SupabaseClient) => {
    const res = await tryHold(guest);
    expect(res.ok, res.errorMessage).toBe(true);
    return res.data as { reservation_id: string; hold_warning: boolean };
  };

  /** The hold ran out a minute ago, as if the guest walked away. */
  const lapse = async (id: string) => {
    const { error } = await svc
      .from('reservations')
      .update({ hold_expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq('id', id);
    expect(error).toBeNull();
  };

  const holdAndLapse = async (guest: SupabaseClient) => lapse((await hold(guest)).reservation_id);

  /** The tp_hold_sweep cron's call: writes the strikes a refused hold_slot rolled back. */
  const sweep = async (c: SupabaseClient) => {
    const res = await appRpc(c, 'expire_stale_holds', {}).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
  };

  const guestIdOf = async (c: SupabaseClient) => (await c.auth.getUser()).data.user!.id;

  const standingOf = async (guest: SupabaseClient): Promise<Standing | null> => {
    const id = await guestIdOf(guest);
    const { data } = await svc.from('hold_standing').select('*').eq('guest_id', id).maybeSingle();
    return data as Standing | null;
  };

  /** The clock moves past the current wait. */
  const waitOut = async (s: Standing) => {
    const { error } = await svc
      .from('hold_standing')
      .update({ blocked_until: new Date(Date.now() - 1000).toISOString() })
      .eq('id', s.id);
    expect(error).toBeNull();
  };

  const verifiedPhoneGuest = async (tag: string, phone: string) => {
    const email = `hold-${tag}-${Date.now()}@test.touch.local`;
    const { error } = await svc.auth.admin.createUser({
      email,
      password: DEV_PASSWORD,
      email_confirm: true,
      phone,
      phone_confirm: true,
      user_metadata: { full_name: `Hold ${tag}`, phone: `+${phone}` },
    });
    if (error) throw new Error(`createUser failed: ${error.message}`);
    return signedInClient(email);
  };

  beforeAll(async () => {
    svc = serviceClient();
    manager = await signedInClient(SEED_STAFF.manager);
    desk = await signedInClient(SEED_STAFF.court_desk);
    await signedInClient(SEED_STAFF.owner);
    await ensureTestRateRule(svc);
    courtId = await createTestCourt(svc, 'R0249');
    // On a freshly reset stack the rule is seconds old, so a hold dated two
    // minutes back would predate it. Moving the line earlier changes nothing
    // else: no hold is older than the reset.
    const { data: ps } = await svc.from('platform_settings').select('hold_strikes_since').eq('id', true).single();
    const since = new Date((ps as { hold_strikes_since: string }).hold_strikes_since).getTime();
    const tenMinutesAgo = Date.now() - 10 * 60_000;
    if (since > tenMinutesAgo) {
      await svc
        .from('platform_settings')
        .update({ hold_strikes_since: new Date(tenMinutesAgo).toISOString() })
        .eq('id', true);
    }
  });

  it('walks the ladder: warning, 2 hours, 1 day, suspension and review', async () => {
    const guest = await guestClient(svc, 'h249-ladder');

    // A clean guest: no warning.
    const first = await hold(guest);
    expect(first.hold_warning).toBe(false);
    await lapse(first.reservation_id);

    // 1st strike: the next hold goes through, with the kind warning.
    const second = await hold(guest);
    expect(second.hold_warning).toBe(true);
    await lapse(second.reservation_id);

    // 2nd strike: two hours.
    const cooled = await tryHold(guest);
    expect(cooled.ok).toBe(false);
    expect(cooled.errorMessage).toContain('HOLD_COOLDOWN');
    await sweep(guest);
    let s = (await standingOf(guest))!;
    expect(s.strikes).toBe(2);
    const twoHours = new Date(s.blocked_until!).getTime() - Date.now();
    expect(twoHours).toBeGreaterThan(115 * 60_000);
    expect(twoHours).toBeLessThan(121 * 60_000);

    // 3rd strike, after the wait: a day.
    await waitOut(s);
    await holdAndLapse(guest);
    expect((await tryHold(guest)).errorMessage).toContain('HOLD_COOLDOWN');
    await sweep(guest);
    s = (await standingOf(guest))!;
    expect(s.strikes).toBe(3);
    expect(new Date(s.blocked_until!).getTime() - Date.now()).toBeGreaterThan(23 * 3600_000);

    // 4th strike, the same day the wait ended: 7 days and a review.
    await waitOut(s);
    await holdAndLapse(guest);
    const suspended = await tryHold(guest);
    expect(suspended.errorMessage).toContain('BOOKING_SUSPENDED');
    await sweep(guest);
    s = (await standingOf(guest))!;
    expect(s.strikes).toBe(4);
    expect(s.needs_review).toBe(true);
    expect(s.review_venue_id).toBe(VENUE_A_ID);
    expect(new Date(s.blocked_until!).getTime() - Date.now()).toBeGreaterThan(6 * 24 * 3600_000);

    // The day close lists them at the branch it happened at.
    const reviews = await appRpc(manager, 'hold_reviews', { p_venue_id: VENUE_A_ID }).then(outcome);
    expect(reviews.ok, reviews.errorMessage).toBe(true);
    const row = (reviews.data as Array<{ id: string; status: string; strikes: number }>).find((r) => r.id === s.id);
    expect(row).toMatchObject({ status: 'suspended', strikes: 4 });

    // Lift: the guest may hold at once and leaves the list.
    const lifted = await appRpc(manager, 'hold_standing_decide', {
      p_standing_id: s.id,
      p_decision: 'lift',
    }).then(outcome);
    expect(lifted.ok, lifted.errorMessage).toBe(true);
    expect(lifted.data).toMatchObject({ status: 'clear', strikes: 0, needs_review: false });
    const after = await hold(guest);
    expect(after.hold_warning).toBe(false);
    const again = await appRpc(manager, 'hold_reviews', { p_venue_id: VENUE_A_ID }).then(outcome);
    expect((again.data as Array<{ id: string }>).some((r) => r.id === s.id)).toBe(false);

    const { data: audit } = await svc
      .from('audit_log')
      .select('action, reason_code')
      .eq('entity', 'hold_standing')
      .eq('entity_id', s.id);
    expect((audit ?? []).map((a) => a.action)).toEqual(
      expect.arrayContaining(['guest.hold_suspended', 'guest.hold_standing']),
    );
  });

  it('a ban holds after the suspension would have ended, until lifted', async () => {
    const guest = await guestClient(svc, 'h249-ban');
    await holdAndLapse(guest);
    await hold(guest); // settles the 1st strike
    const s0 = (await standingOf(guest))!;

    const banned = await appRpc(manager, 'hold_standing_decide', {
      p_standing_id: s0.id,
      p_decision: 'ban',
    }).then(outcome);
    expect(banned.ok, banned.errorMessage).toBe(true);
    expect(banned.data).toMatchObject({ status: 'banned' });
    expect((await tryHold(guest)).errorMessage).toContain('BOOKING_SUSPENDED');

    await appRpc(manager, 'hold_standing_decide', { p_standing_id: s0.id, p_decision: 'lift' });
    await hold(guest);
  });

  it('a day of memory: a strike long after the last wait starts again at the 1st', async () => {
    const guest = await guestClient(svc, 'h249-decay');
    await holdAndLapse(guest);
    await holdAndLapse(guest);
    expect((await tryHold(guest)).errorMessage).toContain('HOLD_COOLDOWN');
    await sweep(guest);
    const s = (await standingOf(guest))!;

    // Both strikes and the wait are two days old.
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600_000).toISOString();
    await svc
      .from('hold_standing')
      .update({ last_strike_at: twoDaysAgo, blocked_until: twoDaysAgo })
      .eq('id', s.id);

    const next = await hold(guest);
    expect(next.hold_warning).toBe(false);
    await lapse(next.reservation_id);
    const warned = await hold(guest);
    expect(warned.hold_warning).toBe(true);
    expect((await standingOf(guest))!.strikes).toBe(1);
  });

  it('releasing inside 90 seconds is browsing, not a strike', async () => {
    const guest = await guestClient(svc, 'h249-browse');
    for (let i = 0; i < 3; i++) {
      const h = await hold(guest);
      expect(h.hold_warning).toBe(false);
      const rel = await appRpc(guest, 'release_hold', { p_reservation_id: h.reservation_id }).then(outcome);
      expect(rel.ok, rel.errorMessage).toBe(true);
    }
    expect(await standingOf(guest)).toBeNull();
    const { data } = await svc
      .from('hold_strikes')
      .select('counted')
      .eq('standing_key', `u:${await guestIdOf(guest)}`);
    expect((data ?? []).map((r) => r.counted)).toEqual([false, false, false]);
  });

  it('releasing after 90 seconds is a strike', async () => {
    const guest = await guestClient(svc, 'h249-sat');
    const h = await hold(guest);
    await svc
      .from('reservations')
      .update({ created_at: new Date(Date.now() - 120_000).toISOString() })
      .eq('id', h.reservation_id);
    await appRpc(guest, 'release_hold', { p_reservation_id: h.reservation_id });
    expect((await standingOf(guest))!.strikes).toBe(1);
    expect((await hold(guest)).hold_warning).toBe(true);
  });

  it('a hold taken before the rule existed does not count', async () => {
    const guest = await guestClient(svc, 'h249-old');
    const { data: ps } = await svc.from('platform_settings').select('hold_strikes_since').eq('id', true).single();
    const since = new Date((ps as { hold_strikes_since: string }).hold_strikes_since).getTime();
    for (let i = 0; i < 2; i++) {
      const h = await hold(guest);
      await svc
        .from('reservations')
        .update({
          created_at: new Date(since - 60_000).toISOString(),
          hold_expires_at: new Date(Date.now() - 60_000).toISOString(),
        })
        .eq('id', h.reservation_id);
    }
    expect((await hold(guest)).hold_warning).toBe(false);
    expect(await standingOf(guest)).toBeNull();
  });

  it('the cron sweep settles lapses without the guest coming back', async () => {
    const guest = await guestClient(svc, 'h249-sweep');
    await holdAndLapse(guest);
    await holdAndLapse(guest);
    await sweep(guest);
    const s = (await standingOf(guest))!;
    expect(s.strikes).toBe(2);
    expect(new Date(s.blocked_until!).getTime()).toBeGreaterThan(Date.now());
  });

  it('a verified phone is the identity: the number carries its standing to a new account', async () => {
    const phone = `9647${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;
    const a = await verifiedPhoneGuest('pa', phone);
    await holdAndLapse(a);
    await holdAndLapse(a);
    await sweep(a);
    const s = (await standingOf(a))!;
    expect(s.key).toMatch(/^p:[0-9a-f]{64}$/);
    // The number itself is never stored.
    expect(JSON.stringify(s)).not.toContain(phone);

    // A number belongs to one account at a time: the first one lets it go
    // (a deleted account does the same), a new account verifies it.
    const other = `9647${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;
    const { error } = await svc.auth.admin.updateUserById(await guestIdOf(a), { phone: other });
    expect(error).toBeNull();
    const b = await verifiedPhoneGuest('pb', phone);
    expect((await tryHold(b)).errorMessage).toContain('HOLD_COOLDOWN');
  });

  it('a typed (unverified) profile phone is not an identity', async () => {
    // guestClient gives every test guest the same metadata phone.
    const a = await guestClient(svc, 'h249-typed-a');
    const b = await guestClient(svc, 'h249-typed-b');
    await holdAndLapse(a);
    await holdAndLapse(a);
    expect((await tryHold(a)).errorMessage).toContain('HOLD_COOLDOWN');
    expect((await hold(b)).hold_warning).toBe(false);
  });

  it('the customer record shows the standing to the desk; only MGMT decides', async () => {
    const guest = await guestClient(svc, 'h249-record');
    await holdAndLapse(guest);
    await hold(guest);
    const id = await guestIdOf(guest);

    const seen = await appRpc(desk, 'guest_hold_standing', { p_customer_id: id }).then(outcome);
    expect(seen.ok, seen.errorMessage).toBe(true);
    expect(seen.data).toMatchObject({ status: 'warned', strikes: 1, guest_id: id });

    const s = (await standingOf(guest))!;
    const refused = await appRpc(desk, 'hold_standing_decide', {
      p_standing_id: s.id,
      p_decision: 'lift',
    }).then(outcome);
    expect(refused.ok).toBe(false);
    expect(refused.errorMessage).toContain('FORBIDDEN');

    const bad = await appRpc(manager, 'hold_standing_decide', {
      p_standing_id: s.id,
      p_decision: 'forgive',
    }).then(outcome);
    expect(bad.errorMessage).toContain('INVALID_ARGUMENT');

    const clean = await guestClient(svc, 'h249-clean');
    const none = await appRpc(desk, 'guest_hold_standing', { p_customer_id: await guestIdOf(clean) }).then(outcome);
    expect(none.ok, none.errorMessage).toBe(true);
    expect(none.data).toBeNull();
  });

  it('guests cannot read the ladder tables', async () => {
    const guest = await guestClient(svc, 'h249-read');
    const standing = await guest.from('hold_standing').select('id');
    expect(standing.error).not.toBeNull();
    const strikes = await guest.from('hold_strikes').select('reservation_id');
    expect(strikes.error).not.toBeNull();
    const reviews = await appRpc(guest, 'hold_reviews', { p_venue_id: VENUE_A_ID }).then(outcome);
    expect(reviews.errorMessage).toContain('FORBIDDEN');
  });
});
