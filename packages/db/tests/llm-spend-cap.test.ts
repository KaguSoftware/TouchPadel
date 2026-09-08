/**
 * SEC-29 (0079) — the LLM day quota and monthly spend cap.
 *
 * The §07 box framed this as "every cafe guest holds an authenticated JWT, so an
 * uncapped model endpoint is an uncapped bill". That is NOT the exposure:
 * analytics-insights calls requireStaffRole(..., ['owner']) on its first line,
 * so a guest never reaches the model. Access control already held.
 *
 * The real exposure is that ONE insights request fans out to six model calls, and
 * nothing counted a single token. An owner leaning on refresh, a client retry
 * loop or a stolen owner session was a bill with no ceiling and no signal until
 * the invoice arrived.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  guestClient,
  appRpc,
  outcome,
  SEED_STAFF,
} from './helpers';

const up = await stackAvailable();

describe.skipIf(!up)('0079 LLM spend cap (SEC-29)', () => {
  let svc: SupabaseClient;

  beforeAll(async () => {
    svc = serviceClient();
  });

  /** Each case owns the counter; reset it and the limits afterwards. */
  afterEach(async () => {
    await svc.from('llm_usage').delete().neq('usage_date', '1970-01-01');
    await svc
      .from('venue_settings')
      .update({
        llm_daily_request_limit: 200,
        llm_monthly_cost_cap_micros: 20000000,
        llm_cost_micros_per_mtok: 500000,
      })
      .not('id', 'is', null);
  });

  const begin = () => svc.schema('app').rpc('llm_begin_request').then(outcome);
  const record = (calls: number, prompt: number, completion: number) =>
    svc
      .schema('app')
      .rpc('llm_record_usage', {
        p_model_calls: calls,
        p_prompt_tokens: prompt,
        p_completion_tokens: completion,
      })
      .then(outcome);

  const setLimits = (patch: Record<string, number>) =>
    svc.from('venue_settings').update(patch).not('id', 'is', null);

  it('counts a request and reports the standing budget', async () => {
    const res = await begin();
    expect(res.ok, res.errorMessage).toBe(true);
    const d = res.data as { requests_today: number; daily_limit: number };
    expect(d.requests_today).toBe(1);
    expect(d.daily_limit).toBe(200);
  });

  it('refuses once the day quota is spent, and does not over-count the refusal', async () => {
    await setLimits({ llm_daily_request_limit: 3 });

    for (let i = 1; i <= 3; i++) {
      const ok = await begin();
      expect(ok.ok, `request ${i} should be allowed`).toBe(true);
    }

    const refused = await begin();
    expect(refused.ok).toBe(false);
    expect(refused.errorMessage).toMatch(/LLM_DAILY_QUOTA/);

    // The refused request must not be counted as if it ran — otherwise a client
    // retry loop drives the counter past the limit and the number stops meaning
    // anything for the next day's diagnosis.
    const { data } = await svc.from('llm_usage').select('requests').single();
    expect((data as { requests: number }).requests).toBe(3);
  });

  it('refuses when the month-to-date spend is already over the cap', async () => {
    await setLimits({ llm_monthly_cost_cap_micros: 1000, llm_cost_micros_per_mtok: 1000000 });
    // 2,000,000 tokens at 1,000,000 micros/Mtok = 2,000,000 micros, well over 1000.
    expect((await record(1, 1000000, 1000000)).ok).toBe(true);

    const refused = await begin();
    expect(refused.ok).toBe(false);
    expect(refused.errorMessage).toMatch(/LLM_MONTHLY_CAP/);
  });

  it('prices tokens from the configurable rate', async () => {
    await setLimits({ llm_cost_micros_per_mtok: 500000 });
    expect((await record(6, 600000, 400000)).ok).toBe(true);

    const { data } = await svc.from('llm_usage').select('*').single();
    const row = data as {
      model_calls: number;
      prompt_tokens: number;
      completion_tokens: number;
      cost_micros: number;
    };
    expect(row.model_calls).toBe(6);
    expect(row.prompt_tokens).toBe(600000);
    expect(row.completion_tokens).toBe(400000);
    // 1,000,000 tokens * 500,000 micros / 1,000,000 = 500,000 micros = USD 0.50
    expect(row.cost_micros).toBe(500000);
  });

  it('accumulates across requests in the same day', async () => {
    expect((await record(2, 100, 50)).ok).toBe(true);
    expect((await record(3, 200, 75)).ok).toBe(true);
    const { data } = await svc.from('llm_usage').select('*').single();
    const row = data as { model_calls: number; prompt_tokens: number; completion_tokens: number };
    expect(row.model_calls).toBe(5);
    expect(row.prompt_tokens).toBe(300);
    expect(row.completion_tokens).toBe(125);
  });

  it('a quota of zero disables the paid path entirely', async () => {
    await setLimits({ llm_daily_request_limit: 0 });
    const res = await begin();
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toMatch(/LLM_DAILY_QUOTA/);
  });

  // ── the counter is not client-writable ────────────────────────────────────

  it('no client can call the gate or the recorder — service role only', async () => {
    const owner = await signedInClient(SEED_STAFF.owner);
    for (const fn of ['llm_begin_request', 'llm_record_usage']) {
      const res = await appRpc(owner, fn, {}).then(outcome);
      expect(res.ok, `${fn} must not be callable by the owner`).toBe(false);
      expect(res.errorMessage).toMatch(/permission denied|not find the function|PGRST202/i);
    }
    await owner.auth.signOut();
  });

  it('a guest cannot read the spend at all; the owner can', async () => {
    await record(1, 10, 10);

    const guest = await guestClient(svc, 'llmspend');
    const { data: guestRows } = await guest.from('llm_usage').select('*');
    expect(guestRows ?? []).toHaveLength(0); // RLS silence

    const owner = await signedInClient(SEED_STAFF.owner);
    const { data: ownerRows, error } = await owner.from('llm_usage').select('*');
    expect(error).toBeNull();
    expect((ownerRows ?? []).length).toBeGreaterThan(0);
    await owner.auth.signOut();
  });

  it('llm_usage_summary is owner-only and shows the budget building', async () => {
    await record(6, 600000, 400000);

    const owner = await signedInClient(SEED_STAFF.owner);
    const res = await appRpc(owner, 'llm_usage_summary', {}).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    const d = res.data as { month_cost_micros: number; monthly_cap_micros: number };
    expect(d.month_cost_micros).toBe(500000);
    expect(d.monthly_cap_micros).toBe(20000000);
    await owner.auth.signOut();

    const manager = await signedInClient(SEED_STAFF.manager);
    const denied = await appRpc(manager, 'llm_usage_summary', {}).then(outcome);
    expect(denied.ok).toBe(false);
    expect(denied.errorMessage).toMatch(/FORBIDDEN/);
    await manager.auth.signOut();
  });
});
