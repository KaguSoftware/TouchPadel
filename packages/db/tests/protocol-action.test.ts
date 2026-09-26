/**
 * protocol-action (build-contracts-2026-09-23 §2.20, §8.2): the owner's launch
 * and the 5-minute tick.
 *
 *   * the pure half (supabase/functions/protocol-action/logic.ts), no Deno:
 *     the body parsed, the one menu path a launch writes, and both flows
 *     against fake ports: a launch now copies this run's photo to
 *     items/<item>/<run>.<ext> and only then sends the step with the record
 *     the SQL check accepts; a photo that is not this run's is refused before
 *     anything is copied; a date copies nothing; a refused submit keeps its
 *     code, hint and status and takes its copy back out of the public menu
 *     bucket; a retry of a launch that went through never copies over or
 *     removes the live photo; the tick launches, reverts, skips, purges,
 *     removes the copy of what did not launch, and one bad run never stops
 *     the others; then it removes the photos of incident reports past their
 *     purge date (wave5-addendum-2026-09-25 §2.6.2), and last the incident
 *     and campaign photos nobody claimed a day on; a database without either
 *     yet costs one failure each and none of the counts before it;
 *   * with the stack (a rolled-back transaction): the SQL the function drives
 *     (the incident and orphan photo pairs included) answers the service role and
 *     refuses every client role (42501), the driver and marketing included; neither may send a launch step
 *     (NOT_STEP_ACTOR); the run's choosable photos are its test photos;
 *   * against the served function (skipped when the local edge runtime does
 *     not serve it yet, `supabase functions serve` does): a driver's and a
 *     marketing account's session are refused FORBIDDEN, and a tick without
 *     the service key is refused.
 */
import { execFileSync } from 'node:child_process';
import { describe, it, expect, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ANON_KEY,
  SEED_STAFF_IDS,
  SEED_TAX_GROUP_STANDARD,
  SUPABASE_URL,
  VENUE_A_ID,
  serviceClient,
  signedInClient,
  stackAvailable,
} from './helpers';
import {
  STAFF_MEDIA_PATH_RE,
  contentTypeOf,
  extOf,
  launch,
  launchRecord,
  menuPhotoPath,
  parseRequest,
  tick,
  type LaunchPorts,
  type LaunchRequest,
  type LaunchStep,
  type TickPorts,
} from '../supabase/functions/protocol-action/logic.ts';

const RUN = '11111111-1111-4111-8111-111111111111';
const STEP = '22222222-2222-4222-8222-222222222222';
const ITEM = '33333333-3333-4333-8333-333333333333';
const PHOTO = `${VENUE_A_ID}/tests/44444444-4444-4444-8444-444444444444.webp`;
const OTHER = `${VENUE_A_ID}/receipts/55555555-5555-4555-8555-555555555555.jpg`;
const INCIDENT = `${VENUE_A_ID}/incidents/66666666-6666-4666-8666-666666666666.png`;
const ORPHAN = `${VENUE_A_ID}/incidents/77777777-7777-4777-8777-777777777777.jpg`;
const CAMPAIGN = `${VENUE_A_ID}/campaigns/88888888-8888-4888-8888-888888888888.webp`;

describe('protocol-action: the request', () => {
  it('parses a launch and a tick, and refuses anything malformed', () => {
    expect(parseRequest({ action: 'tick' })).toEqual({ ok: true, value: { action: 'tick' } });
    expect(parseRequest({ action: 'launch', run_step_id: STEP.toUpperCase(), when: 'now', photo_path: PHOTO, idempotency_key: 'k1' })).toEqual({
      ok: true,
      value: { action: 'launch', run_step_id: STEP, when: 'now', at: null, photo_path: PHOTO, idempotency_key: 'k1' },
    });
    const date = parseRequest({ action: 'launch', run_step_id: STEP, when: 'date', at: '2026-10-01T09:00:00Z', photo_path: PHOTO });
    expect(date).toMatchObject({ ok: true, value: { when: 'date', at: '2026-10-01T09:00:00Z', idempotency_key: null } });
    const bad = (body: unknown) => (parseRequest(body) as { ok: boolean }).ok;
    expect(bad(null)).toBe(false);
    expect(bad({ action: 'publish' })).toBe(false);
    expect(bad({ action: 'launch', run_step_id: 'x', when: 'now', photo_path: PHOTO })).toBe(false);
    expect(bad({ action: 'launch', run_step_id: STEP, when: 'soon', photo_path: PHOTO })).toBe(false);
    expect(bad({ action: 'launch', run_step_id: STEP, when: 'date', photo_path: PHOTO })).toBe(false);
    expect(bad({ action: 'launch', run_step_id: STEP, when: 'now', photo_path: 'items/x/y.jpg' })).toBe(false);
    expect(bad({ action: 'launch', run_step_id: STEP, when: 'now', photo_path: PHOTO, at: 'tomorrow' })).toBe(false);
  });

  it('derives the one menu path a launch writes', () => {
    expect(STAFF_MEDIA_PATH_RE.test(PHOTO)).toBe(true);
    expect(STAFF_MEDIA_PATH_RE.test(INCIDENT)).toBe(true);
    expect(STAFF_MEDIA_PATH_RE.test(INCIDENT.replace('incidents', 'selfies'))).toBe(false);
    expect(extOf(PHOTO)).toBe('webp');
    expect(contentTypeOf('jpg')).toBe('image/jpeg');
    expect(contentTypeOf('png')).toBe('image/png');
    expect(menuPhotoPath(ITEM, RUN, PHOTO)).toBe(`items/${ITEM}/${RUN}.webp`);
    expect(menuPhotoPath(ITEM, RUN, 'x.gif')).toBeNull();
    const now: LaunchRequest = { action: 'launch', run_step_id: STEP, when: 'now', at: null, photo_path: PHOTO, idempotency_key: null };
    expect(launchRecord(now, 'items/a/b.webp')).toEqual({ when: 'now', photo_path: PHOTO, menu_photo_path: 'items/a/b.webp' });
    expect(launchRecord({ ...now, when: 'date', at: '2026-10-01T09:00:00Z' }, null)).toEqual({
      when: 'date',
      at: '2026-10-01T09:00:00Z',
      photo_path: PHOTO,
    });
  });
});

function fakeLaunch(
  step: Partial<LaunchStep> | null,
  answer: { data?: unknown; error?: { code: string; message: string; hint?: string } } = {},
  /** The item's current photo: a launch that went through shows the menu path. */
  itemPhoto: string | null = null,
) {
  const calls: string[] = [];
  const sent: Array<{ record: Record<string, unknown>; key: string | null }> = [];
  const ports: LaunchPorts = {
    step: async () =>
      step === null ? null : { run_id: RUN, menu_item_id: ITEM, step_key: 'launch', kind: 'product_release', photos: [PHOTO], ...step },
    copyPhoto: async (from, to, type) => {
      calls.push(`copy ${from} -> ${to} (${type})`);
      if (step?.photos?.includes('fail-copy')) throw new Error('storage down');
    },
    submit: async (_id, record, key) => {
      calls.push('submit');
      sent.push({ record, key });
      return { data: answer.data ?? null, error: answer.error ? { ...answer.error, details: null } : null };
    },
    menuPhotoInUse: async (_item, path) => itemPhoto === path,
    removeMenuPhoto: async (path) => {
      calls.push(`remove ${path}`);
    },
    log: () => undefined,
  };
  return { ports, calls, sent };
}

describe('protocol-action: the launch', () => {
  const req: LaunchRequest = { action: 'launch', run_step_id: STEP, when: 'now', at: null, photo_path: PHOTO, idempotency_key: 'K' };

  it('copies this run’s photo first, then sends the launch with the copied path', async () => {
    const f = fakeLaunch({}, { data: { submission_id: 's', auto: true, run_status: 'live' } });
    const res = await launch(req, f.ports);
    expect(res).toEqual({ status: 200, body: { submission_id: 's', auto: true, run_status: 'live' } });
    expect(f.calls).toEqual([`copy ${PHOTO} -> items/${ITEM}/${RUN}.webp (image/webp)`, 'submit']);
    expect(f.sent).toEqual([{ record: { when: 'now', photo_path: PHOTO, menu_photo_path: `items/${ITEM}/${RUN}.webp` }, key: 'K' }]);
  });

  it('copies nothing for a launch on a date', async () => {
    const f = fakeLaunch({}, { data: { run_status: 'scheduled' } });
    await launch({ ...req, when: 'date', at: '2026-10-01T09:00:00Z' }, f.ports);
    expect(f.calls).toEqual(['submit']);
    expect(f.sent[0]!.record).toEqual({ when: 'date', at: '2026-10-01T09:00:00Z', photo_path: PHOTO });
  });

  it('refuses a photo that is not this run’s before anything reaches the menu bucket', async () => {
    const f = fakeLaunch({});
    expect(await launch({ ...req, photo_path: OTHER }, f.ports)).toEqual({
      status: 400,
      body: { error: 'RECORD_INVALID', message: 'RECORD_INVALID', hint: 'photo_path' },
    });
    expect(f.calls).toEqual([]);
  });

  it('answers a step that is not a release launch as not found', async () => {
    expect((await launch(req, fakeLaunch(null).ports)).status).toBe(404);
    expect((await launch(req, fakeLaunch({ step_key: 'test' }).ports)).body.error).toBe('PROTOCOL_NOT_FOUND');
    expect((await launch(req, fakeLaunch({ kind: 'price_promo' }).ports)).body.error).toBe('PROTOCOL_NOT_FOUND');
  });

  it('keeps the SQL refusal’s code, hint and status', async () => {
    const notReady = fakeLaunch({}, { error: { code: 'P0001', message: 'RELEASE_NOT_READY', hint: 'prices,recipe' } });
    expect(await launch(req, notReady.ports)).toEqual({
      status: 400,
      body: { error: 'RELEASE_NOT_READY', message: 'RELEASE_NOT_READY', hint: 'prices,recipe' },
    });
    const forbidden = fakeLaunch({}, { error: { code: 'P0001', message: 'FORBIDDEN' } });
    expect((await launch(req, forbidden.ports)).status).toBe(403);
  });

  it('takes a refused launch’s copy back out of the public menu bucket', async () => {
    const menu = `items/${ITEM}/${RUN}.webp`;
    const notReady = fakeLaunch({}, { error: { code: 'P0001', message: 'RELEASE_NOT_READY', hint: 'recipe' } });
    expect((await launch(req, notReady.ports)).body.error).toBe('RELEASE_NOT_READY');
    expect(notReady.calls).toEqual([`copy ${PHOTO} -> ${menu} (image/webp)`, 'submit', `remove ${menu}`]);
    // A date copies nothing, so a refused one removes nothing.
    const date = fakeLaunch({}, { error: { code: 'P0001', message: 'STEP_NOT_OPEN' } });
    await launch({ ...req, when: 'date', at: '2026-10-01T09:00:00Z' }, date.ports);
    expect(date.calls).toEqual(['submit']);
  });

  it('never copies over, or removes, the photo of a launch that went through', async () => {
    const menu = `items/${ITEM}/${RUN}.webp`;
    // A retry with the same key: the step replays, nothing is copied.
    const retry = fakeLaunch({}, { data: { submission_id: 's', run_status: 'live' } }, menu);
    expect((await launch(req, retry.ports)).status).toBe(200);
    expect(retry.calls).toEqual(['submit']);
    // A second launch with a new key is refused: the live photo stays.
    const again = fakeLaunch({}, { error: { code: 'P0001', message: 'STEP_NOT_OPEN' } }, menu);
    await launch(req, again.ports);
    expect(again.calls).toEqual(['submit']);
  });

  it('stops at a failed copy without sending the step', async () => {
    const f = fakeLaunch({ photos: [PHOTO, 'fail-copy'] });
    const res = await launch(req, f.ports);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('UPSTREAM');
    expect(f.calls.filter((c) => c === 'submit')).toEqual([]);
  });
});

describe('protocol-action: the tick', () => {
  it('launches, reverts, skips and purges, and one bad run never stops the others', async () => {
    const log: string[] = [];
    const ports: TickPorts = {
      dueLaunches: async () => [
        { run_id: 'r1', venue_id: VENUE_A_ID, menu_item_id: 'i1', photo_path: PHOTO },
        { run_id: 'r2', venue_id: VENUE_A_ID, menu_item_id: 'i2', photo_path: PHOTO },
        { run_id: 'r3', venue_id: VENUE_A_ID, menu_item_id: null, photo_path: PHOTO },
        { run_id: 'r4', venue_id: VENUE_A_ID, menu_item_id: 'i4', photo_path: PHOTO },
        { run_id: 'r5', venue_id: VENUE_A_ID, menu_item_id: 'i5', photo_path: PHOTO },
        { run_id: 'r6', venue_id: VENUE_A_ID, menu_item_id: 'i6', photo_path: PHOTO },
      ],
      copyPhoto: async (_from, to) => {
        log.push(`copy ${to}`);
        if (to.includes('i4')) throw new Error('storage down');
      },
      launchScheduled: async (runId) => {
        if (runId === 'r6') throw new Error('RECORD_INVALID');
        return ({ r1: 'launched', r2: 'reverted', r5: 'skipped' } as Record<string, string>)[runId] ?? 'launched';
      },
      purgeDue: async () => [
        { run_id: 'p1', paths: [PHOTO, 'not/a/staff/path.jpg'] },
        { run_id: 'p2', paths: [] },
        { run_id: 'p3', paths: [OTHER] },
      ],
      removePhotos: async (paths) => {
        log.push(`remove ${paths.join(',')}`);
        if (paths.includes(OTHER)) throw new Error('remove failed');
      },
      markPurged: async (runId) => {
        log.push(`purged ${runId}`);
      },
      incidentPurgeDue: async () => [],
      markIncidentPurged: async () => undefined,
      orphanPurgeDue: async () => [],
      markOrphansPurged: async () => undefined,
      // r5's item is live already (a launch that went through meanwhile).
      menuPhotoInUse: async (itemId) => itemId === 'i5',
      removeMenuPhoto: async (path) => {
        log.push(`remove menu ${path}`);
      },
      log: () => undefined,
    };
    expect(await tick(ports)).toEqual({ launched: 1, reverted: 1, skipped: 1, failed: 4, purged: 2, incidents_purged: 0, orphans_purged: 0 });
    expect(log).toContain(`copy items/i1/r1.webp`);
    // What did not launch leaves nothing public: the reverted copy and the
    // refused one are removed; the launched one, a copy that never landed
    // and a live photo stay.
    expect(log.filter((l) => l.startsWith('remove menu'))).toEqual([
      'remove menu items/i2/r2.webp',
      'remove menu items/i6/r6.webp',
    ]);
    // Only staff-media paths are removed; an empty run is still marked.
    expect(log).toContain(`remove ${PHOTO}`);
    expect(log).toContain('purged p1');
    expect(log).toContain('purged p2');
    expect(log).not.toContain('purged p3');
  });
  /** Ports with one launch and one run purge, and the incident and orphan phases as given. */
  function incidentPorts(
    due: () => Promise<Array<{ incident_id: string; paths: string[] }>>,
    log: string[],
    orphans: () => Promise<string[]> = async () => [],
  ): TickPorts {
    return {
      dueLaunches: async () => [{ run_id: 'r1', venue_id: VENUE_A_ID, menu_item_id: 'i1', photo_path: PHOTO }],
      copyPhoto: async () => undefined,
      launchScheduled: async () => 'launched',
      purgeDue: async () => [{ run_id: 'p1', paths: [PHOTO] }],
      removePhotos: async (paths) => {
        log.push(`remove ${paths.join(',')}`);
        if (paths.includes(OTHER)) throw new Error('remove failed');
      },
      markPurged: async (runId) => {
        log.push(`purged ${runId}`);
      },
      incidentPurgeDue: due,
      markIncidentPurged: async (id) => {
        log.push(`incident ${id}`);
      },
      orphanPurgeDue: orphans,
      markOrphansPurged: async (paths) => {
        log.push(`orphans ${paths.join(',')}`);
      },
      menuPhotoInUse: async () => false,
      removeMenuPhoto: async () => undefined,
      log: (m) => log.push(`log ${m}`),
    };
  }

  it('removes the photos of incident reports past their purge date, last, one report at a time', async () => {
    const log: string[] = [];
    const ports = incidentPorts(
      async () => [
        { incident_id: 'n1', paths: [INCIDENT, 'items/not/staff.jpg'] },
        { incident_id: 'n2', paths: [OTHER] },
        { incident_id: 'n3', paths: [] },
      ],
      log,
    );
    expect(await tick(ports)).toEqual({ launched: 1, reverted: 0, skipped: 0, failed: 1, purged: 1, incidents_purged: 2, orphans_purged: 0 });
    // Only staff-media paths are removed; a report whose removal failed stays
    // due; one with nothing left to remove is still marked.
    expect(log).toContain(`remove ${INCIDENT}`);
    expect(log).toContain('incident n1');
    expect(log).not.toContain('incident n2');
    expect(log).toContain('incident n3');
    expect(log.indexOf('purged p1')).toBeLessThan(log.indexOf(`remove ${INCIDENT}`));
  });

  it('keeps the launch and run-purge counts when the incident list cannot be read', async () => {
    const log: string[] = [];
    const ports = incidentPorts(async () => {
      throw new Error('incident_photo_purge_due: Could not find the function (PGRST202)');
    }, log);
    expect(await tick(ports)).toEqual({ launched: 1, reverted: 0, skipped: 0, failed: 1, purged: 1, incidents_purged: 0, orphans_purged: 0 });
    expect(log.some((l) => /^log incident purge: .*PGRST202/.test(l))).toBe(true);
  });

  it('removes the photos nobody claimed, last, then lets their slots go', async () => {
    const log: string[] = [];
    const ports = incidentPorts(async () => [{ incident_id: 'n1', paths: [INCIDENT] }], log, async () => [ORPHAN, CAMPAIGN]);
    expect(await tick(ports)).toEqual({ launched: 1, reverted: 0, skipped: 0, failed: 0, purged: 1, incidents_purged: 1, orphans_purged: 2 });
    expect(log.slice(-2)).toEqual([`remove ${ORPHAN},${CAMPAIGN}`, `orphans ${ORPHAN},${CAMPAIGN}`]);
    expect(log.indexOf('incident n1')).toBeLessThan(log.indexOf(`remove ${ORPHAN},${CAMPAIGN}`));
  });

  it('keeps the slots when the objects could not be removed, and every count before', async () => {
    const log: string[] = [];
    const failing = incidentPorts(async () => [], log, async () => [ORPHAN, OTHER]);
    expect(await tick(failing)).toEqual({ launched: 1, reverted: 0, skipped: 0, failed: 1, purged: 1, incidents_purged: 0, orphans_purged: 0 });
    expect(log.some((l) => l.startsWith('orphans'))).toBe(false);
    const missing = incidentPorts(async () => [], [], async () => {
      throw new Error('staff_media_orphan_purge_due: Could not find the function (PGRST202)');
    });
    expect(await tick(missing)).toEqual({ launched: 1, reverted: 0, skipped: 0, failed: 1, purged: 1, incidents_purged: 0, orphans_purged: 0 });
  });
});

// ── with the stack ──────────────────────────────────────────────────────────
const up = await stackAvailable();
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
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

/** An owner-run release brought to its launch step, then the calls, in one rolled-back transaction. */
function stackScenario(): Record<string, { ok: boolean; data?: unknown; state?: string; code?: string }> {
  const call = (label: string, claims: string, role: string, sql: string) => `
    select set_config('request.jwt.claims', (${claims})::text, true);
    set local role ${role};
    do $d$ begin
      insert into pg_temp.out values ('${label}', jsonb_build_object('ok', true, 'data', (${sql})));
    exception when others then
      insert into pg_temp.out values ('${label}', jsonb_build_object('ok', false, 'code', sqlerrm, 'state', sqlstate));
    end $d$;
    reset role;`;
  const svc = `json_build_object('role', 'service_role')`;
  const staff = (name: string) => `json_build_object('sub', (select val from pg_temp.v where name = '${name}'), 'role', 'authenticated')`;
  const val = (name: string) => `(select val from pg_temp.v where name = '${name}')`;
  const launchRecord = `jsonb_build_object('when', 'now', 'photo_path', ${val('photo')}, 'menu_photo_path', ${val('menu')})`;
  const raw = psql(`
    begin;
    create temp table out (label text, res jsonb);
    grant all on pg_temp.out to service_role, authenticated;
    create temp table v (name text primary key, val text);
    grant select on pg_temp.v to service_role, authenticated;
    do $s$
    declare
      v_cat uuid; v_ing uuid; v_run uuid; v_item uuid; v_var uuid; v_photo text; v_step uuid;
      v_mkt uuid := gen_random_uuid(); v_drv uuid := gen_random_uuid();
    begin
      insert into auth.users (id, email, raw_user_meta_data, aud, role) values
        (v_mkt, 'pa-mkt-' || v_mkt || '@test.touch.local', '{}', 'authenticated', 'authenticated'),
        (v_drv, 'pa-drv-' || v_drv || '@test.touch.local', '{}', 'authenticated', 'authenticated');
      insert into staff (id, display_name, role, is_active) values
        (v_mkt, 'PA marketing', 'marketing', true), (v_drv, 'PA driver', 'driver', true);
      insert into menu_categories (name_en, name_ar, tax_group_id, is_active, venue_id, kind)
      values ('PA cakes', 'كعك', '${SEED_TAX_GROUP_STANDARD}', true, '${VENUE_A_ID}', 'cafe') returning id into v_cat;
      insert into ingredients (kind, name_en, name_ar, unit, is_active, venue_id)
      values ('purchased', 'PA butter', 'زبدة', 'g', true, '${VENUE_A_ID}') returning id into v_ing;
      perform set_config('request.jwt.claims', json_build_object('sub', '${SEED_STAFF_IDS.owner}', 'role', 'authenticated')::text, true);
      v_run := (app.start_protocol('product_release', null, 'Butter cake', 'كعكة الزبدة', '{}'::jsonb,
                  jsonb_build_object('name_en', 'Butter cake', 'item_kind', 'dessert', 'category_id', v_cat,
                    'lines', jsonb_build_array(jsonb_build_object('ingredient_id', v_ing, 'qty', 40, 'unit', 'g')),
                    'sizes', jsonb_build_array(jsonb_build_object('name_en', 'Slice'))),
                  '{}'::text[], '${VENUE_A_ID}', null)->>'run_id')::uuid;
      select menu_item_id into v_item from protocol_runs where id = v_run;
      select id into v_var from menu_item_variants where item_id = v_item;
      v_photo := app.staff_media_slot('${VENUE_A_ID}', 'tests', 'jpg')->>'path';
      select id into v_step from protocol_run_steps where run_id = v_run and step_key = 'test';
      perform app.submit_step(v_step, jsonb_build_object('servings', jsonb_build_array(jsonb_build_object('variant_id', v_var, 'count', 1))), array[v_photo]);
      select id into v_step from protocol_run_steps where run_id = v_run and step_key = 'analysis';
      perform app.submit_step(v_step, jsonb_build_object('prices', jsonb_build_array(jsonb_build_object('variant_id', v_var, 'price_iqd', 3000)),
                                                         'name_en', 'Butter cake', 'name_ar', 'كعكة الزبدة'), '{}'::text[]);
      select id into v_step from protocol_run_steps where run_id = v_run and step_key = 'marketing';
      perform app.submit_step(v_step, jsonb_build_object('highlights_en', 'Rich', 'highlights_ar', 'غنية'), '{}'::text[]);
      select id into v_step from protocol_run_steps where run_id = v_run and step_key = 'launch';
      -- What the function's copy leaves in the public menu bucket.
      insert into storage.objects (bucket_id, name) values ('menu-media', app.release_menu_photo_path(v_run, v_photo));
      insert into pg_temp.v values ('run', v_run::text), ('launch', v_step::text), ('photo', v_photo),
                                   ('menu', app.release_menu_photo_path(v_run, v_photo)),
                                   ('drv', v_drv::text), ('mkt', v_mkt::text), ('owner', '${SEED_STAFF_IDS.owner}');
    end $s$;
    ${call('photos', svc, 'service_role', `to_jsonb(app.release_run_photos(${val('run')}::uuid))`)}
    ${call('due', svc, 'service_role', `app.release_due_launches(10)`)}
    ${call('purge', svc, 'service_role', `app.protocol_photo_purge_due(10)`)}
    ${call('inc_due', svc, 'service_role', `app.incident_photo_purge_due(10)`)}
    ${call('orph_due', svc, 'service_role', `app.staff_media_orphan_purge_due(10)`)}
    ${call('orph_purged', svc, 'service_role', `to_jsonb(app.staff_media_orphans_purged('{}'::text[]))`)}
    ${['drv', 'mkt']
      .map(
        (w) => `
    ${call(`${w}_launch`, staff(w), 'authenticated', `app.submit_step(${val('launch')}::uuid, ${launchRecord}, '{}'::text[], null)`)}
    ${call(`${w}_photos`, staff(w), 'authenticated', `to_jsonb(app.release_run_photos(${val('run')}::uuid))`)}
    ${call(`${w}_due`, staff(w), 'authenticated', `app.release_due_launches(10)`)}
    ${call(`${w}_purged`, staff(w), 'authenticated', `to_jsonb(app.protocol_photos_purged(${val('run')}::uuid))`)}
    ${call(`${w}_inc_due`, staff(w), 'authenticated', `app.incident_photo_purge_due(10)`)}
    ${call(`${w}_inc_purged`, staff(w), 'authenticated', `to_jsonb(app.incident_photos_purged(gen_random_uuid()))`)}
    ${call(`${w}_orph_due`, staff(w), 'authenticated', `app.staff_media_orphan_purge_due(10)`)}
    ${call(`${w}_orph_purged`, staff(w), 'authenticated', `to_jsonb(app.staff_media_orphans_purged('{}'::text[]))`)}`,
      )
      .join('\n')}
    ${call('owner_launch', staff('owner'), 'authenticated', `app.submit_step(${val('launch')}::uuid, ${launchRecord}, '{}'::text[], null)`)}
    select label || E'\\t' || res::text from pg_temp.out union all select '__photo' || E'\\t' || to_jsonb(val)::text from pg_temp.v where name = 'photo';
    rollback;`);
  const out: Record<string, { ok: boolean; data?: unknown; state?: string; code?: string }> = {};
  for (const line of raw.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const label = line.slice(0, tab);
    const value = JSON.parse(line.slice(tab + 1));
    out[label] = label === '__photo' ? { ok: true, data: value } : value;
  }
  return out;
}

describe.skipIf(!docker)('protocol-action: the SQL it drives (rolled-back transaction)', () => {
  it('answers the service role, and refuses the driver and marketing everything', () => {
    const r = stackScenario();
    const photo = r.__photo!.data as string;
    expect(r.photos).toEqual({ ok: true, data: [photo] });
    expect(r.due!.ok).toBe(true);
    expect(r.purge!.ok).toBe(true);
    expect(r.inc_due!.ok).toBe(true);
    expect(r.orph_due!.ok).toBe(true);
    expect(r.orph_purged).toMatchObject({ ok: true, data: 0 });
    for (const w of ['drv', 'mkt']) {
      expect(r[`${w}_launch`], w).toMatchObject({ ok: false, code: 'NOT_STEP_ACTOR' });
      for (const fn of ['photos', 'due', 'purged', 'inc_due', 'inc_purged', 'orph_due', 'orph_purged']) {
        expect(r[`${w}_${fn}`], `${w}_${fn}`).toMatchObject({ ok: false, state: '42501' });
      }
    }
    expect(r.owner_launch).toMatchObject({ ok: true, data: { auto: true, run_status: 'live' } });
  });
});

// ── against the served function ─────────────────────────────────────────────
const FN_URL = `${SUPABASE_URL}/functions/v1/protocol-action`;
async function served(): Promise<boolean> {
  if (!up) return false;
  try {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const text = await res.text();
    return !(res.status === 404 && /function not found/i.test(text));
  } catch {
    return false;
  }
}
const isServed = await served();

describe.skipIf(!isServed)('protocol-action: the served function', () => {
  const svc: SupabaseClient | null = isServed ? serviceClient() : null;
  const made: string[] = [];
  afterAll(async () => {
    for (const id of made) {
      await svc!.from('staff').delete().eq('id', id);
      await svc!.auth.admin.deleteUser(id);
    }
  });

  async function staffSession(role: 'driver' | 'marketing'): Promise<string> {
    const email = `pa-edge-${role}-${crypto.randomUUID()}@test.touch.local`;
    const password = `pa-${crypto.randomUUID()}`;
    const { data, error } = await svc!.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    made.push(data.user.id);
    const ins = await svc!.from('staff').insert({ id: data.user.id, display_name: `PA edge ${role}`, role, is_active: true });
    if (ins.error) throw new Error(`staff: ${ins.error.message}`);
    const c = await signedInClient(email, password);
    const { data: s } = await c.auth.getSession();
    return s.session!.access_token;
  }

  const post = (token: string, body: unknown) =>
    fetch(FN_URL, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const launchBody = { action: 'launch', run_step_id: STEP, when: 'now', photo_path: PHOTO, idempotency_key: null };

  it('refuses a driver’s and a marketing session, and a tick without the service key', async () => {
    for (const role of ['driver', 'marketing'] as const) {
      const res = await post(await staffSession(role), launchBody);
      expect(res.status, role).toBe(403);
      expect(((await res.json()) as { error: string }).error, role).toBe('FORBIDDEN');
    }
    const tickRes = await post(await staffSession('driver'), { action: 'tick' });
    expect(tickRes.status).toBe(403);
    const bad = await post(ANON_KEY, { action: 'launch' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe('BAD_REQUEST');
  });
});
