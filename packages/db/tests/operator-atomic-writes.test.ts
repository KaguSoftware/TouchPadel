/**
 * 0050 — atomic writes for the operator admin screens.
 *
 * Two defects from docs/design/operator-audit-2026-08-28.md:
 *
 *   H3  Reorder re-sent the ENTIRE row rebuilt from the client's React Query
 *       cache, so pressing the up-arrow reverted a colleague's concurrent edit
 *       silently. The regression test for that is `does not disturb any other
 *       column` below — it is the whole point of the RPC.
 *   H4  The hero builder wrote settings one-at-a-time in a loop with no
 *       rollback, so a mid-loop failure left the guest hero half-configured.
 *
 * Runs against the live local stack; skips itself when the stack is down.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  anonymousSessionClient,
  appRpc,
  SEED_STAFF,
  createTestMenuItem,
  addModifierToItem,
  snapshotCafeSettings,
} from './helpers';

const up = await stackAvailable();

describe.skipIf(!up)('0050 operator atomic writes', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let restoreSettings: () => Promise<void>;

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    restoreSettings = await snapshotCafeSettings(svc, owner);
  });

  afterAll(async () => {
    await restoreSettings();
  });

  // -------------------------------------------------------------------------
  // reorder_menu_items
  // -------------------------------------------------------------------------
  describe('app.reorder_menu_items', () => {
    async function threeItems() {
      const a = await createTestMenuItem(svc, 'reorder-a', 1000);
      const b = await createTestMenuItem(svc, 'reorder-b', 1000);
      const c = await createTestMenuItem(svc, 'reorder-c', 1000);
      return [a.itemId, b.itemId, c.itemId];
    }

    async function sortOrders(ids: string[]): Promise<number[]> {
      const { data, error } = await svc
        .from('menu_items')
        .select('id, sort_order')
        .in('id', ids);
      if (error) throw new Error(error.message);
      const byId = new Map((data as { id: string; sort_order: number }[]).map((r) => [r.id, r.sort_order]));
      return ids.map((id) => byId.get(id) as number);
    }

    it('assigns sort_order by array position', async () => {
      const [a, b, c] = await threeItems();
      const res = await appRpc(manager, 'reorder_menu_items', { p_ids: [c, a, b] });
      expect(res.error).toBeNull();
      expect(res.data).toBe(3);
      expect(await sortOrders([c!, a!, b!])).toEqual([0, 1, 2]);
    });

    it('does not disturb any other column — THE regression test for H3', async () => {
      // The old client path rebuilt the whole row from its own cache, so a
      // reorder issued by a manager holding a stale copy silently reverted a
      // colleague's edit. This asserts a reorder is a move, not a rewrite.
      const [a, b, c] = await threeItems();

      // Someone else edits the item after this "client" last read it.
      const edited = {
        name_en: 'Renamed by a colleague',
        hook_en: 'fresh hook',
        hook_ar: 'خطاف جديد',
        highlight: 'blue',
        is_active: false,
      };
      const { error: uErr } = await svc.from('menu_items').update(edited).eq('id', a!);
      expect(uErr).toBeNull();

      const { data: before } = await svc.from('menu_items').select('*').eq('id', a!).single();

      const res = await appRpc(manager, 'reorder_menu_items', { p_ids: [b, c, a] });
      expect(res.error).toBeNull();

      const { data: after } = await svc.from('menu_items').select('*').eq('id', a!).single();
      const b0 = before as Record<string, unknown>;
      const a0 = after as Record<string, unknown>;

      expect(a0.sort_order).toBe(2);
      for (const key of Object.keys(b0)) {
        if (key === 'sort_order') continue;
        expect(a0[key], `column ${key} must not change on a reorder`).toEqual(b0[key]);
      }
    });

    it('is idempotent — reordering to the same order changes nothing', async () => {
      const [a, b, c] = await threeItems();
      await appRpc(manager, 'reorder_menu_items', { p_ids: [a, b, c] });
      const first = await sortOrders([a!, b!, c!]);
      const res = await appRpc(manager, 'reorder_menu_items', { p_ids: [a, b, c] });
      expect(res.error).toBeNull();
      expect(await sortOrders([a!, b!, c!])).toEqual(first);
    });

    it('refuses a duplicated id rather than reordering unpredictably', async () => {
      const [a, b] = await threeItems();
      const res = await appRpc(manager, 'reorder_menu_items', { p_ids: [a, b, a] });
      expect(res.error?.message).toBe('DUPLICATE_ID');
    });

    it('refuses the whole batch when one id does not exist', async () => {
      const [a, b] = await threeItems();
      const ghost = '00000000-0000-4000-8000-0000000000ff';
      const beforeOrder = await sortOrders([a!, b!]);
      const res = await appRpc(manager, 'reorder_menu_items', { p_ids: [b, ghost, a] });
      expect(res.error?.message).toBe('ITEM_NOT_FOUND');
      // All or nothing: a partially-applied reorder is worse than none.
      expect(await sortOrders([a!, b!])).toEqual(beforeOrder);
    });

    it('treats an empty array as a no-op, not an error', async () => {
      const res = await appRpc(manager, 'reorder_menu_items', { p_ids: [] });
      expect(res.error).toBeNull();
      expect(res.data).toBe(0);
    });

    it('is refused for a cashier and for an anonymous guest', async () => {
      const [a] = await threeItems();
      expect((await appRpc(cashier, 'reorder_menu_items', { p_ids: [a] })).error?.message).toBe(
        'FORBIDDEN',
      );
      const guest = await anonymousSessionClient();
      expect((await appRpc(guest, 'reorder_menu_items', { p_ids: [a] })).error?.message).toBe(
        'FORBIDDEN',
      );
    });

    it('writes exactly one audit row for the whole batch', async () => {
      const [a, b, c] = await threeItems();
      const { count: before } = await svc
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('action', 'menu.item.reorder');

      await appRpc(manager, 'reorder_menu_items', { p_ids: [c, b, a] });

      const { count: after } = await svc
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('action', 'menu.item.reorder');
      // One act by one actor — not three unrelated row updates.
      expect((after ?? 0) - (before ?? 0)).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // reorder_menu_categories
  // -------------------------------------------------------------------------
  describe('app.reorder_menu_categories', () => {
    it('assigns sort_order by array position and leaves names alone', async () => {
      const a = await createTestMenuItem(svc, 'cat-a', 1000);
      const b = await createTestMenuItem(svc, 'cat-b', 1000);
      const { data: beforeA } = await svc
        .from('menu_categories')
        .select('name_en, name_ar, is_active')
        .eq('id', a.categoryId)
        .single();

      const res = await appRpc(manager, 'reorder_menu_categories', {
        p_ids: [b.categoryId, a.categoryId],
      });
      expect(res.error).toBeNull();
      expect(res.data).toBe(2);

      const { data: rows } = await svc
        .from('menu_categories')
        .select('id, sort_order, name_en, name_ar, is_active')
        .in('id', [a.categoryId, b.categoryId]);
      const byId = new Map(
        (rows as { id: string; sort_order: number }[]).map((r) => [r.id, r]),
      );
      expect(byId.get(b.categoryId)?.sort_order).toBe(0);
      expect(byId.get(a.categoryId)?.sort_order).toBe(1);

      const afterA = byId.get(a.categoryId) as unknown as Record<string, unknown>;
      const b0 = beforeA as unknown as Record<string, unknown>;
      expect(afterA.name_en).toBe(b0.name_en);
      expect(afterA.name_ar).toBe(b0.name_ar);
      expect(afterA.is_active).toBe(b0.is_active);
    });

    it('refuses an unknown category id', async () => {
      const a = await createTestMenuItem(svc, 'cat-missing', 1000);
      const res = await appRpc(manager, 'reorder_menu_categories', {
        p_ids: [a.categoryId, '00000000-0000-4000-8000-0000000000fe'],
      });
      expect(res.error?.message).toBe('CATEGORY_NOT_FOUND');
    });

    it('is refused for a cashier', async () => {
      const a = await createTestMenuItem(svc, 'cat-forbidden', 1000);
      const res = await appRpc(cashier, 'reorder_menu_categories', { p_ids: [a.categoryId] });
      expect(res.error?.message).toBe('FORBIDDEN');
    });
  });

  // -------------------------------------------------------------------------
  // reorder_modifiers — the one that carries money
  // -------------------------------------------------------------------------
  describe('app.reorder_modifiers', () => {
    /** Three options in one group, so the ordering is a realistic single-group move. */
    async function threeOptions() {
      const item = await createTestMenuItem(svc, 'mods', 1000);
      const { groupId, modifierId: first } = await addModifierToItem(svc, item.itemId, 'حليب', 500);
      const { data, error } = await svc
        .from('modifiers')
        .insert([
          { group_id: groupId, name_en: 'Opt B', name_ar: 'ب', price_delta_iqd: 250, is_active: true },
          { group_id: groupId, name_en: 'Opt C', name_ar: 'ج', price_delta_iqd: 750, is_active: true },
        ])
        .select('id');
      if (error) throw new Error(error.message);
      const rest = (data as { id: string }[]).map((r) => r.id);
      return { groupId, ids: [first, ...rest] };
    }

    it('assigns sort_order by array position', async () => {
      const { ids } = await threeOptions();
      const res = await appRpc(manager, 'reorder_modifiers', { p_ids: [ids[2], ids[0], ids[1]] });
      expect(res.error).toBeNull();
      expect(res.data).toBe(3);

      const { data } = await svc
        .from('modifiers')
        .select('id, sort_order')
        .in('id', ids);
      const byId = new Map(
        (data as { id: string; sort_order: number }[]).map((r) => [r.id, r.sort_order]),
      );
      expect(byId.get(ids[2]!)).toBe(0);
      expect(byId.get(ids[0]!)).toBe(1);
      expect(byId.get(ids[1]!)).toBe(2);
    });

    it('does not touch price_delta_iqd — the sharpest edge of H3', async () => {
      // The old client re-sent the whole modifier row from its own cache, so
      // reordering options could silently revert a colleague's PRICE change.
      const { ids } = await threeOptions();
      const { error: uErr } = await svc.from('modifiers').update({ price_delta_iqd: 1234 }).eq('id', ids[0]!);
      expect(uErr).toBeNull();

      const res = await appRpc(manager, 'reorder_modifiers', { p_ids: [ids[1], ids[2], ids[0]] });
      expect(res.error).toBeNull();

      const { data } = await svc
        .from('modifiers')
        .select('price_delta_iqd, name_en, is_active, sort_order')
        .eq('id', ids[0]!)
        .single();
      const row = data as { price_delta_iqd: number; sort_order: number };
      expect(row.price_delta_iqd).toBe(1234);
      expect(row.sort_order).toBe(2);
    });

    it('refuses a duplicated id', async () => {
      const { ids } = await threeOptions();
      const res = await appRpc(manager, 'reorder_modifiers', { p_ids: [ids[0], ids[0]] });
      expect(res.error?.message).toBe('DUPLICATE_ID');
    });

    it('refuses the whole batch when one id does not exist', async () => {
      const { ids } = await threeOptions();
      const res = await appRpc(manager, 'reorder_modifiers', {
        p_ids: [ids[0], '00000000-0000-4000-8000-0000000000fd'],
      });
      expect(res.error?.message).toBe('MODIFIER_NOT_FOUND');
    });

    it('is refused for a cashier', async () => {
      const { ids } = await threeOptions();
      const res = await appRpc(cashier, 'reorder_modifiers', { p_ids: [ids[0]] });
      expect(res.error?.message).toBe('FORBIDDEN');
    });

    it('audits the group, once', async () => {
      const { groupId, ids } = await threeOptions();
      const { count: before } = await svc
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('action', 'menu.modifier.reorder')
        .eq('entity_id', groupId);

      await appRpc(manager, 'reorder_modifiers', { p_ids: [ids[1], ids[0], ids[2]] });

      const { count: after } = await svc
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('action', 'menu.modifier.reorder')
        .eq('entity_id', groupId);
      expect((after ?? 0) - (before ?? 0)).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // set_cafe_settings (batch)
  // -------------------------------------------------------------------------
  describe('app.set_cafe_settings', () => {
    async function readSetting(key: string): Promise<unknown> {
      const { data } = await svc.from('cafe_settings').select('value').eq('key', key).maybeSingle();
      return (data as { value: unknown } | null)?.value ?? null;
    }

    it('applies every key in one call', async () => {
      const res = await appRpc(owner, 'set_cafe_settings', {
        p_settings: { hero_mode: 'featured', bell_tutorial_enabled: true },
      });
      expect(res.error).toBeNull();
      expect(Array.isArray(res.data)).toBe(true);
      expect((res.data as unknown[]).length).toBe(2);
      expect(await readSetting('hero_mode')).toBe('featured');
      expect(await readSetting('bell_tutorial_enabled')).toBe(true);
    });

    it('applies NOTHING when one key in the batch is invalid — THE point of H4', async () => {
      // The hero builder used to loop `await setSetting(...)` with no rollback,
      // so a failure part-way left the guest hero half-configured: mode changed,
      // media not. One statement, one transaction, all or nothing.
      await appRpc(owner, 'set_cafe_settings', { p_settings: { hero_mode: 'none' } });
      expect(await readSetting('hero_mode')).toBe('none');

      const res = await appRpc(owner, 'set_cafe_settings', {
        p_settings: { hero_mode: 'featured', not_a_real_setting: 1 },
      });
      expect(res.error?.message).toBe('UNKNOWN_SETTING');
      expect(await readSetting('hero_mode')).toBe('none');
    });

    it('rolls back the whole batch when one value fails validation', async () => {
      await appRpc(owner, 'set_cafe_settings', { p_settings: { hero_mode: 'none' } });
      const res = await appRpc(owner, 'set_cafe_settings', {
        p_settings: { hero_mode: 'featured', bell_tutorial_enabled: 'not-a-boolean' },
      });
      expect(res.error).not.toBeNull();
      expect(await readSetting('hero_mode')).toBe('none');
    });

    it('treats an empty object as a no-op', async () => {
      const res = await appRpc(owner, 'set_cafe_settings', { p_settings: {} });
      expect(res.error).toBeNull();
      expect(res.data).toEqual([]);
    });

    it('refuses a non-object payload', async () => {
      const res = await appRpc(owner, 'set_cafe_settings', { p_settings: [1, 2] });
      expect(res.error?.message).toBe('INVALID_SETTINGS');
    });

    it('still enforces the per-key owner-only rule inside the batch', async () => {
      // Delegating to set_cafe_setting is what keeps this true — the batch
      // wrapper must not become a second, weaker authorization path.
      const res = await appRpc(manager, 'set_cafe_settings', {
        p_settings: { analytics_business_day_start_hour: 6 },
      });
      expect(res.error?.message).toBe('FORBIDDEN');
    });

    it('is refused for a cashier and for an anonymous guest', async () => {
      expect(
        (await appRpc(cashier, 'set_cafe_settings', { p_settings: { hero_mode: 'none' } })).error
          ?.message,
      ).toBe('FORBIDDEN');
      const guest = await anonymousSessionClient();
      expect(
        (await appRpc(guest, 'set_cafe_settings', { p_settings: { hero_mode: 'none' } })).error
          ?.message,
      ).toBe('FORBIDDEN');
    });

    it('writes one audit row per key, as the single-key RPC does', async () => {
      const { count: before } = await svc
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('action', 'settings.cafe');

      await appRpc(owner, 'set_cafe_settings', {
        p_settings: { hero_mode: 'media', bell_tutorial_enabled: false },
      });

      const { count: after } = await svc
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('action', 'settings.cafe');
      expect((after ?? 0) - (before ?? 0)).toBe(2);
    });
  });
});
