/**
 * The ticket helpers of 0260 on committed rows, with the ledger invariants
 * (docs/design/open-matches/db.md §2.4, §3.5, §4.5.4; money.md §5.8, §9;
 * build contracts R16, R17, R18).
 *
 * The tickets are real purchases (ticket-begin's prepare and a SUCCESS through
 * deposit_apply, over HTTP as in tickets.test.ts), so money.md §9's
 * assertTicketLedger (T1–T12) can read them. Matches have no client write
 * before 0261, so each step below is one committed psql transaction that does
 * what the 0261/0262 bodies will do with these helpers: pick, lock, reserve,
 * approve, book, mark, correct, end. The ledger is asserted after every step,
 * for every guest touched. The R17 refusals run in a transaction that is
 * rolled back (they must change nothing, and nothing is committed if one
 * did).
 *
 * What stays behind: a match and a booking on this file's own court at venue
 * A, both cancelled, and a second match cancelled; every ticket back in its
 * wallet or refunded.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SEED_STAFF,
  SEED_STAFF_IDS,
  VENUE_A_ID,
  appRpc,
  assertTicketLedger,
  createTestCourt,
  guestClient,
  serviceClient,
  signedInClient,
  stackAvailable,
} from './helpers';
import { dockerReachable, psql } from './stores-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;
const TERMS = '2026-09-23';

/**
 * One step as postgres, committed (or rolled back): `body` is the plpgsql of a
 * function returning jsonb; `prelude` is SQL run first in the transaction.
 */
function step(body: string, commit = true, prelude = ''): Json {
  const out = psql(`begin;
${prelude}
create function pg_temp.step() returns jsonb language plpgsql as $step$
${body}
$step$;
select pg_temp.step()::text;
${commit ? 'commit' : 'rollback'};`);
  return JSON.parse(out.split('\n').filter(Boolean).at(-1)!) as Json;
}

/** A refusal captured inside a step: the value, or {error, detail}. */
const TRY = String.raw`
create function pg_temp.try(p_sql text) returns jsonb language plpgsql as $f$
declare v jsonb; v_msg text; v_detail text;
begin
  execute p_sql into v;
  return v;
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return jsonb_build_object('error', v_msg, 'detail', nullif(v_detail, ''));
end $f$;`;

describe.skipIf(!docker)('0260 ticket helpers on committed tickets: ownership (R17), deleted holders (R18), the ledger', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let savedEnabled: boolean;
  let court: string;
  const touched = new Set<string>();
  const g = { g1: '', g2: '', g3: '' };
  const ids = { m: '', s1: '', s2: '', q: '', t1: '', t2: '', tq: '', s3: '', res: '' };

  const rpc = async (c: SupabaseClient, fn: string, args: Json) => {
    const { data, error } = await appRpc(c, fn, args);
    return { ok: !error, code: error?.message, data };
  };

  /** A guest who may buy, with `count` paid tickets (the fake bank says SUCCESS). */
  const guestWithTickets = async (tag: string, count: number) => {
    const client = await guestClient(svc, tag);
    const { data } = await client.auth.getUser();
    const id = data.user!.id;
    expect((await rpc(client, 'accept_terms', { p_version: TERMS })).ok).toBe(true);
    const p = await rpc(svc, 'ticket_payment_prepare', { p_guest_id: id, p_count: count, p_locale: 'en', p_provider: 'fake' });
    expect(p.ok, p.code).toBe(true);
    const row = p.data as { request_id: string; amount_iqd: number };
    const a = await rpc(svc, 'deposit_apply', {
      p_request_id: row.request_id, p_provider_payment_id: null, p_provider_status: 'SUCCESS', p_amount: row.amount_iqd,
      p_currency: 'IQD', p_canceled: false, p_source: 'webhook', p_signature_ok: true, p_raw: { status: 'SUCCESS' },
    });
    expect(a.ok, a.code).toBe(true);
    expect(a.data).toMatchObject({ status: 'succeeded', purpose: 'ticket', ticket_count: count });
    touched.add(id);
    return { client, id };
  };

  const tickets = async (guestId: string) => {
    const { data } = await svc.from('match_tickets').select('id, status, seat_id, request_id, forfeited_seat_id').eq('guest_id', guestId).order('id');
    return (data ?? []) as Json[];
  };
  const events = async (guestId: string) => {
    const { data } = await svc.from('match_ticket_events').select('type, code, seat_id, request_id').eq('guest_id', guestId).order('id');
    return (data ?? []) as Json[];
  };

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    const s = await rpc(owner, 'match_settings', { p_venue_id: VENUE_A_ID });
    expect(s.ok, s.code).toBe(true);
    savedEnabled = (s.data as Json).matches_enabled as boolean;
    expect((await rpc(owner, 'set_match_settings', { p_patch: { matches_enabled: true }, p_venue_id: VENUE_A_ID })).ok).toBe(true);
    court = await createTestCourt(svc, `m259 tickets ${Date.now()}`);
  });

  afterAll(async () => {
    if (!owner || savedEnabled === undefined) return;
    await rpc(owner, 'set_match_settings', { p_patch: { matches_enabled: savedEnabled }, p_venue_id: VENUE_A_ID });
  });

  // money.md §9: the ledger holds after every step, for every guest touched.
  afterEach(async () => {
    for (const id of touched) expect(await assertTicketLedger(svc, id), `ledger of ${id}`).toEqual([]);
  });

  it('buys the tickets: g1 three, g2 one', async () => {
    g.g1 = (await guestWithTickets('m259-t1', 3)).id;
    g.g2 = (await guestWithTickets('m259-t2', 1)).id;
    expect((await tickets(g.g1)).map((t) => t.status)).toEqual(['available', 'available', 'available']);
  });

  it('start: ticket_pick then ticket_lock seat the organiser and a friend; a request reserves (§3.5)', () => {
    const out = step(`
declare v_m uuid; v_start timestamptz := date_trunc('day', now()) + interval '41 days 12 hours';
  v_ids uuid[]; v_s1 uuid; v_s2 uuid; v_q uuid; v_q_ids uuid[]; v_locked int; v_reserved int;
begin
  insert into matches (venue_id, status, start_at, end_at, duration_min, visibility, join_policy, category, price_iqd,
                       shares_iqd, price_court_id, fill_deadline_at, share_token, organiser_id, organised_by)
  values ('${VENUE_A_ID}', 'filling', v_start, v_start + interval '90 minutes', 90, 'public', 'approve', 'open', 40000,
          '{10000,10000,10000,10000}', '${court}', v_start - interval '2 hours',
          substr(replace(gen_random_uuid()::text, '-', ''), 1, 22), '${g.g1}', 'guest')
  returning id into v_m;
  v_ids := app.ticket_pick('${g.g1}', 2, false);
  insert into match_seats (venue_id, match_id, seat_no, kind, guest_id, ticket_id, share_iqd)
  values ('${VENUE_A_ID}', v_m, 1, 'account', '${g.g1}', v_ids[1], 10000) returning id into v_s1;
  insert into match_seats (venue_id, match_id, seat_no, kind, guest_id, ticket_id, share_iqd)
  values ('${VENUE_A_ID}', v_m, 2, 'friend', '${g.g1}', v_ids[2], 10000) returning id into v_s2;
  v_locked := app.ticket_lock(v_ids, array[v_s1, v_s2]);
  v_q_ids := app.ticket_pick('${g.g2}', 1, false);
  insert into match_requests (venue_id, match_id, guest_id, seats_requested)
  values ('${VENUE_A_ID}', v_m, '${g.g2}', 1) returning id into v_q;
  v_reserved := app.ticket_lock(v_q_ids, null, v_q);
  return jsonb_build_object('m', v_m, 's1', v_s1, 's2', v_s2, 'q', v_q, 't1', v_ids[1], 't2', v_ids[2],
                            'tq', v_q_ids[1], 'locked', v_locked, 'reserved', v_reserved);
end`);
    Object.assign(ids, out);
    expect(out).toMatchObject({ locked: 2, reserved: 1 });
  });

  it('checks the wallet: two in use on their seats, one left, one reserved for the request', async () => {
    const t1 = await tickets(g.g1);
    expect(t1.find((t) => t.id === ids.t1)).toMatchObject({ status: 'in_use', seat_id: ids.s1 });
    expect(t1.find((t) => t.id === ids.t2)).toMatchObject({ status: 'in_use', seat_id: ids.s2 });
    expect(t1.filter((t) => t.status === 'available')).toHaveLength(1);
    expect(await tickets(g.g2)).toEqual([{ id: ids.tq, status: 'reserved', seat_id: null, request_id: ids.q, forfeited_seat_id: null }]);
    expect((await events(g.g2)).map((e) => e.type)).toEqual(['bought', 'reserved']);
  });

  it('R17: every helper refuses a ticket that is not the seat\'s or the request\'s, and moves nothing', async () => {
    const spare = (await tickets(g.g1)).find((t) => t.status === 'available')!.id as string;
    const out = step(`
declare v_s3 uuid; v_other uuid; r jsonb := '{}';
begin
  -- A seat for g2 naming g2's reserved ticket, and another request of g1's.
  insert into match_seats (venue_id, match_id, seat_no, kind, guest_id, ticket_id, share_iqd)
  values ('${VENUE_A_ID}', '${ids.m}', 3, 'account', '${g.g2}', '${ids.tq}', 10000) returning id into v_s3;
  insert into match_requests (venue_id, match_id, guest_id, seats_requested)
  values ('${VENUE_A_ID}', '${ids.m}', '${g.g1}', 1) returning id into v_other;
  r := r || jsonb_build_object(
    'lock_on_anothers_seat', app.ticket_lock(array['${ids.tq}'::uuid], array['${ids.s1}'::uuid]),
    'lock_reserved_for_another_request', app.ticket_lock(array['${ids.tq}'::uuid], array[v_s3], v_other),
    'lock_reserved_without_its_request', app.ticket_lock(array['${ids.tq}'::uuid], array[v_s3]),
    'reserve_for_anothers_request', app.ticket_lock(array['${spare}'::uuid], null, '${ids.q}'),
    'release_mismatched_pair', app.ticket_release(array['${ids.t1}'::uuid], 'x', array['${ids.s2}'::uuid]),
    'release_for_another_request', app.ticket_release(array['${ids.tq}'::uuid], 'x', null, v_other),
    'forfeit_mismatched_pair', app.ticket_forfeit('${ids.t1}', '${ids.s2}'),
    'forfeit_reserved', app.ticket_forfeit('${ids.tq}', v_s3),
    'restore_not_forfeited', app.ticket_restore('${ids.t1}', '${ids.s1}'));
  r := r || jsonb_build_object(
    'release_without_pairing', pg_temp.try($q$select to_jsonb(app.ticket_release(array['${ids.t1}'::uuid], 'x'))$q$),
    'lock_uneven_pairs', pg_temp.try($q$select to_jsonb(app.ticket_lock(array['${ids.t1}'::uuid, '${ids.t2}'::uuid], array['${ids.s1}'::uuid]))$q$),
    'statuses', (select jsonb_object_agg(k.id, k.status) from match_tickets k
                  where k.id in ('${ids.t1}', '${ids.t2}', '${ids.tq}', '${spare}')));
  return r;
end`, false, TRY);
    expect(out).toEqual({
      lock_on_anothers_seat: 0,
      lock_reserved_for_another_request: 0,
      lock_reserved_without_its_request: 0,
      reserve_for_anothers_request: 0,
      release_mismatched_pair: 0,
      release_for_another_request: 0,
      forfeit_mismatched_pair: false,
      forfeit_reserved: false,
      restore_not_forfeited: false,
      release_without_pairing: { error: 'INVALID_ARGUMENT', detail: 'p_seat_ids' },
      lock_uneven_pairs: { error: 'INVALID_ARGUMENT', detail: 'p_seat_ids' },
      statuses: { [ids.t1]: 'in_use', [ids.t2]: 'in_use', [ids.tq]: 'reserved', [spare]: 'available' },
    });
  });

  it('approve: the request\'s own reserved ticket moves to its new seat; the fourth seat books the court', () => {
    const out = step(`
declare v_ids uuid[]; v_s3 uuid; v_s4 uuid; v_locked int; v_status text; v_lock text;
begin
  v_ids := app.ticket_pick('${g.g2}', 1, false, '${ids.q}');
  insert into match_seats (venue_id, match_id, seat_no, kind, guest_id, ticket_id, share_iqd, request_id)
  values ('${VENUE_A_ID}', '${ids.m}', 3, 'account', '${g.g2}', v_ids[1], 10000, '${ids.q}') returning id into v_s3;
  v_locked := app.ticket_lock(v_ids, array[v_s3], '${ids.q}');
  update match_requests set status = 'approved', decided_at = now() where id = '${ids.q}';
  insert into match_seats (venue_id, match_id, seat_no, kind, guest_name, share_iqd, created_by_staff_id)
  values ('${VENUE_A_ID}', '${ids.m}', 4, 'desk', 'M259 Walk In', 10000, '${SEED_STAFF_IDS.court_desk}') returning id into v_s4;
  v_lock := (app.match_lock('${ids.m}')).status;
  v_status := app.match_try_book('${ids.m}');
  return jsonb_build_object('picked', v_ids, 's3', v_s3, 'locked', v_locked, 'before', v_lock, 'status', v_status,
    'court', (select r.court_id from reservations r join matches x on x.reservation_id = r.id where x.id = '${ids.m}'),
    'res', (select x.reservation_id from matches x where x.id = '${ids.m}'));
end`);
    ids.s3 = out.s3 as string;
    ids.res = out.res as string;
    expect(out).toMatchObject({ picked: [ids.tq], locked: 1, before: 'filling', status: 'booked', court });
  });

  it('checks: g2\'s ticket is in use on its seat, locked for its own request', async () => {
    expect(await tickets(g.g2)).toEqual([{ id: ids.tq, status: 'in_use', seat_id: ids.s3, request_id: null, forfeited_seat_id: null }]);
    expect((await events(g.g2)).at(-1)).toMatchObject({ type: 'locked', seat_id: ids.s3, request_id: ids.q });
  });

  it('a no-show forfeits the seat\'s ticket (revenue of the seat\'s branch)', async () => {
    const out = step(`
declare v boolean;
begin
  v := app.ticket_forfeit('${ids.tq}', '${ids.s3}');
  update match_seats set status = 'no_show', marked_at = now() where id = '${ids.s3}';
  return jsonb_build_object('forfeited', v, 'again', app.ticket_forfeit('${ids.tq}', '${ids.s3}'));
end`);
    expect(out).toEqual({ forfeited: true, again: true });
    const { data } = await svc.from('match_tickets').select('status, forfeited_venue_id, forfeited_seat_id').eq('id', ids.tq).single();
    expect(data).toEqual({ status: 'forfeited', forfeited_venue_id: VENUE_A_ID, forfeited_seat_id: ids.s3 });
    expect((await events(g.g2)).at(-1)).toMatchObject({ type: 'forfeited', code: 'no_show', seat_id: ids.s3 });
  });

  it('the correction restores it, only from its own seat, while the marks are open (R13)', async () => {
    const out = step(`
declare v_wrong boolean; v_open boolean; v_restored boolean;
begin
  v_wrong := app.ticket_restore('${ids.tq}', '${ids.s1}');
  v_open := app.match_marks_open('${ids.m}');
  v_restored := app.ticket_restore('${ids.tq}', '${ids.s3}');
  update match_seats set status = 'attended' where id = '${ids.s3}';
  return jsonb_build_object('wrong_seat', v_wrong, 'marks_open', v_open, 'restored', v_restored);
end`);
    expect(out).toEqual({ wrong_seat: false, marks_open: true, restored: true });
    expect((await tickets(g.g2))[0]).toMatchObject({ status: 'available', seat_id: null, forfeited_seat_id: null });
  });

  it('the booking is cancelled: match_end releases the tickets still in use; nothing stays in use (R16)', async () => {
    const out = step(`
declare v boolean;
begin
  v := app.match_end('${ids.m}', 'cancelled', 'reservation_cancelled', 'system');
  update reservations set status = 'cancelled', cancelled_at = now(), cancelled_by = 'staff',
                          cancellation_reason = 'm259 test' where id = '${ids.res}';
  return jsonb_build_object('ended', v,
    'seats', (select jsonb_agg(s.status order by s.seat_no) from match_seats s where s.match_id = '${ids.m}'),
    'in_use', (select count(*) from match_tickets k join match_seats s on s.id = k.seat_id where s.match_id = '${ids.m}'));
end`);
    expect(out).toEqual({ ended: true, seats: ['cancelled', 'cancelled', 'cancelled', 'cancelled'], in_use: 0 });
    expect((await tickets(g.g1)).map((t) => t.status)).toEqual(['available', 'available', 'available']);
  });

  it('R18: a deleted holder\'s ticket is released, never forfeited, and DF-20 then refunds it', async () => {
    const g3 = await guestWithTickets('m259-t3', 1);
    g.g3 = g3.id;
    const out = step(`
declare v_m uuid; v_start timestamptz := date_trunc('day', now()) + interval '42 days 12 hours'; v_ids uuid[]; v_s uuid;
begin
  insert into matches (venue_id, status, start_at, end_at, duration_min, visibility, join_policy, category, price_iqd,
                       shares_iqd, price_court_id, fill_deadline_at, share_token, organiser_id, organised_by)
  values ('${VENUE_A_ID}', 'filling', v_start, v_start + interval '60 minutes', 60, 'link', 'open', 'open', 40000,
          '{10000,10000,10000,10000}', '${court}', v_start - interval '2 hours',
          substr(replace(gen_random_uuid()::text, '-', ''), 1, 22), '${g.g3}', 'guest')
  returning id into v_m;
  v_ids := app.ticket_pick('${g.g3}', 1, false);
  insert into match_seats (venue_id, match_id, seat_no, kind, guest_id, ticket_id, share_iqd)
  values ('${VENUE_A_ID}', v_m, 1, 'account', '${g.g3}', v_ids[1], 10000) returning id into v_s;
  return jsonb_build_object('m', v_m, 's', v_s, 't', v_ids[1], 'locked', app.ticket_lock(v_ids, array[v_s]));
end`);
    expect(out).toMatchObject({ locked: 1 });
    const del = await rpc(g3.client, 'delete_my_account', { p_confirm: 'DELETE' });
    expect(del.ok, del.code).toBe(true);

    const end = step(`
declare v boolean;
begin
  v := app.ticket_forfeit('${out.t}', '${out.s}');
  return jsonb_build_object('forfeited', v,
    'status', (select status from match_tickets where id = '${out.t}'),
    'ended', app.match_end('${out.m}', 'cancelled', 'staff_cancelled', 'staff'),
    'refunded', app.ticket_refund_deleted('${g.g3}'));
end`);
    expect(end).toEqual({ forfeited: false, status: 'available', ended: true, refunded: 1 });
    expect((await events(g.g3)).map((e) => `${e.type}:${e.code ?? ''}`)).toEqual([
      'bought:', 'locked:', 'released:account_deleted', 'cashed_out:account_deleted',
    ]);
  });
});
