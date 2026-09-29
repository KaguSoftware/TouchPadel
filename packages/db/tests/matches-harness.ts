/**
 * The shared harness of the 0261 match suites (matches-lifecycle,
 * matches-privacy, matches-moderation, guest-push): one psql transaction that
 * is rolled back (the stores-harness scenario), a branch made inside it (open,
 * matches on, open all day, two courts), guests who may play, paid tickets,
 * and a call runner that sets auth.uid() the way PostgREST would.
 *
 * The committed, over-HTTP half of the lifecycle (real purchases through
 * ticket-begin's prepare and deposit_apply, assertTicketLedger after every
 * case) lives in matches-lifecycle.test.ts itself; here every ticket move is
 * followed by pg_temp.ledger(), the in-transaction form of the ledger rules a
 * rolled-back scenario can check (money.md §9 T5, T6, T8, T9).
 */
import { expect } from 'vitest';
import { KEEP, Q, type Results } from './stores-harness';

export const SETUP = String.raw`
create temp table guests (id uuid primary key);

create function pg_temp.var(p_name text) returns text language sql as $f$
  select val from pg_temp.vars where name = p_name
$f$;

-- e() runs one statement as postgres with auth.uid() = the id kept under p_who
-- (NULL: no session) and records {ok, data} or {ok:false, code, detail, hint}.
create function pg_temp.e(p_label text, p_who text, p_sql text) returns void language plpgsql as $f$
declare v_res jsonb; v_msg text; v_detail text; v_hint text; v_uid text;
begin
  v_uid := case when p_who is null then null else coalesce(pg_temp.var(p_who), p_who) end;
  perform set_config('request.jwt.claims',
    case when v_uid is null then '' else jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text end, true);
  begin
    execute pg_temp.sub(p_sql) into v_res;
    insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v_res));
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
    insert into pg_temp.out(label, res)
    values (p_label, jsonb_build_object('ok', false, 'code', v_msg, 'detail', nullif(v_detail, ''),
                                        'hint', nullif(v_hint, '')));
  end;
  perform set_config('request.jwt.claims', '', true);
end $f$;

-- A branch of its own: open, matches on, open all day, two courts; every slot
-- 40,000 IQD, court 2 48,000 (its own rule).
create function pg_temp.branch() returns void language plpgsql as $f$
declare v uuid; c1 uuid; c2 uuid; r1 uuid; r2 uuid;
  v_all constant jsonb := '[["00:00","24:00"]]';
begin
  insert into venues (slug, name_en, name_ar, timezone, is_active)
  values ('m260-' || substr(md5(random()::text), 1, 8), 'M260 branch', 'فرع ٢٦٠', 'Asia/Baghdad', true)
  returning id into v;
  insert into venue_settings (venue_id, venue_name, opening_hours, matches_enabled)
  values (v, 'M260 branch', jsonb_build_object('mon', v_all, 'tue', v_all, 'wed', v_all, 'thu', v_all,
                                               'fri', v_all, 'sat', v_all, 'sun', v_all), true);
  insert into courts (venue_id, name_en, name_ar, duration_options, sort_order, is_active)
  values (v, 'M260 court 1', 'ملعب ١', '{60,90,120}', 1, true) returning id into c1;
  insert into courts (venue_id, name_en, name_ar, duration_options, sort_order, is_active)
  values (v, 'M260 court 2', 'ملعب ٢', '{60,90,120}', 2, true) returning id into c2;
  insert into rate_rules (venue_id, name, court_id, days_of_week, start_time, end_time, priority, valid_from, is_active)
  values (v, 'M260 all day', null, '{0,1,2,3,4,5,6}', '00:00', '23:59:59', 0, current_date - 1, true)
  returning id into r1;
  insert into rate_rule_prices (rule_id, duration_min, price_iqd)
  select r1, d, 40000 from unnest(array[60, 90, 120]) d;
  insert into rate_rules (venue_id, name, court_id, days_of_week, start_time, end_time, priority, valid_from, is_active)
  values (v, 'M260 court 2', c2, '{0,1,2,3,4,5,6}', '00:00', '23:59:59', 0, current_date - 1, true)
  returning id into r2;
  insert into rate_rule_prices (rule_id, duration_min, price_iqd)
  select r2, d, 48000 from unnest(array[60, 90, 120]) d;
  insert into pg_temp.vars values ('v', v::text), ('c1', c1::text), ('c2', c2::text), ('rule', r1::text);
end $f$;

-- A guest (the 0069 trigger makes the profile) who may play: a phone, the
-- terms, a gender. p overrides: given, family, phone, terms, gender (null
-- unsets), sandbox, push (an Expo token, so pushes are queued).
create function pg_temp.guest(p_name text, p jsonb default '{}') returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid(); q jsonb := jsonb_build_object('phone', '+9647700000000', 'terms', '2026-09-23',
                                                                   'gender', 'female') || p;
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (v, 'm260-' || p_name || '-' || v || '@test.touch.local', jsonb_build_object('full_name', 'Test ' || p_name),
          'authenticated', 'authenticated');
  update profiles
     set phone           = q->>'phone',
         terms_version   = q->>'terms',
         gender          = q->>'gender',
         gender_set_at   = case when q->>'gender' is null then null else now() end,
         gender_set_by   = case when q->>'gender' is null then null else 'guest' end,
         payment_sandbox = coalesce((q->>'sandbox')::boolean, false),
         expo_push_token = case when q ? 'push' then q->>'push' end
   where id = v;
  if q ? 'given' then
    update profiles set given_name = q->>'given', family_name = q->>'family' where id = v;
  end if;
  insert into pg_temp.vars values (p_name, v::text);
  insert into pg_temp.guests values (v);
  return v;
end $f$;

create function pg_temp.ban(p_name text) returns void language sql as $f$
  insert into customer_flags (customer_id, type, label, created_by)
  values (pg_temp.var(p_name)::uuid, 'match_ban', 'conduct', pg_temp.var('manager')::uuid)
$f$;

-- One paid ticket of the guest (a one-ticket purchase), available.
create function pg_temp.ticket(p_guest uuid, p_sandbox boolean default false) returns uuid language plpgsql as $f$
declare v_pay uuid; v uuid;
begin
  insert into booking_payments (venue_id, reservation_id, hold_id, guest_id, purpose, provider, sandbox, request_id,
                                amount_iqd, quoted_price_iqd, ticket_count, status, succeeded_at, deadline_at)
  values (null, null, null, p_guest, 'ticket', 'fake', p_sandbox, gen_random_uuid(), 10000, 10000, 1, 'succeeded',
          now(), now() + interval '15 minutes')
  returning id into v_pay;
  insert into match_tickets (guest_id, status, price_iqd, purchase_payment_id, sandbox)
  values (p_guest, 'available', 10000, v_pay, p_sandbox) returning id into v;
  insert into match_ticket_events (ticket_id, guest_id, type, payment_id) values (v, p_guest, 'bought', v_pay);
  return v;
end $f$;

-- n tickets for the guest kept under p_name, in the guest's own sandbox.
create function pg_temp.tickets(p_name text, n int) returns void language plpgsql as $f$
declare v_g uuid := pg_temp.var(p_name)::uuid; i int;
begin
  for i in 1 .. n loop
    perform pg_temp.ticket(v_g, (select coalesce(p.payment_sandbox, false) from profiles p where p.id = v_g));
  end loop;
end $f$;

-- A reservation on court p_court (a kept name); a hold needs its guest (a kept name).
create function pg_temp.res(p_court text, p_start timestamptz, p_dur int, p_kind text default 'booking',
                            p_status text default 'confirmed', p_guest text default null) returns uuid
language plpgsql as $f$
declare v uuid; v_court uuid := pg_temp.var(p_court)::uuid;
begin
  insert into reservations (venue_id, court_id, kind, status, start_at, end_at, guest_id, guest_name, source,
                            hold_expires_at)
  values ((select c.venue_id from courts c where c.id = v_court), v_court, p_kind::reservation_kind,
          p_status::reservation_status, p_start, p_start + make_interval(mins => p_dur),
          case when p_guest is null then null else pg_temp.var(p_guest)::uuid end,
          case when p_guest is null then 'M260 fixture' end, 'desk',
          case when p_kind = 'hold' then now() + interval '5 minutes' end)
  returning id into v;
  return v;
end $f$;

-- The ticket ledger rules a rolled-back scenario can check, over every guest
-- made in it (money.md §9): T5 a live ticket is on its holder's live seat or
-- pending request, and an in seat's ticket is in use on it; T6 the latest
-- event says what the status says; T8 the ticket's sandbox is its match's;
-- T9 no ticket in use or reserved on an ended match.
create function pg_temp.ledger() returns jsonb language sql as $f$
  select coalesce(jsonb_agg(b order by b), '[]'::jsonb) from (
    select 'T5 in_use ' || k.id as b
      from match_tickets k join pg_temp.guests g on g.id = k.guest_id
      left join match_seats s on s.id = k.seat_id
     where k.status = 'in_use'
       and (s.id is null or s.status not in ('in', 'left_late') or s.guest_id <> k.guest_id or s.ticket_id <> k.id)
    union all
    select 'T5 reserved ' || k.id
      from match_tickets k join pg_temp.guests g on g.id = k.guest_id
      left join match_requests q on q.id = k.request_id
     where k.status = 'reserved' and (q.id is null or q.status <> 'pending' or q.guest_id <> k.guest_id)
    union all
    select 'T5 seat ' || s.id
      from match_seats s join pg_temp.guests g on g.id = s.guest_id
      left join match_tickets k on k.id = s.ticket_id
     where s.status = 'in' and s.ticket_id is not null and (k.status <> 'in_use' or k.seat_id <> s.id)
    union all
    select 'T6 ' || k.id || ' ' || k.status || '/' || coalesce(e.type, 'none')
      from match_tickets k join pg_temp.guests g on g.id = k.guest_id
      left join lateral (select x.type from match_ticket_events x where x.ticket_id = k.id
                          order by x.at desc, x.id desc limit 1) e on true
     where not coalesce(e.type = any (case k.status
                                        when 'available' then array['bought', 'released', 'restored']
                                        when 'reserved' then array['reserved']
                                        when 'in_use' then array['locked', 'restored']
                                        when 'forfeited' then array['forfeited']
                                        when 'cashed_out' then array['cashed_out'] end), false)
    union all
    select 'T8 ' || k.id
      from match_tickets k join pg_temp.guests g on g.id = k.guest_id
      join match_seats s on s.id = k.seat_id join matches m on m.id = s.match_id
     where k.status = 'in_use' and m.sandbox <> k.sandbox
    union all
    select 'T9 ' || k.id
      from match_tickets k join pg_temp.guests g on g.id = k.guest_id
      left join match_seats s on s.id = k.seat_id
      left join match_requests q on q.id = k.request_id
      join matches m on m.id = coalesce(s.match_id, q.match_id)
     where k.status in ('in_use', 'reserved')
       and m.status in ('played', 'no_show', 'cancelled', 'bumped', 'expired')) x
$f$;

-- A match planted directly (a status or time no RPC can reach from here); p
-- overrides the defaults (a filling public open match at the branch, 3 days
-- out, 90 minutes, 40,000 IQD, organiser g1, tapped court c1).
create function pg_temp.m(p jsonb default '{}') returns uuid language plpgsql as $f$
declare
  v_start timestamptz := coalesce((p->>'start_at')::timestamptz, date_trunc('hour', now()) + interval '3 days');
  v_dur   int := coalesce((p->>'duration_min')::int, 90);
  r matches;
  v uuid;
begin
  r := jsonb_populate_record(null::matches, jsonb_build_object(
         'venue_id', pg_temp.var('v'), 'status', 'filling',
         'start_at', v_start, 'end_at', v_start + make_interval(mins => v_dur), 'duration_min', v_dur,
         'visibility', 'public', 'join_policy', 'open', 'category', 'open',
         'price_iqd', 40000, 'shares_iqd', jsonb_build_array(10000, 10000, 10000, 10000),
         'price_court_id', pg_temp.var('c1'), 'rate_rule_id', pg_temp.var('rule'),
         'fill_deadline_at', v_start - interval '2 hours',
         'share_token', substr(replace(gen_random_uuid()::text, '-', ''), 1, 22), 'organiser_id', pg_temp.var('g1'),
         'organised_by', 'guest', 'sandbox', false) || p);
  insert into matches (venue_id, status, start_at, end_at, duration_min, visibility, join_policy, category,
                       price_iqd, shares_iqd, rate_rule_id, price_court_id, fill_deadline_at, share_token,
                       organiser_id, organised_by, created_by_staff_id, reservation_id, sandbox, ended_at,
                       ended_reason)
  values (r.venue_id, r.status, r.start_at, r.end_at, r.duration_min, r.visibility, r.join_policy, r.category,
          r.price_iqd, r.shares_iqd, r.rate_rule_id, r.price_court_id, r.fill_deadline_at, r.share_token,
          r.organiser_id, r.organised_by, r.created_by_staff_id, r.reservation_id, r.sandbox, r.ended_at,
          r.ended_reason)
  returning id into v;
  return v;
end $f$;

-- A seat planted directly: an account or friend seat takes a fresh ticket of
-- its holder, in use while in or left_late.
create function pg_temp.seat(p_match uuid, p_no int, p_kind text, p_guest uuid, p_status text default 'in',
                             p jsonb default '{}') returns uuid language plpgsql as $f$
declare
  v_venue   uuid := (select mt.venue_id from matches mt where mt.id = p_match);
  v_sandbox boolean := (select mt.sandbox from matches mt where mt.id = p_match);
  v_t uuid; v uuid; r match_seats;
begin
  if p_kind in ('account', 'friend') then
    v_t := pg_temp.ticket(p_guest, v_sandbox);
  end if;
  r := jsonb_populate_record(null::match_seats, jsonb_build_object(
         'venue_id', v_venue, 'match_id', p_match, 'seat_no', p_no, 'kind', p_kind, 'guest_id', p_guest,
         'status', p_status, 'ticket_id', v_t, 'share_iqd', 10000,
         'created_by_staff_id', case when p_kind = 'desk' then pg_temp.var('desk') end,
         'ended_at', case when p_status in ('left', 'removed', 'cancelled', 'left_late', 'refilled') then now() end,
         'end_reason', case p_status when 'left' then 'left' when 'removed' then 'removed_by_organiser'
                                     when 'cancelled' then 'match_ended' when 'left_late' then 'left'
                                     when 'refilled' then 'refilled' end) || p);
  insert into match_seats (venue_id, match_id, seat_no, kind, guest_id, guest_name, guest_phone, gender, status,
                           ticket_id, share_iqd, request_id, replaces_seat_id, created_by_staff_id, joined_at,
                           ended_at, end_reason)
  values (r.venue_id, r.match_id, r.seat_no, r.kind, r.guest_id, r.guest_name, r.guest_phone, r.gender, r.status,
          r.ticket_id, r.share_iqd, r.request_id, r.replaces_seat_id, r.created_by_staff_id, clock_timestamp(),
          r.ended_at, r.end_reason)
  returning id into v;
  if v_t is not null and p_status in ('in', 'left_late') then
    update match_tickets set status = 'in_use', seat_id = v where id = v_t;
    insert into match_ticket_events (ticket_id, guest_id, type, venue_id, match_id, seat_id)
    values (v_t, p_guest, 'locked', v_venue, p_match, v);
  end if;
  return v;
end $f$;

-- A match's state for the assertions.
create function pg_temp.state(p_match text) returns jsonb language sql as $f$
  select jsonb_build_object(
    'match', (select jsonb_build_object('status', mt.status, 'ended_reason', mt.ended_reason,
                                        'organiser_id', mt.organiser_id, 'join_policy', mt.join_policy,
                                        'reservation_id', mt.reservation_id)
                from matches mt where mt.id = pg_temp.var(p_match)::uuid),
    'seats', (select jsonb_agg(jsonb_build_object('no', s.seat_no, 'kind', s.kind, 'status', s.status,
                                                  'end_reason', s.end_reason, 'ticket', k.status,
                                                  'guest', (select v.name from pg_temp.vars v
                                                             where v.val = s.guest_id::text limit 1))
                               order by s.seat_no, s.joined_at)
                from match_seats s left join match_tickets k on k.id = s.ticket_id
               where s.match_id = pg_temp.var(p_match)::uuid),
    'requests', (select jsonb_agg(jsonb_build_object('status', q.status, 'seats', q.seats_requested)
                                  order by q.created_at, q.id)
                   from match_requests q where q.match_id = pg_temp.var(p_match)::uuid),
    'events', (select jsonb_agg(e.type || coalesce(':' || e.code, '') order by e.id)
                 from match_events e where e.match_id = pg_temp.var(p_match)::uuid))
$f$;

-- The ticket statuses of a guest, by status.
create function pg_temp.wallet(p_name text) returns jsonb language sql as $f$
  select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb)
    from (select k.status, count(*) as n from match_tickets k
           where k.guest_id = pg_temp.var(p_name)::uuid group by k.status) x
$f$;
`;

/**
 * money.md §9: the court-money invariants (M1, M3–M7, M11) of every match of
 * the branch that has a booking, as {match id: broken rules}; {} when they
 * hold. The scenario loads MATCH_MONEY_CHECK (helpers.ts) after SETUP.
 */
export const MONEY = (label: string) =>
  Q(label, `select coalesce(jsonb_object_agg(m.id, x.b) filter (where x.b <> '[]'::jsonb), '{}'::jsonb)
              from matches m cross join lateral (select pg_temp.money_of(m.id) as b) x
             where m.reservation_id is not null and m.venue_id = {{v}}`);

/** Capture as postgres, auth.uid() = the kept id `who` (null: no session). */
export const E = (label: string, who: string | null, sql: string) =>
  `select pg_temp.e('${label}', ${who === null ? 'null' : `'${who}'`}, $q$${sql}$q$);`;
export const GUEST = (name: string, p = '{}') => `select pg_temp.guest('${name}', '${p}'::jsonb);`;
/** Keep a value under `name`. */
export const K = (name: string, sql: string) => KEEP(name, sql);
/** A time `days` days and `hours` hours past the current hour. */
export const at = (days: number, hours = 0) => `(date_trunc('hour', now()) + interval '${days} days ${hours} hours')`;

/**
 * A match_start call at the branch: defaults to court c1, 90 minutes, an open
 * public instant match, no friends, the quote 40,000 and key `key`.
 */
export function START(o: {
  when?: string; court?: string; dur?: number; category?: string; visibility?: string; policy?: string;
  friends?: string; price?: number | null; key?: string | null;
} = {}): string {
  const key = o.key === undefined ? `'k-${Math.random().toString(36).slice(2)}'` : o.key === null ? 'null' : `'${o.key}'`;
  return `select app.match_start({{v}}, {{${o.court ?? 'c1'}}}, ${o.when ?? at(3)}, ${o.dur ?? 90}, ` +
    `'${o.category ?? 'open'}', '${o.visibility ?? 'public'}', '${o.policy ?? 'open'}', ` +
    `'${o.friends ?? '[]'}'::jsonb, ${o.price === undefined ? 40000 : o.price === null ? 'null' : o.price}, ${key})`;
}

export function failed(r: Results, label: string): { code: string; detail: string | null; hint: string | null } {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label} was expected to fail, got ${JSON.stringify(o!.data)}`).toBe(false);
  return { code: o!.code!, detail: (o!.detail ?? null) as string | null, hint: (o!.hint ?? null) as string | null };
}

export function data<T = Record<string, unknown>>(r: Results, label: string): T {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label}: ${o!.code ?? ''} ${o!.detail ?? ''}`).toBe(true);
  return o!.data as T;
}
