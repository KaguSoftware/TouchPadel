/**
 * 0111 — usage by token kind, prices in the database, the meter (plan §2.6).
 *
 *   * llm_record_usage(model, four counts, calls) prices each kind from
 *     venue_settings.llm_pricing and rolls the counts onto today's row;
 *   * a model absent from the map is priced at the 0079 blended fallback;
 *   * llm_price_micros gives the UI the same arithmetic, owner-only;
 *   * assistant_usage returns days, month, cap, pricing and fallback;
 *   * the 0079 three-argument recorder still works.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stackAvailable, serviceClient, signedInClient, appRpc, outcome, SEED_STAFF } from './helpers';

const up = await stackAvailable();

const TEST_PRICES = { input: 1_000_000, cache_write: 2_000_000, cache_read: 100_000, output: 4_000_000 };

describe.skipIf(!up)('0111 LLM usage by kind', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let savedPricing: unknown;

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    const { data } = await svc.from('venue_settings').select('llm_pricing').single();
    savedPricing = (data as { llm_pricing: unknown }).llm_pricing;
    await svc
      .from('venue_settings')
      .update({ llm_pricing: { ...(savedPricing as Record<string, unknown>), 'test-model': TEST_PRICES } })
      .not('id', 'is', null);
  });

  afterEach(async () => {
    await svc.from('llm_usage').delete().neq('usage_date', '1970-01-01');
    await svc.from('venue_settings').update({ llm_cost_micros_per_mtok: 500000 }).not('id', 'is', null);
  });

  afterAll(async () => {
    await svc.from('venue_settings').update({ llm_pricing: savedPricing }).not('id', 'is', null);
    await owner.auth.signOut();
  });

  const record = (model: string, input: number, cw: number, cr: number, output: number, calls = 1) =>
    svc
      .schema('app')
      .rpc('llm_record_usage', {
        p_model: model, p_input: input, p_cache_write: cw, p_cache_read: cr, p_output: output, p_model_calls: calls,
      })
      .then(outcome);

  it('the default row carries Opus 5 and Sonnet 5 prices', () => {
    const p = savedPricing as Record<string, Record<string, number>>;
    expect(p['claude-opus-5']).toEqual({ input: 5000000, cache_write: 6250000, cache_read: 500000, output: 25000000 });
    expect(p['claude-sonnet-5']).toEqual({ input: 2000000, cache_write: 2500000, cache_read: 200000, output: 10000000 });
  });

  it('prices each kind from the map and rolls up onto today', async () => {
    // 1M tokens of each kind: 1 + 2 + 0.1 + 4 USD = 7,100,000 micros.
    const r = await record('test-model', 1_000_000, 1_000_000, 1_000_000, 1_000_000, 3);
    expect(r.ok, r.errorMessage).toBe(true);
    expect(r.data).toBe(7_100_000);

    const { data } = await svc.from('llm_usage').select('*').single();
    const row = data as Record<string, number>;
    expect(row.model_calls).toBe(3);
    expect(row.prompt_tokens).toBe(1_000_000);
    expect(row.cache_write_tokens).toBe(1_000_000);
    expect(row.cache_read_tokens).toBe(1_000_000);
    expect(row.completion_tokens).toBe(1_000_000);
    expect(row.cost_micros).toBe(7_100_000);

    // A second request on the same day adds.
    expect((await record('test-model', 500_000, 0, 0, 0, 1)).data).toBe(500_000);
    const { data: again } = await svc.from('llm_usage').select('model_calls, prompt_tokens, cost_micros').single();
    expect(again).toEqual({ model_calls: 4, prompt_tokens: 1_500_000, cost_micros: 7_600_000 });
  });

  it('a model missing from the map falls back to the blended rate over every kind', async () => {
    await svc.from('venue_settings').update({ llm_cost_micros_per_mtok: 500000 }).not('id', 'is', null);
    // 4M tokens at 0.5 USD/MTok = 2,000,000 micros.
    const r = await record('not-in-map', 1_000_000, 1_000_000, 1_000_000, 1_000_000);
    expect(r.ok).toBe(true);
    expect(r.data).toBe(2_000_000);
  });

  it('llm_price_micros answers the owner with the same arithmetic and refuses the manager', async () => {
    const res = await appRpc(owner, 'llm_price_micros', {
      p_model: 'test-model', p_input: 1_000_000, p_cache_write: 1_000_000, p_cache_read: 1_000_000, p_output: 1_000_000,
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    expect(res.data).toBe(7_100_000);

    const opus = await appRpc(owner, 'llm_price_micros', {
      p_model: 'claude-opus-5', p_input: 10_000, p_cache_write: 0, p_cache_read: 90_000, p_output: 2_000,
    }).then(outcome);
    // 10k × 5 + 90k × 0.5 + 2k × 25 = 50,000 + 45,000 + 50,000 micros
    expect(opus.data).toBe(145_000);

    const manager = await signedInClient(SEED_STAFF.manager);
    const denied = await appRpc(manager, 'llm_price_micros', {
      p_model: 'test-model', p_input: 1, p_cache_write: 0, p_cache_read: 0, p_output: 0,
    }).then(outcome);
    expect(denied.ok).toBe(false);
    expect(denied.errorMessage).toMatch(/FORBIDDEN/);
    await manager.auth.signOut();
  });

  it('assistant_usage returns days, month, cap, pricing and the fallback', async () => {
    await record('test-model', 1_000_000, 0, 0, 0, 2);
    const res = await appRpc(owner, 'assistant_usage', {}).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    const d = res.data as {
      days: { usage_date: string; requests: number; model_calls: number; input_tokens: number; cost_micros: number }[];
      month: { cost_micros: number; model_calls: number; input_tokens: number };
      cap: { daily_limit: number; monthly_cap_micros: number; month_cost_micros: number };
      pricing: Record<string, unknown>;
      fallback_micros_per_mtok: number;
    };
    expect(d.days).toHaveLength(1);
    const today = d.days[0]!;
    expect(today.model_calls).toBe(2);
    expect(today.input_tokens).toBe(1_000_000);
    expect(today.cost_micros).toBe(1_000_000);
    expect(d.month.cost_micros).toBe(1_000_000);
    expect(d.cap.monthly_cap_micros).toBe(20000000);
    expect(d.cap.month_cost_micros).toBe(1_000_000);
    expect(d.pricing).toHaveProperty('claude-opus-5');
    expect(d.pricing).toHaveProperty('test-model');
    expect(d.fallback_micros_per_mtok).toBe(500000);

    const ranged = await appRpc(owner, 'assistant_usage', { p_from: '2020-01-01', p_to: '2020-01-31' }).then(outcome);
    expect(ranged.ok).toBe(true);
    expect((ranged.data as { days: unknown[] }).days).toEqual([]);

    const bad = await appRpc(owner, 'assistant_usage', { p_from: '2026-02-01', p_to: '2026-01-01' }).then(outcome);
    expect(bad.ok).toBe(false);
    expect(bad.errorMessage).toMatch(/INVALID_RANGE/);
  });

  it('the 0079 three-argument recorder still works beside the new overload', async () => {
    const old = await svc
      .schema('app')
      .rpc('llm_record_usage', { p_model_calls: 1, p_prompt_tokens: 1_000_000, p_completion_tokens: 1_000_000 })
      .then(outcome);
    expect(old.ok, old.errorMessage).toBe(true);
    const { data } = await svc.from('llm_usage').select('cost_micros, cache_write_tokens').single();
    expect(data).toEqual({ cost_micros: 1_000_000, cache_write_tokens: 0 });
  });

  it('the by-kind recorder is service role only', async () => {
    const res = await appRpc(owner, 'llm_record_usage', {
      p_model: 'test-model', p_input: 1, p_cache_write: 0, p_cache_read: 0, p_output: 0, p_model_calls: 1,
    }).then(outcome);
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toMatch(/permission denied|not find the function|PGRST202/i);
  });
});
