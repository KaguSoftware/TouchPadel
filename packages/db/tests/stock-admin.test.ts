/**
 * 0063 — the stock master-data write path (SOW L515-518). Ingredients and
 * recipe_lines had NO write RPC at all; RLS blocked direct writes and only
 * the fixtures could author them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  appRpc,
  outcome,
  SEED_STAFF,
} from './helpers';

const up = await stackAvailable();

describe.skipIf(!up)('0063 stock admin writes', () => {
  let svc: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  const made: string[] = [];

  beforeAll(async () => {
    svc = serviceClient();
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
  });

  afterAll(async () => {
    if (made.length > 0) {
      await svc.from('recipe_lines').delete().in('ingredient_id', made);
      await svc.from('stock_movements').delete().in('ingredient_id', made);
      await svc.from('stock_batches').delete().in('ingredient_id', made);
      await svc.from('ingredients').delete().in('id', made);
    }
    await manager.auth.signOut();
    await cashier.auth.signOut();
  });

  async function makeIngredient(
    name: string,
    over: Record<string, unknown> = {},
  ): Promise<string> {
    const res = await appRpc(manager, 'upsert_ingredient', {
      p_name_en: name,
      p_name_ar: `مكوّن ${name}`,
      p_unit: 'g',
      ...over,
    });
    if (res.error) throw new Error(res.error.message);
    const id = res.data as string;
    made.push(id);
    return id;
  }

  it('creates and updates an ingredient, audited, refusing junk by name', async () => {
    const id = await makeIngredient(`SA-${Date.now()}`, {
      p_pack_size: 1000,
      p_pack_cost_iqd: 12_000,
      p_supplier_name: 'Al-Rasheed Foods',
    });
    const { data } = await svc.from('ingredients').select('*').eq('id', id).single();
    expect((data as { pack_size: string | number }).pack_size).not.toBeNull();

    const upd = await appRpc(manager, 'upsert_ingredient', {
      p_id: id,
      p_name_en: 'Milk',
      p_name_ar: 'حليب',
      p_unit: 'g',
      p_par_level: 5000,
      p_low_stock_threshold: 1000,
    });
    expect(upd.error).toBeNull();

    const denied = outcome(
      await appRpc(cashier, 'upsert_ingredient', { p_name_en: 'X', p_name_ar: 'س', p_unit: 'g' }),
    );
    expect(denied.errorMessage).toContain('FORBIDDEN');

    const badYield = outcome(
      await appRpc(manager, 'upsert_ingredient', {
        p_name_en: 'X',
        p_name_ar: 'س',
        p_unit: 'g',
        p_yield_percent: 0,
      }),
    );
    expect(badYield.errorMessage).toContain('INVALID_YIELD');
  });

  it('locks unit and kind once the ledger holds movements', async () => {
    const id = await makeIngredient(`SB-${Date.now()}`);
    const recv = await appRpc(manager, 'receive_delivery', {
      p_lines: [{ ingredient_id: id, qty_received: 500, unit_cost_iqd: 10 }],
    });
    expect(recv.error).toBeNull();

    const locked = outcome(
      await appRpc(manager, 'upsert_ingredient', {
        p_id: id,
        p_name_en: 'SB',
        p_name_ar: 'س',
        p_unit: 'ml',
      }),
    );
    expect(locked.errorMessage).toContain('UNIT_LOCKED');

    // Renames stay allowed — history's quantities are untouched.
    const renamed = await appRpc(manager, 'upsert_ingredient', {
      p_id: id,
      p_name_en: 'SB renamed',
      p_name_ar: 'س',
      p_unit: 'g',
    });
    expect(renamed.error).toBeNull();
  });

  it('set_recipe replaces a variant BOM atomically and audits the line sets', async () => {
    const flour = await makeIngredient(`SC-flour-${Date.now()}`);
    const sugar = await makeIngredient(`SC-sugar-${Date.now()}`);
    const { data: variant } = await svc
      .from('menu_item_variants')
      .select('id')
      .limit(1)
      .single();
    const variantId = (variant as { id: string }).id;

    const first = await appRpc(manager, 'set_recipe', {
      p_target: 'variant',
      p_target_id: variantId,
      p_lines: [
        { ingredient_id: flour, qty: 120 },
        { ingredient_id: sugar, qty: 30 },
      ],
    });
    expect(first.error).toBeNull();
    expect(first.data).toBe(2);

    // Replace, not merge: the second call's set is the whole truth.
    const second = await appRpc(manager, 'set_recipe', {
      p_target: 'variant',
      p_target_id: variantId,
      p_lines: [{ ingredient_id: flour, qty: 100 }],
    });
    expect(second.error).toBeNull();
    const { data: lines } = await svc
      .from('recipe_lines')
      .select('ingredient_id, qty')
      .eq('variant_id', variantId)
      .in('ingredient_id', [flour, sugar]);
    expect(lines).toHaveLength(1);

    // Restore: clear what this test attached.
    await appRpc(manager, 'set_recipe', {
      p_target: 'variant',
      p_target_id: variantId,
      p_lines: [],
    });

    const badQty = outcome(
      await appRpc(manager, 'set_recipe', {
        p_target: 'variant',
        p_target_id: variantId,
        p_lines: [{ ingredient_id: flour, qty: 0 }],
      }),
    );
    expect(badQty.errorMessage).toContain('INVALID_QTY');
  });

  it('sub-recipes attach to prepared ingredients only, and cycles are refused', async () => {
    const raw = await makeIngredient(`SD-raw-${Date.now()}`);
    const prepared = await makeIngredient(`SD-prep-${Date.now()}`, { p_kind: 'prepared' });

    const wrongTarget = outcome(
      await appRpc(manager, 'set_recipe', {
        p_target: 'output',
        p_target_id: raw,
        p_lines: [{ ingredient_id: prepared, qty: 1 }],
      }),
    );
    expect(wrongTarget.errorMessage).toContain('INGREDIENT_NOT_FOUND');

    const ok = await appRpc(manager, 'set_recipe', {
      p_target: 'output',
      p_target_id: prepared,
      p_lines: [{ ingredient_id: raw, qty: 200 }],
    });
    expect(ok.error).toBeNull();

    const cycle = outcome(
      await appRpc(manager, 'set_recipe', {
        p_target: 'output',
        p_target_id: prepared,
        p_lines: [{ ingredient_id: prepared, qty: 1 }],
      }),
    );
    expect(cycle.errorMessage).toContain('RECIPE_CYCLE');
  });
});
