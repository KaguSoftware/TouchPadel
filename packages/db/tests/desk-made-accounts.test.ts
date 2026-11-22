/**
 * 0448 — every customer a desk writes down is a customer record.
 *
 *   1. app.desk_register_customer takes the cashier and the shop assistant as
 *      well as the court desk, manager and owner, and counts a second job; the
 *      kitchen is still refused.
 *   2. app.phone_sign_up_status answers `desk` for a number a desk walk-in
 *      holds while nobody has signed in to that record, however the number is
 *      written; `taken` still wins; a walk-in somebody signed in to, a staff
 *      member and a number nobody has are not `desk`.
 *   3. The code that confirms the number on the phone claims the record: the
 *      walk-in's booking moves to the new account (0307, proven here end to end
 *      for a walk-in made the 0448 way: a name and a number, no gender).
 *   4. A name with no number is a customer too, INCOMPLETE: no phone, no key,
 *      audited customer.draft, never `desk` to the phone. The number added
 *      later (app.desk_complete_customer) makes it an ordinary walk-in: keyed,
 *      found by the number, `desk` to the phone, and claimed by the code like
 *      any other. Only the desk's own unfinished record can be completed, and
 *      a number that already has its customer is refused, naming them.
 *   5. app.customer_search lists a customer with a number before one saved by
 *      name alone.
 *   6. The edge function's `ifExists: 'return'` (when the edge runtime serves):
 *      a new account, then the same account for the same number, for the
 *      cashier too; a name alone; the number that completes it; without the
 *      flag the Customers form's 409 and role list stand.
 *
 * Every row is removed in afterAll; the lookup throttle is emptied around the
 * file so a re-run is not throttled by this one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ANON_KEY,
  DEV_PASSWORD,
  SEED_STAFF,
  SEED_STAFF_IDS,
  SUPABASE_URL,
  anonClient,
  appRpc,
  outcome,
  serviceClient,
  signedInClient,
  stackAvailable,
} from './helpers';

const up = await stackAvailable();

async function edgeRuntimeServes(): Promise<boolean> {
  if (!up) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/replay`, { method: 'POST', signal: AbortSignal.timeout(5_000) });
    await res.text();
    return res.status === 401;
  } catch {
    return false;
  }
}
const served = await edgeRuntimeServes();

/** Seven random digits after 077: unique per run, Iraqi-shaped. */
const tail = () => String(Math.floor(Math.random() * 1e7)).padStart(7, '0');

async function clearThrottle(svc: SupabaseClient) {
  const { error } = await svc.schema('app').from('phone_sign_up_lookups').delete().gte('id', 0);
  if (error) throw new Error(`clear throttle: ${error.message}`);
}

async function status(c: SupabaseClient, phone: string): Promise<string> {
  const { data, error } = await c.schema('app').rpc('phone_sign_up_status', { p_phone: phone });
  if (error) throw new Error(`phone_sign_up_status: ${error.message}`);
  return data as string;
}

describe.skipIf(!up)('0448 desk-made accounts', () => {
  const svc = up ? serviceClient() : (null as unknown as SupabaseClient);
  const anon = up ? anonClient() : (null as unknown as SupabaseClient);
  const users: string[] = [];

  /** An auth user as desk-customer-create makes one: a synthetic address, a password nobody knows. */
  async function deskUser(national: string, name = 'Walk In'): Promise<string> {
    const { data, error } = await svc.auth.admin.createUser({
      email: `${national}-${Date.now()}@guest.touch.local`,
      password: DEV_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: name, phone: national, preferred_lang: 'ar', created_via: 'desk' },
    });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    users.push(data.user.id);
    return data.user.id;
  }

  /** A walk-in registered with a name and a number alone (no gender), by `actor`. */
  async function walkIn(national: string, actor: string = SEED_STAFF_IDS.court_desk, name = 'Walk In'): Promise<string> {
    const id = await deskUser(national, name);
    const reg = await appRpc(svc, 'desk_register_customer', {
      p_customer_id: id,
      p_full_name: name,
      p_phone: national,
      p_preferred_lang: 'ar',
      p_actor_id: actor,
    });
    if (reg.error) throw new Error(`desk_register_customer: ${reg.error.message}`);
    return id;
  }

  beforeAll(async () => {
    await clearThrottle(svc);
  });

  afterAll(async () => {
    await svc.from('staff').update({ extra_roles: [] }).eq('id', SEED_STAFF_IDS.prep);
    for (const id of users) await svc.auth.admin.deleteUser(id);
    await clearThrottle(svc);
  });

  // ── 1. who may register ────────────────────────────────────────────────────

  it('the cashier registers a customer; the audit row names them', async () => {
    const national = `077${tail()}0`;
    const id = await walkIn(national, SEED_STAFF_IDS.cashier, 'Till Guest');
    const { data: prof } = await svc.from('profiles').select('full_name, phone, phone_key, gender').eq('id', id).single();
    expect(prof).toMatchObject({ full_name: 'Till Guest', phone: national, gender: null });
    expect((prof as { phone_key: string | null }).phone_key).not.toBeNull();
    const { data: audit } = await svc.from('audit_log').select('action, actor_id, actor_role').eq('entity', 'profiles').eq('entity_id', id);
    expect(audit).toEqual([{ action: 'customer.create', actor_id: SEED_STAFF_IDS.cashier, actor_role: 'cashier' }]);
  });

  it('the kitchen is refused, until the court desk is their second job', async () => {
    const national = `077${tail()}1`;
    const id = await deskUser(national);
    const args = { p_customer_id: id, p_full_name: 'Walk In', p_phone: national, p_preferred_lang: 'ar', p_actor_id: SEED_STAFF_IDS.prep };
    expect(outcome(await appRpc(svc, 'desk_register_customer', args)).errorMessage).toContain('FORBIDDEN');

    const second = await svc.from('staff').update({ extra_roles: ['court_desk'] }).eq('id', SEED_STAFF_IDS.prep);
    expect(second.error).toBeNull();
    const ok = await appRpc(svc, 'desk_register_customer', args);
    expect(ok.error).toBeNull();
    await svc.from('staff').update({ extra_roles: [] }).eq('id', SEED_STAFF_IDS.prep);
  });

  it('nobody but the service role may call it', async () => {
    const cashier = await signedInClient(SEED_STAFF.cashier);
    const res = outcome(
      await appRpc(cashier, 'desk_register_customer', {
        p_customer_id: SEED_STAFF_IDS.cashier,
        p_full_name: 'x',
        p_phone: '07700000000',
        p_preferred_lang: 'en',
        p_actor_id: SEED_STAFF_IDS.cashier,
      }),
    );
    expect(res.errorMessage).toMatch(/permission denied/i);
  });

  // ── 2. what the phone is told ──────────────────────────────────────────────

  it('a desk-made number answers desk, however it is written; a number nobody has is free', async () => {
    const rest = tail();
    const national = `0770${rest}`; // as the desk typed it
    await walkIn(national);
    expect(await status(anon, `+964770${rest}`)).toBe('desk');
    expect(await status(anon, national)).toBe('desk');
    expect(await status(anon, `00964770${rest}`)).toBe('desk');
    expect(await status(anon, `+964 770 ${rest.slice(0, 3)} ${rest.slice(3)}`)).toBe('desk');
    expect(await status(anon, `+964771${tail()}`)).toBe('free');
  });

  it('a record somebody has signed in to is no longer desk', async () => {
    const rest = tail();
    const national = `0772${rest}`;
    const id = await walkIn(national);
    expect(await status(anon, national)).toBe('desk');
    // The desk gave the account a real address and its owner reset the password: they are in.
    const email = `claimed-${rest}@test.touch.local`;
    const upd = await svc.auth.admin.updateUserById(id, { email, email_confirm: true, password: DEV_PASSWORD });
    expect(upd.error).toBeNull();
    await signedInClient(email);
    expect(await status(anon, national)).toBe('free');
  });

  it('a staff member the desk also wrote down is not offered Create account', async () => {
    const rest = tail();
    const national = `0773${rest}`;
    const id = await walkIn(national);
    const hire = await svc.from('staff').insert({ id, role: 'waiter', display_name: 'Probe Waiter', is_active: false });
    expect(hire.error).toBeNull();
    expect(await status(anon, national)).toBe('free');
    await svc.from('staff_venues').delete().eq('staff_id', id);
    const fire = await svc.from('staff').delete().eq('id', id);
    expect(fire.error).toBeNull();
    expect(await status(anon, national)).toBe('desk');
  });

  // ── 3. the code on the phone claims the record ─────────────────────────────

  it('confirming the number on the phone takes the desk record over, and the number is then taken', async () => {
    const rest = tail();
    const national = `0774${rest}`;
    const e164 = `+964774${rest}`;
    const walk = await walkIn(national, SEED_STAFF_IDS.court_desk, 'Desk Typed Name');
    // Something the desk wrote against the record: a customer note.
    const note = await svc.from('customer_notes').insert({ customer_id: walk, body: 'prefers court 2', author_id: SEED_STAFF_IDS.court_desk });
    expect(note.error).toBeNull();
    expect(await status(anon, e164)).toBe('desk');

    // Create account on the phone: the verified code makes the account (GoTrue confirms the phone).
    const made = await svc.auth.admin.createUser({ phone: e164, phone_confirm: true, password: DEV_PASSWORD });
    if (made.error || !made.data.user) throw new Error(`createUser: ${made.error?.message}`);
    const me = made.data.user.id;
    users.push(me);

    const { data: mine } = await svc.from('profiles').select('phone, phone_key, full_name, deleted_at').eq('id', me).single();
    expect((mine as { phone_key: string | null }).phone_key).not.toBeNull();
    // c21: the desk's typed name is never carried onto the person's own account.
    expect((mine as { full_name: string }).full_name).not.toBe('Desk Typed Name');
    const { data: old } = await svc.from('profiles').select('deleted_at, phone_key').eq('id', walk).single();
    expect((old as { deleted_at: string | null }).deleted_at).not.toBeNull();
    const { data: merges } = await svc.schema('app').from('profile_merges').select('reason').eq('keep_id', me).eq('drop_id', walk);
    expect((merges ?? []).map((m: { reason: string }) => m.reason)).toContain('walkin_claim');

    // Still unfinished (no name, no gender): free. Whole: taken.
    expect(await status(anon, e164)).toBe('free');
    const whole = await svc
      .from('profiles')
      .update({ full_name: 'Real Person', gender: 'male', gender_set_at: new Date().toISOString(), gender_set_by: 'guest' })
      .eq('id', me);
    expect(whole.error).toBeNull();
    expect(await status(anon, e164)).toBe('taken');
  });

  // ── 4. a name with no number ───────────────────────────────────────────────

  /** A customer saved by name alone, as the edge function makes one. */
  async function nameOnly(name: string, actor: string = SEED_STAFF_IDS.court_desk): Promise<string> {
    const { data, error } = await svc.auth.admin.createUser({
      email: `name-${crypto.randomUUID()}@guest.touch.local`,
      password: DEV_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: name, preferred_lang: 'ar', created_via: 'desk' },
    });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    users.push(data.user.id);
    const reg = await appRpc(svc, 'desk_register_customer', {
      p_customer_id: data.user.id,
      p_full_name: name,
      p_phone: null,
      p_preferred_lang: 'ar',
      p_actor_id: actor,
    });
    if (reg.error) throw new Error(`desk_register_customer: ${reg.error.message}`);
    expect(reg.data).toMatchObject({ id: data.user.id, full_name: name, phone: null, incomplete: true });
    return data.user.id;
  }

  it('a name alone is a customer with no phone and no key, audited as a draft', async () => {
    const id = await nameOnly('Name Only Probe', SEED_STAFF_IDS.cashier);
    const { data: prof } = await svc.from('profiles').select('full_name, phone, phone_key').eq('id', id).single();
    expect(prof).toEqual({ full_name: 'Name Only Probe', phone: null, phone_key: null });
    const { data: audit } = await svc.from('audit_log').select('action, actor_id, after').eq('entity', 'profiles').eq('entity_id', id);
    expect(audit).toHaveLength(1);
    expect((audit as { action: string; actor_id: string; after: Record<string, unknown> }[])[0]).toMatchObject({
      action: 'customer.draft',
      actor_id: SEED_STAFF_IDS.cashier,
      after: { full_name: 'Name Only Probe', incomplete: true },
    });
    // Two people with one name are two records: nothing is matched by name.
    const twin = await nameOnly('Name Only Probe');
    expect(twin).not.toBe(id);
  });

  it('a number that is not one is still refused when one is given', async () => {
    const { data, error } = await svc.auth.admin.createUser({ email: `name-${crypto.randomUUID()}@guest.touch.local`, password: DEV_PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    users.push(data.user.id);
    const bad = outcome(
      await appRpc(svc, 'desk_register_customer', { p_customer_id: data.user.id, p_full_name: 'x', p_phone: '12', p_preferred_lang: 'ar', p_actor_id: SEED_STAFF_IDS.court_desk }),
    );
    expect(bad.errorMessage).toContain('INVALID_PHONE');
  });

  it('the number added later completes it: keyed, found by the number, desk to the phone, then claimed', async () => {
    const rest = tail();
    const national = `0779${rest}`;
    const e164 = `+964779${rest}`;
    const id = await nameOnly('Complete Me');
    expect(await status(anon, e164)).toBe('free');

    const done = await appRpc(svc, 'desk_complete_customer', { p_customer_id: id, p_phone: national, p_actor_id: SEED_STAFF_IDS.cashier });
    expect(done.error).toBeNull();
    expect(done.data).toMatchObject({ id, full_name: 'Complete Me', phone: national });
    const { data: prof } = await svc.from('profiles').select('phone, phone_key').eq('id', id).single();
    expect((prof as { phone: string }).phone).toBe(national);
    expect((prof as { phone_key: string | null }).phone_key).not.toBeNull();
    const found = await appRpc(svc, 'find_customer_by_phone', { p_phone: e164 });
    expect(found.data).toBe(id);
    expect(await status(anon, e164)).toBe('desk');
    const { data: audit } = await svc.from('audit_log').select('action').eq('entity', 'profiles').eq('entity_id', id).order('id');
    expect((audit as { action: string }[]).map((a) => a.action)).toEqual(['customer.draft', 'customer.create']);

    // Whole now: it cannot be "completed" a second time.
    const again = outcome(await appRpc(svc, 'desk_complete_customer', { p_customer_id: id, p_phone: `0779${tail()}`, p_actor_id: SEED_STAFF_IDS.cashier }));
    expect(again.errorMessage).toContain('CUSTOMER_NOT_INCOMPLETE');

    // And the phone claims it like any desk walk-in.
    const made = await svc.auth.admin.createUser({ phone: e164, phone_confirm: true, password: DEV_PASSWORD });
    if (made.error || !made.data.user) throw new Error(`createUser: ${made.error?.message}`);
    users.push(made.data.user.id);
    const { data: old } = await svc.from('profiles').select('deleted_at').eq('id', id).single();
    expect((old as { deleted_at: string | null }).deleted_at).not.toBeNull();
  });

  it('only the desk\'s own unfinished record is completed, and never onto a number that has its customer', async () => {
    const rest = tail();
    const held = `0771${rest}`;
    const holder = await walkIn(held, SEED_STAFF_IDS.court_desk, 'Holder');
    const draft = await nameOnly('Draft');

    const dup = await appRpc(svc, 'desk_complete_customer', { p_customer_id: draft, p_phone: `+964771${rest}`, p_actor_id: SEED_STAFF_IDS.court_desk });
    expect(dup.error?.message).toContain('DUPLICATE_PHONE');
    expect((dup.error as { details?: string } | null)?.details).toBe(holder);

    const bad = outcome(await appRpc(svc, 'desk_complete_customer', { p_customer_id: draft, p_phone: '12', p_actor_id: SEED_STAFF_IDS.court_desk }));
    expect(bad.errorMessage).toContain('INVALID_PHONE');
    const kitchen = outcome(await appRpc(svc, 'desk_complete_customer', { p_customer_id: draft, p_phone: `0771${tail()}`, p_actor_id: SEED_STAFF_IDS.prep }));
    expect(kitchen.errorMessage).toContain('FORBIDDEN');

    // An account that is not a draft: a walk-in with a number, a staff member, a phone account.
    for (const notDraft of [holder, SEED_STAFF_IDS.cashier]) {
      const res = outcome(await appRpc(svc, 'desk_complete_customer', { p_customer_id: notDraft, p_phone: `0771${tail()}`, p_actor_id: SEED_STAFF_IDS.court_desk }));
      expect(res.errorMessage).toContain('CUSTOMER_NOT_INCOMPLETE');
    }
    const client = outcome(
      await appRpc(await signedInClient(SEED_STAFF.court_desk), 'desk_complete_customer', { p_customer_id: draft, p_phone: `0771${tail()}`, p_actor_id: SEED_STAFF_IDS.court_desk }),
    );
    expect(client.errorMessage).toMatch(/permission denied/i);
  });

  // ── 5. the search ──────────────────────────────────────────────────────────

  it('the search lists a customer with a number before one saved by name alone', async () => {
    const word = `Zzorder${tail()}`;
    const draft = await nameOnly(`${word} Aaa`);
    const whole = await walkIn(`0772${tail()}`, SEED_STAFF_IDS.court_desk, `${word} Bbb`);
    const desk = await signedInClient(SEED_STAFF.court_desk);
    const { data, error } = await desk.schema('app').rpc('customer_search', { p_query: word, p_limit: 10 });
    expect(error).toBeNull();
    // By name alone the draft (Aaa) would come first.
    expect((data as { id: string }[]).map((r) => r.id)).toEqual([whole, draft]);
    const dir = await desk.schema('app').rpc('customer_directory', {});
    expect(dir.error).toBeNull();
    // The directory holds both; it hands its rows over by name and the screen
    // sorts them (customerDirectoryLogic), the server order only decides what
    // the 5,000 cap drops first.
    const ids = ((dir.data as { rows: { id: string }[] }).rows ?? []).map((r) => r.id);
    expect(ids).toContain(whole);
    expect(ids).toContain(draft);
  });

  // ── 6. the edge function ───────────────────────────────────────────────────

  describe.skipIf(!served)('desk-customer-create ifExists: return', () => {
    async function call(email: string, body: Record<string, unknown>) {
      const c = await signedInClient(email);
      const token = (await c.auth.getSession()).data.session?.access_token;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/desk-customer-create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      return { status: res.status, json: (await res.json()) as Record<string, unknown> };
    }

    it('makes the account from a name and a number, then hands the same one back', async () => {
      const national = `0775${tail()}`;
      const body = { fullName: 'Edge Walk In', phone: national, preferredLang: 'en', ifExists: 'return' };
      const first = await call(SEED_STAFF.court_desk, body);
      expect(first.status).toBe(201);
      const id = String(first.json.id);
      users.push(id);
      expect(first.json.customer).toMatchObject({ id, full_name: 'Edge Walk In', gender: null });

      // The cashier asks about the same person, typed another way and under a shorter name.
      const again = await call(SEED_STAFF.cashier, { ...body, fullName: 'Edge', phone: `+964${national.slice(1)}` });
      expect(again.status).toBe(200);
      expect(again.json).toMatchObject({ id, existing: true, claimed: false });
      expect(again.json.customer).toMatchObject({ full_name: 'Edge Walk In' });

      expect(await status(anon, national)).toBe('desk');
    });

    it('a cashier makes one too; the Customers form itself stays the court desk\'s', async () => {
      const national = `0776${tail()}`;
      const made = await call(SEED_STAFF.cashier, { fullName: 'Till Edge', phone: national, preferredLang: 'ar', ifExists: 'return' });
      expect(made.status).toBe(201);
      users.push(String(made.json.id));

      const form = await call(SEED_STAFF.cashier, { fullName: 'Till Edge', phone: `0777${tail()}`, preferredLang: 'ar', gender: 'male' });
      expect(form.status).toBe(403);
      // And without the flag a held number is still the form's 409.
      const dup = await call(SEED_STAFF.court_desk, { fullName: 'Till Edge', phone: national, preferredLang: 'ar', gender: 'male' });
      expect(dup.status).toBe(409);
      expect(dup.json.error).toBe('DUPLICATE_PHONE');
    });

    it('a name alone makes an incomplete customer; the number added later completes it', async () => {
      const made = await call(SEED_STAFF.cashier, { fullName: 'Edge Name Only', preferredLang: 'ar', ifExists: 'return' });
      expect(made.status).toBe(201);
      const id = String(made.json.id);
      users.push(id);
      expect(made.json).toMatchObject({ incomplete: true, customer: { id, full_name: 'Edge Name Only', phone: null } });
      const { data: user } = await svc.auth.admin.getUserById(id);
      expect(user.user?.email).toMatch(/^name-[0-9a-f-]+@guest\.touch\.local$/);

      // The Customers form still needs a number.
      const form = await call(SEED_STAFF.court_desk, { fullName: 'No Number', preferredLang: 'ar', gender: 'male' });
      expect(form.status).toBe(400);
      expect(form.json.error).toBe('INVALID_PHONE');

      // A number that already has its customer: refused, naming them.
      const rest = tail();
      const holder = await walkIn(`0773${rest}`, SEED_STAFF_IDS.court_desk, 'Edge Holder');
      const taken = await call(SEED_STAFF.court_desk, { customerId: id, phone: `+964773${rest}`, ifExists: 'return' });
      expect(taken.status).toBe(409);
      expect(taken.json).toMatchObject({ error: 'DUPLICATE_PHONE', id: holder, customer: { full_name: 'Edge Holder' } });

      const national = `0774${tail()}`;
      const done = await call(SEED_STAFF.court_desk, { customerId: id, phone: national, ifExists: 'return' });
      expect(done.status).toBe(200);
      expect(done.json).toMatchObject({ id, completed: true, customer: { phone: national } });
      expect(await status(anon, national)).toBe('desk');

      const twice = await call(SEED_STAFF.court_desk, { customerId: id, phone: `0774${tail()}`, ifExists: 'return' });
      expect(twice.status).toBe(409);
      expect(twice.json.error).toBe('CUSTOMER_NOT_INCOMPLETE');
    });

    it('the kitchen is refused, and a number that cannot be one is said', async () => {
      const refused = await call(SEED_STAFF.prep, { fullName: 'x', phone: `0778${tail()}`, preferredLang: 'en', ifExists: 'return' });
      expect(refused.status).toBe(403);
      const bad = await call(SEED_STAFF.court_desk, { fullName: 'x', phone: '12', preferredLang: 'en', ifExists: 'return' });
      expect(bad.status).toBe(400);
      expect(bad.json.error).toBe('INVALID_PHONE');
    });
  });
});
