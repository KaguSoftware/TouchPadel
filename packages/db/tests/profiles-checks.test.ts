/**
 * 0116 profile CHECKs + 0121 — the service role can still write profiles.
 *
 * 0116 added three CHECK constraints to profiles, one of which calls
 * app.phone_digits. A CHECK runs as the writing role, and 0116 granted the
 * function to anon and authenticated only: every service-role UPDATE on
 * profiles then failed with "permission denied for function phone_digits"
 * (send-push clearing a dead token, the desk's customer tooling, test seeds).
 * 0121 grants service_role. These cases pin both halves: the checks refuse
 * malformed values, and the service role is allowed to write well-formed ones.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { guestClient, serviceClient, stackAvailable } from './helpers';

const up = await stackAvailable();

describe.skipIf(!up)('0116/0121 profile CHECKs and the service role', () => {
  let svc: SupabaseClient;
  let guest: SupabaseClient;
  let uid: string;

  beforeAll(async () => {
    svc = serviceClient();
    guest = await guestClient(svc, 'profiles-checks');
    const { data } = await guest.auth.getUser();
    uid = data.user!.id;
  });

  afterAll(async () => {
    await guest.auth.signOut();
  });

  it('the service role sets a well-formed push token (0121: phone_digits is granted to it)', async () => {
    const upd = await svc.from('profiles').update({ expo_push_token: 'ExponentPushToken[checks]' }).eq('id', uid);
    expect(upd.error).toBeNull();
    const { data } = await svc.from('profiles').select('expo_push_token').eq('id', uid).single();
    expect((data as { expo_push_token: string }).expo_push_token).toBe('ExponentPushToken[checks]');
  });

  it('the service role sets a well-formed phone and clears the token', async () => {
    const upd = await svc.from('profiles').update({ phone: '+964 770 000 0042', expo_push_token: null }).eq('id', uid);
    expect(upd.error).toBeNull();
  });

  it('a malformed push token is refused by profiles_push_token_format', async () => {
    const upd = await svc.from('profiles').update({ expo_push_token: 'not-a-token' }).eq('id', uid);
    expect(upd.error?.code).toBe('23514');
    expect(upd.error?.message).toContain('profiles_push_token_format');
  });

  it('a phone with too few digits is refused by profiles_phone_format', async () => {
    const upd = await svc.from('profiles').update({ phone: '+964 12' }).eq('id', uid);
    expect(upd.error?.code).toBe('23514');
    expect(upd.error?.message).toContain('profiles_phone_format');
  });

  it('a name over 80 characters is refused by profiles_full_name_len', async () => {
    const upd = await svc.from('profiles').update({ full_name: 'x'.repeat(81) }).eq('id', uid);
    expect(upd.error?.code).toBe('23514');
    expect(upd.error?.message).toContain('profiles_full_name_len');
  });
});
