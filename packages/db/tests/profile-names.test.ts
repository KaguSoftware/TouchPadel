/**
 * 0256 profile_names_gender (docs/design/open-matches/guest.md §4.5, db.md §4.2).
 *
 *   - app.split_person_name: the compound prefixes, one word, the 39 clamp, blank;
 *   - profiles_sync_names: every rule of the trigger table, and an UPDATE that
 *     lists full_name without changing it;
 *   - handle_new_user: full metadata, a given name alone, none (phone OTP),
 *     and an anonymous café session;
 *   - the backfill (the migration's own statement, replayed in a rolled-back
 *     transaction) keeps full_name byte-identical;
 *   - the grants: a guest writes the two parts, never gender, and reads its own
 *     five columns;
 *   - app.set_my_gender: each refusal in order, the same answer twice,
 *     GENDER_ALREADY_SET, and an audit row without the value;
 *   - account deletion empties the five columns.
 *
 * Needs the local stack; the psql cases also need docker on PATH (psql in the
 * stack's container, as rpc-overloads.test.ts does).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  anonClient,
  anonymousSessionClient,
  appRpc,
  serviceClient,
  shapedGuest,
  stackAvailable,
} from './helpers';

const up = await stackAvailable();
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
}
/** The error text a failing psql script printed, or '' when it succeeded. */
function psqlError(sql: string): string {
  try {
    psql(sql);
    return '';
  } catch (e) {
    return String((e as { stderr?: string }).stderr ?? e);
  }
}
function dockerReachable(): boolean {
  try {
    return psql('select 1') === '1';
  } catch {
    return false;
  }
}
const docker = up && dockerReachable();

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(
  resolve(here, '../supabase/migrations/20260929000256_profile_names_gender.sql'),
  'utf8',
);
/** The migration's backfill block, verbatim. */
const BACKFILL = (() => {
  const start = MIGRATION.indexOf('do $backfill_names_0256$');
  const endTag = 'end $backfill_names_0256$;';
  const end = MIGRATION.indexOf(endTag, start);
  if (start < 0 || end < 0) throw new Error('backfill block not found in 0256');
  return MIGRATION.slice(start, end + endTag.length);
})();

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
/** A SQL string literal. */
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

type Names = {
  full_name: string;
  given_name: string | null;
  family_name: string | null;
  gender: string | null;
  gender_set_at: string | null;
  gender_set_by: string | null;
};

describe.skipIf(!up)('0256 profile names and gender', () => {
  let svc: SupabaseClient;

  const names = async (id: string): Promise<Names> => {
    const { data, error } = await svc
      .from('profiles')
      .select('full_name, given_name, family_name, gender, gender_set_at, gender_set_by')
      .eq('id', id)
      .single();
    if (error) throw new Error(`profiles read: ${error.message}`);
    return data as Names;
  };
  const guestWith = (meta: Record<string, unknown>) =>
    shapedGuest(svc, 'names', { email: `names-${uniq()}@test.touch.local`, user_metadata: meta });
  const update = async (id: string, patch: Record<string, unknown>) => {
    const { error } = await svc.from('profiles').update(patch).eq('id', id);
    if (error) throw new Error(`profiles update: ${error.message}`);
    return names(id);
  };

  beforeAll(() => {
    svc = serviceClient();
  });

  describe.skipIf(!docker)('app.split_person_name', () => {
    const split = (name: string | null): [string | null, string | null] => {
      const out = psql(
        `select coalesce(p[1], '<null>') || '|' || coalesce(p[2], '<null>') ` +
          `from (select app.split_person_name(${name === null ? 'null' : lit(name)}) as p) s;`,
      );
      const [g, f] = out.split('|');
      return [g === '<null>' ? null : g!, f === '<null>' ? null : f!];
    };

    it.each([
      ['عبد الله الربيعي', 'عبد الله', 'الربيعي'],
      ['أبو بكر علي حسن', 'أبو بكر', 'علي حسن'],
      ['إبو محمد', 'إبو محمد', null],
      ['Abd al Rahman Kareem', 'Abd al Rahman', 'Kareem'],
      ['Abdul Kareem', 'Abdul Kareem', null],
      ['abu Ali Hassan', 'abu Ali', 'Hassan'],
      ['Abd', 'Abd', null],
      ['Ahmed', 'Ahmed', null],
      ['Ahmed Kareem Ali', 'Ahmed', 'Kareem Ali'],
      ['  Sara   Ali  ', 'Sara', 'Ali'],
    ])('%s', (name, given, family) => {
      expect(split(name)).toEqual([given, family]);
    });

    it('clamps each part to 39 characters, so an 80-character name fits the CHECKs', () => {
      const long = `${'G'.repeat(45)} ${'F'.repeat(34)}`;
      expect(long).toHaveLength(80);
      const [g, f] = split(long);
      expect(g).toBe('G'.repeat(39));
      expect(f).toBe('F'.repeat(34));
      // The 39th character of the family part is a space: the clamp trims it.
      const [g2, f2] = split(`Ali ${'B'.repeat(38)} ${'C'.repeat(5)}`);
      expect(g2).toBe('Ali');
      expect(f2).toBe('B'.repeat(38));
    });

    it('gives {NULL, NULL} for empty, blank and NULL', () => {
      expect(split('')).toEqual([null, null]);
      expect(split('   ')).toEqual([null, null]);
      expect(split(null)).toEqual([null, null]);
    });

    it('is not callable by a client', async () => {
      const { data } = await shapedGuestPair();
      const res = await appRpc(data, 'split_person_name', { p: 'Ahmed Kareem' });
      expect(res.error?.message ?? '').toMatch(/permission denied|Could not find/i);
    });
  });

  /** A signed-in guest with a whole name and no parts in the metadata. */
  async function shapedGuestPair(fullName = 'Plain Guest') {
    const g = await guestWith({ full_name: fullName, phone: '+9647700000055' });
    return { id: g.id, data: g.client };
  }

  describe('handle_new_user', () => {
    it('stores the metadata parts when they rebuild the name exactly', async () => {
      // The split would give {"Abu Bakr", "Ali"}: the metadata wins.
      const g = await guestWith({ full_name: 'Abu Bakr Ali', given_name: 'Abu', family_name: 'Bakr Ali' });
      expect(await names(g.id)).toMatchObject({ full_name: 'Abu Bakr Ali', given_name: 'Abu', family_name: 'Bakr Ali' });
    });

    it('ignores a given name that does not rebuild the name, and never cuts full_name short', async () => {
      const g = await guestWith({ full_name: 'Sara Hassan', given_name: 'Sara' });
      expect(await names(g.id)).toMatchObject({ full_name: 'Sara Hassan', given_name: 'Sara', family_name: 'Hassan' });
    });

    it('splits the name when the metadata has no parts (Google)', async () => {
      const g = await guestWith({ full_name: 'Google User', name: 'Google User' });
      expect(await names(g.id)).toMatchObject({ full_name: 'Google User', given_name: 'Google', family_name: 'User' });
    });

    it('leaves both parts NULL on a phone sign-up with no metadata', async () => {
      const phone = `9647${String(Date.now()).slice(-9)}`;
      const { data, error } = await svc.auth.admin.createUser({ phone, phone_confirm: true });
      if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
      expect(await names(data.user.id)).toMatchObject({ full_name: '', given_name: null, family_name: null, gender: null });
    });

    it('creates no profile for an anonymous café session', async () => {
      const anon = await anonymousSessionClient();
      const uid = (await anon.auth.getUser()).data.user!.id;
      const { data } = await svc.from('profiles').select('id').eq('id', uid);
      expect(data ?? []).toEqual([]);
    });
  });

  describe('profiles_sync_names', () => {
    it('rule 6: a full_name written alone is split again', async () => {
      const { id } = await shapedGuestPair('First Name');
      expect(await update(id, { full_name: 'Abd al Rahman Kareem' })).toMatchObject({
        full_name: 'Abd al Rahman Kareem',
        given_name: 'Abd al Rahman',
        family_name: 'Kareem',
      });
      expect(await update(id, { full_name: 'Mona' })).toMatchObject({ given_name: 'Mona', family_name: null });
    });

    it('rule 5: a changed part rebuilds full_name, and the parts win over a full_name in the same UPDATE', async () => {
      const { id } = await shapedGuestPair('Old Name');
      expect(await update(id, { given_name: 'Zainab', family_name: 'Al-Rubaie' })).toMatchObject({
        full_name: 'Zainab Al-Rubaie',
        given_name: 'Zainab',
        family_name: 'Al-Rubaie',
      });
      expect(await update(id, { family_name: 'Hussein' })).toMatchObject({ full_name: 'Zainab Hussein' });
      expect(await update(id, { full_name: 'Ignored Whole', given_name: 'Noor' })).toMatchObject({
        full_name: 'Noor Hussein',
        given_name: 'Noor',
        family_name: 'Hussein',
      });
    });

    it('rule 3: an empty part is NULL', async () => {
      const { id } = await shapedGuestPair('Layla Karim');
      expect(await update(id, { family_name: '' })).toMatchObject({
        full_name: 'Layla',
        given_name: 'Layla',
        family_name: null,
      });
      // The sanitiser runs first: a part of spaces only is '' and then NULL.
      expect(await update(id, { family_name: '   ' })).toMatchObject({ family_name: null, full_name: 'Layla' });
    });

    it('cleans the parts as it cleans full_name (0080)', async () => {
      const { id } = await shapedGuestPair('Clean Me');
      expect(await update(id, { given_name: '  Ra‮na  ', family_name: 'Ali​  Ahmed' })).toMatchObject({
        given_name: 'Rana',
        family_name: 'Ali Ahmed',
        full_name: 'Rana Ali Ahmed',
      });
    });

    it('matches no rule when an UPDATE lists full_name without changing it', async () => {
      const { id } = await shapedGuestPair('Anything Else');
      // Parts the split would not produce ({"Abd Kareem", "Ali"}), then the same full_name again.
      await update(id, { given_name: 'Abd', family_name: 'Kareem Ali' });
      expect(await update(id, { full_name: 'Abd Kareem Ali' })).toMatchObject({
        full_name: 'Abd Kareem Ali',
        given_name: 'Abd',
        family_name: 'Kareem Ali',
      });
    });

    it('refuses a family name without a given name, and a part over 39 characters', async () => {
      const { id } = await shapedGuestPair('Hadi Salim');
      const orphan = await svc.from('profiles').update({ given_name: null, family_name: 'Salim' }).eq('id', id);
      expect(orphan.error?.message ?? '').toMatch(/profiles_name_parts/);
      const long = await svc.from('profiles').update({ given_name: 'G'.repeat(40) }).eq('id', id);
      expect(long.error?.message ?? '').toMatch(/profiles_given_name_len/);
      expect(await names(id)).toMatchObject({ full_name: 'Hadi Salim', given_name: 'Hadi', family_name: 'Salim' });
    });

    it.skipIf(!docker)('rule 2: nothing while app.skip_name_sync is on', async () => {
      const { id } = await shapedGuestPair('Skip Me');
      const out = psql(`
        begin;
        select set_config('app.skip_name_sync', 'on', true);
        update profiles set full_name = 'Changed Whole' where id = ${lit(id)};
        select full_name || '|' || coalesce(given_name, '') || '|' || coalesce(family_name, '')
          from profiles where id = ${lit(id)};
        rollback;`);
      expect(out.split('\n').pop()).toBe('Changed Whole|Skip|Me');
    });

    it('rule 1: a tombstone loses the five columns', async () => {
      const { id } = await shapedGuestPair('Tomb Stone');
      await update(id, { gender: 'male', gender_set_at: new Date().toISOString(), gender_set_by: 'staff' });
      expect(await update(id, { full_name: 'Deleted account', deleted_at: new Date().toISOString() })).toEqual({
        full_name: 'Deleted account',
        given_name: null,
        family_name: null,
        gender: null,
        gender_set_at: null,
        gender_set_by: null,
      });
    });
  });

  describe.skipIf(!docker)('the backfill', () => {
    /** Clear a profile's parts without the trigger, run the migration's block, read back. */
    const replay = (id: string): string =>
      psql(`
        begin;
        select set_config('app.skip_name_sync', 'on', true);
        update profiles set given_name = null, family_name = null where id = ${lit(id)};
        select set_config('app.skip_name_sync', '', true);
        ${BACKFILL}
        select full_name || '|' || coalesce(given_name, '<null>') || '|' || coalesce(family_name, '<null>')
          from profiles where id = ${lit(id)};
        rollback;`)
        .split('\n')
        .pop()!;

    it('fills the parts and keeps full_name byte-identical, a clamped part included', async () => {
      const whole = `Ali ${'B'.repeat(45)}`;
      const { id } = await shapedGuestPair(whole);
      const before = (await names(id)).full_name;
      expect(before).toBe(whole);
      expect(replay(id)).toBe(`${whole}|Ali|${'B'.repeat(39)}`);
    });

    it('takes the sign-up metadata parts when they rebuild the name, else the split', async () => {
      const meta = await guestWith({ full_name: 'Abu Bakr Ali', given_name: 'Abu', family_name: 'Bakr Ali' });
      expect(replay(meta.id)).toBe('Abu Bakr Ali|Abu|Bakr Ali');
      const plain = await guestWith({ full_name: 'Abu Bakr Ali' });
      expect(replay(plain.id)).toBe('Abu Bakr Ali|Abu Bakr|Ali');
    });

    it('leaves a tombstone alone', async () => {
      const { id } = await shapedGuestPair('Gone Soon');
      await update(id, { full_name: 'Deleted account', deleted_at: new Date().toISOString() });
      expect(replay(id)).toBe('Deleted account|<null>|<null>');
    });
  });

  describe('grants', () => {
    it('lets a guest write its own name parts and read its five columns', async () => {
      const g = await shapedGuestPair('Guest Writer');
      const { error } = await g.data.from('profiles').update({ given_name: 'Huda', family_name: 'Jaber' }).eq('id', g.id);
      expect(error).toBeNull();
      const read = await g.data
        .from('profiles')
        .select('full_name, given_name, family_name, gender, gender_set_at, gender_set_by')
        .eq('id', g.id)
        .single();
      expect(read.error).toBeNull();
      expect(read.data).toEqual({
        full_name: 'Huda Jaber',
        given_name: 'Huda',
        family_name: 'Jaber',
        gender: null,
        gender_set_at: null,
        gender_set_by: null,
      });
    });

    it('never lets a guest write gender directly', async () => {
      const g = await shapedGuestPair('Guest Gender');
      for (const patch of [
        { gender: 'female' },
        { gender_set_at: new Date().toISOString() },
        { gender_set_by: 'guest' },
      ]) {
        const { error } = await g.data.from('profiles').update(patch).eq('id', g.id);
        expect(error?.message ?? '', JSON.stringify(patch)).toMatch(/permission denied/i);
      }
      expect((await names(g.id)).gender).toBeNull();
    });
  });

  describe('app.set_my_gender', () => {
    it.skipIf(!docker)('AUTH_REQUIRED without a session', () => {
      const err = psqlError(`
        begin;
        set local role authenticated;
        select app.set_my_gender('female');
        rollback;`);
      expect(err).toMatch(/AUTH_REQUIRED/);
    });

    it('is not granted to anon', async () => {
      const res = await appRpc(anonClient(), 'set_my_gender', { p_gender: 'female' });
      expect(res.error?.message ?? '').toMatch(/permission denied/i);
    });

    it('ACCOUNT_REQUIRED for an anonymous café session, before the value is judged', async () => {
      const anon = await anonymousSessionClient();
      for (const p_gender of ['female', 'x']) {
        const res = await appRpc(anon, 'set_my_gender', { p_gender });
        expect(res.error?.message).toBe('ACCOUNT_REQUIRED');
      }
    });

    it('ACCOUNT_REQUIRED for a deleted account', async () => {
      const g = await shapedGuestPair('Deleted Gender');
      const del = await appRpc(g.data, 'delete_my_account', { p_confirm: 'DELETE' });
      expect(del.error).toBeNull();
      // The tombstone profile stays; the old session still reaches the RPC.
      const res = await appRpc(g.data, 'set_my_gender', { p_gender: 'male' });
      expect(res.error?.message).toBe('ACCOUNT_REQUIRED');
    });

    it('INVALID_ARGUMENT naming p_gender for anything but female or male', async () => {
      const g = await shapedGuestPair('Bad Value');
      for (const p_gender of ['x', 'FEMALE', '', null]) {
        const res = await appRpc(g.data, 'set_my_gender', { p_gender });
        expect(res.error?.message, String(p_gender)).toBe('INVALID_ARGUMENT');
        expect((res.error as { details?: string } | null)?.details).toBe('p_gender');
      }
      expect((await names(g.id)).gender).toBeNull();
    });

    it('stamps all three columns once, answers the same value as a duplicate, refuses another', async () => {
      const g = await shapedGuestPair('Once Only');
      const first = await appRpc(g.data, 'set_my_gender', { p_gender: 'female' });
      expect(first.error).toBeNull();
      const out = first.data as { gender: string; gender_set_at: string; duplicate: boolean };
      expect(out).toMatchObject({ gender: 'female', duplicate: false });
      expect(Date.parse(out.gender_set_at)).not.toBeNaN();
      const row = await names(g.id);
      expect(row).toMatchObject({ gender: 'female', gender_set_by: 'guest' });
      expect(Date.parse(row.gender_set_at!)).toBe(Date.parse(out.gender_set_at));

      const again = await appRpc(g.data, 'set_my_gender', { p_gender: 'female' });
      expect(again.error).toBeNull();
      expect(again.data).toMatchObject({ gender: 'female', duplicate: true });
      expect(Date.parse((again.data as { gender_set_at: string }).gender_set_at)).toBe(Date.parse(out.gender_set_at));

      const other = await appRpc(g.data, 'set_my_gender', { p_gender: 'male' });
      expect(other.error?.message).toBe('GENDER_ALREADY_SET');
      expect((await names(g.id)).gender).toBe('female');
    });

    it('audits the first set without the value', async () => {
      const g = await shapedGuestPair('Audit Gender');
      await appRpc(g.data, 'set_my_gender', { p_gender: 'male' });
      const { data } = await svc
        .from('audit_log')
        .select('action, entity, entity_id, before, after')
        .eq('action', 'profile.gender_set')
        .eq('entity_id', g.id);
      expect(data).toHaveLength(1);
      expect(data![0]).toMatchObject({ entity: 'profiles', before: null, after: { gender_set_by: 'guest' } });
      expect(JSON.stringify(data![0])).not.toMatch(/male/);
    });
  });

  it('account deletion empties the five columns', async () => {
    const g = await shapedGuestPair('Delete Me Please');
    const set = await appRpc(g.data, 'set_my_gender', { p_gender: 'female' });
    expect(set.error).toBeNull();
    expect(await names(g.id)).toMatchObject({ given_name: 'Delete', family_name: 'Me Please', gender: 'female' });
    const del = await appRpc(g.data, 'delete_my_account', { p_confirm: 'DELETE' });
    expect(del.error).toBeNull();
    expect(await names(g.id)).toEqual({
      full_name: 'Deleted account',
      given_name: null,
      family_name: null,
      gender: null,
      gender_set_at: null,
      gender_set_by: null,
    });
  });
});
