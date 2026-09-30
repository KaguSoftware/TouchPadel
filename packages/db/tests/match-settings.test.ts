/**
 * 0257 match_settings (docs/design/open-matches/db.md §4.3): the open-match
 * rules of a branch and of the chain, read by the manager and written by the
 * owner through PostgREST (so through safeupdate, as venue-settings.test.ts
 * explains), the guest-safe view, and app.match_terms_ok.
 *
 * Every write here is put back in afterAll: matches_enabled stays false on
 * every branch until the whole milestone is live (R10).
 */
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  anonClient,
  anonymousSessionClient,
  appRpc,
  serviceClient,
  signedInClient,
  stackAvailable,
  SEED_STAFF,
  VENUE_A_ID,
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
function dockerReachable(): boolean {
  try {
    return psql('select 1') === '1';
  } catch {
    return false;
  }
}
const docker = up && dockerReachable();

type Settings = {
  venue_id: string;
  matches_enabled: boolean;
  match_fill_deadline_minutes: number;
  earliest_start_minutes: number;
  match_ticket_price_iqd: number;
  max_filling_matches_per_guest: number;
  match_terms_version: string | null;
};

describe.skipIf(!up)('0257 open-match settings', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let desk: SupabaseClient;
  let cashier: SupabaseClient;

  const DEFAULTS = {
    matches_enabled: false,
    match_fill_deadline_minutes: 120,
    match_ticket_price_iqd: 10000,
    max_filling_matches_per_guest: 3,
  };

  const read = async (c: SupabaseClient) => {
    const res = await appRpc(c, 'match_settings', { p_venue_id: VENUE_A_ID });
    if (res.error) throw new Error(res.error.message);
    return res.data as Settings;
  };
  const write = (patch: unknown, c: SupabaseClient = owner) =>
    appRpc(c, 'set_match_settings', { p_patch: patch, p_venue_id: VENUE_A_ID });

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    desk = await signedInClient(SEED_STAFF.court_desk);
    cashier = await signedInClient(SEED_STAFF.cashier);
  });

  afterAll(async () => {
    if (!owner) return;
    await write(DEFAULTS);
  });

  it('ships every branch off with the defaults', async () => {
    const { data, error } = await svc.from('venue_settings').select('venue_id, matches_enabled, match_fill_deadline_minutes');
    expect(error).toBeNull();
    for (const row of data ?? []) expect(row).toMatchObject({ matches_enabled: false, match_fill_deadline_minutes: 120 });
    expect(await read(owner)).toEqual({
      venue_id: VENUE_A_ID,
      matches_enabled: false,
      match_fill_deadline_minutes: 120,
      earliest_start_minutes: 180,
      match_ticket_price_iqd: 10000,
      max_filling_matches_per_guest: 3,
      match_terms_version: null,
    });
  });

  it('lets the manager and the owner read, and nobody else', async () => {
    expect((await read(manager)).venue_id).toBe(VENUE_A_ID);
    for (const c of [desk, cashier, await anonymousSessionClient()]) {
      const res = await appRpc(c, 'match_settings', { p_venue_id: VENUE_A_ID });
      expect(res.error?.message).toBe('FORBIDDEN');
    }
    const anon = await appRpc(anonClient(), 'match_settings', { p_venue_id: VENUE_A_ID });
    expect(anon.error?.message ?? '').toMatch(/permission denied/i);
  });

  it('checks the role before it resolves the branch (R33)', async () => {
    // A guest with no branch at all is FORBIDDEN, never VENUE_REQUIRED.
    const guest = await anonymousSessionClient();
    expect((await appRpc(guest, 'match_settings', {})).error?.message).toBe('FORBIDDEN');
    expect((await appRpc(guest, 'set_match_settings', { p_patch: { matches_enabled: true } })).error?.message).toBe(
      'FORBIDDEN',
    );
  });

  it('lets only the owner write', async () => {
    for (const c of [manager, desk, cashier]) {
      const res = await write({ matches_enabled: true }, c);
      expect(res.error?.message).toBe('FORBIDDEN');
    }
    expect((await read(owner)).matches_enabled).toBe(false);
  });

  it.each([
    [null, 'p_patch'],
    [[], 'p_patch'],
    [{}, 'p_patch'],
    [{ matches_enabled: true, match_terms_version: '2026-10-01' }, 'match_terms_version'],
    [{ deposit_mode: 'off' }, 'deposit_mode'],
    [{ matches_enabled: 'true' }, 'matches_enabled'],
    [{ matches_enabled: 1 }, 'matches_enabled'],
    [{ match_fill_deadline_minutes: 59 }, 'match_fill_deadline_minutes'],
    [{ match_fill_deadline_minutes: 2881 }, 'match_fill_deadline_minutes'],
    [{ match_fill_deadline_minutes: 90.5 }, 'match_fill_deadline_minutes'],
    [{ match_ticket_price_iqd: 999 }, 'match_ticket_price_iqd'],
    [{ match_ticket_price_iqd: 1000250 }, 'match_ticket_price_iqd'],
    [{ match_ticket_price_iqd: 10100 }, 'match_ticket_price_iqd'],
    [{ max_filling_matches_per_guest: 0 }, 'max_filling_matches_per_guest'],
    [{ max_filling_matches_per_guest: 11 }, 'max_filling_matches_per_guest'],
  ])('refuses %j as INVALID_ARGUMENT naming %s', async (patch, detail) => {
    const res = await write(patch);
    expect(res.error?.message).toBe('INVALID_ARGUMENT');
    expect((res.error as { details?: string } | null)?.details).toBe(detail);
  });

  it('writes nothing unless the whole patch is valid', async () => {
    const res = await write({ matches_enabled: true, match_ticket_price_iqd: 10100 });
    expect(res.error?.message).toBe('INVALID_ARGUMENT');
    expect(await read(owner)).toMatchObject(DEFAULTS);
  });

  it('writes the branch keys to the branch and the chain keys to the chain, audited', async () => {
    const res = await write({
      matches_enabled: true,
      match_fill_deadline_minutes: 90,
      match_ticket_price_iqd: 12500,
      max_filling_matches_per_guest: 5,
    });
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({
      venue_id: VENUE_A_ID,
      matches_enabled: true,
      match_fill_deadline_minutes: 90,
      earliest_start_minutes: 150,
      match_ticket_price_iqd: 12500,
      max_filling_matches_per_guest: 5,
    });

    const { data: vs } = await svc
      .from('venue_settings')
      .select('matches_enabled, match_fill_deadline_minutes')
      .eq('venue_id', VENUE_A_ID)
      .single();
    expect(vs).toEqual({ matches_enabled: true, match_fill_deadline_minutes: 90 });
    const { data: ps } = await svc
      .from('platform_settings')
      .select('match_ticket_price_iqd, max_filling_matches_per_guest')
      .eq('id', true)
      .single();
    expect(ps).toEqual({ match_ticket_price_iqd: 12500, max_filling_matches_per_guest: 5 });

    const { data: audit } = await svc
      .from('audit_log')
      .select('action, entity, entity_id, before, after')
      .eq('action', 'venue.match_settings')
      .order('at', { ascending: false })
      .limit(1);
    expect(audit?.[0]).toMatchObject({
      entity: 'venue_settings',
      entity_id: VENUE_A_ID,
      before: { matches_enabled: false },
      after: { matches_enabled: true, match_ticket_price_iqd: 12500 },
    });

    // The guest-safe view carries the branch's two keys, never the chain's.
    const { data: pub } = await anonClient()
      .from('venue_settings_public')
      .select('venue_id, matches_enabled, match_fill_deadline_minutes')
      .eq('venue_id', VENUE_A_ID)
      .single();
    expect(pub).toEqual({ venue_id: VENUE_A_ID, matches_enabled: true, match_fill_deadline_minutes: 90 });
    const priced = await anonClient().from('venue_settings_public').select('match_ticket_price_iqd').limit(1);
    expect(priced.error).not.toBeNull();

    // A patch that changes nothing writes no second audit row.
    const again = await write({ matches_enabled: true });
    expect(again.error).toBeNull();
    const { count } = await svc
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'venue.match_settings')
      .eq('entity_id', VENUE_A_ID);
    const back = await write(DEFAULTS);
    expect(back.error).toBeNull();
    const { count: after } = await svc
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'venue.match_settings')
      .eq('entity_id', VENUE_A_ID);
    expect(after).toBe((count ?? 0) + 1);
    expect(await read(owner)).toMatchObject(DEFAULTS);
  });

  it('refuses out-of-range values at the table as well', async () => {
    const bad = await svc.from('venue_settings').update({ match_fill_deadline_minutes: 30 }).eq('venue_id', VENUE_A_ID);
    expect(bad.error?.message ?? '').toMatch(/venue_settings_match_rules/);
    const price = await svc.from('platform_settings').update({ match_ticket_price_iqd: 10001 }).eq('id', true);
    expect(price.error?.message ?? '').toMatch(/platform_settings_match_rules/);
    const terms = await svc.from('platform_settings').update({ match_terms_version: 'next week' }).eq('id', true);
    expect(terms.error?.message ?? '').toMatch(/platform_settings_match_rules/);
  });

  it.skipIf(!docker)('lets the owner’s assistant read the five columns and the view’s two (0109 allowlist)', () => {
    const rows = psql(`
      select string_agg(table_name || '.' || column_name || ':' || kind, ',' order by table_name, column_name)
        from app.assistant_readable_columns
       where column_name in ('matches_enabled', 'match_fill_deadline_minutes', 'match_ticket_price_iqd',
                             'max_filling_matches_per_guest', 'match_terms_version');`);
    expect(rows.split(',')).toEqual([
      'platform_settings.match_terms_version:table',
      'platform_settings.match_ticket_price_iqd:table',
      'platform_settings.max_filling_matches_per_guest:table',
      'venue_settings.match_fill_deadline_minutes:table',
      'venue_settings.matches_enabled:table',
      'venue_settings_public.match_fill_deadline_minutes:view',
      'venue_settings_public.matches_enabled:view',
    ]);
  });

  describe.skipIf(!docker)('app.match_terms_ok', () => {
    /** Each version against a required one, in a rolled-back transaction. */
    const ok = (required: string | null, versions: Array<string | null>): string =>
      psql(`
        begin;
        update platform_settings set match_terms_version = ${required === null ? 'null' : `'${required}'`} where id;
        select string_agg(coalesce(app.match_terms_ok(v)::text, 'null'), ',' order by n)
          from unnest(array[${versions.map((v) => (v === null ? 'null' : `'${v}'`)).join(', ')}]::text[])
               with ordinality as t(v, n);
        rollback;`)
        .split('\n')
        .pop()!;

    it('is false without an accepted version and true for any version while none is required', () => {
      expect(ok(null, [null, '2026-09-23', '2020-01-01.5'])).toBe('false,true,true');
    });

    it('compares (date, revision), so .10 ranks above .9', () => {
      expect(ok('2026-10-01.9', ['2026-10-01.10', '2026-10-01.9', '2026-10-01.8', '2026-10-01', '2026-10-02', '2026-09-30.99', null]))
        .toBe('true,true,false,false,true,false,false');
      expect(ok('2026-10-01', ['2026-10-01', '2026-10-01.1', '2026-09-30.5'])).toBe('true,true,false');
    });

    it('is not callable by a client', async () => {
      const res = await appRpc(owner, 'match_terms_ok', { p_version: '2026-10-01' });
      expect(res.error?.message ?? '').toMatch(/permission denied/i);
    });
  });
});
