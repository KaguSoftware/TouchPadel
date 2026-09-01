/**
 * 0058 / 0059 — OAuth-shaped sign-ups: profiles bootstrap + the phone rule.
 *
 * Native Sign in with Apple / Google (supabase.auth.signInWithIdToken) create
 * auth.users rows whose raw_user_meta_data is whatever the id token carried:
 *
 *   Google  full_name + name + email + picture + avatar_url        no phone
 *   Apple   sub / email flags only; the email may be an opaque      no phone,
 *           @privaterelay.appleid.com address (Hide My Email)       no name
 *
 * Apple and Google are never contacted here: the users are minted through the
 * admin API with exactly that metadata (helpers.shapedGuest), so the signup
 * trigger sees what it will see in production and the suite stays offline.
 *
 * Case 2 (Google `name` only) and case 3 (Apple relay -> '') FAIL on the 0004
 * trigger body and pass on 0058; that pair is the proof the migration matters.
 * Case 6 is the product rule's location: the DB requires only an ACCOUNT to
 * hold (0048/C1) and a PHONE to confirm (0059).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  anonymousSessionClient,
  shapedGuest,
  appRpc,
  createTestCourt,
  ensureTestRateRule,
  futureSlot,
  outcome,
} from './helpers';

const up = await stackAvailable();

/** Unique suffix so reruns without a db reset never collide on email. */
const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

type ProfileRow = { full_name: string; phone: string | null; preferred_lang: string };

describe.skipIf(!up)('0058/0059 OAuth-shaped sign-ups -> profiles bootstrap + phone rule', () => {
  let svc: SupabaseClient;
  let courtId: string;

  const profileOf = async (id: string): Promise<ProfileRow> => {
    const { data, error } = await svc
      .from('profiles')
      .select('full_name, phone, preferred_lang')
      .eq('id', id)
      .single();
    if (error) throw new Error(`profiles read failed: ${error.message}`);
    return data as ProfileRow;
  };

  beforeAll(async () => {
    svc = serviceClient();
    await ensureTestRateRule(svc);
    courtId = await createTestCourt(svc, 'OAUTH-0058');
  });

  it('1: Google shape (full_name + name + picture) -> full_name, no phone, lang en', async () => {
    const n = uniq();
    const email = `google-${n}@test.touch.local`;
    const sub = `10${n.replace(/\D/g, '').slice(0, 18)}`;
    const g = await shapedGuest(svc, 'google', {
      email,
      user_metadata: {
        iss: 'https://accounts.google.com',
        sub,
        provider_id: sub,
        name: 'Google User',
        full_name: 'Google User',
        email,
        email_verified: true,
        picture: 'https://lh3.googleusercontent.com/x',
        avatar_url: 'https://lh3.googleusercontent.com/x',
      },
      app_metadata: { provider: 'google', providers: ['google'] },
    });

    expect(await profileOf(g.id)).toEqual({
      full_name: 'Google User',
      phone: null,
      preferred_lang: 'en',
    });
  });

  it('2: Google shape with ONLY `name` (no full_name) -> full_name from the OIDC claim', async () => {
    // Fails on the 0004 body (which read only full_name, then the email local
    // part): this is the assertion that proves 0058.
    const n = uniq();
    const email = `google-name-${n}@test.touch.local`;
    const g = await shapedGuest(svc, 'google-name', {
      email,
      user_metadata: {
        iss: 'https://accounts.google.com',
        sub: `11${n.replace(/\D/g, '').slice(0, 18)}`,
        name: 'Only Name',
        email,
        email_verified: true,
      },
      app_metadata: { provider: 'google', providers: ['google'] },
    });

    expect((await profileOf(g.id)).full_name).toBe('Only Name');
  });

  it('3: Apple Hide-My-Email shape -> full_name "" (a relay token is not a name), no phone', async () => {
    const n = uniq();
    const email = `apple-${n}@privaterelay.appleid.com`;
    const sub = `000123.${n.replace(/\D/g, '')}.0001`;
    const a = await shapedGuest(svc, 'apple-relay', {
      email,
      user_metadata: {
        iss: 'https://appleid.apple.com',
        sub,
        provider_id: sub,
        email,
        email_verified: true,
        is_private_email: true,
      },
      app_metadata: { provider: 'apple', providers: ['apple'] },
    });

    // The 0004 body made this 'apple-<n>' -- a hash the desk would search for.
    expect(await profileOf(a.id)).toEqual({ full_name: '', phone: null, preferred_lang: 'en' });
  });

  it('4: Apple with a real email and no metadata -> the local-part fallback is preserved', async () => {
    const n = uniq();
    const local = `parsa.test-${n}`;
    const a = await shapedGuest(svc, 'apple-real', {
      email: `${local}@test.touch.local`,
      user_metadata: {},
      app_metadata: { provider: 'apple', providers: ['apple'] },
    });

    expect((await profileOf(a.id)).full_name).toBe(local);
  });

  it("5: RLS -- a shaped guest completes its OWN profile; another user's row is silence", async () => {
    const me = await shapedGuest(svc, 'rls-me', {
      email: `rls-me-${uniq()}@privaterelay.appleid.com`,
      user_metadata: { is_private_email: true },
    });
    const other = await shapedGuest(svc, 'rls-other', {
      email: `rls-other-${uniq()}@privaterelay.appleid.com`,
      user_metadata: { is_private_email: true },
    });

    // Own row: the complete-profile step the app runs after an Apple sign-in.
    const own = await me.client
      .from('profiles')
      .update({ full_name: 'Real Name', phone: '+9647700000001', preferred_lang: 'ar' })
      .eq('id', me.id)
      .select('id');
    expect(own.error).toBeNull();
    expect(own.data).toHaveLength(1);
    expect(await profileOf(me.id)).toEqual({
      full_name: 'Real Name',
      phone: '+9647700000001',
      preferred_lang: 'ar',
    });

    // Another user's row: no error, no rows, nothing changed (RLS silence).
    const before = await profileOf(other.id);
    const theirs = await me.client
      .from('profiles')
      .update({ full_name: 'Hijacked', phone: '+9647700000002', preferred_lang: 'ar' })
      .eq('id', other.id)
      .select('id');
    expect(theirs.error).toBeNull();
    expect(theirs.data).toHaveLength(0);
    expect(await profileOf(other.id)).toEqual(before);
  });

  it('6: product rule -- a phone-less account can HOLD (0048) but not CONFIRM (0059) until it adds a phone', async () => {
    const n = uniq();
    const email = `apple-${n}@privaterelay.appleid.com`;
    const a = await shapedGuest(svc, 'phone-rule', {
      email,
      user_metadata: {
        iss: 'https://appleid.apple.com',
        sub: `000123.${n.replace(/\D/g, '')}.0002`,
        email,
        email_verified: true,
        is_private_email: true,
      },
      app_metadata: { provider: 'apple', providers: ['apple'] },
    });
    expect((await profileOf(a.id)).phone).toBeNull();

    // The DB requires only the profiles row to hold -- the app takes the slot
    // first and asks for the phone while the hold ticks.
    const slot = futureSlot();
    const held = await appRpc(a.client, 'hold_slot', {
      p_court_id: courtId,
      p_start_at: slot.start.toISOString(),
      p_duration_min: 60,
    }).then(outcome);
    expect(held.ok, held.errorMessage).toBe(true);
    const holdId = (held.data as { reservation_id: string }).reservation_id;

    // ...but the booking itself is refused while the profile has no phone.
    const refused = await appRpc(a.client, 'confirm_booking', { p_hold_id: holdId }).then(outcome);
    expect(refused.ok).toBe(false);
    expect(refused.errorMessage).toContain('PHONE_REQUIRED');

    // The hold is still a pending hold: the refusal wrote nothing.
    const { data: still } = await svc
      .from('reservations')
      .select('kind, status')
      .eq('id', holdId)
      .single();
    expect(still).toEqual({ kind: 'hold', status: 'pending' });

    // The guest completes the profile and confirms.
    const fix = await a.client
      .from('profiles')
      .update({ full_name: 'Phone Rule Guest', phone: '+9647700000003' })
      .eq('id', a.id);
    expect(fix.error).toBeNull();

    const confirmed = await appRpc(a.client, 'confirm_booking', { p_hold_id: holdId }).then(outcome);
    expect(confirmed.ok, confirmed.errorMessage).toBe(true);
    expect(confirmed.duplicate).toBe(false);

    // Idempotent replay (0008) still answers ahead of the new guard.
    const again = await appRpc(a.client, 'confirm_booking', { p_hold_id: holdId }).then(outcome);
    expect(again.ok, again.errorMessage).toBe(true);
    expect(again.duplicate).toBe(true);
  });

  it('7: invariant -- an anonymous cafe session still has NO profiles row (0048/C1)', async () => {
    const anon = await anonymousSessionClient();
    const { data, error } = await anon.from('profiles').select('id');
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('8: a staff-shaped user (no metadata, ordinary email) still gets the local-part name', async () => {
    // The staff-admin edge function creates users with no metadata at all and
    // relies on this fallback; 0058 must not have broken it.
    const local = `desk-like-${uniq()}`;
    const s = await shapedGuest(svc, 'desk-like', {
      email: `${local}@test.touch.local`,
      user_metadata: {},
    });

    expect(await profileOf(s.id)).toEqual({ full_name: local, phone: null, preferred_lang: 'en' });
  });
});
