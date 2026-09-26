/**
 * "Open a new branch" — migrations 0222–0223 (multi-venue slice 4, plan MV1).
 *
 * The owner creates a branch in 'preparing' by copying the setup of an existing
 * one (app.create_branch), the readiness checklist blocks "Open to guests"
 * (app.open_branch) until the branch has a manager and a till, and a branch is
 * closed, never deleted (app.close_branch).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BRANCH THIS FILE CREATES IS CLOSED IN afterAll.
 *
 * vitest runs this package singleFork against ONE shared database. A preparing
 * branch is invisible to guests and to app.resolve_venue's "only open venue"
 * step, so it disturbs nothing; the case that OPENS it closes it again in a
 * finally, because two open venues make every venue-less service_role insert in
 * other suites raise VENUE_REQUIRED (see multi-venue.test.ts).
 * manager_b is given a membership at the new branch for one case and put back
 * at venue A in the same finally.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  anonClient,
  serviceClient,
  signedInClient,
  appRpc,
  outcome,
  SEED_STAFF,
  SEED_STAFF_IDS,
  VENUE_A_ID,
} from './helpers';

const up = await stackAvailable();

type Created = { venue_id: string; slug: string; status: string; counts: Record<string, number> };
type Readiness = { key: string; required: boolean; ok: boolean }[];

describe.skipIf(!up)('open a new branch (0222-0223)', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let anon: SupabaseClient;
  let created: Created;
  const slug = `probe-${Date.now().toString(36)}`;

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    anon = anonClient();

    const res = await appRpc(owner, 'create_branch', {
      p_source_venue: VENUE_A_ID,
      p_slug: slug,
      p_name_en: 'Probe Branch',
      p_name_ar: 'فرع تجريبي',
      p_phone: '+964 770 000 0000',
      p_address_en: 'Probe Street 1',
      p_address_ar: 'شارع التجربة ١',
    });
    expect(res.error, res.error?.message).toBeNull();
    created = res.data as Created;
  });

  afterAll(async () => {
    if (created?.venue_id) {
      await svc.from('venues').update({ status: 'closed' }).eq('id', created.venue_id);
    }
    await svc.from('staff_venues').delete().eq('staff_id', SEED_STAFF_IDS.manager_b).neq('venue_id', VENUE_A_ID);
    await svc
      .from('staff_venues')
      .upsert({ staff_id: SEED_STAFF_IDS.manager_b, venue_id: VENUE_A_ID, role: 'manager' }, { onConflict: 'staff_id,venue_id' });
    await owner?.auth.signOut();
    await manager?.auth.signOut();
  });

  it('creates the branch in preparing, invisible to guests', async () => {
    expect(created.status).toBe('preparing');
    const { data: v } = await svc.from('venues').select('status, is_active, address_en').eq('id', created.venue_id).single();
    expect(v).toMatchObject({ status: 'preparing', is_active: false, address_en: 'Probe Street 1' });

    // Guests: no settings row, no venue row.
    const pub = await anon.from('venue_settings_public').select('venue_id').eq('venue_id', created.venue_id);
    expect(pub.data ?? []).toHaveLength(0);
    const ven = await anon.from('venues').select('id').eq('id', created.venue_id);
    expect(ven.data ?? []).toHaveLength(0);
    // Staff see it (the owner's switcher lists a preparing branch).
    const staffView = await owner.from('venues').select('id').eq('id', created.venue_id);
    expect(staffView.data ?? []).toHaveLength(1);
  });

  it('copies the setup, with every reference remapped, and nothing else', async () => {
    const count = async (table: string, venue: string, activeOnly = false) => {
      let q = svc.from(table).select('id', { count: 'exact', head: true }).eq('venue_id', venue);
      if (activeOnly) q = q.eq('is_active', true);
      return (await q).count ?? 0;
    };
    // Active courts and tables, every menu item and category, every ingredient.
    expect(await count('courts', created.venue_id)).toBe(await count('courts', VENUE_A_ID, true));
    expect(await count('cafe_tables', created.venue_id)).toBe(await count('cafe_tables', VENUE_A_ID, true));
    expect(await count('menu_items', created.venue_id)).toBe(await count('menu_items', VENUE_A_ID));
    expect(await count('menu_categories', created.venue_id)).toBe(await count('menu_categories', VENUE_A_ID));
    expect(await count('ingredients', created.venue_id)).toBe(await count('ingredients', VENUE_A_ID));
    expect(created.counts.menu_items).toBeGreaterThan(0);

    // Every copied item points at a copied category, never at the source's.
    const { data: items } = await svc.from('menu_items').select('id, category_id, is_active, launched_at, release_run_id, sold_out').eq('venue_id', created.venue_id);
    const { data: cats } = await svc.from('menu_categories').select('id').eq('venue_id', created.venue_id);
    const catIds = new Set((cats ?? []).map((c) => (c as { id: string }).id));
    for (const i of (items ?? []) as { category_id: string; is_active: boolean; launched_at: string | null; release_run_id: string | null; sold_out: boolean }[]) {
      expect(catIds.has(i.category_id)).toBe(true);
      expect(i.release_run_id).toBeNull();
      expect(i.sold_out).toBe(false);
      if (i.is_active) expect(i.launched_at).not.toBeNull();
    }

    // Recipe lines of the copy use only the copy's ingredients.
    const { data: ing } = await svc.from('ingredients').select('id').eq('venue_id', created.venue_id);
    const ingIds = (ing ?? []).map((r) => (r as { id: string }).id);
    if (ingIds.length > 0) {
      const { data: lines } = await svc.from('recipe_lines').select('ingredient_id').in('ingredient_id', ingIds);
      expect((lines ?? []).length).toBe(created.counts.recipe_lines ?? 0);
    }

    // Settings row with the new identity; no Telegram group; the featured item
    // (if any) points at the copy.
    const { data: vs } = await svc.from('venue_settings').select('venue_name, phone').eq('venue_id', created.venue_id).single();
    expect(vs).toMatchObject({ venue_name: 'Probe Branch', phone: '+964 770 000 0000' });
    const { data: cs } = await svc.from('cafe_settings').select('key, value').eq('venue_id', created.venue_id);
    const keys = (cs ?? []).map((r) => (r as { key: string }).key);
    expect(keys.some((k) => k.startsWith('telegram_'))).toBe(false);
    const feat = (cs ?? []).find((r) => (r as { key: string }).key === 'featured_item_id') as { value: unknown } | undefined;
    if (feat && typeof feat.value === 'string') {
      expect((items ?? []).some((i) => (i as { id: string }).id === feat.value)).toBe(true);
    }

    // Never copied: promotions, stations, stock, days.
    expect(await count('promotions', created.venue_id)).toBe(0);
    expect(await count('stations', created.venue_id)).toBe(0);
    expect(await count('stock_batches', created.venue_id)).toBe(0);
    expect(await count('day_sessions', created.venue_id)).toBe(0);

    // One audit row.
    const { data: audit } = await svc.from('audit_log').select('action').eq('entity_id', created.venue_id).eq('action', 'venue.create');
    expect(audit ?? []).toHaveLength(1);
  });

  it('is the owner\'s: a manager is refused, a slug is unique', async () => {
    const byManager = await appRpc(manager, 'create_branch', {
      p_source_venue: VENUE_A_ID, p_slug: `${slug}-m`, p_name_en: 'Nope', p_name_ar: 'لا',
    }).then(outcome);
    expect(byManager.ok).toBe(false);
    expect(byManager.errorMessage).toBe('FORBIDDEN');

    const again = await appRpc(owner, 'create_branch', {
      p_source_venue: VENUE_A_ID, p_slug: slug, p_name_en: 'Twice', p_name_ar: 'مرتين',
    }).then(outcome);
    expect(again.errorMessage).toBe('SLUG_TAKEN');
  });

  it('shares the source\'s photos, and the operator is told not to delete a shared one', async () => {
    const { data: withPhoto } = await svc
      .from('menu_items')
      .select('photo_path')
      .eq('venue_id', created.venue_id)
      .not('photo_path', 'is', null)
      .limit(1);
    const path = (withPhoto ?? [])[0] as { photo_path: string } | undefined;
    if (!path) return; // a fixture without photos: nothing to share
    const inUse = await appRpc(owner, 'storage_path_in_use', { p_path: path.photo_path }).then(outcome);
    expect(inUse.data).toBe(true);
  });

  it('refuses to open until it is ready, then opens and closes; the last open branch stays open', async () => {
    const readiness = (await appRpc(owner, 'branch_readiness', { p_venue: created.venue_id })).data as Readiness;
    const byKey = Object.fromEntries(readiness.map((r) => [r.key, r]));
    expect(byKey.manager).toMatchObject({ required: true, ok: false });
    expect(byKey.till).toMatchObject({ required: true, ok: false });
    expect(byKey.courts_and_rates?.required).toBe(true);
    expect(byKey.opening_hours).toMatchObject({ required: true, ok: true });

    const early = await appRpc(owner, 'open_branch', { p_venue: created.venue_id });
    expect(early.error?.message).toBe('BRANCH_NOT_READY');
    expect(early.error?.details).toContain('manager');
    expect(early.error?.details).toContain('till');

    try {
      const staffed = await appRpc(owner, 'set_staff_venues', {
        p_staff_id: SEED_STAFF_IDS.manager_b, p_venue_ids: [created.venue_id],
      });
      expect(staffed.error, staffed.error?.message).toBeNull();
      const till = await appRpc(owner, 'register_station', {
        p_id: `TILL-${slug.toUpperCase().slice(-6)}`, p_venue_id: created.venue_id, p_mode: 'till',
      });
      expect(till.error, till.error?.message).toBeNull();

      const again = (await appRpc(owner, 'branch_readiness', { p_venue: created.venue_id })).data as Readiness;
      const missing = again.filter((r) => r.required && !r.ok).map((r) => r.key);
      // courts_and_rates depends on the fixtures carrying a rate at venue A.
      if (missing.length === 0) {
        const opened = await appRpc(owner, 'open_branch', { p_venue: created.venue_id });
        expect(opened.error, opened.error?.message).toBeNull();
        const { data: v } = await svc.from('venues').select('status, is_active').eq('id', created.venue_id).single();
        expect(v).toMatchObject({ status: 'open', is_active: true });
        // Guests see it now.
        const pub = await anon.from('venue_settings_public').select('venue_id').eq('venue_id', created.venue_id);
        expect(pub.data ?? []).toHaveLength(1);
      } else {
        expect(missing).toEqual(['courts_and_rates']);
      }
    } finally {
      const closed = await appRpc(owner, 'close_branch', { p_venue: created.venue_id });
      expect(closed.error, closed.error?.message).toBeNull();
      await appRpc(owner, 'set_staff_venues', { p_staff_id: SEED_STAFF_IDS.manager_b, p_venue_ids: [VENUE_A_ID] });
    }

    // With the new branch closed, venue A is the only open branch.
    const last = await appRpc(owner, 'close_branch', { p_venue: VENUE_A_ID });
    expect(last.error?.message).toBe('LAST_OPEN_BRANCH');
  });
});
