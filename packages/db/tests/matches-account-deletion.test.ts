/**
 * 0264 match_account_deletion: deleting an account that plays open matches
 * (docs/design/open-matches/db.md §4.9, money.md §5.11, §9, §10 situation 33;
 * build contracts DF-20, R13, R18, R25, R29).
 *
 * DF-20 comes in two halves (R25). app.delete_my_account scrubs what describes
 * the person (the name parts and gender, a seat's gender, a request's
 * friend_genders, every block either way), queues nothing, takes no match
 * lock, and refunds at once every purchase with nothing reserved, in use or
 * restorable. The match sweep (0263) does the rest: it leaves the filling and
 * waiting matches, turns a booked seat before the start into a late leave
 * whose ticket is released (never forfeited, R18) at the start, withdraws the
 * requests, and refunds each purchase once it is free.
 *
 * Three parts:
 *   * the body as the stack holds it (R25): no lock it waits on, the refund
 *     after the tombstone and every reservations write;
 *   * a rolled-back scenario at a branch made inside the transaction (the
 *     0261 harness): a player with tickets in every state (unused, reserved by
 *     a request, in use in a filling, a waiting and a booked match, a forfeit
 *     still restorable, a forfeit for good, already cashed out, a purchase
 *     still being paid), requests, blocks both ways, reports and a queued push;
 *     deleted, then swept, then swept again after the booked match starts,
 *     then swept a third time and deleted a second time (nothing moves); each
 *     branch run is followed by the refund queue for the player, since only
 *     the cron's chain-wide run has that phase (D-14); pg_temp.ledger() after
 *     every ticket move;
 *   * one committed case over HTTP with real purchases (the fake bank) and
 *     assertTicketLedger (T1–T12): the free purchases are refunded by the
 *     deletion itself, one refund each; a purchase whose ticket another
 *     connection holds is skipped without waiting and refunded by the next
 *     call.
 *
 * The SEC-20 deletion proof (seats, requests, blocks) is stored-fields.test.ts.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SEED_STAFF,
  VENUE_A_ID,
  appRpc,
  assertTicketLedger,
  grantTestTickets,
  guestClient,
  serviceClient,
  signedInClient,
  stackAvailable,
} from './helpers';
import { Q, X, dockerReachable, psql, psqlSession, scenario, waitForSleeper, type Results } from './stores-harness';
import { E, GUEST, K, SETUP, at, data, failed } from './matches-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;

// ── 1. The body (R25) ────────────────────────────────────────────────────────

describe.skipIf(!docker)('0264 delete_my_account as the stack holds it', () => {
  it('takes no match, court or ticket lock it could wait on (R25), and refunds last', () => {
    // pg_get_functiondef prints its own $function$ tag, so the comment names the file.
    expect(psql(`select obj_description('app.delete_my_account(text)'::regprocedure, 'pg_proc')`)).toMatch(/^0264 /);
    const def = psql(`select pg_get_functiondef('app.delete_my_account(text)'::regprocedure)`);
    for (const lock of ['lock_match_venue', 'lock_match_money', 'match_lock', 'lock_court', 'pg_advisory', 'for update']) {
      expect(def.toLowerCase(), lock).not.toContain(lock);
    }
    const pos = (s: string) => {
      const i = def.indexOf(s);
      expect(i, s).toBeGreaterThan(-1);
      return i;
    };
    const refund = pos('perform app.ticket_refund_deleted(v_uid)');
    // After the tombstone (it picks deleted payers) and every reservations write...
    expect(refund).toBeGreaterThan(pos('deleted_at      = now()'));
    expect(refund).toBeGreaterThan(pos('update reservation_series'));
    // ...after the three match scrubs, before the audit row and the auth user.
    expect(refund).toBeGreaterThan(pos('delete from match_blocks'));
    expect(refund).toBeLessThan(pos("'account.delete'"));
    expect(refund).toBeLessThan(pos('delete from auth.users'));
  });

  it('writes the match rows before the queued notifications, the order a match ending takes (no 40P01)', () => {
    // A mutex holder ending a match writes its seats, then (through the
    // match_events push trigger, match_sync_reminders) deletes that match's
    // reminders. The deletion scrubs the seats and requests first too, so it
    // never holds a player's reminder row while waiting for a seat.
    const def = psql(`select pg_get_functiondef('app.delete_my_account(text)'::regprocedure)`);
    const pos = (s: string) => {
      const i = def.indexOf(s);
      expect(i, s).toBeGreaterThan(-1);
      return i;
    };
    const outbox = pos('delete from notification_outbox where profile_id = v_uid');
    expect(outbox).toBeGreaterThan(pos('update match_seats'));
    expect(outbox).toBeGreaterThan(pos('update match_requests'));
    expect(outbox).toBeGreaterThan(pos('delete from match_blocks'));
    expect(outbox).toBeLessThan(pos('perform app.ticket_refund_deleted(v_uid)'));
    // And the reminder upkeep a match ending runs is still where the order
    // above assumes: seats first, the outbox through the event trigger.
    const sync = psql(`select pg_get_functiondef('app.match_sync_reminders(uuid)'::regprocedure)`);
    expect(sync).toContain('delete from notification_outbox');
  });
});

// ── 2. Tickets in every state, deleted, then swept (rolled back) ─────────────

/**
 * The scenario's own helpers, after SETUP: a purchase of n tickets, its i-th
 * ticket, a seat on a given ticket, a request holding given tickets, and the
 * player's footprint as one value.
 */
const HERE = String.raw`
-- n tickets bought in one purchase (a succeeded row and n available tickets,
-- each with its bought event); a purchase still being paid holds none.
create function pg_temp.buy(p_guest uuid, n int, p_status text default 'succeeded') returns uuid
language plpgsql as $f$
declare v_pay uuid; v_t uuid; i int;
begin
  insert into booking_payments (venue_id, reservation_id, hold_id, guest_id, purpose, provider, sandbox, request_id,
                                amount_iqd, quoted_price_iqd, ticket_count, status, succeeded_at, deadline_at)
  values (null, null, null, p_guest, 'ticket', 'fake', false, gen_random_uuid(), n * 10000, 10000, n, p_status,
          case when p_status = 'succeeded' then now() end, now() + interval '15 minutes')
  returning id into v_pay;
  if p_status = 'succeeded' then
    for i in 1 .. n loop
      insert into match_tickets (guest_id, status, price_iqd, purchase_payment_id, sandbox)
      values (p_guest, 'available', 10000, v_pay, false) returning id into v_t;
      insert into match_ticket_events (ticket_id, guest_id, type, payment_id) values (v_t, p_guest, 'bought', v_pay);
    end loop;
  end if;
  return v_pay;
end $f$;

-- The i-th ticket of a purchase, by id.
create function pg_temp.nth(p_pay uuid, p_i int) returns uuid language sql as $f$
  select id from match_tickets where purchase_payment_id = p_pay order by id offset p_i - 1 limit 1
$f$;

-- A seat on a given ticket. in and left_late lock it on the seat; no_show
-- locks it, then forfeits it at the seat's branch (its forfeited event queues
-- the 0261 ticket_forfeited push); any other status leaves it as it is.
create function pg_temp.hold(p_match uuid, p_no int, p_kind text, p_guest uuid, p_ticket uuid,
                             p_status text default 'in', p jsonb default '{}') returns uuid
language plpgsql as $f$
declare
  v_venue uuid := (select mt.venue_id from matches mt where mt.id = p_match);
  v uuid;
  r match_seats;
begin
  r := jsonb_populate_record(null::match_seats, jsonb_build_object(
         'status', p_status,
         'ended_at', case when p_status in ('left', 'removed', 'cancelled', 'left_late', 'refilled') then now() end,
         'end_reason', case p_status when 'left' then 'left' when 'removed' then 'removed_by_organiser'
                                     when 'cancelled' then 'match_ended' when 'left_late' then 'left' end,
         'marked_at', case when p_status in ('attended', 'no_show') then now() end) || p);
  insert into match_seats (venue_id, match_id, seat_no, kind, guest_id, gender, status, ticket_id, share_iqd,
                           joined_at, ended_at, end_reason, marked_at)
  values (v_venue, p_match, p_no, p_kind, p_guest, r.gender, r.status, p_ticket, 10000, clock_timestamp(),
          r.ended_at, r.end_reason, r.marked_at)
  returning id into v;
  if p_status in ('in', 'left_late', 'no_show') then
    update match_tickets set status = 'in_use', seat_id = v, updated_at = now() where id = p_ticket;
    insert into match_ticket_events (ticket_id, guest_id, type, venue_id, match_id, seat_id)
    values (p_ticket, p_guest, 'locked', v_venue, p_match, v);
  end if;
  if p_status = 'no_show' then
    update match_tickets
       set status = 'forfeited', seat_id = null, forfeited_at = now(), forfeited_venue_id = v_venue,
           forfeited_seat_id = v, updated_at = now()
     where id = p_ticket;
    insert into match_ticket_events (ticket_id, guest_id, type, venue_id, match_id, seat_id, code)
    values (p_ticket, p_guest, 'forfeited', v_venue, p_match, v, 'no_show');
  end if;
  return v;
end $f$;

-- A request for p_seats seats. A pending one reserves p_tickets (one per
-- seat); any other status was decided now and holds none.
create function pg_temp.ask(p_match uuid, p_guest uuid, p_seats int, p_friend_genders text[],
                            p_tickets uuid[] default null, p_status text default 'pending') returns uuid
language plpgsql as $f$
declare v_venue uuid := (select mt.venue_id from matches mt where mt.id = p_match); v uuid;
begin
  insert into match_requests (venue_id, match_id, guest_id, seats_requested, friend_genders, status, decided_at)
  values (v_venue, p_match, p_guest, p_seats, p_friend_genders, p_status,
          case when p_status <> 'pending' then now() end)
  returning id into v;
  if p_status = 'pending' then
    update match_tickets set status = 'reserved', request_id = v, updated_at = now() where id = any (p_tickets);
    insert into match_ticket_events (ticket_id, guest_id, type, venue_id, match_id, request_id)
    select t, p_guest, 'reserved', v_venue, p_match, v from unnest(p_tickets) t;
  end if;
  return v;
end $f$;

-- Everything of the player kept under 'gone': the profile, the auth user, the
-- kept seats and requests that name them, their purchases (tickets by status)
-- and the rows around them.
create function pg_temp.gone() returns jsonb language sql as $f$
  select jsonb_build_object(
    'profile', (select jsonb_build_object(
                  'full_name', p.full_name, 'given_name', p.given_name, 'family_name', p.family_name,
                  'gender', p.gender, 'gender_stamped', p.gender_set_at is not null or p.gender_set_by is not null,
                  'phone_set', p.phone is not null, 'push_set', p.expo_push_token is not null,
                  'deleted', p.deleted_at is not null)
                  from profiles p where p.id = pg_temp.var('gone')::uuid),
    'auth_user', exists (select 1 from auth.users u where u.id = pg_temp.var('gone')::uuid),
    'seats', (select jsonb_object_agg(v.name, jsonb_build_object('status', s.status, 'end_reason', s.end_reason,
                                                                 'gender', s.gender, 'ticket', k.status))
                from pg_temp.vars v
                join match_seats s on s.id::text = v.val
                left join match_tickets k on k.id = s.ticket_id
               where s.guest_id = pg_temp.var('gone')::uuid),
    'requests', (select jsonb_object_agg(v.name, jsonb_build_object('status', q.status,
                                                                    'friend_genders', to_jsonb(q.friend_genders)))
                   from pg_temp.vars v join match_requests q on q.id::text = v.val),
    'purchases', (select jsonb_object_agg(v.name, jsonb_build_object(
                    'status', b.status, 'reason', b.refund_reason, 'refund', b.refund_amount_iqd,
                    'tickets', coalesce((select jsonb_agg(t.status order by t.status) from match_tickets t
                                          where t.purchase_payment_id = b.id), '[]'::jsonb)))
                    from pg_temp.vars v join booking_payments b on b.id::text = v.val),
    'blocks', (select count(*) from match_blocks b
                where b.blocker_id = pg_temp.var('gone')::uuid or b.blocked_id = pg_temp.var('gone')::uuid),
    'other_blocks', (select count(*) from match_blocks b join pg_temp.guests g on g.id = b.blocker_id
                      where b.blocker_id <> pg_temp.var('gone')::uuid and b.blocked_id <> pg_temp.var('gone')::uuid),
    'reports', (select count(*) from match_reports r
                 where r.reporter_id = pg_temp.var('gone')::uuid or r.reported_id = pg_temp.var('gone')::uuid),
    'exclusions', (select count(*) from match_exclusions x where x.guest_id = pg_temp.var('gone')::uuid),
    'outbox', (select count(*) from notification_outbox o where o.profile_id = pg_temp.var('gone')::uuid),
    'forfeits', (select count(*) from match_ticket_events e
                  where e.guest_id = pg_temp.var('gone')::uuid and e.type = 'forfeited'))
$f$;

-- The kept matches: status, ended_reason and the organiser by kept name.
create function pg_temp.games() returns jsonb language sql as $f$
  select jsonb_object_agg(v.name, jsonb_build_object(
           'status', m.status, 'ended_reason', m.ended_reason,
           'organiser', (select x.name from pg_temp.vars x
                          where x.val = m.organiser_id::text and x.name in ('gone', 'g1', 'g2', 'g3'))))
    from pg_temp.vars v join matches m on m.id::text = v.val
$f$;

-- The push outbox: the player's rows, any row naming them, and what g1 was sent
-- (title_key@match).
create function pg_temp.pushes() returns jsonb language sql as $f$
  select jsonb_build_object(
    'gone', (select count(*) from notification_outbox o where o.profile_id = pg_temp.var('gone')::uuid),
    'naming', (select count(*) from notification_outbox o where o.payload::text ~ '(Huda|Yasiri)'),
    'g1', (select coalesce(jsonb_agg(distinct (o.payload->>'title_key') || '@'
                                     || coalesce((select x.name from pg_temp.vars x where x.val = o.payload->>'id'
                                                     and x.name in ('mF', 'mR', 'mA', 'mB', 'mD', 'mE')), '?')), '[]')
             from notification_outbox o where o.profile_id = pg_temp.var('g1')::uuid))
$f$;
`;

describe.skipIf(!docker)('0264 a player with tickets in every state deletes the account (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m263', [
      SETUP,
      HERE,
      `select pg_temp.branch();`,
      GUEST('gone', '{"given":"Huda","family":"Yasiri","push":"ExponentPushToken[m263-gone]"}'),
      GUEST('g1', '{"push":"ExponentPushToken[m263-g1]"}'),
      GUEST('g2', '{"push":"ExponentPushToken[m263-g2]"}'),
      GUEST('g3', '{"push":"ExponentPushToken[m263-g3]"}'),

      // The player's purchases, one per ticket state (10,000 IQD a ticket).
      K('p1', `select pg_temp.buy({{gone}}, 2)`),          // one seated on mF, one unused: waits, then ONE refund
      K('p2', `select pg_temp.buy({{gone}}, 1)`),          // unused (an old removed seat names it): refunded at once
      K('p3', `select pg_temp.buy({{gone}}, 1)`),          // the friend's seat on mF
      K('p4', `select pg_temp.buy({{gone}}, 2)`),          // reserved by the request on mR
      K('p5', `select pg_temp.buy({{gone}}, 1)`),          // mA, waiting for a court
      K('p6', `select pg_temp.buy({{gone}}, 1)`),          // mB, booked
      K('p7', `select pg_temp.buy({{gone}}, 2)`),          // a forfeit still restorable (mX), one unused: waits (R13)
      K('p8', `select pg_temp.buy({{gone}}, 2)`),          // a forfeit for good (mP), one unused: refunded at once
      K('p9', `select pg_temp.buy({{gone}}, 1)`),          // cashed out at the desk before the deletion
      K('p10', `select pg_temp.buy({{gone}}, 1, 'pending')`), // still being paid: never in the queue (R13)
      K('p11', `select pg_temp.buy({{gone}}, 1)`),         // mE, the player alone
      X(`select app.tickets_cash_out({{p9}}, 'ticket_cashout', null)`),

      // mF: a women's match the player organised, their seat and a friend's, and g1's.
      K('mF', `select pg_temp.m(jsonb_build_object('organiser_id', {{gone}}, 'category', 'women'))`),
      K('sF1', `select pg_temp.hold({{mF}}, 1, 'account', {{gone}}, pg_temp.nth({{p1}}, 1), 'in', '{"gender":"female"}')`),
      K('sF2', `select pg_temp.hold({{mF}}, 2, 'friend', {{gone}}, pg_temp.nth({{p3}}, 1), 'in', '{"gender":"female"}')`),
      X(`select pg_temp.seat({{mF}}, 3, 'account', {{g1}})`),
      // mR: g1's approve-mode women's match; the player asks for two seats (a
      // friend declared a woman); an earlier ask was declined.
      K('mR', `select pg_temp.m(jsonb_build_object('start_at', ${at(4)}, 'join_policy', 'approve', 'category', 'women'))`),
      X(`select pg_temp.seat({{mR}}, 1, 'account', {{g1}})`),
      K('qOld', `select pg_temp.ask({{mR}}, {{gone}}, 2, array['female'], null, 'declined')`),
      K('qR', `select pg_temp.ask({{mR}}, {{gone}}, 2, array['female'],
                                  array[pg_temp.nth({{p4}}, 1), pg_temp.nth({{p4}}, 2)])`),
      // mA: four players waiting for a court (DF-18), the player the fourth.
      K('mA', `select pg_temp.m(jsonb_build_object('start_at', ${at(5)}, 'status', 'awaiting_court'))`),
      X(`select pg_temp.seat({{mA}}, 1, 'account', {{g1}})`),
      X(`select pg_temp.seat({{mA}}, 2, 'account', {{g2}})`),
      K('sA3', `select pg_temp.seat({{mA}}, 3, 'account', {{g3}})`),
      K('sA4', `select pg_temp.hold({{mA}}, 4, 'account', {{gone}}, pg_temp.nth({{p5}}, 1))`),
      // mB: booked on court 1, before the start, the player the fourth.
      K('resB', `select pg_temp.res('c1', ${at(6)}, 90)`),
      K('mB', `select pg_temp.m(jsonb_build_object('start_at', ${at(6)}, 'status', 'booked', 'reservation_id', {{resB}}))`),
      X(`select pg_temp.seat({{mB}}, 1, 'account', {{g1}})`),
      X(`select pg_temp.seat({{mB}}, 2, 'account', {{g2}})`),
      X(`select pg_temp.seat({{mB}}, 3, 'account', {{g3}})`),
      K('sB4', `select pg_temp.hold({{mB}}, 4, 'account', {{gone}}, pg_temp.nth({{p6}}, 1))`),
      // mD: g2's match; the desk seated the player as a linked walk-in.
      K('mD', `select pg_temp.m(jsonb_build_object('start_at', ${at(7)}, 'organiser_id', {{g2}}, 'category', 'women'))`),
      X(`select pg_temp.seat({{mD}}, 1, 'account', {{g2}})`),
      K('sD2', `select pg_temp.seat({{mD}}, 2, 'desk', {{gone}}, 'in', '{"gender":"female"}')`),
      // mE: the player's own match, nobody else in it.
      K('mE', `select pg_temp.m(jsonb_build_object('start_at', ${at(8)}, 'organiser_id', {{gone}}))`),
      K('sE1', `select pg_temp.hold({{mE}}, 1, 'account', {{gone}}, pg_temp.nth({{p11}}, 1))`),
      // mC: an old cancelled match the player was removed from (and excluded).
      K('mC', `select pg_temp.m(jsonb_build_object('start_at', ${at(2)}, 'status', 'cancelled', 'ended_at', now(),
                                                   'ended_reason', 'organiser_cancelled'))`),
      K('sC2', `select pg_temp.hold({{mC}}, 2, 'account', {{gone}}, pg_temp.nth({{p2}}, 1), 'removed', '{"gender":"female"}')`),
      X(`insert into match_exclusions (match_id, guest_id, venue_id, reason)
         values ({{mC}}, {{gone}}, {{v}}, 'removed_by_organiser')`),
      // mX, at venue A where the branch's sweep never looks: booked in three
      // days, the player marked a no-show (as tickets.test.ts plants it); its
      // day is open, so the forfeit is still restorable (R13).
      K('ca', `insert into courts (name_en, name_ar, venue_id) values ('M263 court', 'ملعب ٢٦٣', {{venue}}) returning id`),
      K('resX', `select pg_temp.res('ca', ${at(3)}, 90)`),
      K('mX', `select pg_temp.m(jsonb_build_object('venue_id', {{venue}}, 'price_court_id', {{ca}}, 'rate_rule_id', null,
                                                   'organiser_id', {{g1}}, 'status', 'booked', 'reservation_id', {{resX}}))`),
      K('sX', `select pg_temp.hold({{mX}}, 1, 'account', {{gone}}, pg_temp.nth({{p7}}, 1), 'no_show')`),
      // mP: played three days ago at the branch, which has never opened a
      // day, so its marks are shut and the forfeit is final.
      K('resP', `select pg_temp.res('c2', ${at(-3)}, 90, 'booking', 'completed')`),
      K('mP', `select pg_temp.m(jsonb_build_object('start_at', ${at(-3)}, 'status', 'played', 'ended_at', now(),
                                                   'reservation_id', {{resP}}))`),
      K('sP', `select pg_temp.hold({{mP}}, 1, 'account', {{gone}}, pg_temp.nth({{p8}}, 1), 'no_show')`),

      // Blocks both ways and one between others; a report each way; a reminder queued.
      X(`insert into match_blocks (blocker_id, blocked_id) values ({{gone}}, {{g2}}), ({{g3}}, {{gone}}), ({{g1}}, {{g2}})`),
      X(`insert into match_reports (venue_id, match_id, reporter_id, reported_id, seat_id, reason)
         values ({{v}}, {{mF}}, {{g1}}, {{gone}}, {{sF1}}, 'harassment'),
                ({{v}}, {{mA}}, {{gone}}, {{g3}}, {{sA3}}, 'unsafe_play')`),
      X(`insert into notification_outbox (profile_id, kind, payload, scheduled_for)
         values ({{gone}}, 'match_reminder',
                 jsonb_build_object('route', 'match', 'id', {{mB}}, 'title_key', 'reminder_3h', 'params', '{}'::jsonb),
                 ${at(6)} - interval '3 hours')`),
      Q('before', `select pg_temp.gone()`),
      Q('pushes_before', `select pg_temp.pushes()`),
      Q('ledger_before', `select pg_temp.ledger()`),

      // The deletion.
      E('delete', 'gone', `select app.delete_my_account('DELETE')`),
      Q('deleted', `select pg_temp.gone()`),
      Q('games_deleted', `select pg_temp.games()`),
      Q('pushes_deleted', `select pg_temp.pushes()`),
      Q('audit', `select jsonb_agg(a.after order by a.at, a.id) from audit_log a
                   where a.entity_id = {{gone}}::text and a.action = 'account.delete'`),
      Q('ledger_deleted', `select pg_temp.ledger()`),
      // What the others read now: "Former player" (OM-26), no gender.
      E('detail_mF', 'g1', `select app.match_detail({{mF}})`),
      E('detail_mR', 'g1', `select app.match_detail({{mR}})`),
      E('blocks_g3', 'g3', `select app.my_match_blocks()`),
      E('blocks_g1', 'g1', `select app.my_match_blocks()`),
      // Idempotent: a second call is refused and changes nothing; the refund
      // queue has nothing more for this player until the sweep frees a ticket.
      E('again', 'gone', `select app.delete_my_account('DELETE')`),
      Q('after_again', `select pg_temp.gone()`),
      Q('refund_again', `select to_jsonb(app.ticket_refund_deleted({{gone}}))`),

      // The sweep (0263) finishes DF-20. A branch-scoped run moves the matches
      // and stops there: its Phase 3, ticket_refund_deleted(null), runs only on
      // the cron's chain-wide call (db.md §4.8.3, D-14). The scenario calls
      // the same queue for the player after each run, as that phase would.
      E('sweep', null, `select app.match_sweep({{v}})`),
      Q('swept', `select pg_temp.gone()`),
      Q('games_swept', `select pg_temp.games()`),
      Q('pushes_swept', `select pg_temp.pushes()`),
      Q('ledger_swept', `select pg_temp.ledger()`),
      Q('refund_swept', `select to_jsonb(app.ticket_refund_deleted({{gone}}))`),
      Q('refunded', `select pg_temp.gone()`),
      Q('ledger_refunded', `select pg_temp.ledger()`),

      // mB starts with the player's late leave unrefilled: released, never forfeited (R18).
      X(`update matches set start_at = now() - interval '10 minutes', end_at = now() + interval '80 minutes'
          where id = {{mB}}`),
      E('sweep_start', null, `select app.match_sweep({{v}})`),
      Q('released', `select pg_temp.gone()`),
      Q('refund_started', `select to_jsonb(app.ticket_refund_deleted({{gone}}))`),
      Q('started', `select pg_temp.gone()`),
      Q('games_started', `select pg_temp.games()`),
      Q('t6_events', `select jsonb_agg(e.type || ':' || coalesce(e.code, '') order by e.at, e.id)
                        from match_ticket_events e where e.ticket_id = pg_temp.nth({{p6}}, 1)`),
      Q('ledger_started', `select pg_temp.ledger()`),

      // Once more: nothing left to move.
      E('sweep_again', null, `select app.match_sweep({{v}})`),
      Q('swept_again', `select pg_temp.gone()`),
      Q('refund_last', `select to_jsonb(app.ticket_refund_deleted({{gone}}))`),
      Q('pushes_end', `select pg_temp.pushes()`),
    ]);
  });

  const SEATS_DELETED = {
    sF1: { status: 'in', end_reason: null, gender: null, ticket: 'in_use' },
    sF2: { status: 'in', end_reason: null, gender: null, ticket: 'in_use' },
    sA4: { status: 'in', end_reason: null, gender: null, ticket: 'in_use' },
    sB4: { status: 'in', end_reason: null, gender: null, ticket: 'in_use' },
    sD2: { status: 'in', end_reason: null, gender: null, ticket: null },
    sE1: { status: 'in', end_reason: null, gender: null, ticket: 'in_use' },
    sC2: { status: 'removed', end_reason: 'removed_by_organiser', gender: null, ticket: 'cashed_out' },
    sX: { status: 'no_show', end_reason: null, gender: null, ticket: 'forfeited' },
    sP: { status: 'no_show', end_reason: null, gender: null, ticket: 'forfeited' },
  };
  const held = (tickets: string[]) => ({ status: 'succeeded', reason: null, refund: null, tickets });
  const refunded = (refund: number, tickets: string[], reason = 'account_deleted') =>
    ({ status: 'refund_pending', reason, refund, tickets });
  const PURCHASES_DELETED = {
    p1: held(['available', 'in_use']),
    p2: refunded(10_000, ['cashed_out']),
    p3: held(['in_use']),
    p4: held(['reserved', 'reserved']),
    p5: held(['in_use']),
    p6: held(['in_use']),
    p7: held(['available', 'forfeited']),
    p8: refunded(10_000, ['cashed_out', 'forfeited']),
    p9: refunded(10_000, ['cashed_out'], 'ticket_cashout'),
    p10: { status: 'pending', reason: null, refund: null, tickets: [] },
    p11: held(['in_use']),
  };

  it('the fixture is what it says: a named, gendered player with a queued push and no broken rule', () => {
    const b = data<Json>(r, 'before');
    expect(b.profile).toEqual({
      full_name: 'Huda Yasiri', given_name: 'Huda', family_name: 'Yasiri', gender: 'female', gender_stamped: true,
      phone_set: true, push_set: true, deleted: false,
    });
    expect(b.auth_user).toBe(true);
    expect((b.seats as Record<string, Json>).sF1).toMatchObject({ gender: 'female' });
    expect(b.requests).toEqual({
      qOld: { status: 'declined', friend_genders: ['female'] },
      qR: { status: 'pending', friend_genders: ['female'] },
    });
    expect(b).toMatchObject({ blocks: 2, other_blocks: 1, reports: 2, exclusions: 1, forfeits: 2 });
    // The reminder, and the two ticket_forfeited pushes of the planted no-shows (0261).
    expect(b.outbox).toBeGreaterThanOrEqual(2);
    expect(data(r, 'ledger_before')).toEqual([]);
  });

  it('empties the profile, destroys the auth user and scrubs every seat and request, leaving the matches as they were (R25, R29)', () => {
    expect(data<Json>(r, 'delete')).toMatchObject({ deleted: true, apple_revoke_pending: false });
    const d = data<Json>(r, 'deleted');
    expect(d.profile).toEqual({
      full_name: 'Deleted account', given_name: null, family_name: null, gender: null, gender_stamped: false,
      phone_set: false, push_set: false, deleted: true,
    });
    expect(d.auth_user).toBe(false);
    // Every seat keeps its status and ticket (the sweep moves them); none keeps a gender.
    expect(d.seats).toEqual(SEATS_DELETED);
    expect(d.requests).toEqual({
      qOld: { status: 'declined', friend_genders: null },
      qR: { status: 'pending', friend_genders: null },
    });
    // Both blocks with the player go, the one between others stays; reports
    // and the exclusion are kept, pointing at the tombstone; no push is left.
    expect(d).toMatchObject({ blocks: 0, other_blocks: 1, reports: 2, exclusions: 1, outbox: 0, forfeits: 2 });
    expect(data(r, 'games_deleted')).toMatchObject({
      mF: { status: 'filling', organiser: 'gone' },
      mR: { status: 'filling', organiser: 'g1' },
      mA: { status: 'awaiting_court' },
      mB: { status: 'booked' },
      mD: { status: 'filling', organiser: 'g2' },
      mE: { status: 'filling', organiser: 'gone' },
    });
    expect(data(r, 'ledger_deleted')).toEqual([]);
  });

  it('DF-20 at once: only purchases with nothing reserved, in use or restorable are refunded, one refund each (R13)', () => {
    expect(data<Json>(r, 'deleted').purchases).toEqual(PURCHASES_DELETED);
  });

  it('audits the shape of the deletion, with the three match counts and nothing that names the player', () => {
    const rows = data<Json[]>(r, 'audit');
    expect(rows).toHaveLength(1);
    const after = rows[0]!;
    expect(after).toMatchObject({
      reservations_anonymised: 0, series_anonymised: 0, customer_notes_deleted: 0, customer_flags_deleted: 0,
      // sF1, sF2 (the friend's), sC2 and the linked desk seat sD2 held a gender.
      match_seats_scrubbed: 4, match_requests_scrubbed: 2, match_blocks_deleted: 2, apple_revoke_pending: false,
    });
    expect(after.outbox_deleted).toBe(data<Json>(r, 'before').outbox);
    expect(JSON.stringify(after)).not.toMatch(/Huda|Yasiri|female/);
  });

  it('other players see "Former player", and the organiser no friend genders (OM-26, R29)', () => {
    const f = data<Json>(r, 'detail_mF');
    expect(f.organiser).toEqual({ name: null, former: true, is_me: false });
    const seats = f.seats as Json[];
    expect(seats.map((s) => [s.seat_no, s.name, s.former])).toEqual([
      [1, null, true], [2, null, true], [3, expect.any(String), false],
    ]);
    const reqs = data<Json>(r, 'detail_mR').requests as Json[];
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ name: null, former: true, seats_requested: 2, friend_genders: null });
    // g3 blocked the player: the entry is gone. g1's own block of g2 stays.
    expect(data(r, 'blocks_g3')).toEqual([]);
    expect(data<Json[]>(r, 'blocks_g1')).toHaveLength(1);
  });

  it('a second deletion is refused and changes nothing; the queue has nothing more yet', () => {
    expect(failed(r, 'again').code).toBe('ALREADY_DELETED');
    expect(data(r, 'after_again')).toEqual(data(r, 'deleted'));
    expect(data(r, 'refund_again')).toBe(0);
  });

  it('the sweep leaves the filling and waiting matches, withdraws the request and turns the booked seat into a late leave; the queue then refunds what it freed (DF-20, R18)', () => {
    expect(data<Json>(r, 'sweep')).toMatchObject({ errors: 0, refunds_started: 0 });
    const s = data<Json>(r, 'swept');
    const left = (ticket: string | null) => ({ status: 'left', end_reason: 'account_deleted', gender: null, ticket });
    expect(s.seats).toEqual({
      ...SEATS_DELETED,
      sF1: left('available'),
      sF2: left('available'),
      sA4: left('available'),
      sD2: left(null),
      sE1: left('available'),
      // Booked, before the start: a late leave; the ticket stays in use until then.
      sB4: { status: 'left_late', end_reason: 'account_deleted', gender: null, ticket: 'in_use' },
    });
    expect((s.requests as Json).qR).toEqual({ status: 'withdrawn', friend_genders: null });
    // Released, not yet refunded: the branch run has no Phase 3 (D-14).
    expect(s.purchases).toEqual({
      ...PURCHASES_DELETED,
      p1: held(['available', 'available']),
      p3: held(['available']),
      p4: held(['available', 'available']),
      p5: held(['available']),
      p11: held(['available']),
    });
    expect(data(r, 'refund_swept')).toBe(5);
    const f = data<Json>(r, 'refunded');
    expect(f.seats).toEqual({
      ...(s.seats as Json),
      sF1: left('cashed_out'),
      sF2: left('cashed_out'),
      sA4: left('cashed_out'),
      sE1: left('cashed_out'),
    });
    expect(f.purchases).toEqual({
      ...PURCHASES_DELETED,
      p1: refunded(20_000, ['cashed_out', 'cashed_out']), // both tickets, one Qi refund
      p3: refunded(10_000, ['cashed_out']),
      p4: refunded(20_000, ['cashed_out', 'cashed_out']),
      p5: refunded(10_000, ['cashed_out']),
      p11: refunded(10_000, ['cashed_out']),
      // p6 waits for the start; p7 for its day to close (restorable, R13).
    });
    expect(data(r, 'ledger_refunded')).toEqual([]);
    expect(data(r, 'games_swept')).toMatchObject({
      mF: { status: 'filling', organiser: 'g1' },          // handed over (OM-34)
      mR: { status: 'filling', organiser: 'g1' },
      mA: { status: 'filling', organiser: 'g1' },          // three carriers: back to filling
      mB: { status: 'booked', organiser: 'g1' },
      mD: { status: 'filling', organiser: 'g2' },
      mE: { status: 'cancelled', ended_reason: 'empty' },  // nobody left
      mX: { status: 'booked' },
      mP: { status: 'played' },
    });
    expect(s).toMatchObject({ outbox: 0, forfeits: 2, reports: 2 });
    expect(data(r, 'ledger_swept')).toEqual([]);
  });

  it('at the start the late leaver\'s ticket is released, never forfeited, and refunded (R18, T11)', () => {
    expect(data<Json>(r, 'sweep_start')).toMatchObject({ errors: 0, forfeited: 0 });
    expect((data<Json>(r, 'released').seats as Json).sB4)
      .toEqual({ status: 'left_late', end_reason: 'account_deleted', gender: null, ticket: 'available' });
    expect(data(r, 'refund_started')).toBe(1);
    const s = data<Json>(r, 'started');
    expect((s.seats as Json).sB4).toEqual({ status: 'left_late', end_reason: 'account_deleted', gender: null, ticket: 'cashed_out' });
    expect((s.purchases as Json).p6).toEqual(refunded(10_000, ['cashed_out']));
    expect(data(r, 't6_events')).toEqual(['bought:', 'locked:', 'released:account_deleted', 'cashed_out:account_deleted']);
    expect(s.forfeits).toBe(2);
    expect((data<Json>(r, 'games_started').mB as Json).status).toBe('booked');
    // The restorable forfeit and its unused partner still wait; the final forfeit stays forfeited.
    expect((s.purchases as Json).p7).toEqual(held(['available', 'forfeited']));
    expect((s.purchases as Json).p8).toEqual(refunded(10_000, ['cashed_out', 'forfeited']));
    expect(data(r, 'ledger_started')).toEqual([]);
  });

  it('a third sweep moves nothing, and no purchase is refunded twice', () => {
    expect(data<Json>(r, 'sweep_again')).toMatchObject({ errors: 0 });
    expect(data(r, 'swept_again')).toEqual(data(r, 'started'));
    expect(data(r, 'refund_last')).toBe(0);
  });

  it('the push outbox: nothing is ever queued for the player, nothing names them; the others hear (guest.md §4.6.3)', () => {
    expect(data<Json>(r, 'pushes_before').gone).toBeGreaterThanOrEqual(2);
    for (const label of ['pushes_deleted', 'pushes_swept', 'pushes_end']) {
      expect(data<Json>(r, label), label).toMatchObject({ gone: 0, naming: 0 });
    }
    expect(data<Json>(r, 'pushes_deleted').g1).toEqual([]);
    // The handover of mF and the player leaving mA reach g1.
    expect(data<Json>(r, 'pushes_swept').g1).toEqual(expect.arrayContaining(['organiser_handover@mF', 'player_left@mA']));
  });
});

// ── 3. Committed, over HTTP, with real purchases (assertTicketLedger) ────────

describe.skipIf(!docker)('0264 over HTTP: the deletion refunds the free purchases itself; a held ticket is skipped, not waited for (committed)', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let savedEnabled: boolean | undefined;
  const touched = new Set<string>();

  const rpc = async (c: SupabaseClient, fn: string, args: Json) => {
    const { data, error } = await appRpc(c, fn, args);
    return { ok: !error, code: error?.message, data: data as unknown };
  };
  const payment = async (id: string) => {
    const { data, error } = await svc.from('booking_payments')
      .select('status, refund_reason, refund_amount_iqd, amount_iqd').eq('id', id).single();
    if (error) throw new Error(`payment ${id}: ${error.message}`);
    return data as { status: string; refund_reason: string | null; refund_amount_iqd: number | null; amount_iqd: number };
  };
  /** Refunded for the deletion: pending at Qi, or already back (the reconciler runs every 30 s). */
  const expectRefunded = async (id: string) => {
    const p = await payment(id);
    expect(['refund_pending', 'refunded'], `${id}: ${p.status}`).toContain(p.status);
    expect(p.refund_reason).toBe('account_deleted');
    expect(Number(p.refund_amount_iqd)).toBe(Number(p.amount_iqd));
  };

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    const s = await rpc(owner, 'match_settings', { p_venue_id: VENUE_A_ID });
    expect(s.ok, s.code).toBe(true);
    savedEnabled = (s.data as Json).matches_enabled as boolean;
    // ticket_payment_prepare refuses MATCHES_OFF while no open branch has matches on.
    expect((await rpc(owner, 'set_match_settings', { p_patch: { matches_enabled: true }, p_venue_id: VENUE_A_ID })).ok).toBe(true);
  });

  afterAll(async () => {
    if (!owner || savedEnabled === undefined) return;
    await rpc(owner, 'set_match_settings', { p_patch: { matches_enabled: savedEnabled }, p_venue_id: VENUE_A_ID });
  });

  // money.md §9: the ledger holds after every case, for every guest touched.
  afterEach(async () => {
    for (const id of touched) expect(await assertTicketLedger(svc, id), `ledger of ${id}`).toEqual([]);
  });

  it('three purchases: two refunded by the deletion, the held one left for the next call (DF-20, skip locked)', async () => {
    const client = await guestClient(svc, 'm263-df20');
    const id = (await client.auth.getUser()).data.user!.id;
    expect((await rpc(client, 'accept_terms', { p_version: '2026-09-23' })).ok).toBe(true);
    touched.add(id);
    const a = await grantTestTickets(svc, id, 2);
    const b = await grantTestTickets(svc, id, 1);
    const c = await grantTestTickets(svc, id, 1);
    expect(await assertTicketLedger(svc, id)).toEqual([]);

    // Another body holds b's ticket (0260's pick takes the same row lock).
    const { data: bt } = await svc.from('match_tickets').select('id').eq('purchase_payment_id', b);
    const session = psqlSession(`set application_name = 'm264-df20-held';
begin;
select 1 from match_tickets where id = '${(bt as Array<{ id: string }>)[0]!.id}' for update;
select pg_sleep(6);
rollback;`);
    await waitForSleeper('m264-df20-held');
    const del = await rpc(client, 'delete_my_account', { p_confirm: 'DELETE' });
    expect(del.ok, del.code).toBe(true);
    // Read while the other body still holds the ticket: skipped, not waited for.
    const bWhileHeld = await payment(b);
    await session;
    expect(bWhileHeld.status).toBe('succeeded');
    await expectRefunded(a);
    await expectRefunded(c);

    // The next call takes it. The match sweep's cron (0263, every 30 s) calls
    // the same queue, so it may have been first: one refund either way.
    const next = await svc.schema('app').rpc('ticket_refund_deleted', { p_guest_id: id });
    expect(next.error).toBeNull();
    expect([0, 1]).toContain(next.data);
    await expectRefunded(b);
    expect((await svc.schema('app').rpc('ticket_refund_deleted', { p_guest_id: id })).data).toBe(0);

    const { data: ev } = await svc.from('match_ticket_events').select('code, actor_staff_id, venue_id')
      .eq('guest_id', id).eq('type', 'cashed_out');
    expect(ev).toHaveLength(4);
    for (const e of ev ?? []) expect(e).toEqual({ code: 'account_deleted', actor_staff_id: null, venue_id: null });

    const { data: audit } = await svc.from('audit_log').select('after').eq('entity_id', id).eq('action', 'account.delete');
    expect(audit).toHaveLength(1);
    expect((audit as Array<{ after: Json }>)[0]!.after).toMatchObject({
      match_seats_scrubbed: 0, match_requests_scrubbed: 0, match_blocks_deleted: 0,
    });

    // A replay with the old session is refused and moves no money.
    const again = await rpc(client, 'delete_my_account', { p_confirm: 'DELETE' });
    expect(again.ok).toBe(false);
    for (const p of [a, b, c]) await expectRefunded(p);
  });
});
