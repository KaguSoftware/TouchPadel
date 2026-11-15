/**
 * 0414 — app.phone_sign_up_status: the Create account number check.
 *
 * A whole account (phone, name, gender) is `taken` in every way the number can
 * be written; an unfinished sign-up and a deleted account are `free`; garbage
 * is `unknown`; anon may call it; and past 20 calls a caller gets `unknown`,
 * never an error. Every row this file writes is removed in afterAll, and the
 * throttle table is emptied around each block so a re-run is not throttled by
 * the last one (or by rls-matrix's probe).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { stackAvailable, serviceClient, anonClient, uniqueTestPhone, DEV_PASSWORD, SUPABASE_URL, ANON_KEY } from './helpers';

const up = await stackAvailable();

async function clearThrottle(svc: SupabaseClient) {
  const { error } = await svc.schema('app').from('phone_sign_up_lookups').delete().gte('id', 0);
  if (error) throw new Error(`clear throttle: ${error.message}`);
}

async function status(c: SupabaseClient, phone: string): Promise<string> {
  const { data, error } = await c.schema('app').rpc('phone_sign_up_status', { p_phone: phone });
  if (error) throw new Error(`phone_sign_up_status: ${error.message}`);
  return data as string;
}

describe.skipIf(!up)('0414 phone_sign_up_status', () => {
  const svc = up ? serviceClient() : (null as unknown as SupabaseClient);
  const anon = up ? anonClient() : (null as unknown as SupabaseClient);
  const phone = uniqueTestPhone(); // +9647xxxxxxxxx
  let userId = '';

  beforeAll(async () => {
    await clearThrottle(svc);
    const { data, error } = await svc.auth.admin.createUser({
      phone,
      phone_confirm: true,
      password: DEV_PASSWORD,
      user_metadata: { full_name: 'Sign Up Probe', phone },
    });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    userId = data.user.id;
  });

  afterAll(async () => {
    if (userId) await svc.auth.admin.deleteUser(userId);
    await clearThrottle(svc);
  });

  async function setProfile(patch: Record<string, unknown>) {
    const { error } = await svc.from('profiles').update(patch).eq('id', userId);
    if (error) throw new Error(`profile update: ${error.message}`);
  }

  it('an unfinished sign-up (no gender yet) is free', async () => {
    await setProfile({ phone, full_name: 'Sign Up Probe', gender: null, gender_set_at: null, gender_set_by: null });
    expect(await status(anon, phone)).toBe('free');
  });

  it('a whole account is taken, however the number is written', async () => {
    await setProfile({ gender: 'female', gender_set_at: new Date().toISOString(), gender_set_by: 'guest' });
    const national = phone.slice(4); // after +964
    expect(await status(anon, phone)).toBe('taken');
    expect(await status(anon, `00964${national}`)).toBe('taken');
    expect(await status(anon, `+964 ${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`)).toBe('taken');
  });

  it('a number nobody has is free; garbage is unknown', async () => {
    expect(await status(anon, uniqueTestPhone())).toBe('free');
    expect(await status(anon, '12')).toBe('unknown');
    expect(await status(anon, 'not a number')).toBe('unknown');
  });

  /** An anon client as Cloudflare would present one caller (hosted sets the header). */
  function fromAddress(addr: string, extra: Record<string, string> = {}): SupabaseClient {
    return createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'cf-connecting-ip': addr, ...extra } },
    });
  }

  it('past 20 calls from one address the answer is unknown, never an error', async () => {
    await clearThrottle(svc);
    const one = fromAddress('203.0.113.9');
    const answers: string[] = [];
    for (let i = 0; i < 25; i += 1) answers.push(await status(one, phone));
    expect(answers.slice(0, 20).every((a) => a === 'taken')).toBe(true);
    expect(answers.slice(20).every((a) => a === 'unknown')).toBe(true);
    // Another address is its own caller.
    expect(await status(fromAddress('198.51.100.7'), phone)).toBe('taken');
  });

  it('a forged x-forwarded-for does not make a new caller', async () => {
    await clearThrottle(svc);
    const answers: string[] = [];
    for (let i = 0; i < 22; i += 1) {
      answers.push(await status(fromAddress('203.0.113.10', { 'x-forwarded-for': `10.0.0.${i}` }), phone));
    }
    expect(answers.slice(20).every((a) => a === 'unknown')).toBe(true);
  });

  it('stores no number and no address', async () => {
    const { data, error } = await svc.schema('app').from('phone_sign_up_lookups').select('caller').limit(5);
    expect(error).toBeNull();
    for (const row of data ?? []) {
      expect(row.caller === 'none' || /^[0-9a-f]{32}$/.test(row.caller)).toBe(true);
    }
  });

  // Last: account deletion's tombstone triggers scrub the profile.
  it('a deleted account is free', async () => {
    await setProfile({ deleted_at: new Date().toISOString() });
    expect(await status(anon, phone)).toBe('free');
  });
});
