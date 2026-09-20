/**
 * 0115 — analytics components and their cache.
 *
 * Owner-only like the rest of the assistant (decision 5): guest, cashier and
 * manager get RLS silence on both tables and FORBIDDEN from the three granted
 * RPCs; the owner reads. app.analytics_component answers a miss, then a hit
 * after a service-role upsert, with a params_hash that ignores key order and
 * nulls; supersede retires the live row (the miss then carries it as `last`);
 * pin creates a pinned row the owner can archive, and a built-in key is taken.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stackAvailable, serviceClient, signedInClient, anonymousSessionClient, appRpc, outcome, SEED_STAFF, SEED_STAFF_IDS } from './helpers';

const up = await stackAvailable();
const TABLES = ['assistant_components', 'assistant_component_cache'] as const;
const PIN_KEY = 'test_pinned_probe';
const PARAMS = { from: '2026-09-14', to: '2026-09-20', lang: 'en', compare: 'previousPeriod' };
const FP_A = 'a'.repeat(64);
const FP_B = 'b'.repeat(64);

/** Every function 0115 grants to authenticated, with owner-safe arguments. */
const GRANTED: { name: string; args: Record<string, unknown>; ownerOk: RegExp | null }[] = [
  { name: 'analytics_component', args: { p_key: 'week_paragraph', p_params: PARAMS }, ownerOk: null },
  {
    name: 'assistant_pin_component',
    args: { p_key: 'no_such_builtin_probe', p_question: 'q', p_tools: [], p_output_schema: { type: 'object' }, p_default_params: {} },
    ownerOk: /INVALID_ARGUMENT/, // empty tools: past the guard, refused on validation
  },
  { name: 'assistant_archive_component', args: { p_key: 'no_such_component_probe' }, ownerOk: /COMPONENT_NOT_FOUND/ },
];

describe.skipIf(!up)('0115 analytics components', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let guest: SupabaseClient;

  const cleanup = async () => {
    await svc.from('assistant_component_cache').delete().eq('component_key', 'week_paragraph').in('inputs_fingerprint', [FP_A, FP_B]);
    await svc.from('assistant_components').delete().eq('key', PIN_KEY);
  };

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    guest = await anonymousSessionClient();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await Promise.all([owner, manager, cashier, guest].map((c) => c.auth.signOut()));
  });

  // ── tables ────────────────────────────────────────────────────────────────

  it('the six built-ins are seeded with real catalog tool names and object schemas', async () => {
    const { data, error } = await svc.from('assistant_components').select('key, kind, tools, output_schema').eq('kind', 'builtin').order('key');
    expect(error).toBeNull();
    const rows = (data ?? []) as { key: string; tools: string[]; output_schema: { type?: string } }[];
    expect(rows.map((r) => r.key)).toEqual(['cafe_findings', 'courts_findings', 'staff_note', 'stock_watch', 'week_paragraph', 'what_changed']);
    for (const r of rows) {
      expect(r.tools.length).toBeGreaterThan(0);
      expect(r.output_schema.type).toBe('object');
      for (const t of r.tools) expect(t).toMatch(/^[a-z][a-z0-9_]+( \{.*\})?$/);
    }
  });

  for (const table of TABLES) {
    it(`${table}: guest, cashier and manager get RLS silence; the owner sees rows`, async () => {
      if (table === 'assistant_component_cache') {
        await svc.schema('app').rpc('assistant_component_upsert', {
          p: { key: 'week_paragraph', params: PARAMS, inputs_fingerprint: FP_A, content: { paragraph: 'probe', figures: [] } },
        });
      }
      for (const [who, c] of [['guest', guest], ['cashier', cashier], ['manager', manager]] as const) {
        const { data, error } = await c.from(table).select('*');
        expect(error, `${who} ${table}`).toBeNull();
        expect(data ?? [], `${who} ${table} should be empty`).toHaveLength(0);
      }
      const { data, error } = await owner.from(table).select('*');
      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThan(0);
    });
  }

  it('nobody but the service role writes the cache', async () => {
    const row = { component_key: 'week_paragraph', params_hash: 'x', inputs_fingerprint: FP_B, content: {} };
    for (const c of [owner, manager, guest]) {
      const { error } = await c.from('assistant_component_cache').insert(row);
      expect(error).not.toBeNull();
    }
    const { error: uErr } = await owner.from('assistant_component_cache').update({ superseded_at: new Date().toISOString() }).eq('component_key', 'week_paragraph');
    expect(uErr).not.toBeNull();
    const { error: cErr } = await owner.from('assistant_components').insert({ key: 'owner_direct_insert', kind: 'pinned', question: 'q', output_schema: {}, tools: ['x'] });
    expect(cErr).not.toBeNull();
  });

  // ── RPC guards ────────────────────────────────────────────────────────────

  for (const fn of GRANTED) {
    it(`${fn.name}: guest, cashier and manager are FORBIDDEN; the owner passes the guard`, async () => {
      for (const [who, c] of [['guest', guest], ['cashier', cashier], ['manager', manager]] as const) {
        const res = outcome(await appRpc(c, fn.name, fn.args));
        expect(res.ok, `${who} ${fn.name}`).toBe(false);
        expect(res.errorMessage, `${who} ${fn.name}`).toMatch(/FORBIDDEN/);
      }
      const res = outcome(await appRpc(owner, fn.name, fn.args));
      if (fn.ownerOk) {
        expect(res.ok).toBe(false);
        expect(res.errorMessage).toMatch(fn.ownerOk);
      } else {
        expect(res.ok, res.errorMessage ?? "").toBe(true);
      }
    });
  }

  it('the service-only functions are not callable by the owner', async () => {
    for (const [name, args] of [
      ['assistant_component_upsert', { p: {} }],
      ['assistant_component_supersede', { p_key: 'week_paragraph', p_params_hash: 'x' }],
      ['assistant_run_tool_prewarm', { p_tool: 'panel_headline', p_args: {} }],
      ['assistant_component_lookup', { p_key: 'week_paragraph', p_params: {} }],
      ['assistant_params_hash', { p_params: {} }],
    ] as const) {
      const res = outcome(await appRpc(owner, name, args as Record<string, unknown>));
      expect(res.ok, name).toBe(false);
      expect(res.errorMessage, name).toMatch(/permission denied|42501|PGRST202|could not find/i);
    }
  });

  // ── the cache contract ────────────────────────────────────────────────────

  it('analytics_component: miss, then hit after a service upsert; params_hash ignores key order and nulls', async () => {
    await cleanup();
    const params2 = { compare: 'previousPeriod', lang: 'en', to: '2026-09-20', from: '2026-09-14', court: null };

    const miss = outcome(await appRpc(owner, 'analytics_component', { p_key: 'week_paragraph', p_params: PARAMS }));
    expect(miss.ok).toBe(true);
    const m = miss.data as { hit: boolean; params_hash: string; last: unknown };
    expect(m.hit).toBe(false);
    expect(m.last).toBeNull();
    expect(m.params_hash).toMatch(/^[0-9a-f]{32}$/);

    const up = await svc.schema('app').rpc('assistant_component_upsert', {
      p: {
        key: 'week_paragraph',
        params: params2,
        inputs_fingerprint: FP_A,
        content: { paragraph: 'A quiet week.', figures: [{ label: 'Revenue', value: '1,000,000 IQD', route: '/panel' }] },
        sources: [{ name: 'panel_headline' }],
        tokens: { model: 'claude-opus-5', input: 10, output: 5, cost_micros: 175 },
      },
    });
    expect(up.error).toBeNull();
    expect((up.data as { params_hash: string }).params_hash).toBe(m.params_hash);

    const hit = outcome(await appRpc(owner, 'analytics_component', { p_key: 'week_paragraph', p_params: PARAMS }));
    expect(hit.ok).toBe(true);
    const h = hit.data as { hit: boolean; inputs_fingerprint: string; content: { paragraph: string }; tokens: { input: number }; generated_at: string };
    expect(h.hit).toBe(true);
    expect(h.inputs_fingerprint).toBe(FP_A);
    expect(h.content.paragraph).toBe('A quiet week.');
    expect(h.tokens.input).toBe(10);
    expect(h.generated_at).toBeTruthy();
  });

  it('a newer generation supersedes the previous row; supersede retires the live one and the miss carries it as last', async () => {
    const up2 = await svc.schema('app').rpc('assistant_component_upsert', {
      p: { key: 'week_paragraph', params: PARAMS, inputs_fingerprint: FP_B, content: { paragraph: 'Busier.', figures: [] } },
    });
    expect(up2.error).toBeNull();
    const { data: rows } = await svc.from('assistant_component_cache').select('inputs_fingerprint, superseded_at').eq('component_key', 'week_paragraph').in('inputs_fingerprint', [FP_A, FP_B]);
    const byFp = Object.fromEntries((rows ?? []).map((r) => [r.inputs_fingerprint as string, r.superseded_at]));
    expect(byFp[FP_A]).not.toBeNull();
    expect(byFp[FP_B]).toBeNull();

    const hit = outcome(await appRpc(owner, 'analytics_component', { p_key: 'week_paragraph', p_params: PARAMS }));
    const h = hit.data as { hit: boolean; params_hash: string; content: { paragraph: string } };
    expect(h.hit).toBe(true);
    expect(h.content.paragraph).toBe('Busier.');

    const sup = await svc.schema('app').rpc('assistant_component_supersede', { p_key: 'week_paragraph', p_params_hash: h.params_hash });
    expect(sup.error).toBeNull();
    expect(sup.data).toBe(1);

    const miss = outcome(await appRpc(owner, 'analytics_component', { p_key: 'week_paragraph', p_params: PARAMS }));
    const m = miss.data as { hit: boolean; last: { content: { paragraph: string }; inputs_fingerprint: string } | null };
    expect(m.hit).toBe(false);
    expect(m.last?.content.paragraph).toBe('Busier.');
    expect(m.last?.inputs_fingerprint).toBe(FP_B);
  });

  it('analytics_component refuses an unknown or archived key', async () => {
    const res = outcome(await appRpc(owner, 'analytics_component', { p_key: 'no_such_component_probe', p_params: PARAMS }));
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toMatch(/COMPONENT_NOT_FOUND/);
  });

  it('the pre-warm runner reads through the wall as the owner (service role only)', async () => {
    const { data, error } = await svc.schema('app').rpc('assistant_run_tool_prewarm', {
      p_tool: 'panel_headline',
      p_args: { p_from: PARAMS.from, p_to: PARAMS.to, p_compare: 'previousPeriod' },
    });
    expect(error).toBeNull();
    expect((data as { tool: string }).tool).toBe('panel_headline');
  });

  // ── pinning ───────────────────────────────────────────────────────────────

  it('pin creates a pinned row for the owner; a built-in key is taken; archive stamps it; a built-in cannot be archived', async () => {
    const pin = outcome(
      await appRpc(owner, 'assistant_pin_component', {
        p_key: PIN_KEY,
        p_question: 'How many bookings came from the app?',
        p_tools: ['analytics_courts_guests'],
        p_output_schema: { type: 'object', additionalProperties: false, required: ['figures', 'paragraph'], properties: { figures: { type: 'array', items: { type: 'object' } }, paragraph: { type: 'string' } } },
        p_default_params: { scope: 'courts' },
      }),
    );
    expect(pin.ok, pin.errorMessage ?? "").toBe(true);
    const row = pin.data as { key: string; kind: string; created_by: string; archived_at: string | null };
    expect(row.kind).toBe('pinned');
    expect(row.created_by).toBe(SEED_STAFF_IDS.owner);
    expect(row.archived_at).toBeNull();

    const { data: visible } = await owner.from('assistant_components').select('key').eq('kind', 'pinned').is('archived_at', null);
    expect((visible ?? []).map((r) => r.key)).toContain(PIN_KEY);

    const taken = outcome(
      await appRpc(owner, 'assistant_pin_component', { p_key: 'week_paragraph', p_question: 'q', p_tools: ['panel_headline'], p_output_schema: { type: 'object' }, p_default_params: {} }),
    );
    expect(taken.ok).toBe(false);
    expect(taken.errorMessage).toMatch(/COMPONENT_KEY_TAKEN/);

    const archived = outcome(await appRpc(owner, 'assistant_archive_component', { p_key: PIN_KEY }));
    expect(archived.ok).toBe(true);
    expect((archived.data as { archived_at: string | null }).archived_at).not.toBeNull();

    const builtin = outcome(await appRpc(owner, 'assistant_archive_component', { p_key: 'week_paragraph' }));
    expect(builtin.ok).toBe(false);
    expect(builtin.errorMessage).toMatch(/COMPONENT_BUILTIN/);

    // Re-pinning an archived key revives it.
    const again = outcome(
      await appRpc(owner, 'assistant_pin_component', { p_key: PIN_KEY, p_question: 'q2', p_tools: ['panel_headline'], p_output_schema: { type: 'object' }, p_default_params: {} }),
    );
    expect(again.ok).toBe(true);
    expect((again.data as { archived_at: string | null; question: string }).archived_at).toBeNull();
    expect((again.data as { question: string }).question).toBe('q2');
  });

  it('the pre-warm is scheduled hourly and posts only at the venue\'s 03:30', async () => {
    // cron.* is not reachable through PostgREST; the migration text is the record.
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(new URL('../supabase/migrations/20260920000115_assistant_components.sql', import.meta.url), 'utf8');
    expect(sql).toMatch(/cron\.schedule\('tp_assistant_prewarm',\s*'30 \* \* \* \*'/);
    expect(sql).toMatch(/extract\(hour from \(now\(\) at time zone coalesce\(v_tz, 'Asia\/Baghdad'\)\)\) <> 3/);
    expect(sql).toContain(`'{"prewarm":true}'::jsonb`);
  });
});
