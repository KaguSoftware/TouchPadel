/**
 * staff_push (build-contracts-2026-09-23 §2.4, §2.21) — work pushes through
 * the existing outbox.
 *
 *   * notify_staff holds exactly the kinds, title keys and routes of
 *     _shared/staff-push.json (send-push reads the same file; the phone's
 *     pushRoutes test reads its routes);
 *   * it queues one row per active recipient, never the caller, never a NULL,
 *     never an inactive account, dedupes within 15 minutes, and refuses a key
 *     outside the closed payload shape, so money cannot reach a lock screen;
 *   * the outbox CHECK admits the four staff kinds and still nothing else;
 *   * set_staff_active(false) clears the push token; a staff request tells the
 *     owners, once per requester in 15 minutes, and its decision tells the
 *     requester.
 *
 * notify_staff and staff_ids_with_roles are internal (no client grant), so
 * they are called through the stack's own container as postgres with the
 * caller's JWT claims set, the way assistant-wall.test.ts plants its probe.
 * Without docker on PATH those cases skip themselves.
 *
 * Self-contained: four auth users + staff rows at venue A through the service
 * role, deleted in afterAll with every outbox row and request they caused.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import type { SupabaseClient } from '@supabase/supabase-js';
import staffPush from '../supabase/functions/_shared/staff-push.json';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  anonymousSessionClient,
  appRpc,
  outcome,
  SEED_STAFF,
  SEED_STAFF_IDS,
  DEV_PASSWORD,
  VENUE_A_ID,
} from './helpers';

const up = await stackAvailable();
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';
const NOWHERE = '00000000-0000-4000-8000-00000000fade';

function psql(sql: string): string {
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      CONTAINER,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-qAt',
    ],
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

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Runs `query` as `uid` (auth.uid() reads the claims); returns its last output line. */
function as(uid: string | null, query: string): string {
  const claims = uid
    ? `select set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: uid, role: 'authenticated' }))}, true);`
    : '';
  const out = psql(`begin;\n${claims}\n${query};\ncommit;`);
  return out.split('\n').pop() ?? '';
}
/** The P0001 code (and hint) a query raised as `uid`, or null when it ran. */
function raised(uid: string | null, query: string): string | null {
  try {
    as(uid, query);
    return null;
  } catch (e) {
    const err = String((e as { stderr?: string }).stderr ?? e);
    const code = err.match(/ERROR:\s+(\S+)/)?.[1] ?? err;
    const hint = err.match(/HINT:\s+(.+)/)?.[1];
    return hint ? `${code}:${hint.trim()}` : code;
  }
}

function notify(
  ids: Array<string | null>,
  kind: string,
  payload: Record<string, unknown>,
  dedupe?: string,
): string {
  const arr = `array[${ids.map((i) => (i ? lit(i) : 'null')).join(',')}]::uuid[]`;
  const d = dedupe ? `, ${lit(dedupe)}` : '';
  return `select app.notify_staff(${arr}, ${lit(kind)}, ${lit(JSON.stringify(payload))}::jsonb${d})`;
}

describe.skipIf(!up)('staff_push', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  const ids = { barista: '', chef: '', gone: '', requester: '' };
  let requester: SupabaseClient;
  const requestIds: string[] = [];
  const probe = `push-${Date.now()}`;

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);

    const roles: Record<keyof typeof ids, string> = {
      barista: 'barista',
      chef: 'chef',
      gone: 'barista',
      requester: 'driver',
    };
    for (const [key, role] of Object.entries(roles) as Array<[keyof typeof ids, string]>) {
      const email = `staffpush-${key}-${Date.now()}@test.touch.local`;
      const { data, error } = await svc.auth.admin.createUser({
        email,
        password: DEV_PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`createUser ${key} failed: ${error?.message}`);
      ids[key] = data.user.id;
      const ins = await svc
        .from('staff')
        .insert({ id: data.user.id, display_name: `Push ${key}`, role, is_active: true });
      if (ins.error) throw new Error(`staff insert ${key} failed: ${ins.error.message}`);
      if (key === 'requester') requester = await signedInClient(email);
    }
    const off = await svc.from('staff').update({ is_active: false }).eq('id', ids.gone);
    expect(off.error).toBeNull();
  });

  afterAll(async () => {
    const staffIds = Object.values(ids).filter(Boolean);
    let r = await svc.from('notification_outbox').delete().in('profile_id', staffIds);
    expect(r.error).toBeNull();
    if (requestIds.length > 0) {
      r = await svc.from('notification_outbox').delete().in('payload->>id', requestIds);
      expect(r.error).toBeNull();
      r = await svc.from('staff_requests').delete().in('id', requestIds);
      expect(r.error).toBeNull();
      await svc.from('assistant_index_queue').delete().eq('kind', 'request').in('ref', requestIds);
    }
    r = await svc.from('notification_outbox').delete().like('payload->>id', `${probe}%`);
    expect(r.error).toBeNull();
    await requester?.auth.signOut();
    for (const id of staffIds) {
      r = await svc.from('staff').delete().eq('id', id);
      expect(r.error, `staff delete ${id}`).toBeNull();
      await svc.auth.admin.deleteUser(id).catch(() => undefined);
    }
    for (const c of [owner, manager]) await c?.auth.signOut();
  });

  async function rowsFor(profileId: string, id: string) {
    const { data, error } = await svc
      .from('notification_outbox')
      .select('profile_id, kind, payload')
      .eq('profile_id', profileId)
      .eq('payload->>id', id);
    expect(error).toBeNull();
    return data ?? [];
  }

  describe.skipIf(!docker)('app.notify_staff', () => {
    it('holds exactly the kinds, title keys and routes of _shared/staff-push.json', () => {
      const def = psql(
        `select pg_get_functiondef('app.notify_staff(uuid[],text,jsonb,text)'::regprocedure)`,
      );
      const list = (name: string) => {
        const m = def.match(new RegExp(`${name}\\s+constant text\\[\\] := array\\[([^\\]]*)\\]`));
        expect(m, name).not.toBeNull();
        return [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]);
      };
      expect(list('c_kinds')).toEqual(staffPush.kinds);
      expect(list('c_title_keys')).toEqual(staffPush.title_keys);
      expect(list('c_routes')).toEqual(staffPush.routes);
    });

    it('queues one row per active recipient: no NULL, no inactive account, never the caller', async () => {
      const payload = {
        route: 'staff-step',
        id: `${probe}-open`,
        title_key: 'step_open',
        params: { step: { en: 'Taste', ar: 'تذوق' }, title: 'Probe latte' },
      };
      const n = as(
        SEED_STAFF_IDS.manager,
        notify(
          [ids.barista, ids.chef, ids.gone, null, SEED_STAFF_IDS.manager, ids.chef],
          'staff_task',
          payload,
        ),
      );
      expect(n).toBe('2');
      for (const who of [ids.barista, ids.chef]) {
        const rows = await rowsFor(who, payload.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.kind).toBe('staff_task');
        expect(rows[0]!.payload).toEqual(payload);
      }
      expect(await rowsFor(ids.gone, payload.id)).toHaveLength(0);
      expect(await rowsFor(SEED_STAFF_IDS.manager, payload.id)).toHaveLength(0);
    });

    it('queues for everyone listed when no one is signed in (cron)', async () => {
      const id = `${probe}-cron`;
      const n = as(
        null,
        notify([ids.barista, SEED_STAFF_IDS.manager], 'staff_task', {
          route: 'staff-step',
          id,
          title_key: 'apply_not_ready',
          params: { title: 'Probe' },
        }),
      );
      expect(n).toBe('2');
      await svc.from('notification_outbox').delete().eq('payload->>id', id);
    });

    it('dedupes a recipient for 15 minutes on the same value, and only that recipient', async () => {
      const key = `shopping:${VENUE_A_ID}:${probe}`;
      const payload = {
        route: 'staff-shopping',
        id: `${probe}-shop`,
        title_key: 'shopping_new',
        params: {},
      };
      expect(as(SEED_STAFF_IDS.manager, notify([ids.barista], 'staff_task', payload, key))).toBe(
        '1',
      );
      expect(as(SEED_STAFF_IDS.manager, notify([ids.barista], 'staff_task', payload, key))).toBe(
        '0',
      );
      expect(
        as(SEED_STAFF_IDS.manager, notify([ids.barista, ids.chef], 'staff_task', payload, key)),
      ).toBe('1');
      const rows = await rowsFor(ids.barista, payload.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.payload).toEqual({ ...payload, dedupe: key });

      // Past the window the recipient is told again.
      await svc
        .from('notification_outbox')
        .update({ created_at: new Date(Date.now() - 16 * 60_000).toISOString() })
        .eq('profile_id', ids.barista)
        .eq('payload->>dedupe', key);
      expect(as(SEED_STAFF_IDS.manager, notify([ids.barista], 'staff_task', payload, key))).toBe(
        '1',
      );
    });

    it('refuses a kind, title key or route outside the list, and any key outside the payload shape', () => {
      const ok = { route: 'staff', id: `${probe}-x`, title_key: 'purchase_to_receive', params: {} };
      const m = SEED_STAFF_IDS.manager;
      expect(raised(m, notify([ids.barista], 'booking_confirmed', ok))).toBe(
        'INVALID_ARGUMENT:kind',
      );
      expect(
        raised(m, notify([ids.barista], 'staff_task', { ...ok, title_key: 'step_exploded' })),
      ).toBe('INVALID_ARGUMENT:title_key');
      expect(raised(m, notify([ids.barista], 'staff_task', { ...ok, route: 'booking' }))).toBe(
        'INVALID_ARGUMENT:route',
      );
      expect(raised(m, notify([ids.barista], 'staff_task', { ...ok, total_iqd: 45000 }))).toBe(
        'INVALID_ARGUMENT:payload',
      );
      expect(
        raised(
          m,
          notify([ids.barista], 'staff_task', { ...ok, params: { title: 'x', phone: '0770' } }),
        ),
      ).toBe('INVALID_ARGUMENT:params');
      expect(raised(m, notify([ids.barista], 'staff_task', { ...ok, params: 'x' }))).toBe(
        'INVALID_ARGUMENT:params',
      );
      expect(
        raised(
          m,
          `select app.notify_staff(array[${lit(ids.barista)}]::uuid[], 'staff_task', '[]'::jsonb)`,
        ),
      ).toBe('INVALID_ARGUMENT:payload');
    });

    it('is not callable by any client role', async () => {
      for (const c of [manager, owner, await anonymousSessionClient()]) {
        const r = await appRpc(c, 'notify_staff', {
          p_staff_ids: [ids.barista],
          p_kind: 'staff_task',
          p_payload: { route: 'staff', title_key: 'shopping_new' },
        });
        expect(r.error, 'notify_staff').not.toBeNull();
        const s = await appRpc(c, 'staff_ids_with_roles', {
          p_venue: VENUE_A_ID,
          p_roles: ['barista'],
        });
        expect(s.error, 'staff_ids_with_roles').not.toBeNull();
      }
      const d = await appRpc(requester, 'notify_staff', {
        p_staff_ids: [ids.barista],
        p_kind: 'staff_task',
        p_payload: { route: 'staff', title_key: 'shopping_new' },
      });
      expect(d.error, 'driver notify_staff').not.toBeNull();
    });
  });

  describe.skipIf(!docker)('app.staff_ids_with_roles', () => {
    const idsWith = (venue: string, roles: string[]) =>
      as(
        null,
        `select array_to_string(app.staff_ids_with_roles(${lit(venue)}::uuid, array[${roles.map(lit).join(',')}]::staff_role[]), ',')`,
      )
        .split(',')
        .filter(Boolean);

    it('lists the active holders of the roles at the venue', () => {
      const got = idsWith(VENUE_A_ID, ['barista', 'chef']);
      expect(got).toContain(ids.barista);
      expect(got).toContain(ids.chef);
      expect(got).not.toContain(ids.gone);
      expect(got).not.toContain(SEED_STAFF_IDS.manager);
    });

    it('counts owners at every venue, and nobody else at a venue they do not belong to', () => {
      expect(idsWith(VENUE_A_ID, ['owner', 'manager'])).toEqual(
        expect.arrayContaining([SEED_STAFF_IDS.owner, SEED_STAFF_IDS.manager]),
      );
      expect(idsWith(NOWHERE, ['owner', 'manager', 'barista'])).toEqual([SEED_STAFF_IDS.owner]);
      expect(idsWith(VENUE_A_ID, ['marketing'])).not.toContain(SEED_STAFF_IDS.owner);
    });
  });

  it('the outbox CHECK admits the four staff kinds and nothing new besides', async () => {
    for (const kind of staffPush.kinds) {
      const ins = await svc
        .from('notification_outbox')
        .insert({
          profile_id: ids.chef,
          kind,
          payload: { route: 'staff', id: `${probe}-kind`, title_key: 'shopping_new' },
        });
      expect(ins.error, kind).toBeNull();
    }
    const bad = await svc
      .from('notification_outbox')
      .insert({ profile_id: ids.chef, kind: 'staff_gossip', payload: {} });
    expect(bad.error?.code).toBe('23514');
  });

  it('set_staff_active(false) clears the push token, and switching back on does not restore it', async () => {
    const token = 'ExponentPushToken[staffpush_probe]';
    let r = await svc.from('profiles').update({ expo_push_token: token }).eq('id', ids.chef);
    expect(r.error).toBeNull();

    expect(
      outcome(await appRpc(owner, 'set_staff_active', { p_staff_id: ids.chef, p_active: false }))
        .ok,
    ).toBe(true);
    let p = await svc.from('profiles').select('expo_push_token').eq('id', ids.chef).single();
    expect(p.data?.expo_push_token).toBeNull();

    expect(
      outcome(await appRpc(owner, 'set_staff_active', { p_staff_id: ids.chef, p_active: true })).ok,
    ).toBe(true);
    p = await svc.from('profiles').select('expo_push_token').eq('id', ids.chef).single();
    expect(p.data?.expo_push_token).toBeNull();

    // A token is kept while the account stays on.
    r = await svc.from('profiles').update({ expo_push_token: token }).eq('id', ids.barista);
    expect(r.error).toBeNull();
    expect(
      outcome(await appRpc(owner, 'set_staff_active', { p_staff_id: ids.barista, p_active: true }))
        .ok,
    ).toBe(true);
    p = await svc.from('profiles').select('expo_push_token').eq('id', ids.barista).single();
    expect(p.data?.expo_push_token).toBe(token);
    await svc.from('profiles').update({ expo_push_token: null }).eq('id', ids.barista);
  });

  it('a staff request tells every active owner, with the requester’s name', async () => {
    const res = outcome(
      await appRpc(requester, 'submit_staff_request', {
        p_kind: 'leave',
        p_from: '2030-01-10',
        p_to: '2030-01-11',
      }),
    );
    expect(res.ok, res.errorMessage).toBe(true);
    const requestId = res.data as string;
    requestIds.push(requestId);

    const { data: owners } = await svc
      .from('staff')
      .select('id')
      .eq('role', 'owner')
      .eq('is_active', true);
    expect((owners ?? []).length).toBeGreaterThan(0);
    for (const o of owners ?? []) {
      const rows = await rowsFor(o.id as string, requestId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.kind).toBe('staff_decide');
      expect(rows[0]!.payload).toEqual({
        route: 'staff-request',
        id: requestId,
        title_key: 'request_submitted',
        params: { name: 'Push requester' },
        dedupe: `request:${ids.requester}`,
      });
    }
    expect(await rowsFor(ids.requester, requestId)).toHaveLength(0);
  });

  it('a decision tells the requester: approved, and declined', async () => {
    const approve = outcome(
      await appRpc(owner, 'decide_staff_request', { p_id: requestIds[0], p_approve: true }),
    );
    expect(approve.ok, approve.errorMessage).toBe(true);
    let rows = await rowsFor(ids.requester, requestIds[0]!);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('staff_decided');
    expect(rows[0]!.payload).toEqual({
      route: 'staff-request',
      id: requestIds[0],
      title_key: 'request_approved',
      params: {},
    });
    expect(await rowsFor(SEED_STAFF_IDS.owner, requestIds[0]!)).toHaveLength(1); // only the submit row

    const second = outcome(
      await appRpc(requester, 'submit_staff_request', { p_kind: 'advance', p_amount_iqd: 50000 }),
    );
    expect(second.ok, second.errorMessage).toBe(true);
    requestIds.push(second.data as string);
    const reject = outcome(
      await appRpc(owner, 'decide_staff_request', {
        p_id: second.data,
        p_approve: false,
        p_note: 'Not this month',
      }),
    );
    expect(reject.ok, reject.errorMessage).toBe(true);
    rows = await rowsFor(ids.requester, second.data as string);
    expect(rows).toHaveLength(1);
    expect((rows[0]!.payload as { title_key: string }).title_key).toBe('request_rejected');
    // The amount and the note stay in the app.
    expect(JSON.stringify(rows[0]!.payload)).not.toMatch(/50000|Not this month/);
    // The owners heard from this requester minutes ago (the leave above), so
    // the advance queues nothing for them: one push per requester in 15 minutes.
    expect(await rowsFor(SEED_STAFF_IDS.owner, second.data as string)).toHaveLength(0);
  });

  it('submit, withdraw and submit again reaches each owner once, not once a round', async () => {
    for (let round = 0; round < 3; round++) {
      const sub = outcome(
        await appRpc(requester, 'submit_staff_request', {
          p_kind: 'correction',
          p_from: '2030-01-12',
          p_note: 'Clock-out time',
        }),
      );
      expect(sub.ok, sub.errorMessage).toBe(true);
      requestIds.push(sub.data as string);
      const back = outcome(await appRpc(requester, 'withdraw_staff_request', { p_id: sub.data }));
      expect(back.ok, back.errorMessage).toBe(true);
    }
    const { data: owners } = await svc.from('staff').select('id').eq('role', 'owner').eq('is_active', true);
    for (const o of owners ?? []) {
      const { data, error } = await svc
        .from('notification_outbox')
        .select('payload')
        .eq('profile_id', o.id as string)
        .eq('payload->>dedupe', `request:${ids.requester}`);
      expect(error).toBeNull();
      // The leave request's row, and none of the four requests after it.
      expect(data, `owner ${o.id as string}`).toHaveLength(1);
      expect(JSON.stringify(data)).not.toMatch(/advance|correction/);
    }
  });
});
