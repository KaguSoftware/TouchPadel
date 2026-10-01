/**
 * 0261, lane Guest: the open-match push family in the database (docs/design/
 * open-matches/guest.md §4.6, §4.6.4; build contracts §1.9, R3, R26).
 *
 *   * app.match_notify: the closed payload, each INVALID_ARGUMENT, the kind
 *     taken from the key, the actor, deleted and tokenless recipients
 *     skipped, the 15-minute dedupe inside and outside its window, a failing
 *     insert that returns 0 while the caller's write goes on, and send-push
 *     nudged only for rows due now;
 *   * c_keys (in the function body) equals _shared/guest-push.json;
 *   * the fan-out (match_events_push, match_ticket_events_push): each row of
 *     the §4.6.3 table queues exactly its key to exactly its recipients, the
 *     silent events queue nothing, a join to four queues match_booked and no
 *     player_joined, a bump reaches seat holders and pending requesters once
 *     each, and a holder who forfeits two tickets gets one push;
 *   * reminders: booked queues reminder_3h at start - 3 h for the in holders;
 *     a late leave drops that holder, a refill adds the new one, a move
 *     reschedules, an end clears, a match booked inside 3 hours gets none.
 *
 * One rolled-back scenario per block, at a branch made inside it; every
 * player has an Expo token unless the case says otherwise. send-push's own
 * copy is send-push-guest.test.ts.
 */
import { describe, expect, it } from 'vitest';
import guestPush from '../supabase/functions/_shared/guest-push.json';
import { stackAvailable } from './helpers';
import { Q, X, dockerReachable, psql, scenario, type Results } from './stores-harness';
import { E, GUEST, K, SETUP, START, at, data, failed } from './matches-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;

const PUSH = '{"push":"ExponentPushToken[m260]"}';
const PLAYER = (name: string, extra = '') => GUEST(name, extra ? `{"push":"ExponentPushToken[m260]",${extra}}` : PUSH);
const KEPT = (name: string, label: string, path: string) =>
  K(name, `select res #>> '{data,${path}}' from pg_temp.out where label = '${label}'`);

/** The pushes queued for a match (reminders aside), as "who:key[:params]", sorted. */
const PUSHES = String.raw`
create function pg_temp.who(p_id uuid) returns text language sql as $f$
  select coalesce((select v.name from pg_temp.vars v join pg_temp.guests g on g.id::text = v.val
                    where v.val = p_id::text limit 1), p_id::text)
$f$;
create function pg_temp.pushes(p_match text) returns jsonb language sql as $f$
  select coalesce(jsonb_agg(x.t order by x.t), '[]'::jsonb) from (
    select pg_temp.who(o.profile_id) || ':' || (o.payload->>'title_key')
           || case when o.payload->'params' <> '{}'::jsonb then ':' || (o.payload->'params')::text else '' end as t
      from notification_outbox o
     where o.payload->>'id' = pg_temp.var(p_match) and o.kind <> 'match_reminder') x
$f$;
create function pg_temp.reminders(p_match text) returns jsonb language sql as $f$
  select coalesce(jsonb_agg(x.t order by x.t), '[]'::jsonb) from (
    select pg_temp.who(o.profile_id) || '@' || extract(epoch from (m.start_at - o.scheduled_for))::int / 60 as t
      from notification_outbox o join matches m on m.id::text = o.payload->>'id'
     where o.payload->>'id' = pg_temp.var(p_match) and o.kind = 'match_reminder' and o.sent_at is null) x
$f$;
-- Forget the pushes queued so far (a case reads only its own).
create function pg_temp.clear() returns void language sql as $f$
  delete from notification_outbox o where o.profile_id in (select id from pg_temp.guests) and o.kind <> 'match_reminder'
$f$;
`;
const P = (label: string, m: string) => Q(label, `select pg_temp.pushes('${m}')`);
/** A push or reminder list, sorted here (the database sorts text by its own collation). */
const list = (r: Results, label: string) => [...data<string[]>(r, label)].sort();
const REM = (label: string, m: string) => Q(label, `select pg_temp.reminders('${m}')`);
const CLEAR = `select pg_temp.clear();`;

describe.skipIf(!docker)('c_keys in app.match_notify is _shared/guest-push.json', () => {
  it('parses to the same key -> kind map', () => {
    const def = psql(
      `select pg_get_functiondef('app.match_notify(uuid,uuid[],text,jsonb,uuid,timestamptz,text)'::regprocedure)`,
    );
    const m = def.match(/c_keys constant jsonb := '(\{[\s\S]*?\})';/);
    expect(m).not.toBeNull();
    expect(JSON.parse(m![1]!)).toEqual(guestPush.title_keys);
    expect(new Set(Object.values(guestPush.title_keys))).toEqual(new Set(guestPush.kinds));
  });
});

describe.skipIf(!docker)('app.match_notify (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m260n', [
      SETUP,
      PUSHES,
      `select pg_temp.branch();`,
      PLAYER('org'), PLAYER('p2'), PLAYER('p3'), GUEST('notoken'), PLAYER('gone'),
      X(`update profiles set deleted_at = now() where id = {{gone}}`),
      K('m', `select pg_temp.m()`),
      // Send-push is nudged only for rows due now: a stand-in counts the calls.
      `create temp table nudges (n int);`,
      X(`create or replace function app.push_nudge() returns void language sql as 'insert into pg_temp.nudges values (1)'`),

      E('bad_key', null, `select to_jsonb(app.match_notify({{m}}, array[{{p2}}]::uuid[], 'nope'))`),
      E('bad_param_key', null, `select to_jsonb(app.match_notify({{m}}, array[{{p2}}]::uuid[], 'player_joined', '{"name":"x"}'))`),
      E('bad_param_text', null, `select to_jsonb(app.match_notify({{m}}, array[{{p2}}]::uuid[], 'player_joined', '{"minutes":"5"}'))`),
      E('bad_param_fraction', null, `select to_jsonb(app.match_notify({{m}}, array[{{p2}}]::uuid[], 'player_joined', '{"minutes":1.5}'))`),
      E('bad_params', null, `select to_jsonb(app.match_notify({{m}}, array[{{p2}}]::uuid[], 'player_joined', '[1]'))`),
      E('no_match', null, `select to_jsonb(app.match_notify(null, array[{{p2}}]::uuid[], 'player_joined'))`),

      E('sent', null, `select to_jsonb(app.match_notify({{m}}, array[{{p2}}, {{p3}}, {{notoken}}, {{gone}}, {{org}}, {{p2}}, null]::uuid[],
                         'player_joined', '{"seats_taken":2,"seats_total":4}', {{org}}, null, 'd1'))`),
      Q('rows', `select jsonb_agg(jsonb_build_object('who', pg_temp.who(o.profile_id), 'kind', o.kind, 'payload', o.payload,
                   'now', o.scheduled_for = now()) order by pg_temp.who(o.profile_id))
                   from notification_outbox o where o.payload->>'dedupe' = 'd1'`),
      Q('nudges_after_sent', `select to_jsonb(count(*)) from pg_temp.nudges`),
      E('deduped', null, `select to_jsonb(app.match_notify({{m}}, array[{{p2}}]::uuid[], 'player_joined', '{}', null, null, 'd1'))`),
      X(`insert into notification_outbox (profile_id, kind, payload, created_at)
         values ({{p3}}, 'match_update', '{"dedupe":"d2"}', now() - interval '16 minutes')`),
      E('outside_window', null, `select to_jsonb(app.match_notify({{m}}, array[{{p3}}]::uuid[], 'seat_removed', '{}', null, null, 'd2'))`),
      E('refunded', null, `select to_jsonb(app.match_notify(null, array[{{p2}}]::uuid[], 'tickets_refunded', '{}', null, null, 'tr'))`),
      Q('refunded_row', `select o.payload || jsonb_build_object('kind', o.kind) from notification_outbox o where o.payload->>'dedupe' = 'tr'`),
      E('reminder', null, `select to_jsonb(app.match_notify({{m}}, array[{{p2}}]::uuid[], 'reminder_3h', '{}', null, now() + interval '1 day'))`),
      E('message', null, `select to_jsonb(app.match_notify({{m}}, array[{{p2}}]::uuid[], 'msg_on_my_way', '{}', null, null, 'dm'))`),
      Q('kinds', `select jsonb_object_agg(o.payload->>'title_key', o.kind) from notification_outbox o
                   where o.profile_id = {{p2}} and o.payload->>'title_key' in ('reminder_3h', 'msg_on_my_way')`),
      Q('nudges_before_failure', `select to_jsonb(count(*)) from pg_temp.nudges`),
      // A failing insert: the call returns 0 and the caller goes on.
      X(`create function pg_temp.boom() returns trigger language plpgsql as $b$ begin raise exception 'boom'; end $b$`),
      X(`create trigger zz_m260_boom before insert on notification_outbox for each row execute function pg_temp.boom()`),
      E('failing', null, `select to_jsonb(app.match_notify({{m}}, array[{{p2}}]::uuid[], 'seat_removed', '{}', null, null, 'd3'))`),
      X(`drop trigger zz_m260_boom on notification_outbox`),
      Q('after_failure', `select to_jsonb(count(*)) from notification_outbox where payload->>'dedupe' = 'd3'`),
    ]);
  });

  it('refuses a bad call where a test can see it', () => {
    expect(failed(r, 'bad_key')).toMatchObject({ code: 'INVALID_ARGUMENT', hint: 'title_key' });
    for (const label of ['bad_param_key', 'bad_param_text', 'bad_param_fraction', 'bad_params']) {
      expect(failed(r, label), label).toMatchObject({ code: 'INVALID_ARGUMENT', hint: 'params' });
    }
    expect(failed(r, 'no_match')).toMatchObject({ code: 'INVALID_ARGUMENT', hint: 'p_match_id' });
  });

  it('queues the closed payload once per recipient, skipping the actor, deleted and tokenless profiles', () => {
    expect(data(r, 'sent')).toBe(2);
    const rows = data<Json[]>(r, 'rows');
    const id = (rows[0]!.payload as Json).id;
    expect(rows).toEqual([
      { who: 'p2', kind: 'match_update', now: true,
        payload: { route: 'match', id, title_key: 'player_joined', params: { seats_taken: 2, seats_total: 4 }, dedupe: 'd1' } },
      { who: 'p3', kind: 'match_update', now: true,
        payload: { route: 'match', id, title_key: 'player_joined', params: { seats_taken: 2, seats_total: 4 }, dedupe: 'd1' } },
    ]);
    expect(data(r, 'nudges_after_sent')).toBe(1);
  });

  it('dedupes for 15 minutes; takes the kind from the key; tickets_refunded is route tickets with no id', () => {
    expect(data(r, 'deduped')).toBe(0);
    expect(data(r, 'outside_window')).toBe(1);
    expect(data(r, 'refunded')).toBe(1);
    expect(data(r, 'refunded_row')).toEqual({
      route: 'tickets', id: null, title_key: 'tickets_refunded', params: {}, dedupe: 'tr', kind: 'match_update',
    });
    expect(data(r, 'kinds')).toEqual({ reminder_3h: 'match_reminder', msg_on_my_way: 'match_message' });
    // The scheduled reminder did not nudge; the message did.
    expect(data(r, 'nudges_before_failure')).toBe(4);
  });

  it('a failing insert returns 0 and never fails its caller', () => {
    expect(data(r, 'failing')).toBe(0);
    expect(data(r, 'after_failure')).toBe(0);
  });
});

describe.skipIf(!docker)('the fan-out and the reminders (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m260f', [
      SETUP,
      PUSHES,
      `select pg_temp.branch();`,
      ...['org', 'p2', 'p3', 'p4', 'p5', 'req', 'req2', 'o2', 'q3', 'o3', 'p6', 'o4', 'p7', 'o5', 'p8', 'x1', 'x2']
        .map((g) => PLAYER(g)),
      GUEST('notoken'),
      ...['org', 'p2', 'p3', 'p4', 'p5', 'req', 'req2', 'o2', 'q3', 'o3', 'p6', 'o4', 'p7', 'o5', 'p8', 'x1', 'x2', 'notoken']
        .map((g) => `select pg_temp.tickets('${g}', 3);`),

      // MA: start (silent), joins, the fourth seat books (match_booked, no
      // player_joined), reminders; a late leave, a refill, a message, a move,
      // the venue's cancel.
      E('ma', 'org', START({ key: 'k-ma' })),
      KEPT('ma', 'ma', 'match_id'),
      P('ma_started', 'ma'),
      E('ma_p2', 'p2', `select app.match_join({{ma}})`),
      E('ma_p3', 'p3', `select app.match_join({{ma}})`),
      P('ma_joined', 'ma'), CLEAR,
      E('ma_p4', 'p4', `select app.match_join({{ma}})`),
      P('ma_booked', 'ma'), REM('rem_booked', 'ma'), CLEAR,
      E('ma_leave', 'p2', `select app.match_leave({{ma}})`),
      P('ma_left', 'ma'), REM('rem_left', 'ma'), CLEAR,
      E('do_refill', 'p5', `select app.match_join({{ma}})`),
      P('ma_refill', 'ma'), REM('rem_refill', 'ma'), CLEAR,
      E('do_msg', 'p3', `select app.match_post_message({{ma}}, 'on_my_way')`),
      P('ma_msg', 'ma'), CLEAR,
      X(`update matches set start_at = start_at + interval '1 day', end_at = end_at + interval '1 day' where id = {{ma}}`),
      X(`select app.match_event({{ma}}, null, 'moved', 'system')`),
      P('ma_moved', 'ma'), REM('rem_moved', 'ma'), CLEAR,
      X(`select app.match_end({{ma}}, 'cancelled', 'reservation_cancelled', 'system')`),
      P('ma_cancelled', 'ma'), REM('rem_cancelled', 'ma'), CLEAR,

      // MB: approve mode: request_new (deduped for the organiser), declined,
      // approved (no player_joined to the approving organiser), and
      // request_expired (match_full) to the one left waiting at four.
      E('mb', 'org', START({ when: at(5), policy: 'approve', friends: '[{},{}]', key: 'k-mb' })),
      KEPT('mb', 'mb', 'match_id'),
      E('mb_ask', 'req', `select app.match_request({{mb}})`),
      KEPT('qb', 'mb_ask', 'request_id'),
      E('mb_decline', 'org', `select app.match_decide({{qb}}, false)`),
      E('mb_ask2', 'req', `select app.match_request({{mb}})`),
      KEPT('qb2', 'mb_ask2', 'request_id'),
      E('mb_ask_other', 'req2', `select app.match_request({{mb}})`),
      E('mb_withdraw', 'req2', `select app.match_withdraw((select id from match_requests where guest_id = {{req2}}))`),
      E('mb_ask_other2', 'req2', `select app.match_request({{mb}})`),
      P('mb_asked', 'mb'), CLEAR,
      E('mb_approve', 'org', `select app.match_decide({{qb2}}, true)`),
      P('mb_approved', 'mb'), CLEAR,

      // MC: a bump reaches the seats and the pending request once each; the
      // request's own expiry (code bumped) is silent.
      E('mc', 'o2', START({ when: at(7), policy: 'approve', friends: '[{}]', key: 'k-mc' })),
      KEPT('mc', 'mc', 'match_id'),
      E('mc_ask', 'q3', `select app.match_request({{mc}})`),
      CLEAR,
      X(`select app.match_end({{mc}}, 'bumped', 'bumped', 'system')`),
      P('mc_bumped', 'mc'),

      // MD, ME, MF: no court (match_cancelled), the deadline (match_expired),
      // everyone left (silent).
      E('md', 'x1', START({ when: at(9), key: 'k-md' })),
      KEPT('md', 'md', 'match_id'),
      X(`select app.match_end({{md}}, 'bumped', 'no_court', 'system')`),
      P('md_no_court', 'md'),
      E('me', 'x2', START({ when: at(9), key: 'k-me' })),
      KEPT('me', 'me', 'match_id'),
      X(`select app.match_end({{me}}, 'expired', 'deadline', 'system')`),
      P('me_expired', 'me'),
      E('mf', 'x1', START({ when: at(11), key: 'k-mf' })),
      KEPT('mf', 'mf', 'match_id'),
      E('mf_leave', 'x1', `select app.match_leave({{mf}})`),
      P('mf_empty', 'mf'),

      // MG: the organiser leaves, the next player takes over.
      E('mg', 'o3', START({ when: at(13), key: 'k-mg' })),
      KEPT('mg', 'mg', 'match_id'),
      E('mg_p6', 'p6', `select app.match_join({{mg}})`),
      CLEAR,
      E('mg_leave', 'o3', `select app.match_leave({{mg}})`),
      P('mg_handover', 'mg'),

      // MH: the organiser removes a player (seat_removed only); MI: a ban drops
      // a player (player_left to the organiser too).
      E('mh', 'o4', START({ when: at(15), key: 'k-mh' })),
      KEPT('mh', 'mh', 'match_id'),
      E('mh_p7', 'p7', `select app.match_join({{mh}})`),
      CLEAR,
      E('mh_remove', 'o4', `select app.match_remove_player({{mh}}, (select id from match_seats where match_id = {{mh}} and guest_id = {{p7}}))`),
      P('mh_removed', 'mh'),
      E('mi', 'o5', START({ when: at(17), key: 'k-mi' })),
      KEPT('mi', 'mi', 'match_id'),
      E('mi_p8', 'p8', `select app.match_join({{mi}})`),
      CLEAR,
      `select pg_temp.ban('p8');`,
      X(`select app.match_drop_ineligible({{mi}})`),
      P('mi_banned', 'mi'),

      // MJ: holds on both courts at the fourth seat: awaiting a court.
      E('mj', 'x1', START({ when: at(19), friends: '[{},{}]', key: 'k-mj' })),
      KEPT('mj', 'mj', 'match_id'),
      X(`select pg_temp.res('c1', ${at(19)}, 90, 'hold', 'pending', 'req')`),
      X(`select pg_temp.res('c2', ${at(19)}, 90, 'hold', 'pending', 'req2')`),
      CLEAR,
      E('mj_fourth', 'notoken', `select app.match_join({{mj}})`),
      P('mj_waiting', 'mj'),
      // A deadline warning (the sweep writes it, 0263) to the seat holders.
      X(`select app.match_event({{mj}}, null, 'deadline_warning', 'system')`),
      Q('mj_warning', `select jsonb_agg(o.payload->'params') from notification_outbox o
                        where o.payload->>'id' = {{mj}}::text and o.payload->>'title_key' = 'deadline_warning'`),

      // MK: a holder's two forfeited tickets make one push; a match booked
      // inside its last 3 hours gets no reminder.
      K('mk', `select pg_temp.m(jsonb_build_object('start_at', now() + interval '2 hours', 'organiser_id', {{o2}}))`),
      K('mk_s1', `select pg_temp.seat({{mk}}, 1, 'account', {{o2}})`),
      K('mk_s2', `select pg_temp.seat({{mk}}, 2, 'friend', {{o2}})`),
      X(`select pg_temp.seat({{mk}}, 3, 'account', {{x2}})`),
      X(`select pg_temp.seat({{mk}}, 4, 'account', {{p4}})`),
      CLEAR,
      X(`select app.match_try_book({{mk}})`),
      P('mk_booked', 'mk'), REM('rem_mk', 'mk'), CLEAR,
      X(`select app.ticket_forfeit((select ticket_id from match_seats where id = {{mk_s1}}), {{mk_s1}})`),
      X(`select app.ticket_forfeit((select ticket_id from match_seats where id = {{mk_s2}}), {{mk_s2}})`),
      P('mk_forfeited', 'mk'),
      Q('silent_kinds', `select to_jsonb(count(*)) from notification_outbox o
                          where o.profile_id in (select id from pg_temp.guests) and o.kind not like 'match_%'`),
    ]);
  });

  it('start is silent; a join tells the organiser; the fourth seat is match_booked to the seat holders, no player_joined', () => {
    expect(list(r, 'ma_started')).toEqual([]);
    expect(list(r, 'ma_joined')).toEqual([
      'org:player_joined:{"seats_taken": 2, "seats_total": 4}',
      'org:player_joined:{"seats_taken": 3, "seats_total": 4}',
    ]);
    expect(list(r, 'ma_booked')).toEqual(['org:match_booked', 'p2:match_booked', 'p3:match_booked', 'p4:match_booked']);
    expect(list(r, 'rem_booked')).toEqual(['org@180', 'p2@180', 'p3@180', 'p4@180']);
  });

  it('a late leave, a refill, a message, a move and the venue\'s cancel, with the reminders kept in step', () => {
    expect(list(r, 'ma_left')).toEqual(['org:player_left:{"seats_taken": 3, "seats_total": 4}']);
    expect(list(r, 'rem_left')).toEqual(['org@180', 'p3@180', 'p4@180']);
    expect(list(r, 'ma_refill')).toEqual(['org:player_joined:{"seats_taken": 4, "seats_total": 4}', 'p2:seat_refilled']);
    expect(list(r, 'rem_refill')).toEqual(['org@180', 'p3@180', 'p4@180', 'p5@180']);
    expect(list(r, 'ma_msg')).toEqual(['org:msg_on_my_way', 'p4:msg_on_my_way', 'p5:msg_on_my_way']);
    expect(list(r, 'ma_moved')).toEqual(['org:match_moved', 'p3:match_moved', 'p4:match_moved', 'p5:match_moved']);
    expect(list(r, 'rem_moved')).toEqual(['org@180', 'p3@180', 'p4@180', 'p5@180']);
    expect(list(r, 'ma_cancelled')).toEqual(['org:match_cancelled', 'p3:match_cancelled', 'p4:match_cancelled', 'p5:match_cancelled']);
    expect(list(r, 'rem_cancelled')).toEqual([]);
  });

  it('approve mode: request_new (once in 15 minutes), declined, approved; request_expired to the one left waiting', () => {
    // Withdrawing is silent; the organiser hears of a request once per 15 minutes.
    expect(list(r, 'mb_asked')).toEqual(['org:request_new', 'req:request_declined']);
    expect(list(r, 'mb_approved')).toEqual([
      'org:match_booked', 'req2:request_expired', 'req:match_booked', 'req:request_approved',
    ]);
  });

  it('endings: bumped once to seats and requests; no court reads cancelled; the deadline reads expired; empty is silent', () => {
    expect(list(r, 'mc_bumped')).toEqual(['o2:match_bumped', 'q3:match_bumped']);
    expect(list(r, 'md_no_court')).toEqual(['x1:match_cancelled']);
    expect(list(r, 'me_expired')).toEqual(['x2:match_expired']);
    expect(list(r, 'mf_empty')).toEqual([]);
  });

  it('handover, a removal by the organiser, a ban; waiting for a court; a deadline warning', () => {
    // The leaver was still the organiser when their own leave was written: no player_left.
    expect(list(r, 'mg_handover')).toEqual(['p6:organiser_handover']);
    expect(list(r, 'mh_removed')).toEqual(['p7:seat_removed']);
    expect(list(r, 'mi_banned')).toEqual(['o5:player_left:{"seats_taken": 1, "seats_total": 4}', 'p8:seat_removed']);
    // The fourth player has no push token: nothing queued for them.
    expect(list(r, 'mj_waiting')).toEqual(['x1:match_waiting_court']);
    const warning = data<Json[]>(r, 'mj_warning');
    expect(warning).toHaveLength(1);
    expect(warning[0]).toMatchObject({ seats_taken: 4, seats_total: 4 });
    expect(Number((warning[0] as Json).minutes)).toBeGreaterThan(0);
  });

  it('forfeits: one push per holder per match; booked inside 3 hours: no reminder', () => {
    expect(list(r, 'mk_booked')).toEqual(['o2:match_booked', 'p4:match_booked', 'x2:match_booked']);
    expect(list(r, 'rem_mk')).toEqual([]);
    expect(list(r, 'mk_forfeited')).toEqual(['o2:ticket_forfeited']);
    expect(data(r, 'silent_kinds')).toBe(0);
  });
});
