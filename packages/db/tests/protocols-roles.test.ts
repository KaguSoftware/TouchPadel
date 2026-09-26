/**
 * protocols_engine_tables + protocols_engine_rpcs, the six new roles
 * (build-contracts-2026-09-23 §2.1, §2.7 "Visibility", §8.2): what driver,
 * marketing and the bar and kitchen family may read and do, A's tables and
 * RPCs only.
 *
 *   * none of them reads a row of the seven protocol tables (MGMT does);
 *   * a run is read through the definer reads, and only by those involved in
 *     it: the starter, an assignee, an actor of an unassigned step. The
 *     price step's record (a mgmt step) is null for them, the run's data is
 *     the starter's alone, and no key anywhere carries a price or a cost;
 *   * each is refused every MGMT and owner RPC, and start_protocol admits
 *     exactly the starters of each kind (heads: product_release; marketing:
 *     price_promo; driver, barista, chef: none);
 *   * their lists: marketing's To do holds the marketing step; nothing waits
 *     on the driver; the price step waits on the owner, not on them.
 *
 * Self-contained like new-roles.test.ts: one auth user + staff row per role
 * through the service role (the 0123 trigger files each at venue A). The
 * probe run is written by the service role (a product release at its price
 * step, the manager's price waiting on the owner) and deleted in afterAll with
 * the users; nothing here goes through start_protocol, whose kind hooks other
 * lanes own.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  appRpc,
  SEED_STAFF,
  SEED_STAFF_IDS,
  DEV_PASSWORD,
  VENUE_A_ID,
} from './helpers';

const up = await stackAvailable();
const NIL = '00000000-0000-4000-8000-000000000000';

const ROLES = ['head_barista', 'barista', 'head_chef', 'chef', 'driver', 'marketing'] as const;
type Role = (typeof ROLES)[number];

const TABLES = [
  'protocol_templates', 'protocol_template_steps', 'protocol_template_items',
  'protocol_runs', 'protocol_run_steps', 'protocol_submissions', 'protocol_run_items',
];

/** Keys that would carry money or cost, at any depth. */
function moneyKeys(v: unknown, path = ''): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => moneyKeys(x, `${path}[${i}]`));
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => [
      ...(/_iqd$|^cost|price|margin/i.test(k) ? [`${path}.${k}`] : []),
      ...moneyKeys(x, `${path}.${k}`),
    ]);
  }
  return [];
}

interface Sub { record: Record<string, unknown> | null; photos: string[]; decision_note: string | null }
interface Detail {
  run: { data: unknown };
  steps: Array<{ step_key: string; submissions: Sub[] }>;
}

describe.skipIf(!up)('protocols: the six new roles', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  const ids = {} as Record<Role, string>;
  const as = {} as Record<Role, SupabaseClient>;
  const runId = crypto.randomUUID();
  const step = {
    propose: crypto.randomUUID(),
    test: crypto.randomUUID(),
    analysis: crypto.randomUUID(),
    marketing: crypto.randomUUID(),
    launch: crypto.randomUUID(),
  };
  const analysisSub = crypto.randomUUID();
  let itemId: string;

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    for (const role of ROLES) {
      const email = `protoroles-${role}-${Date.now()}@test.touch.local`;
      const { data, error } = await svc.auth.admin.createUser({ email, password: DEV_PASSWORD, email_confirm: true });
      if (error || !data.user) throw new Error(`createUser ${role} failed: ${error?.message}`);
      ids[role] = data.user.id;
      const ins = await svc.from('staff').insert({ id: data.user.id, display_name: `Proto ${role}`, role, is_active: true });
      if (ins.error) throw new Error(`staff insert ${role} failed: ${ins.error.message}`);
      as[role] = await signedInClient(email);
    }

    // A product release the head chef proposed, at its price step: the
    // manager's figure waits on the owner; marketing's step is open.
    const tpl = await svc.from('protocol_templates').select('id, version')
      .eq('venue_id', VENUE_A_ID).eq('kind', 'product_release').single();
    if (tpl.error) throw new Error(tpl.error.message);
    const run = await svc.from('protocol_runs').insert({
      id: runId, venue_id: VENUE_A_ID, template_id: tpl.data.id, template_version: tpl.data.version,
      kind: 'product_release', title_en: 'Proto roles probe', started_by: ids.head_chef, data: {},
    });
    if (run.error) throw new Error(run.error.message);
    // Every row names every column: a PostgREST bulk insert fills a missing
    // key with NULL, not with the column default.
    const row = (id: string, position: number, key: string, en: string, ar: string, actors: string[],
                 ok: boolean, after: string[], status: string, assignedTo: string | null = null) => ({
      id, run_id: runId, position, step_key: key, name_en: en, name_ar: ar, actor_roles: actors,
      assigned_to: assignedTo, needs_owner_ok: ok, optional: false, after_keys: after, status,
    });
    const steps = await svc.from('protocol_run_steps').insert([
      row(step.propose, 1, 'propose', 'Proposal', 'الاقتراح', ['head_barista', 'head_chef'], false, [], 'passed'),
      row(step.test, 2, 'test', 'Test', 'التجربة', ['head_barista', 'head_chef'], false, ['propose'], 'passed',
          ids.head_chef),
      row(step.analysis, 3, 'analysis', 'Price', 'التسعير', ['manager'], true, ['test'], 'submitted'),
      row(step.marketing, 4, 'marketing', 'Marketing', 'التسويق', ['marketing'], true, ['test'], 'open'),
      row(step.launch, 5, 'launch', 'Launch', 'الإطلاق', ['owner'], false, ['analysis', 'marketing'], 'waiting'),
    ]);
    if (steps.error) throw new Error(steps.error.message);
    const subs = await svc.from('protocol_submissions').insert([
      { id: crypto.randomUUID(), run_step_id: step.propose, run_id: runId, round: 1, submitted_by: ids.head_chef,
        record: { name_en: 'Probe latte', lines: [] }, decision: 'approve',
        decided_by: SEED_STAFF_IDS.manager, decided_at: new Date().toISOString() },
      { id: analysisSub, run_step_id: step.analysis, run_id: runId, round: 1, submitted_by: SEED_STAFF_IDS.manager,
        record: { prices: [{ variant_id: NIL, price_iqd: 5000 }], name_en: 'Probe latte', name_ar: 'لاتيه', note: 'margin 62%' },
        decision: null, decided_by: null, decided_at: null },
    ]);
    if (subs.error) throw new Error(subs.error.message);
    const item = await svc.from('protocol_run_items')
      .insert({ run_step_id: step.marketing, position: 1, text_en: 'Shoot it', text_ar: 'صوّره' })
      .select('id').single();
    if (item.error) throw new Error(item.error.message);
    itemId = item.data.id;
  });

  afterAll(async () => {
    const del = await svc.from('protocol_runs').delete().eq('id', runId);
    expect(del.error).toBeNull();
    for (const role of ROLES) {
      await as[role]?.auth.signOut();
      if (!ids[role]) continue;
      const r = await svc.from('staff').delete().eq('id', ids[role]);
      expect(r.error, `staff delete ${role}`).toBeNull();
      await svc.auth.admin.deleteUser(ids[role]).catch(() => undefined);
    }
    for (const c of [owner, manager]) await c?.auth.signOut();
  });

  it('none of them reads a row of the seven tables; MGMT does', async () => {
    for (const t of TABLES.filter((x) => x !== 'protocol_template_items')) {
      const { data, error } = await manager.from(t).select('id').limit(1);
      expect(error, t).toBeNull();
      expect(data!.length, `manager reads ${t}`).toBeGreaterThan(0);
    }
    for (const role of ROLES) {
      for (const t of TABLES) {
        const { data, error } = await as[role].from(t).select('id').limit(1);
        expect(error, `${role} ${t}`).toBeNull();
        expect(data, `${role} ${t}`).toEqual([]);
      }
    }
  });

  it('only those involved read the run; the price step’s record and the run’s data stay hidden', async () => {
    // Involved: the starter, the other head (propose actor), marketing (its step's actor).
    for (const role of ['head_chef', 'head_barista', 'marketing'] as const) {
      const { data, error } = await appRpc(as[role], 'protocol_run_detail', { p_run_id: runId });
      expect(error, role).toBeNull();
      const d = data as Detail;
      const analysis = d.steps.find((s) => s.step_key === 'analysis')!;
      expect(analysis.submissions).toHaveLength(1);
      expect(analysis.submissions[0]).toMatchObject({ record: null, photos: [], decision_note: null });
      expect(d.steps.find((s) => s.step_key === 'propose')!.submissions[0]!.record).not.toBeNull();
      expect(d.run.data, role).toEqual(role === 'head_chef' ? {} : null);
      expect(moneyKeys(data), role).toEqual([]);

      const s = await appRpc(as[role], 'protocol_step_detail', { p_run_step_id: step.analysis });
      expect(s.error, role).toBeNull();
      expect(moneyKeys(s.data), role).toEqual([]);
    }
    // Not involved: no step of a product release is theirs.
    for (const role of ['barista', 'chef', 'driver'] as const) {
      for (const [fn, args] of [
        ['protocol_run_detail', { p_run_id: runId }],
        ['protocol_step_detail', { p_run_step_id: step.marketing }],
      ] as const) {
        expect((await appRpc(as[role], fn, args)).error?.message, `${role} ${fn}`).toBe('PROTOCOL_NOT_FOUND');
      }
      const page = await appRpc(as[role], 'protocol_runs_page', { p_venue_id: VENUE_A_ID, p_filter: 'active' });
      expect(page.error).toBeNull();
      expect((page.data as { runs: Array<{ id: string }> }).runs.map((r) => r.id), role).not.toContain(runId);
    }
    const mkPage = await appRpc(as.marketing, 'protocol_runs_page', { p_venue_id: VENUE_A_ID, p_filter: 'active' });
    expect((mkPage.data as { runs: Array<{ id: string }> }).runs.map((r) => r.id)).toContain(runId);
    // MGMT reads the figure.
    const mgr = await appRpc(manager, 'protocol_step_detail', { p_run_step_id: step.analysis });
    expect((mgr.data as { step: { submissions: Sub[] } }).step.submissions[0]!.record).toMatchObject({
      prices: [{ price_iqd: 5000 }],
    });
  });

  it('each is refused every MGMT and owner RPC', async () => {
    const calls: Array<[string, Record<string, unknown>]> = [
      ['protocols_overview', { p_venue_id: VENUE_A_ID }],
      ['protocol_template_detail', { p_template_id: NIL }],
      ['save_protocol_template', { p_template_id: NIL, p_expected_version: 1, p_name_en: 'x', p_name_ar: 'x', p_steps: [] }],
      ['stop_protocol', { p_run_id: runId, p_note: 'x' }],
      ['edit_run_items', { p_run_step_id: step.marketing, p_items: [] }],
      ['add_run_step', { p_run_id: runId, p_after_run_step_id: step.test, p_step: {} }],
    ];
    for (const role of ROLES) {
      for (const [fn, args] of calls) {
        expect((await appRpc(as[role], fn, args)).error?.message, `${role} ${fn}`).toBe('FORBIDDEN');
      }
    }
  });

  it('start_protocol admits exactly the starters of each kind', async () => {
    const kinds = ['product_release', 'tournament', 'hiring', 'price_promo'] as const;
    const starts: Record<Role, readonly string[]> = {
      head_barista: ['product_release'],
      head_chef: ['product_release'],
      barista: [],
      chef: [],
      driver: [],
      marketing: ['price_promo'],
    };
    for (const role of ROLES) {
      for (const kind of kinds) {
        // No first record: a caller past the guard stops at RECORD_INVALID.
        const { error } = await appRpc(as[role], 'start_protocol', {
          p_kind: kind, p_variant: kind === 'tournament' ? 'type1' : null, p_title_en: 'x',
        });
        expect(error?.message, `${role} ${kind}`).toBe(starts[role].includes(kind) ? 'RECORD_INVALID' : 'FORBIDDEN');
      }
    }
  });

  it('what each may do on the run: marketing its own step, nobody the price decision', async () => {
    const mkWork = await appRpc(as.marketing, 'my_protocol_work', { p_venue_id: VENUE_A_ID });
    expect(mkWork.error).toBeNull();
    const w = mkWork.data as { todo: Array<{ run_step_id: string }>; to_decide: unknown[] };
    expect(w.todo.map((t) => t.run_step_id)).toContain(step.marketing);
    expect(w.to_decide).toEqual([]);
    const mkStep = await appRpc(as.marketing, 'protocol_step_detail', { p_run_step_id: step.marketing });
    expect((mkStep.data as { can: { submit: boolean; tick: boolean } }).can).toMatchObject({ submit: true, tick: true });

    for (const role of ROLES) {
      const work = await appRpc(as[role], 'my_protocol_work', { p_venue_id: VENUE_A_ID });
      expect(work.error, role).toBeNull();
      const ww = work.data as { to_decide: Array<{ submission_id: string }>; todo: Array<{ run_step_id: string }> };
      expect(ww.to_decide.map((x) => x.submission_id), role).not.toContain(analysisSub);
      if (role !== 'marketing') expect(ww.todo.map((x) => x.run_step_id), role).not.toContain(step.marketing);
      // Same venue, so the role check answers (a row at another venue is PROTOCOL_NOT_FOUND, §2.1).
      const decide = await appRpc(as[role], 'decide_step', { p_submission_id: analysisSub, p_decision: 'approve' });
      expect(decide.error?.message, role).toBe('NOT_DECIDER');
      if (role !== 'marketing') {
        const tick = await appRpc(as[role], 'tick_run_item', { p_item_id: itemId, p_done: true });
        expect(tick.error?.message, role).toBe('NOT_STEP_ACTOR');
      }
    }
    // The price waits on the owner (needs the owner's OK), never on the manager who sent it.
    const ownerWork = await appRpc(owner, 'my_protocol_work', { p_venue_id: VENUE_A_ID });
    expect((ownerWork.data as { to_decide: Array<{ submission_id: string }> }).to_decide.map((x) => x.submission_id))
      .toContain(analysisSub);
    const mgrWork = await appRpc(manager, 'my_protocol_work', { p_venue_id: VENUE_A_ID });
    expect((mgrWork.data as { to_decide: Array<{ submission_id: string }> }).to_decide.map((x) => x.submission_id))
      .not.toContain(analysisSub);
  });
});
