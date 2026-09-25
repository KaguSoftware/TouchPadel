/**
 * protocols_engine_tables + protocols_engine_rpcs (build-contracts-2026-09-23
 * §2.6, §2.7) through PostgREST, as the two apps call them.
 *
 *   * every protocol RPC refuses a café guest with FORBIDDEN and holds no
 *     anon grant; the engine's internals (hooks' dispatcher, the step
 *     catalogue, the seed) are callable by no client role;
 *   * MGMT reads the venue's templates (overview, How it works) and the rest
 *     of the staff are refused; each seeded template keeps every built-in
 *     step once, first and last in place and every dependency below its step;
 *   * the any-staff reads answer at the caller's venue and refuse another;
 *     row-addressed calls answer PROTOCOL_NOT_FOUND for an unknown id;
 *   * start_protocol checks its starter by kind before anything else;
 *   * the seven tables: MGMT at the venue reads them, nobody else does, no
 *     client writes them, and they join the owner assistant's allowlist with
 *     the jsonb columns off by default and the free text a candidate's name
 *     could be typed into (records, decision and skip notes, the stop
 *     reason) left out;
 *   * app.staff_media_visible, the staff-media read policy's helper, answers
 *     false to a guest on any name and is not granted to anon.
 *
 * The engine's moves (start to launch, send-backs, skips, stops, How it
 * works, per-run edits) are protocols-engine-flow.test.ts; the new roles'
 * denials are protocols-roles.test.ts. Nothing here writes a row.
 */
import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  anonClient,
  signedInClient,
  anonymousSessionClient,
  appRpc,
  SEED_STAFF,
  SEED_STAFF_IDS,
  VENUE_A_ID,
  VENUE_B_ID,
} from './helpers';

const up = await stackAvailable();
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';
const NIL = '00000000-0000-4000-8000-000000000000';

function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'],
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

/** Every client-callable protocol RPC, with arguments that pass no guard by accident. */
const RPCS: Array<[string, Record<string, unknown>]> = [
  ['start_protocol', { p_kind: 'price_promo' }],
  ['submit_step', { p_run_step_id: NIL, p_record: {} }],
  ['withdraw_step', { p_submission_id: NIL }],
  ['decide_step', { p_submission_id: NIL, p_decision: 'approve' }],
  ['skip_step', { p_run_step_id: NIL, p_note: 'x' }],
  ['tick_run_item', { p_item_id: NIL, p_done: true }],
  ['withdraw_protocol', { p_run_id: NIL }],
  ['stop_protocol', { p_run_id: NIL, p_note: 'x' }],
  ['cancel_schedule', { p_run_id: NIL }],
  ['edit_run_items', { p_run_step_id: NIL, p_items: [] }],
  ['add_run_step', { p_run_id: NIL, p_after_run_step_id: NIL, p_step: {} }],
  ['save_protocol_template', { p_template_id: NIL, p_expected_version: 1, p_name_en: 'x', p_name_ar: 'x', p_steps: [] }],
  ['protocol_template_detail', { p_template_id: NIL }],
  ['protocols_overview', { p_venue_id: VENUE_A_ID }],
  ['protocol_runs_page', { p_venue_id: VENUE_A_ID }],
  ['protocol_run_detail', { p_run_id: NIL }],
  ['protocol_step_detail', { p_run_step_id: NIL }],
  ['my_protocol_work', { p_venue_id: VENUE_A_ID }],
  ['protocols_waiting_count', { p_venue_id: VENUE_A_ID }],
];

const TABLES = [
  'protocol_templates', 'protocol_template_steps', 'protocol_template_items',
  'protocol_runs', 'protocol_run_steps', 'protocol_submissions', 'protocol_run_items',
];

interface Def { step_key: string; after: string[]; fixed: string | null }
interface TemplateDetail {
  template: { id: string; kind: string; variant: string | null; version: number };
  steps: Array<{ position: number; step_key: string | null; actor_roles: string[]; needs_owner_ok: boolean; optional: boolean }>;
  defs: Array<Def & { actor_roles: string[]; needs_owner_ok: boolean; ok_fixed: boolean; optional: boolean }>;
}

describe.skipIf(!up)('protocols engine: the RPC surface through PostgREST', () => {
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let prep: SupabaseClient;
  let desk: SupabaseClient;
  let guest: SupabaseClient;
  let anon: SupabaseClient;

  beforeAll(async () => {
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    prep = await signedInClient(SEED_STAFF.prep);
    desk = await signedInClient(SEED_STAFF.court_desk);
    guest = await anonymousSessionClient();
    anon = anonClient();
  });

  afterAll(async () => {
    for (const c of [owner, manager, cashier, prep, desk, guest]) await c?.auth.signOut();
  });

  it('every protocol RPC refuses a café guest with FORBIDDEN, and anon holds no grant', async () => {
    for (const [fn, args] of RPCS) {
      const asGuest = await appRpc(guest, fn, args);
      expect(asGuest.error?.message, `${fn} as a guest`).toBe('FORBIDDEN');
      const asAnon = await appRpc(anon, fn, args);
      expect(asAnon.error?.code, `${fn} as anon`).toBe('42501');
    }
  });

  it('the engine internals are callable by no client role', async () => {
    const internals: Array<[string, Record<string, unknown>]> = [
      ['protocol_step_defs', { p_kind: 'hiring', p_variant: null }],
      ['protocol_step_allowed', { p_from: 'open', p_to: 'submitted' }],
      ['protocol_seed_venue', { p_venue: VENUE_A_ID }],
      ['protocol_engine_submit', { p_run_id: NIL, p_step_id: NIL, p_record: {}, p_photos: [] }],
      ['protocol_engine_notify', { p_ids: [], p_kind: 'staff_task', p_title_key: 'step_open', p_route: 'staff', p_id: NIL, p_run_id: NIL, p_step_id: NIL }],
      ['protocol_engine_can', { p_run_id: NIL, p_step_id: NIL }],
    ];
    for (const [fn, args] of internals) {
      for (const c of [owner, guest]) {
        const { error } = await appRpc(c, fn, args);
        expect(error?.code, `${fn}`).toBe('42501');
      }
    }
  });

  it('MGMT reads the venue’s templates; each keeps its built-in steps in dependency order', async () => {
    for (const c of [owner, manager]) {
      const { data, error } = await appRpc(c, 'protocols_overview', { p_venue_id: VENUE_A_ID });
      expect(error).toBeNull();
      const templates = (data as { templates: Array<{ template_id: string; kind: string; variant: string | null;
        running: number; waiting_on_me: number; finished_30d: number }> }).templates;
      expect(templates.map((t) => `${t.kind}/${t.variant ?? ''}`)).toEqual([
        'product_release/', 'tournament/type1', 'tournament/type2', 'tournament/type3', 'hiring/', 'price_promo/',
      ]);
      for (const t of templates) {
        expect(typeof t.running).toBe('number');
        expect(typeof t.waiting_on_me).toBe('number');
        expect(typeof t.finished_30d).toBe('number');
        const detail = await appRpc(c, 'protocol_template_detail', { p_template_id: t.template_id });
        expect(detail.error).toBeNull();
        const d = detail.data as TemplateDetail;
        expect(d.template.kind).toBe(t.kind);
        // The seeded list may have been edited through How it works on this
        // stack; what save_protocol_template guarantees is checked, not the seed.
        const keys = d.steps.map((s) => s.step_key);
        const pos = (k: string) => keys.indexOf(k);
        for (const def of d.defs) {
          expect(keys.filter((k) => k === def.step_key), `${t.kind} ${def.step_key}`).toHaveLength(1);
          for (const a of def.after) expect(pos(a)).toBeLessThan(pos(def.step_key));
          if (def.fixed === 'first') expect(pos(def.step_key)).toBe(0);
          if (def.fixed === 'last') expect(pos(def.step_key)).toBe(keys.length - 1);
          const step = d.steps[pos(def.step_key)]!;
          expect([...step.actor_roles].sort()).toEqual([...def.actor_roles].sort());
          expect(step.optional).toBe(def.optional);
          if (def.ok_fixed) expect(step.needs_owner_ok).toBe(def.needs_owner_ok);
        }
      }
    }
    for (const c of [cashier, prep, desk]) {
      expect((await appRpc(c, 'protocols_overview', { p_venue_id: VENUE_A_ID })).error?.message).toBe('FORBIDDEN');
    }
    const { data } = await appRpc(owner, 'protocols_overview', { p_venue_id: VENUE_A_ID });
    const first = (data as { templates: Array<{ template_id: string }> }).templates[0]!.template_id;
    expect((await appRpc(cashier, 'protocol_template_detail', { p_template_id: first })).error?.message).toBe('FORBIDDEN');
    expect((await appRpc(manager, 'protocol_template_detail', { p_template_id: NIL })).error?.message).toBe('PROTOCOL_NOT_FOUND');
    // How it works is the owner's.
    const save = await appRpc(manager, 'save_protocol_template', {
      p_template_id: first, p_expected_version: 1, p_name_en: 'x', p_name_ar: 'x', p_steps: [],
    });
    expect(save.error?.message).toBe('FORBIDDEN');
  });

  it('the any-staff reads answer at the caller’s venue and refuse another', async () => {
    for (const c of [cashier, prep, desk, manager, owner]) {
      const work = await appRpc(c, 'my_protocol_work', {});
      expect(work.error).toBeNull();
      const w = work.data as Record<string, unknown>;
      expect(Object.keys(w).sort()).toEqual(['counts', 'decided', 'to_decide', 'todo', 'waiting']);
      expect(Object.keys(w.counts as object).sort()).toEqual(['to_decide', 'todo', 'waiting']);

      const count = await appRpc(c, 'protocols_waiting_count', { p_venue_id: VENUE_A_ID });
      expect(count.error).toBeNull();
      expect(Object.keys(count.data as object).sort()).toEqual(['to_decide', 'todo']);

      for (const filter of ['waiting', 'active', 'finished', 'mine']) {
        const page = await appRpc(c, 'protocol_runs_page', { p_venue_id: VENUE_A_ID, p_filter: filter, p_limit: 5 });
        expect(page.error, filter).toBeNull();
        const p = page.data as { runs: unknown[]; total: number };
        expect(Array.isArray(p.runs)).toBe(true);
        expect(typeof p.total).toBe('number');
      }
    }
    const badFilter = await appRpc(cashier, 'protocol_runs_page', { p_venue_id: VENUE_A_ID, p_filter: 'everything' });
    expect(badFilter.error?.message).toBe('INVALID_ARGUMENT');
    expect(badFilter.error?.hint).toBe('filter');
    const badKind = await appRpc(cashier, 'protocol_runs_page', { p_venue_id: VENUE_A_ID, p_kind: 'party' });
    expect(badKind.error?.hint).toBe('kind');
    // Venue B is not one of the caller's venues (and is inactive outside multi-venue.test.ts).
    for (const [c, fn] of [[cashier, 'my_protocol_work'], [prep, 'protocols_waiting_count'],
                           [desk, 'protocol_runs_page'], [manager, 'protocols_overview']] as const) {
      expect((await appRpc(c, fn, { p_venue_id: VENUE_B_ID })).error?.message, fn).toBe('FORBIDDEN');
    }
  });

  it('row-addressed calls answer PROTOCOL_NOT_FOUND for an id nobody can see', async () => {
    const byStaff: Array<[SupabaseClient, string, Record<string, unknown>]> = [
      [cashier, 'protocol_run_detail', { p_run_id: NIL }],
      [cashier, 'protocol_step_detail', { p_run_step_id: NIL }],
      [cashier, 'submit_step', { p_run_step_id: NIL, p_record: {} }],
      [cashier, 'withdraw_step', { p_submission_id: NIL }],
      [cashier, 'decide_step', { p_submission_id: NIL, p_decision: 'approve' }],
      [cashier, 'skip_step', { p_run_step_id: NIL, p_note: 'x' }],
      [cashier, 'tick_run_item', { p_item_id: NIL, p_done: true }],
      [cashier, 'withdraw_protocol', { p_run_id: NIL }],
      [cashier, 'cancel_schedule', { p_run_id: NIL }],
      [manager, 'stop_protocol', { p_run_id: NIL, p_note: 'x' }],
      [owner, 'edit_run_items', { p_run_step_id: NIL, p_items: [] }],
      [owner, 'add_run_step', { p_run_id: NIL, p_after_run_step_id: NIL, p_step: {} }],
      [owner, 'save_protocol_template', { p_template_id: NIL, p_expected_version: 1, p_name_en: 'x', p_name_ar: 'x', p_steps: [] }],
    ];
    for (const [c, fn, args] of byStaff) {
      expect((await appRpc(c, fn, args)).error?.message, fn).toBe('PROTOCOL_NOT_FOUND');
    }
    // The subset guards come before the lookup.
    expect((await appRpc(cashier, 'stop_protocol', { p_run_id: NIL, p_note: 'x' })).error?.message).toBe('FORBIDDEN');
    expect((await appRpc(manager, 'edit_run_items', { p_run_step_id: NIL, p_items: [] })).error?.message).toBe('FORBIDDEN');
    expect((await appRpc(manager, 'add_run_step', { p_run_id: NIL, p_after_run_step_id: NIL, p_step: {} })).error?.message).toBe('FORBIDDEN');
  });

  it('start_protocol checks its starter by kind before anything else', async () => {
    // A guest-safe probe: no first record, so nothing past the guard can write.
    for (const c of [cashier, prep, desk]) {
      for (const kind of ['product_release', 'tournament', 'hiring', 'price_promo']) {
        const { error } = await appRpc(c, 'start_protocol', { p_kind: kind, p_title_en: 'x' });
        expect(error?.message, `${kind}`).toBe('FORBIDDEN');
      }
    }
    const noRecord = await appRpc(manager, 'start_protocol', { p_kind: 'hiring', p_title_en: 'Barista' });
    expect(noRecord.error?.message).toBe('RECORD_INVALID');
    expect(noRecord.error?.hint).toBe('record');
    const badKind = await appRpc(manager, 'start_protocol', { p_kind: 'party', p_title_en: 'x', p_first_record: {} });
    expect(badKind.error?.message).toBe('INVALID_ARGUMENT');
    expect(badKind.error?.hint).toBe('kind');
    const noTitle = await appRpc(manager, 'start_protocol', { p_kind: 'hiring' });
    expect(noTitle.error?.message).toBe('TEXT_REQUIRED');
    const ownerOneTitle = await appRpc(owner, 'start_protocol', { p_kind: 'hiring', p_title_en: 'x' });
    expect(ownerOneTitle.error?.message).toBe('TEXT_BOTH_LANGUAGES_REQUIRED');
    // An argument the function does not take matches no signature.
    const stray = await appRpc(manager, 'start_protocol', { p_kind: 'hiring', p_override: true });
    expect(stray.error?.code).toBe('PGRST202');
  });

  it('the seven tables: MGMT at the venue reads them, nobody else, and no client writes them', async () => {
    for (const t of ['protocol_templates', 'protocol_template_steps']) {
      for (const c of [owner, manager]) {
        const { data, error } = await c.from(t).select('id').limit(1);
        expect(error, t).toBeNull();
        expect(data!.length, t).toBeGreaterThan(0);
      }
    }
    for (const t of TABLES) {
      for (const c of [cashier, prep, desk, guest]) {
        const { data, error } = await c.from(t).select('id').limit(1);
        expect(error, t).toBeNull();
        expect(data, t).toEqual([]);
      }
      const denied = await anon.from(t).select('id').limit(1);
      expect(denied.error?.code, t).toBe('42501');
      const write = await owner.from(t).insert({ id: NIL });
      expect(write.error?.code, `insert ${t}`).toBe('42501');
      const del = await manager.from(t).delete().eq('id', NIL);
      expect(del.error?.code, `delete ${t}`).toBe('42501');
    }
  });

  it.skipIf(!docker)('the seven tables join the assistant allowlist, without the free text a name can be typed into', () => {
    const rows = JSON.parse(
      psql(`select coalesce(jsonb_agg(jsonb_build_object('t', table_name, 'c', column_name, 'd', is_default)), '[]')
              from app.assistant_readable_columns where table_name like 'protocol\\_%'`),
    ) as Array<{ t: string; c: string; d: boolean }>;
    expect([...new Set(rows.map((r) => r.t))].sort()).toEqual([...TABLES].sort());
    expect(rows.find((r) => r.t === 'protocol_runs' && r.c === 'data')?.d).toBe(false);
    expect(rows.find((r) => r.t === 'protocol_runs' && r.c === 'status')?.d).toBe(true);
    // A hiring run's notes may name a candidate until the 90-day purge
    // (§2.12), and what the assistant reads goes to the LLM (§1.5).
    const hidden = ['protocol_submissions.decision_note', 'protocol_submissions.record',
                    'protocol_run_steps.skip_note', 'protocol_runs.stop_reason'];
    expect(rows.filter((r) => hidden.includes(`${r.t}.${r.c}`))).toEqual([]);
    // assistant_table_read is internal (assistant_run_tool reaches it), so it
    // runs as postgres with the owner's claims, as the dispatcher runs it.
    const claims = JSON.stringify({ sub: SEED_STAFF_IDS.owner, role: 'authenticated' });
    const asOwner = (sql: string) => {
      try {
        return psql(`begin;\nselect set_config('request.jwt.claims', '${claims}', true);\n${sql};\nrollback;`);
      } catch (e) {
        return String((e as { stderr?: string }).stderr ?? e).match(/ERROR:\s+(\S+)/)?.[1] ?? String(e);
      }
    };
    // The control: the same call reads a column that is listed.
    expect(asOwner(`select app.assistant_table_read('protocol_runs', array['status'], null, null, 1)`))
      .toContain('"columns": ["status"]');
    for (const col of hidden) {
      const [table, column] = col.split('.');
      expect(asOwner(`select app.assistant_table_read('${table}', array['${column}'])`), col)
        .toBe('ASSISTANT_UNKNOWN_COLUMN');
    }
  });

  it('staff_media_visible, the storage policy’s helper, answers false to a guest and holds no anon grant', async () => {
    const path = `${VENUE_A_ID}/steps/${NIL}.jpg`;
    for (const name of [path, 'items/x.jpg', '', 'not a path']) {
      const asGuest = await appRpc(guest, 'staff_media_visible', { p_name: name });
      expect(asGuest.error, name).toBeNull();
      expect(asGuest.data, name).toBe(false);
    }
    expect((await appRpc(anon, 'staff_media_visible', { p_name: path })).error?.code).toBe('42501');
    // A path with no slot is nobody's, management included.
    expect((await appRpc(owner, 'staff_media_visible', { p_name: path })).data).toBe(false);
  });
});
