/**
 * staff_ingredient_options (build-contracts-2026-09-23 §2.5): the narrow
 * ingredient read for the release proposal's recipe lines, the shopping list
 * and the driver's purchase helper.
 *
 *   * the bar and kitchen family, the driver and MGMT read the venue's active
 *     ingredients as {id, name_en, name_ar, unit, kind, pack_size} and
 *     nothing else: no cost, no on-hand, no supplier;
 *   * marketing, the till, the desk, prep and guests are refused FORBIDDEN;
 *     anon holds no grant; a venue the caller does not work at is refused;
 *   * p_query matches either name, as text (a % or _ is not a wildcard).
 *
 * Self-contained: one auth user + staff row per new role through the service
 * role, and three probe ingredients at venue A with a pack cost and a stock
 * batch the answer must not show, all deleted in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  anonClient,
  anonymousSessionClient,
  appRpc,
  addStockBatch,
  SEED_STAFF,
  DEV_PASSWORD,
  VENUE_A_ID,
  VENUE_B_ID,
} from './helpers';

const up = await stackAvailable();

const ALLOWED = ['head_barista', 'barista', 'head_chef', 'chef', 'driver'] as const;
const NEW_ROLES = [...ALLOWED, 'marketing'] as const;
type NewRole = (typeof NEW_ROLES)[number];

interface Option { id: string; name_en: string; name_ar: string; unit: string; kind: string; pack_size: number | null }

describe.skipIf(!up)('staff_ingredient_options', () => {
  let svc: SupabaseClient;
  const ids = {} as Record<NewRole, string>;
  const as = {} as Record<NewRole, SupabaseClient>;
  const others: Record<string, SupabaseClient> = {};
  const stamp = `${Date.now()}`;
  const ing = { active: '', inactive: '', percent: '' };

  beforeAll(async () => {
    svc = serviceClient();
    for (const role of NEW_ROLES) {
      const email = `ingopts-${role}-${stamp}@test.touch.local`;
      const { data, error } = await svc.auth.admin.createUser({ email, password: DEV_PASSWORD, email_confirm: true });
      if (error || !data.user) throw new Error(`createUser ${role} failed: ${error?.message}`);
      ids[role] = data.user.id;
      const ins = await svc.from('staff').insert({ id: data.user.id, display_name: `Ingopts ${role}`, role, is_active: true });
      if (ins.error) throw new Error(`staff insert ${role} failed: ${ins.error.message}`);
      as[role] = await signedInClient(email);
    }
    others.owner = await signedInClient(SEED_STAFF.owner);
    others.manager = await signedInClient(SEED_STAFF.manager);
    others.cashier = await signedInClient(SEED_STAFF.cashier);
    others.prep = await signedInClient(SEED_STAFF.prep);
    others.desk = await signedInClient(SEED_STAFF.court_desk);
    others.guest = await anonymousSessionClient();

    const mk = async (nameEn: string, nameAr: string, active: boolean) => {
      const { data, error } = await svc.from('ingredients').insert({
        kind: 'purchased', name_en: nameEn, name_ar: nameAr, unit: 'g', is_active: active,
        venue_id: VENUE_A_ID, pack_size: 1000, pack_cost_iqd: 12_000, supplier_name: 'Probe supplier',
      }).select('id').single();
      if (error) throw new Error(`ingredient ${nameEn} failed: ${error.message}`);
      return (data as { id: string }).id;
    };
    ing.active = await mk(`Ingopts Rose ${stamp}`, `ورد ${stamp}`, true);
    ing.inactive = await mk(`Ingopts Retired ${stamp}`, `متقاعد ${stamp}`, false);
    ing.percent = await mk(`Ingopts 100% Cocoa ${stamp}`, `كاكاو ${stamp}`, true);
    await addStockBatch(svc, ing.active, 500, 11, 30);
  });

  afterAll(async () => {
    const all = Object.values(ing).filter(Boolean);
    await svc.from('stock_batches').delete().in('ingredient_id', all);
    const del = await svc.from('ingredients').delete().in('id', all);
    expect(del.error).toBeNull();
    for (const role of NEW_ROLES) {
      await as[role]?.auth.signOut();
      if (!ids[role]) continue;
      const r = await svc.from('staff').delete().eq('id', ids[role]);
      expect(r.error, `staff delete ${role}`).toBeNull();
      await svc.auth.admin.deleteUser(ids[role]).catch(() => undefined);
    }
    for (const c of Object.values(others)) await c?.auth.signOut();
  });

  async function options(c: SupabaseClient, args: Record<string, unknown>) {
    const { data, error } = await appRpc(c, 'staff_ingredient_options', args);
    return { rows: (data as { ingredients: Option[] } | null)?.ingredients ?? null, error };
  }

  it('the bar and kitchen family, the driver and MGMT read the active ingredients, names and units only', async () => {
    for (const c of [...ALLOWED.map((r) => as[r]), others.manager!, others.owner!]) {
      const { rows, error } = await options(c, { p_venue_id: VENUE_A_ID, p_query: stamp });
      expect(error).toBeNull();
      expect(rows!.map((r) => r.id).sort()).toEqual([ing.active, ing.percent].sort());
      const rose = rows!.find((r) => r.id === ing.active)!;
      expect(Object.keys(rose).sort()).toEqual(['id', 'kind', 'name_ar', 'name_en', 'pack_size', 'unit']);
      expect(rose).toMatchObject({ unit: 'g', kind: 'purchased', pack_size: 1000 });
    }
    // With no venue named, a single-venue caller's own venue answers.
    const { rows, error } = await options(as.driver, { p_query: `Rose ${stamp}` });
    expect(error).toBeNull();
    expect(rows!.map((r) => r.id)).toEqual([ing.active]);
  });

  it('marketing, the till, the desk, prep and guests are refused; anon holds no grant', async () => {
    for (const [who, c] of [['marketing', as.marketing], ['cashier', others.cashier], ['desk', others.desk],
                            ['prep', others.prep], ['guest', others.guest]] as const) {
      const { error } = await options(c!, { p_venue_id: VENUE_A_ID });
      expect(error?.message, who).toBe('FORBIDDEN');
    }
    const { error } = await appRpc(anonClient(), 'staff_ingredient_options', { p_venue_id: VENUE_A_ID });
    expect(error?.code).toBe('42501');
  });

  it('a venue the caller does not work at is refused', async () => {
    for (const c of [as.driver, as.head_chef, others.manager!]) {
      expect((await options(c, { p_venue_id: VENUE_B_ID })).error?.message).toBe('FORBIDDEN');
    }
  });

  it('p_query matches either name as text, never as a pattern', async () => {
    const byArabic = await options(as.head_barista, { p_venue_id: VENUE_A_ID, p_query: `ورد ${stamp}` });
    expect(byArabic.rows!.map((r) => r.id)).toEqual([ing.active]);
    const byPercent = await options(as.head_barista, { p_venue_id: VENUE_A_ID, p_query: `100% Cocoa ${stamp}` });
    expect(byPercent.rows!.map((r) => r.id)).toEqual([ing.percent]);
    // A bare % would match everything as a pattern; as text it matches only
    // names that contain one.
    const pct = await options(as.head_barista, { p_venue_id: VENUE_A_ID, p_query: '%' });
    expect(pct.rows!.every((r) => r.name_en.includes('%') || r.name_ar.includes('%'))).toBe(true);
    expect(pct.rows!.map((r) => r.id)).toContain(ing.percent);
    const blank = await options(as.head_barista, { p_venue_id: VENUE_A_ID, p_query: '   ' });
    expect(blank.rows!.length).toBeGreaterThan(0);
    expect(blank.rows!.length).toBeLessThanOrEqual(200);
    expect(blank.rows!.map((r) => r.id)).not.toContain(ing.inactive);
  });
});
