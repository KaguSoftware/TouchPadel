/**
 * 0260 match_core (docs/design/open-matches/db.md §2.2, §3, §4.5; build
 * contracts §1.4, §1.5, R4, R12, R13, R15–R18, R21, R22, R37): the internal
 * functions every match body is built from, called as postgres.
 *
 * Nothing client-callable writes a match before 0261, so every case here is
 * one psql transaction that is rolled back (the stores-harness scenario). The
 * court cases run at a branch made inside the transaction (open, matches on,
 * open all day, two courts), so no other suite's courts count. The ticket
 * helpers' ownership rules (R17, R18) with the ledger invariants on committed
 * rows are in matches-tickets.test.ts; the gate's view of these bodies is in
 * lock-order-matches.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { splitEvenly } from '../../core/src/money/split';
import { stackAvailable } from './helpers';
import { KEEP, Q, X, dockerReachable, ok, psql, psqlSession, scenario, waitForSleeper, type Results } from './stores-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;

/**
 * The planting helpers. e() runs as postgres and captures the outcome, with
 * auth.uid() set to the id kept under p_who (NULL: no session); the SQL
 * returns jsonb (wrap scalars in to_jsonb).
 */
const SETUP = String.raw`
create function pg_temp.var(p_name text) returns text language sql as $f$
  select val from pg_temp.vars where name = p_name
$f$;

create function pg_temp.e(p_label text, p_who text, p_sql text) returns void language plpgsql as $f$
declare v_res jsonb; v_msg text; v_detail text; v_uid text;
begin
  v_uid := case when p_who is null then null else coalesce(pg_temp.var(p_who), p_who) end;
  perform set_config('request.jwt.claims',
    case when v_uid is null then '' else jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text end, true);
  begin
    execute pg_temp.sub(p_sql) into v_res;
    insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v_res));
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
    insert into pg_temp.out(label, res)
    values (p_label, jsonb_build_object('ok', false, 'code', v_msg, 'detail', nullif(v_detail, '')));
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
  values ('m259-' || substr(md5(random()::text), 1, 8), 'M259 branch', 'فرع ٢٥٩', 'Asia/Baghdad', true)
  returning id into v;
  insert into venue_settings (venue_id, venue_name, opening_hours, matches_enabled)
  values (v, 'M259 branch', jsonb_build_object('mon', v_all, 'tue', v_all, 'wed', v_all, 'thu', v_all,
                                               'fri', v_all, 'sat', v_all, 'sun', v_all), true);
  insert into courts (venue_id, name_en, name_ar, duration_options, sort_order, is_active)
  values (v, 'M259 court 1', 'ملعب ١', '{60,90,120}', 1, true) returning id into c1;
  insert into courts (venue_id, name_en, name_ar, duration_options, sort_order, is_active)
  values (v, 'M259 court 2', 'ملعب ٢', '{60,90,120}', 2, true) returning id into c2;
  insert into rate_rules (venue_id, name, court_id, days_of_week, start_time, end_time, priority, valid_from, is_active)
  values (v, 'M259 all day', null, '{0,1,2,3,4,5,6}', '00:00', '23:59:59', 0, current_date - 1, true)
  returning id into r1;
  insert into rate_rule_prices (rule_id, duration_min, price_iqd)
  select r1, d, 40000 from unnest(array[60, 90, 120]) d;
  insert into rate_rules (venue_id, name, court_id, days_of_week, start_time, end_time, priority, valid_from, is_active)
  values (v, 'M259 court 2', c2, '{0,1,2,3,4,5,6}', '00:00', '23:59:59', 0, current_date - 1, true)
  returning id into r2;
  insert into rate_rule_prices (rule_id, duration_min, price_iqd)
  select r2, d, 48000 from unnest(array[60, 90, 120]) d;
  insert into pg_temp.vars values ('v', v::text), ('c1', c1::text), ('c2', c2::text), ('rule', r1::text);
end $f$;

-- A guest (the 0069 trigger makes the profile) who may play: a phone, the
-- terms, a gender. p overrides: given, family, phone, terms, gender (null
-- unsets), sandbox.
create function pg_temp.guest(p_name text, p jsonb default '{}') returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid(); q jsonb := jsonb_build_object('phone', '+9647700000000', 'terms', '2026-09-23',
                                                                   'gender', 'female') || p;
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (v, 'm259-' || p_name || '-' || v || '@test.touch.local', jsonb_build_object('full_name', 'Test ' || p_name),
          'authenticated', 'authenticated');
  update profiles
     set phone           = q->>'phone',
         terms_version   = q->>'terms',
         gender          = q->>'gender',
         gender_set_at   = case when q->>'gender' is null then null else now() end,
         gender_set_by   = case when q->>'gender' is null then null else 'guest' end,
         payment_sandbox = coalesce((q->>'sandbox')::boolean, false)
   where id = v;
  if q ? 'given' then
    update profiles set given_name = q->>'given', family_name = q->>'family' where id = v;
  end if;
  insert into pg_temp.vars values (p_name, v::text);
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

-- A reservation on court p_court (a kept name) p_days from now at this hour.
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
          case when p_guest is null then 'M259 fixture' end, 'desk',
          case when p_kind = 'hold' then now() + interval '5 minutes' end)
  returning id into v;
  return v;
end $f$;

-- A match; p overrides the defaults (a filling public open match at the
-- branch, 3 days out, 90 minutes, 40,000 IQD, organiser g1, tapped court c1).
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

-- A booked (or played / no_show) match with its booking on p_court.
create function pg_temp.mb(p_court text, p_status text, p_start timestamptz, p jsonb default '{}') returns uuid
language plpgsql as $f$
declare v_res uuid := pg_temp.res(p_court, p_start, 90, 'booking',
                                  case when p_status = 'booked' then 'confirmed' else 'completed' end);
begin
  return pg_temp.m(jsonb_build_object('status', p_status, 'start_at', p_start, 'reservation_id', v_res,
                                      'price_court_id', pg_temp.var(p_court),
                                      'ended_at', case when p_status = 'booked' then null else now() end,
                                      'ended_reason', case when p_status = 'no_show' then 'all_no_show' end) || p);
end $f$;

-- A seat. Account and friend seats get a ticket of their holder: in_use while
-- in or left_late, forfeited by the seat on no_show, available otherwise.
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
         'marked_at', case when p_status in ('attended', 'no_show') then now() end,
         'ended_at', case when p_status in ('left', 'removed', 'cancelled', 'left_late', 'refilled') then now() end,
         'end_reason', case p_status when 'left' then 'left' when 'removed' then 'removed_by_organiser'
                                     when 'cancelled' then 'match_ended' when 'left_late' then 'left'
                                     when 'refilled' then 'refilled' end) || p);
  insert into match_seats (venue_id, match_id, seat_no, kind, guest_id, guest_name, gender, status, ticket_id,
                           share_iqd, request_id, replaces_seat_id, created_by_staff_id, joined_at, ended_at,
                           end_reason, marked_at)
  values (r.venue_id, r.match_id, r.seat_no, r.kind, r.guest_id, r.guest_name, r.gender, r.status, r.ticket_id,
          r.share_iqd, r.request_id, r.replaces_seat_id, r.created_by_staff_id, clock_timestamp(), r.ended_at,
          r.end_reason, r.marked_at)
  returning id into v;
  if v_t is not null and p_status in ('in', 'left_late') then
    update match_tickets set status = 'in_use', seat_id = v where id = v_t;
    insert into match_ticket_events (ticket_id, guest_id, type, venue_id, match_id, seat_id)
    values (v_t, p_guest, 'locked', v_venue, p_match, v);
  elsif v_t is not null and p_status = 'no_show' then
    update match_tickets set status = 'forfeited', forfeited_at = now(), forfeited_venue_id = v_venue,
                             forfeited_seat_id = v where id = v_t;
    insert into match_ticket_events (ticket_id, guest_id, type, venue_id, match_id, seat_id)
    values (v_t, p_guest, 'forfeited', v_venue, p_match, v);
  end if;
  return v;
end $f$;

-- A pending request with its ticket reserved through ticket_lock.
create function pg_temp.req(p_match uuid, p_guest uuid) returns uuid language plpgsql as $f$
declare v uuid; v_t uuid;
begin
  insert into match_requests (venue_id, match_id, guest_id, seats_requested)
  values ((select mt.venue_id from matches mt where mt.id = p_match), p_match, p_guest, 1) returning id into v;
  v_t := pg_temp.ticket(p_guest, (select mt.sandbox from matches mt where mt.id = p_match));
  if app.ticket_lock(array[v_t], null, v) <> 1 then
    raise exception 'req: the ticket was not reserved';
  end if;
  return v;
end $f$;

-- A player leaves a filling match (the 0261 path in two lines): the seat's
-- ticket back, the seat left.
create function pg_temp.leave(p_seat uuid) returns void language plpgsql as $f$
begin
  perform app.ticket_release(array[(select s.ticket_id from match_seats s where s.id = p_seat)], 'left', array[p_seat]);
  update match_seats set status = 'left', ended_at = now(), end_reason = 'left' where id = p_seat;
end $f$;

-- Tickets and seat statuses of one match, for the assertions.
create function pg_temp.state(p_match text) returns jsonb language sql as $f$
  select jsonb_build_object(
    'match', (select jsonb_build_object('status', mt.status, 'ended_reason', mt.ended_reason,
                                        'organiser_id', mt.organiser_id, 'join_policy', mt.join_policy,
                                        'reservation_id', mt.reservation_id)
                from matches mt where mt.id = pg_temp.var(p_match)::uuid),
    'seats', (select jsonb_agg(jsonb_build_object('no', s.seat_no, 'status', s.status, 'end_reason', s.end_reason,
                                                  'ticket', k.status, 'marked', s.marked_at is not null)
                               order by s.seat_no, s.joined_at)
                from match_seats s left join match_tickets k on k.id = s.ticket_id
               where s.match_id = pg_temp.var(p_match)::uuid),
    'requests', (select jsonb_agg(jsonb_build_object('status', q.status,
                                                     'ticket', (select k.status from match_tickets k
                                                                 join match_ticket_events e on e.ticket_id = k.id
                                                                where e.request_id = q.id limit 1))
                                  order by q.created_at, q.id)
                   from match_requests q where q.match_id = pg_temp.var(p_match)::uuid),
    'events', (select jsonb_agg(jsonb_build_object('type', e.type, 'actor', e.actor, 'code', e.code) order by e.id)
                 from match_events e where e.match_id = pg_temp.var(p_match)::uuid))
$f$;

-- The ticket events of one match, in order.
create function pg_temp.tevents(p_match text) returns jsonb language sql as $f$
  select coalesce(jsonb_agg(jsonb_build_object('type', e.type, 'code', e.code) order by e.id), '[]')
    from match_ticket_events e where e.match_id = pg_temp.var(p_match)::uuid
$f$;
`;

/** Capture as postgres, auth.uid() = the kept id `who` (null: no session). */
const E = (label: string, who: string | null, sql: string) =>
  `select pg_temp.e('${label}', ${who === null ? 'null' : `'${who}'`}, $q$${sql}$q$);`;
const GUEST = (name: string, p = '{}') => `select pg_temp.guest('${name}', '${p}'::jsonb);`;
/** Keep a match (or any id) under `name`. */
const K = (name: string, sql: string) => KEEP(name, sql);
const at = (days: number, hours = 0) => `(date_trunc('hour', now()) + interval '${days} days ${hours} hours')`;

function failed(r: Results, label: string): { code: string; detail: string | null } {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label} was expected to fail`).toBe(false);
  return { code: o!.code!, detail: (o!.detail ?? null) as string | null };
}

// ── 1. Shares, names, eligibility ────────────────────────────────────────────

const PRICES = [0, 1, 2, 3, 4, 5, 7, 250, 10_001, 39_999, 40_000, 40_001, 40_002, 40_003, 99_998, 250_001, 1_000_003];

describe.skipIf(!docker)('0260 shares, names, eligibility', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m259a', [
      SETUP,
      Q('shares', `select jsonb_agg(jsonb_build_object('p', p, 's', app.match_shares(p)) order by p)
                     from unnest(array[${PRICES.join(',')}]::bigint[]) p`),
      Q('shares_null', `select to_jsonb(app.match_shares(null))`),
      E('shares_negative', null, `select to_jsonb(app.match_shares(-1))`),

      Q('initials', `select jsonb_object_agg(coalesce(f, '<null>'), app.name_initial(f)) from unnest(array[
        'آل ياسين', 'آل-سعود', 'الربيعي', 'الـسعدي', 'آلاء', 'الياس', 'ال', '  حسين  ', 'ـعلي',
        'Al-Rubaie', 'al rubaie', 'EL Amin', 'Alice', 'Elias', 'Émile', 'O''Brien', 'Al-', '123', '', null]) f`),
      // Every letter of the three Arabic ranges is its own initial, whatever the ctype.
      Q('arabic_nulls', `select to_jsonb(count(*)) from (
          select chr(c) as l from generate_series(x'0621'::int, x'063A'::int) c
          union all select chr(c) from generate_series(x'0641'::int, x'064A'::int) c
          union all select chr(c) from generate_series(x'0671'::int, x'06D3'::int) c) x
        where app.name_initial(x.l || 'ب') is distinct from upper(x.l)`),

      GUEST('g1', '{"given":"Ahmed","family":"Khalil"}'),
      GUEST('g2', '{"given":"أحمد","family":"الحسني"}'),
      GUEST('g3', '{"given":"Sara","family":null}'),
      GUEST('g4', '{"given":"Gone","family":"Away"}'),
      GUEST('g5'),
      GUEST('g6'),
      X(`update profiles set deleted_at = now() where id = {{g4}}`),
      // A profile an older build wrote: no parts, only the full name.
      X(`select set_config('app.skip_name_sync', 'on', true)`),
      X(`update profiles set given_name = null, family_name = null, full_name = 'Omar  Faruq' where id = {{g5}}`),
      X(`update profiles set given_name = null, family_name = null, full_name = '' where id = {{g6}}`),
      X(`select set_config('app.skip_name_sync', '', true)`),
      Q('names', `select jsonb_build_object(
          'latin', app.match_display_name({{g1}}), 'arabic', app.match_display_name({{g2}}),
          'no_family', app.match_display_name({{g3}}), 'deleted', app.match_display_name({{g4}}),
          'full_name_only', app.match_display_name({{g5}}), 'nameless', app.match_display_name({{g6}}),
          'vanished', app.match_display_name('00000000-0000-4000-8000-000000000000'),
          'none', app.match_display_name(null))`),

      // Eligibility and the guest guard, in the §1.6 order.
      GUEST('ok'),
      GUEST('nophone', '{"phone":null}'),
      GUEST('noterms', '{"terms":null}'),
      GUEST('nogender', '{"gender":null}'),
      GUEST('banned'),
      GUEST('everything', '{"phone":null,"terms":null,"gender":null}'),
      GUEST('deleted'),
      `select pg_temp.ban('banned');`,
      `select pg_temp.ban('everything');`,
      X(`update profiles set deleted_at = now() where id = {{deleted}}`),
      Q('elig', `select jsonb_build_object(
          'ok', app.match_eligibility({{ok}}, true), 'read', app.match_eligibility({{nophone}}, false),
          'nophone', app.match_eligibility({{nophone}}, true), 'noterms', app.match_eligibility({{noterms}}, true),
          'nogender', app.match_eligibility({{nogender}}, true), 'banned', app.match_eligibility({{banned}}, true),
          'banned_read', app.match_eligibility({{banned}}, false),
          'everything', app.match_eligibility({{everything}}, true),
          'deleted', app.match_eligibility({{deleted}}, false), 'nobody', app.match_eligibility(null, false))`),
      E('guard_anon', null, `select to_jsonb((app.match_guest(false)).id)`),
      E('guard_stranger', '00000000-0000-4000-8000-00000000e259', `select to_jsonb((app.match_guest(false)).id)`),
      E('guard_deleted', 'deleted', `select to_jsonb((app.match_guest(false)).id)`),
      E('guard_ok', 'ok', `select to_jsonb((app.match_guest(true)).id)`),
      E('guard_read_banned', 'banned', `select to_jsonb((app.match_guest(false)).id)`),
      E('guard_nophone', 'nophone', `select to_jsonb((app.match_guest(true)).id)`),
      E('guard_noterms', 'noterms', `select to_jsonb((app.match_guest(true)).id)`),
      E('guard_banned', 'banned', `select to_jsonb((app.match_guest(true)).id)`),
      E('guard_nogender', 'nogender', `select to_jsonb((app.match_guest(true)).id)`),
      E('guard_everything', 'everything', `select to_jsonb((app.match_guest(true)).id)`),
      Q('ids', `select jsonb_build_object('ok', {{ok}}, 'banned', {{banned}})`),
      // A newer terms version required: an older acceptance is TERMS_REQUIRED.
      X(`update platform_settings set match_terms_version = '2026-10-01' where id`),
      E('guard_old_terms', 'ok', `select to_jsonb((app.match_guest(true)).id)`),
    ]);
  });

  it('match_shares is splitEvenly(p, 4) for every price, largest first, summing to the price (DF-3)', () => {
    const rows = ok<{ p: number; s: number[] }[]>(r, 'shares');
    expect(rows.map((x) => x.p)).toEqual(PRICES);
    for (const { p, s } of rows) {
      expect(s.map(Number), String(p)).toEqual(splitEvenly(p, 4).map(Number));
      expect(s.reduce((a, b) => a + Number(b), 0)).toBe(p);
      expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(1);
    }
    expect(ok(r, 'shares_null')).toBeNull();
    expect(failed(r, 'shares_negative')).toEqual({ code: 'INVALID_ARGUMENT', detail: 'p_price' });
  });

  it('name_initial drops one article and reads an explicit Latin + Arabic letter class', () => {
    expect(ok<Json>(r, 'initials')).toEqual({
      'آل ياسين': 'ي',
      'آل-سعود': 'س',
      'الربيعي': 'ر',
      'الـسعدي': 'س',
      'آلاء': 'آ', // no separator after آل: not an article
      'الياس': 'ي', // the known limit (§10): a non-article ال is dropped
      'ال': 'ا', // nothing after the article: the word itself
      '  حسين  ': 'ح',
      'ـعلي': 'ع', // tatweel is not a letter
      'Al-Rubaie': 'R',
      'al rubaie': 'R',
      'EL Amin': 'A',
      Alice: 'A',
      Elias: 'E',
      'Émile': 'É',
      "O'Brien": 'O',
      'Al-': 'A',
      '123': null,
      '': null,
      '<null>': null,
    });
    expect(ok(r, 'arabic_nulls')).toBe(0);
  });

  it('match_display_name: "First I.", the first word of an old full name, "Former player", "Player" (OM-26)', () => {
    expect(ok<Json>(r, 'names')).toEqual({
      latin: { name: 'Ahmed K.', former: false },
      arabic: { name: 'أحمد ح.', former: false },
      no_family: { name: 'Sara', former: false },
      deleted: { name: null, former: true },
      full_name_only: { name: 'Omar', former: false },
      nameless: { name: null, former: false },
      vanished: { name: null, former: true },
      none: { name: null, former: false },
    });
  });

  it('match_eligibility: ACCOUNT_REQUIRED, then only to act PHONE, TERMS, BANNED, GENDER, in that order', () => {
    expect(ok<Json>(r, 'elig')).toEqual({
      ok: null,
      read: null,
      nophone: 'PHONE_REQUIRED',
      noterms: 'TERMS_REQUIRED',
      nogender: 'GENDER_REQUIRED',
      banned: 'MATCH_BANNED',
      banned_read: null, // a banned player can still leave
      everything: 'PHONE_REQUIRED',
      deleted: 'ACCOUNT_REQUIRED',
      nobody: 'ACCOUNT_REQUIRED',
    });
  });

  it('match_guest raises the first failing code and returns the caller\'s profile', () => {
    const ids = ok<Record<string, string>>(r, 'ids');
    expect(failed(r, 'guard_anon').code).toBe('AUTH_REQUIRED');
    expect(failed(r, 'guard_stranger').code).toBe('ACCOUNT_REQUIRED');
    expect(failed(r, 'guard_deleted').code).toBe('ACCOUNT_REQUIRED');
    expect(ok(r, 'guard_ok')).toBe(ids.ok);
    expect(ok(r, 'guard_read_banned')).toBe(ids.banned);
    expect(failed(r, 'guard_nophone').code).toBe('PHONE_REQUIRED');
    expect(failed(r, 'guard_noterms').code).toBe('TERMS_REQUIRED');
    expect(failed(r, 'guard_banned').code).toBe('MATCH_BANNED');
    expect(failed(r, 'guard_nogender').code).toBe('GENDER_REQUIRED');
    expect(failed(r, 'guard_everything').code).toBe('PHONE_REQUIRED');
    expect(failed(r, 'guard_old_terms').code).toBe('TERMS_REQUIRED');
  });
});

// ── 2. Visibility, seat labels, carriers ─────────────────────────────────────

/** match_visibility of a kept match for a kept viewer ('anon': none), with or without its token. */
const VIS = String.raw`
create function pg_temp.vis(p_match text, p_viewer text, p_gender text, p_tok boolean default false)
returns text language sql as $f$
  select app.match_visibility(x, case when p_viewer = 'anon' then null else pg_temp.var(p_viewer)::uuid end,
                              p_gender, case when p_tok then x.share_token end)
    from matches x where x.id = pg_temp.var(p_match)::uuid
$f$;
create function pg_temp.label(p_seat text) returns jsonb language sql as $f$
  select app.match_seat_label(s) from match_seats s where s.id = pg_temp.var(p_seat)::uuid
$f$;
`;

describe.skipIf(!docker)('0260 visibility, seat labels, carriers', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m259b', [
      SETUP,
      VIS,
      `select pg_temp.branch();`,
      GUEST('g1', '{"given":"Lina","family":"Haddad"}'),
      GUEST('g2', '{"given":"Maya","family":"Nasser"}'),
      GUEST('gf', '{"given":"Rana","family":"Al-Khatib"}'),
      GUEST('gm', '{"gender":"male"}'),
      GUEST('gu', '{"gender":null}'),
      GUEST('gb'),
      GUEST('gk'),
      GUEST('gd'),
      GUEST('gs', '{"sandbox":true}'),
      GUEST('gr'),
      GUEST('gq'),
      GUEST('gx'),
      GUEST('gz'),
      `select pg_temp.ban('gb');`,
      X(`insert into match_blocks (blocker_id, blocked_id) values ({{gk}}, {{g1}}), ({{g2}}, {{gd}}), ({{gx}}, {{gr}})`),

      // mw: women, public, filling. g1 organises (seat 1 + a friend), g2 plays,
      // gr was removed (and excluded), gq asks to join.
      K('mw', `select pg_temp.m('{"category":"women"}')`),
      K('mw1', `select pg_temp.seat({{mw}}, 1, 'account', {{g1}}, 'in', '{"gender":"female"}')`),
      K('mw2', `select pg_temp.seat({{mw}}, 2, 'friend', {{g1}}, 'in', '{"gender":"female"}')`),
      K('mw3', `select pg_temp.seat({{mw}}, 3, 'account', {{g2}}, 'in', '{"gender":"female"}')`),
      K('mw4', `select pg_temp.seat({{mw}}, 4, 'account', {{gr}}, 'removed', '{"gender":"female"}')`),
      X(`insert into match_exclusions (match_id, guest_id, venue_id, reason)
         values ({{mw}}, {{gr}}, {{v}}, 'removed_by_organiser')`),
      X(`select pg_temp.req({{mw}}, {{gq}})`),
      K('mm', `select pg_temp.m(jsonb_build_object('category', 'men', 'organiser_id', {{g2}}))`),
      K('ml', `select pg_temp.m(jsonb_build_object('visibility', 'link', 'organiser_id', {{g2}}))`),
      K('mpast', `select pg_temp.m(jsonb_build_object('organiser_id', {{g2}}, 'start_at', now() + interval '1 hour',
                                                      'fill_deadline_at', now() - interval '1 hour'))`),
      // Booked with a late leaver's number open (listable), and booked full (not).
      K('mbo', `select pg_temp.mb('c1', 'booked', ${at(4)}, jsonb_build_object('organiser_id', {{g2}}))`),
      X(`select pg_temp.seat({{mbo}}, 1, 'account', {{g2}}, 'in')`),
      K('mbo2', `select pg_temp.seat({{mbo}}, 2, 'desk', null, 'in', '{"guest_name":"عبد الله الربيعي"}')`),
      K('mbo3', `select pg_temp.seat({{mbo}}, 3, 'desk', null, 'in', '{"guest_name":"Walk In"}')`),
      X(`select pg_temp.seat({{mbo}}, 4, 'account', {{gx}}, 'left_late')`),
      K('mbf', `select pg_temp.mb('c2', 'booked', ${at(4)}, '{"organiser_id":null}')`),
      K('mbf1', `select pg_temp.seat({{mbf}}, 1, 'desk', {{gf}}, 'in')`),
      X(`select pg_temp.seat({{mbf}}, 2, 'desk', null, 'in', '{"guest_name":"A B"}')`),
      X(`select pg_temp.seat({{mbf}}, 3, 'desk', null, 'in')`),
      X(`select pg_temp.seat({{mbf}}, 4, 'desk', null, 'in')`),
      K('msb', `select pg_temp.m(jsonb_build_object('sandbox', true, 'organiser_id', {{g2}}))`),
      K('mterm', `select pg_temp.m(jsonb_build_object('status', 'cancelled', 'ended_at', now(),
                                                      'ended_reason', 'organiser_cancelled', 'organiser_id', {{g2}}))`),
      K('mterm1', `select pg_temp.seat({{mterm}}, 1, 'account', {{gz}}, 'cancelled')`),
      X(`update profiles set deleted_at = now() where id = {{gz}}`),
      K('mban', `select pg_temp.m(jsonb_build_object('organiser_id', {{gb}}))`),
      // A branch that is not open (the harness's inactive venue).
      K('cw', `insert into courts (venue_id, name_en, name_ar) values ({{other_venue}}, 'M259 W', 'و') returning id`),
      K('mclosed', `select pg_temp.m(jsonb_build_object('venue_id', {{other_venue}}, 'price_court_id', {{cw}},
                                                        'rate_rule_id', null, 'organiser_id', {{g2}}))`),

      Q('vis_mw', `select jsonb_build_object(
          'organiser', pg_temp.vis('mw', 'g1', 'female'), 'seated', pg_temp.vis('mw', 'g2', 'female'),
          'removed', pg_temp.vis('mw', 'gr', 'female'), 'requester', pg_temp.vis('mw', 'gq', 'female'),
          'woman', pg_temp.vis('mw', 'gf', 'female'), 'man', pg_temp.vis('mw', 'gm', 'male'),
          'man_token', pg_temp.vis('mw', 'gm', 'male', true), 'unset', pg_temp.vis('mw', 'gu', null),
          'anon', pg_temp.vis('mw', 'anon', null), 'banned', pg_temp.vis('mw', 'gb', 'female'),
          'banned_token', pg_temp.vis('mw', 'gb', 'female', true),
          'blocks_organiser', pg_temp.vis('mw', 'gk', 'female'),
          'blocks_organiser_token', pg_temp.vis('mw', 'gk', 'female', true),
          'blocked_by_carrier', pg_temp.vis('mw', 'gd', 'female'),
          'blocked_by_carrier_token', pg_temp.vis('mw', 'gd', 'female', true),
          'blocks_a_former_holder', pg_temp.vis('mw', 'gx', 'female'),
          'sandbox_viewer', pg_temp.vis('mw', 'gs', 'female'),
          'sandbox_viewer_token', pg_temp.vis('mw', 'gs', 'female', true))`),
      Q('vis_other', `select jsonb_build_object(
          'men_woman', pg_temp.vis('mm', 'gf', 'female'), 'men_man', pg_temp.vis('mm', 'gm', 'male'),
          'link', pg_temp.vis('ml', 'gf', 'female'), 'link_token', pg_temp.vis('ml', 'gf', 'female', true),
          'link_anon_token', pg_temp.vis('ml', 'anon', null, true),
          'past_deadline', pg_temp.vis('mpast', 'gf', 'female'),
          'past_deadline_token', pg_temp.vis('mpast', 'gf', 'female', true),
          'booked_open', pg_temp.vis('mbo', 'gf', 'female'),
          'booked_full', pg_temp.vis('mbf', 'gm', 'male'),
          'booked_full_token', pg_temp.vis('mbf', 'gm', 'male', true),
          'booked_full_linked', pg_temp.vis('mbf', 'gf', 'female'),
          'sandbox_sandbox', pg_temp.vis('msb', 'gs', 'female'), 'sandbox_real', pg_temp.vis('msb', 'gf', 'female'),
          'sandbox_anon', pg_temp.vis('msb', 'anon', null),
          'ended', pg_temp.vis('mterm', 'gf', 'female'), 'ended_token', pg_temp.vis('mterm', 'gf', 'female', true),
          'banned_organiser', pg_temp.vis('mban', 'gf', 'female'),
          'banned_organiser_token', pg_temp.vis('mban', 'gf', 'female', true),
          'banned_organiser_anon', pg_temp.vis('mban', 'anon', null),
          'closed_branch_token', pg_temp.vis('mclosed', 'gf', 'female', true),
          'wrong_token', (select app.match_visibility(x, {{gf}}, 'female', repeat('x', 22))
                            from matches x where x.id = {{ml}}))`),
      X(`update venue_settings set matches_enabled = false where venue_id = {{v}}`),
      Q('vis_off', `select jsonb_build_object('woman', pg_temp.vis('mw', 'gf', 'female'),
                                              'woman_token', pg_temp.vis('mw', 'gf', 'female', true),
                                              'organiser', pg_temp.vis('mw', 'g1', 'female'))`),
      X(`update venue_settings set matches_enabled = true where venue_id = {{v}}`),

      Q('labels', `select jsonb_build_object(
          'account', pg_temp.label('mw1'), 'friend', pg_temp.label('mw2'), 'typed_arabic', pg_temp.label('mbo2'),
          'typed_latin', pg_temp.label('mbo3'), 'linked_desk', pg_temp.label('mbf1'),
          'former', pg_temp.label('mterm1'))`),
      Q('label_ids', `select jsonb_build_object('mw1', {{mw1}}, 'mw2', {{mw2}}, 'mbo2', {{mbo2}})`),

      // Carriers (R4, R21): a no-show re-seated by a walk-in, a late leaver, a
      // vacant number; a refilled late leaver.
      K('mc', `select pg_temp.mb('c1', 'booked', ${at(5)}, '{}')`),
      K('mc1', `select pg_temp.seat({{mc}}, 1, 'account', {{g1}}, 'in')`),
      K('mc2', `select pg_temp.seat({{mc}}, 2, 'account', {{g2}}, 'no_show')`),
      K('mc2w', `select pg_temp.seat({{mc}}, 2, 'desk', null, 'in', jsonb_build_object('replaces_seat_id', {{mc2}}))`),
      K('mc3', `select pg_temp.seat({{mc}}, 3, 'account', {{gf}}, 'left_late')`),
      X(`select pg_temp.seat({{mc}}, 4, 'account', {{gx}}, 'left')`),
      K('md', `select pg_temp.mb('c2', 'booked', ${at(5)}, '{}')`),
      K('md1', `select pg_temp.seat({{md}}, 1, 'account', {{g1}}, 'refilled')`),
      K('md1r', `select pg_temp.seat({{md}}, 1, 'account', {{g2}}, 'in', jsonb_build_object('replaces_seat_id', {{md1}}))`),
      K('md2', `select pg_temp.seat({{md}}, 2, 'account', {{gf}}, 'attended')`),
      Q('carriers', `select jsonb_build_object(
          'mc', (select jsonb_agg(jsonb_build_object('no', c.seat_no, 'seat', c.seat_id, 'status', c.status)
                                  order by c.seat_no) from app.match_carriers({{mc}}) c),
          'md', (select jsonb_agg(jsonb_build_object('no', c.seat_no, 'seat', c.seat_id, 'status', c.status)
                                  order by c.seat_no) from app.match_carriers({{md}}) c),
          'ids', jsonb_build_object('mc1', {{mc1}}, 'mc2w', {{mc2w}}, 'mc3', {{mc3}}, 'md1r', {{md1r}}, 'md2', {{md2}}))`),
      // A booked match whose only open number is a replaced no-show is not listable to guests.
      Q('vis_carriers', `select jsonb_build_object('late_leaver_open', pg_temp.vis('mc', 'gm', 'male'),
                                                   'vacant_open', pg_temp.vis('md', 'gm', 'male'))`),
    ]);
  });

  it('match_visibility: participants, DF-10 (an unset gender sees both), bans, blocks, sandbox, tokens', () => {
    expect(ok<Json>(r, 'vis_mw')).toEqual({
      organiser: 'participant',
      seated: 'participant',
      removed: 'participant', // an excluded player still sees the match (as removed); 0261 refuses the join
      requester: 'participant',
      woman: 'public',
      man: null,
      man_token: 'restricted',
      unset: 'public',
      anon: 'public',
      banned: null,
      banned_token: 'restricted',
      blocks_organiser: null,
      blocks_organiser_token: 'restricted',
      blocked_by_carrier: null,
      blocked_by_carrier_token: 'restricted',
      blocks_a_former_holder: 'public', // only carriers and the organiser count
      sandbox_viewer: null,
      sandbox_viewer_token: null, // DF-19: never, even with the link
    });
  });

  it('match_visibility: link, listability, sandbox, ended, banned organiser, closed branch, matches off', () => {
    expect(ok<Json>(r, 'vis_other')).toEqual({
      men_woman: null,
      men_man: 'public',
      link: null,
      link_token: 'token',
      link_anon_token: 'token',
      past_deadline: null,
      past_deadline_token: 'token',
      booked_open: 'public',
      booked_full: null,
      booked_full_token: 'token',
      booked_full_linked: 'participant', // a linked desk seat is a seat
      sandbox_sandbox: 'public',
      sandbox_real: null,
      sandbox_anon: null,
      ended: null,
      ended_token: 'token',
      banned_organiser: null,
      banned_organiser_token: 'restricted',
      banned_organiser_anon: 'public', // step 6 needs a viewer
      closed_branch_token: null,
      wrong_token: null,
    });
    expect(ok<Json>(r, 'vis_off')).toEqual({ woman: null, woman_token: 'token', organiser: 'participant' });
    expect(ok<Json>(r, 'vis_carriers')).toEqual({ late_leaver_open: 'public', vacant_open: 'public' });
  });

  it('match_seat_label: names only, the holder for a friend, typed walk-ins, a deleted holder', () => {
    const ids = ok<Record<string, string>>(r, 'label_ids');
    const labels = ok<Record<string, Json>>(r, 'labels');
    expect(labels.account).toEqual({ seat_id: ids.mw1, seat_no: 1, kind: 'account', name: 'Lina H.', former: false, holder_seat_no: null });
    expect(labels.friend).toEqual({ seat_id: ids.mw2, seat_no: 2, kind: 'friend', name: 'Lina H.', former: false, holder_seat_no: 1 });
    expect(labels.typed_arabic).toMatchObject({ seat_id: ids.mbo2, kind: 'desk', name: 'عبد الله ر.', former: false });
    expect(labels.typed_latin).toMatchObject({ kind: 'desk', name: 'Walk I.', former: false });
    expect(labels.linked_desk).toMatchObject({ kind: 'desk', name: 'Rana K.', former: false });
    expect(labels.former).toMatchObject({ kind: 'account', name: null, former: true });
    for (const l of Object.values(labels)) {
      expect(Object.keys(l).sort()).toEqual(['former', 'holder_seat_no', 'kind', 'name', 'seat_id', 'seat_no']);
    }
    expect(JSON.stringify(labels)).not.toMatch(/Haddad|Nasser|\+964|Test /);
  });

  it('match_carriers: one carrier per number; a re-seated no-show and a refilled leaver carry nothing (R4, R21)', () => {
    const c = ok<{ mc: Json[]; md: Json[]; ids: Record<string, string> }>(r, 'carriers');
    expect(c.mc).toEqual([
      { no: 1, seat: c.ids.mc1, status: 'in' },
      { no: 2, seat: c.ids.mc2w, status: 'in' },
      { no: 3, seat: c.ids.mc3, status: 'left_late' },
      { no: 4, seat: null, status: null },
    ]);
    expect(c.md).toEqual([
      { no: 1, seat: c.ids.md1r, status: 'in' },
      { no: 2, seat: c.ids.md2, status: 'attended' },
      { no: 3, seat: null, status: null },
      { no: 4, seat: null, status: null },
    ]);
  });
});

// ── 3. Courts, hold expiry, the fourth seat ──────────────────────────────────

describe.skipIf(!docker)('0260 courts, hold expiry, match_try_book', () => {
  let r: Results;
  const P1 = at(3, 2);

  it('runs the scenario', () => {
    r = scenario('m259c', [
      SETUP,
      `select pg_temp.branch();`,
      ...['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'gh'].map((g) => GUEST(g)),
      KEEP('p1', `select tstzrange(${P1}, ${P1} + interval '90 minutes', '[)')::text`),
      K('mt1', `select pg_temp.m(jsonb_build_object('start_at', ${P1}))`),
      K('mt2', `select pg_temp.m(jsonb_build_object('start_at', ${P1}, 'price_court_id', {{c2}}))`),
      Q('free_both', `select jsonb_build_object(
          'pick_c1', (select app.match_pick_court(x) from matches x where x.id = {{mt1}}),
          'pick_c2', (select app.match_pick_court(x) from matches x where x.id = {{mt2}}),
          'firm1', app.match_court_free_firm({{v}}, {{p1}}::tstzrange, 90, 1),
          'firm2', app.match_court_free_firm({{v}}, {{p1}}::tstzrange, 90, 2),
          'firm3', app.match_court_free_firm({{v}}, {{p1}}::tstzrange, 90, 3))`),
      // A live hold on the tapped court: not firm, but the pick skips it.
      K('h1', `select pg_temp.res('c1', ${P1}, 60, 'hold', 'pending', 'gh')`),
      Q('hold_c1', `select jsonb_build_object(
          'pick', (select app.match_pick_court(x) from matches x where x.id = {{mt1}}),
          'firm2', app.match_court_free_firm({{v}}, {{p1}}::tstzrange, 90, 2))`),
      K('b2', `select pg_temp.res('c2', ${P1} + interval '30 minutes', 60)`),
      Q('hold_c1_booked_c2', `select jsonb_build_object(
          'pick', (select app.match_pick_court(x) from matches x where x.id = {{mt1}}),
          'firm1', app.match_court_free_firm({{v}}, {{p1}}::tstzrange, 90, 1),
          'firm2', app.match_court_free_firm({{v}}, {{p1}}::tstzrange, 90, 2))`),
      X(`update reservations set status = 'expired' where id = {{h1}}`),
      X(`select pg_temp.res('c1', ${P1}, 90, 'booking', 'cancelled')`),
      Q('lapsed_c1', `select jsonb_build_object(
          'pick', (select app.match_pick_court(x) from matches x where x.id = {{mt1}}),
          'firm1', app.match_court_free_firm({{v}}, {{p1}}::tstzrange, 90, 1))`),
      K('mx1', `select pg_temp.res('c1', ${P1} + interval '60 minutes', 60, 'maintenance')`),
      Q('maintenance', `select jsonb_build_object(
          'pick', (select app.match_pick_court(x) from matches x where x.id = {{mt1}}),
          'firm1', app.match_court_free_firm({{v}}, {{p1}}::tstzrange, 90, 1))`),
      X(`delete from reservations where id in ({{mx1}}, {{b2}})`),
      // A court that does not offer the length, and an inactive one, never count.
      X(`update courts set duration_options = '{60}' where id = {{c2}}`),
      Q('length', `select jsonb_build_object(
          'firm2', app.match_court_free_firm({{v}}, {{p1}}::tstzrange, 90, 2),
          'firm1_60', app.match_court_free_firm({{v}}, {{p1}}::tstzrange, 60, 2),
          'pick_c2', (select app.match_pick_court(x) from matches x where x.id = {{mt2}}))`),
      X(`update courts set duration_options = '{60,90,120}', is_active = false where id = {{c2}}`),
      Q('inactive', `select jsonb_build_object(
          'firm2', app.match_court_free_firm({{v}}, {{p1}}::tstzrange, 90, 2),
          'pick_c2', (select app.match_pick_court(x) from matches x where x.id = {{mt2}}))`),
      X(`update courts set is_active = true where id = {{c2}}`),
      // The price order: two more courts, c3 at the stamped price after c2 in
      // sort order, c4 the cheapest.
      K('c3', `insert into courts (venue_id, name_en, name_ar, sort_order) values ({{v}}, 'M259 c3', 'ملعب ٣', 3) returning id`),
      K('c4', `insert into courts (venue_id, name_en, name_ar, sort_order) values ({{v}}, 'M259 c4', 'ملعب ٤', 4) returning id`),
      X(`with r as (insert into rate_rules (venue_id, name, court_id, days_of_week, start_time, end_time, valid_from)
                    values ({{v}}, 'M259 c4', {{c4}}, '{0,1,2,3,4,5,6}', '00:00', '23:59:59', current_date - 1)
                    returning id)
         insert into rate_rule_prices (rule_id, duration_min, price_iqd) select r.id, d, 30000 from r, unnest(array[60,90,120]) d`),
      X(`select pg_temp.res('c1', ${P1}, 90)`),
      K('mt3', `select pg_temp.m(jsonb_build_object('start_at', ${P1}, 'price_iqd', 48000,
                                                    'shares_iqd', jsonb_build_array(12000, 12000, 12000, 12000)))`),
      K('mt4', `select pg_temp.m(jsonb_build_object('start_at', ${P1}, 'price_iqd', 99999,
                                                    'shares_iqd', jsonb_build_array(25000, 25000, 25000, 24999)))`),
      Q('price_order', `select jsonb_build_object(
          'stamped_40000', (select app.match_pick_court(x) from matches x where x.id = {{mt1}}),
          'stamped_48000', (select app.match_pick_court(x) from matches x where x.id = {{mt3}}),
          'no_equal_price', (select app.match_pick_court(x) from matches x where x.id = {{mt4}}),
          'ids', jsonb_build_object('c1', {{c1}}, 'c2', {{c2}}, 'c3', {{c3}}, 'c4', {{c4}}))`),
      X(`update courts set is_active = false where id in ({{c3}}, {{c4}})`),
      X(`update reservations set status = 'cancelled' where court_id = {{c1}} and venue_id = {{v}}`),

      // match_expire_holds against expire_stale_holds, one branch, one period.
      KEEP('p5', `select tstzrange(${at(8)}, ${at(8)} + interval '90 minutes', '[)')::text`),
      K('xh1', `select pg_temp.res('c1', ${at(8)}, 60, 'hold', 'pending', 'g1')`),
      K('xh3', `select pg_temp.res('c2', ${at(9)}, 60, 'hold', 'pending', 'g2')`),
      K('xh4', `select pg_temp.res('c2', ${at(8)}, 60, 'hold', 'pending', 'g3')`),
      K('ca', `insert into courts (venue_id, name_en, name_ar) values ({{venue}}, 'M259 A', 'أ') returning id`),
      K('xh6', `insert into reservations (venue_id, court_id, kind, status, start_at, end_at, guest_id, source, hold_expires_at)
                values ({{venue}}, {{ca}}, 'hold', 'pending', ${at(8)}, ${at(8)} + interval '1 hour', {{g4}}, 'mobile', now() - interval '1 minute')
                returning id`),
      X(`update reservations set hold_expires_at = now() - interval '1 minute' where id in ({{xh1}}, {{xh3}})`),
      E('twin_match_n', null, `select to_jsonb(app.match_expire_holds({{v}}, {{p5}}::tstzrange))`),
      Q('twin_match', `select coalesce(jsonb_agg(id order by id), '[]') from reservations
                        where id in ({{xh1}}, {{xh3}}, {{xh4}}, {{xh6}}) and status = 'expired'`),
      X(`update reservations set status = 'pending' where id = {{xh1}}`),
      E('twin_chain_n', null, `select to_jsonb(app.expire_stale_holds(null, {{p5}}::tstzrange))`),
      Q('twin_chain', `select coalesce(jsonb_agg(id order by id), '[]') from reservations
                        where id in ({{xh1}}, {{xh3}}, {{xh4}}, {{xh6}}) and status = 'expired'`),
      Q('twin_ids', `select jsonb_build_object('xh1', {{xh1}}, 'xh6', {{xh6}})`),

      // ── the fourth seat ──
      // a. Four carriers, both courts free: booked on the tapped court at the
      //    stamped price; a pending request expires (match_full).
      K('ma', `select pg_temp.m(jsonb_build_object('start_at', ${P1}, 'price_iqd', 40001,
                                                   'shares_iqd', jsonb_build_array(10001, 10000, 10000, 10000)))`),
      ...[1, 2, 3, 4].map((n) => X(`select pg_temp.seat({{ma}}, ${n}, 'account', {{g${n}}}, 'in')`)),
      K('ma_req', `select pg_temp.req({{ma}}, {{g5}})`),
      E('lock_ma', null, `select to_jsonb((app.match_lock({{ma}})).status)`),
      Q('venue_guc', `select to_jsonb(current_setting('app.venue_id', true))`),
      E('book_ma', null, `select to_jsonb(app.match_try_book({{ma}}))`),
      Q('ma_state', `select pg_temp.state('ma')`),
      Q('ma_booking', `select jsonb_build_object('court', r.court_id, 'kind', r.kind, 'status', r.status,
          'guest_id', r.guest_id, 'guest_name', r.guest_name, 'price_iqd', r.price_iqd, 'source', r.source,
          'rate_rule_id', r.rate_rule_id, 'staff', r.created_by_staff_id, 'period', r.period = {{p1}}::tstzrange,
          'c1', {{c1}}, 'rule', {{rule}},
          'event', (select e.data from match_events e where e.match_id = {{ma}} and e.type = 'booked'),
          'res_id', r.id, 'guc', current_setting('app.match_booking', true))
          from reservations r join matches x on x.reservation_id = r.id where x.id = {{ma}}`),
      Q('ma_req_tickets', `select pg_temp.tevents('ma')`),
      // b. Another four, c1 booked, only a hold on c2: waits (DF-18), once.
      K('hb', `select pg_temp.res('c2', ${P1}, 90, 'hold', 'pending', 'gh')`),
      K('mb', `select pg_temp.m(jsonb_build_object('start_at', ${P1}))`),
      ...[1, 2, 3, 4].map((n) => X(`select pg_temp.seat({{mb}}, ${n}, 'account', {{g${n + 4}}}, 'in')`)),
      E('book_mb', null, `select to_jsonb(app.match_try_book({{mb}}))`),
      E('book_mb_again', null, `select to_jsonb(app.match_try_book({{mb}}))`),
      Q('mb_waiting', `select pg_temp.state('mb')`),
      // c. The hold lapses: match_lock expires it and the fourth seat books c2.
      X(`update reservations set hold_expires_at = now() - interval '1 minute' where id = {{hb}}`),
      E('lock_mb', null, `select to_jsonb((app.match_lock({{mb}})).status)`),
      E('book_mb_lapsed', null, `select to_jsonb(app.match_try_book({{mb}}))`),
      Q('mb_booked', `select jsonb_build_object('state', pg_temp.state('mb'), 'hold', (select status from reservations where id = {{hb}}),
          'court', (select r.court_id from reservations r join matches x on x.reservation_id = r.id where x.id = {{mb}}),
          'c2', {{c2}})`),
      // d. A third four with no firm-free court: bumped, tickets back.
      K('mc', `select pg_temp.m(jsonb_build_object('start_at', ${P1}))`),
      ...[1, 2, 3, 4].map((n) => X(`select pg_temp.seat({{mc}}, ${n}, 'account', {{g${n}}}, 'in')`)),
      E('book_mc', null, `select to_jsonb(app.match_try_book({{mc}}))`),
      Q('mc_state', `select jsonb_build_object('state', pg_temp.state('mc'), 'tickets', pg_temp.tevents('mc'))`),
      // g. A sandbox match never books a court, even with none free (DF-19).
      K('ms', `select pg_temp.m(jsonb_build_object('start_at', ${P1}, 'sandbox', true))`),
      ...[1, 2, 3, 4].map((n) => X(`select pg_temp.seat({{ms}}, ${n}, 'account', {{g${n}}}, 'in')`)),
      E('book_ms', null, `select to_jsonb(app.match_try_book({{ms}}))`),
      Q('ms_state', `select pg_temp.state('ms')`),

      // e. R18: a deleted holder is dropped before counting; a banned one takes
      //    a waiting match back to filling.
      K('md', `select pg_temp.m(jsonb_build_object('start_at', ${at(4)}))`),
      K('md1', `select pg_temp.seat({{md}}, 1, 'account', {{g1}}, 'in')`),
      ...[2, 3].map((n) => X(`select pg_temp.seat({{md}}, ${n}, 'account', {{g${n}}}, 'in')`)),
      K('md4', `select pg_temp.seat({{md}}, 4, 'account', {{g8}}, 'in')`),
      X(`update profiles set deleted_at = now() where id = {{g8}}`),
      E('book_md', null, `select to_jsonb(app.match_try_book({{md}}))`),
      Q('md_state', `select jsonb_build_object('state', pg_temp.state('md'), 'tickets', pg_temp.tevents('md'))`),
      K('mw', `select pg_temp.m(jsonb_build_object('start_at', ${at(4)}, 'status', 'awaiting_court', 'organiser_id', {{g2}}))`),
      ...[1, 2, 3].map((n) => X(`select pg_temp.seat({{mw}}, ${n}, 'account', {{g${n + 1}}}, 'in')`)),
      X(`select pg_temp.seat({{mw}}, 4, 'account', {{g7}}, 'in')`),
      `select pg_temp.ban('g7');`,
      E('book_mw', null, `select to_jsonb(app.match_try_book({{mw}}))`),
      Q('mw_state', `select pg_temp.state('mw')`),

      // f. R22: the waiting match is served first; the newer one is bumped.
      X(`select pg_temp.res('c1', ${at(5)}, 90)`),
      K('h5', `select pg_temp.res('c2', ${at(5)}, 90, 'hold', 'pending', 'gh')`),
      K('me', `select pg_temp.m(jsonb_build_object('start_at', ${at(5)}))`),
      ...[1, 2, 3, 4].map((n) => X(`select pg_temp.seat({{me}}, ${n}, 'account', {{g${n}}}, 'in')`)),
      E('book_me', null, `select to_jsonb(app.match_try_book({{me}}))`),
      K('mf', `select pg_temp.m(jsonb_build_object('start_at', ${at(5)}, 'organiser_id', {{g5}}))`),
      ...[5, 6, 7].map((n) => X(`select pg_temp.seat({{mf}}, ${n - 4}, 'account', {{g${n === 7 ? 'h' : n}}}, 'in')`)),
      X(`select pg_temp.seat({{mf}}, 4, 'friend', {{g5}}, 'in')`),
      X(`update reservations set hold_expires_at = now() - interval '1 minute' where id = {{h5}}`),
      E('lock_mf', null, `select to_jsonb((app.match_lock({{mf}})).status)`),
      E('book_mf', null, `select to_jsonb(app.match_try_book({{mf}}))`),
      Q('waiting_first', `select jsonb_build_object('me', (select status from matches where id = {{me}}),
          'me_court', (select r.court_id from reservations r join matches x on x.reservation_id = r.id where x.id = {{me}}),
          'mf', (select status from matches where id = {{mf}}),
          'mf_reason', (select ended_reason from matches where id = {{mf}}), 'c2', {{c2}})`),

      // h. A closed date cancels (venue_closed); i. fewer than four stays; j.
      //    after the start nothing books.
      K('mg', `select pg_temp.m(jsonb_build_object('start_at', ${at(6)}))`),
      ...[1, 2, 3, 4].map((n) => X(`select pg_temp.seat({{mg}}, ${n}, 'account', {{g${n}}}, 'in')`)),
      X(`update venue_settings set closed_dates = array[(${at(6)} at time zone 'Asia/Baghdad')::date] where venue_id = {{v}}`),
      E('book_mg', null, `select to_jsonb(app.match_try_book({{mg}}))`),
      Q('mg_state', `select pg_temp.state('mg')`),
      X(`update venue_settings set closed_dates = '{}' where venue_id = {{v}}`),
      K('mi', `select pg_temp.m(jsonb_build_object('start_at', ${at(7)}))`),
      ...[1, 2, 3].map((n) => X(`select pg_temp.seat({{mi}}, ${n}, 'account', {{g${n}}}, 'in')`)),
      E('book_mi', null, `select to_jsonb(app.match_try_book({{mi}}))`),
      K('mj', `select pg_temp.m(jsonb_build_object('start_at', now() - interval '1 hour',
                                                   'fill_deadline_at', now() - interval '3 hours'))`),
      ...[1, 2, 3, 4].map((n) => X(`select pg_temp.seat({{mj}}, ${n}, 'account', {{g${n}}}, 'in')`)),
      E('book_mj', null, `select to_jsonb(app.match_try_book({{mj}}))`),
      E('book_ended', null, `select to_jsonb(app.match_try_book({{mc}}))`),
      E('book_unknown', null, `select to_jsonb(app.match_try_book('00000000-0000-4000-8000-000000000259'))`),
      E('lock_unknown', null, `select to_jsonb((app.match_lock('00000000-0000-4000-8000-000000000259')).id)`),
      Q('no_in_use_on_ended', `select to_jsonb(count(*)) from match_tickets k
          join match_seats s on s.id = k.seat_id join matches x on x.id = s.match_id
         where k.status = 'in_use' and x.venue_id = {{v}}
           and x.status in ('played', 'no_show', 'cancelled', 'bumped', 'expired')`),
    ]);
  });

  it('match_pick_court and match_court_free_firm on two courts (R22: a hold is live, not firm)', () => {
    const ids = ok<Json>(r, 'price_order').ids as Record<string, string>;
    expect(ok<Json>(r, 'free_both')).toEqual({ pick_c1: ids.c1, pick_c2: ids.c2, firm1: true, firm2: true, firm3: false });
    expect(ok<Json>(r, 'hold_c1')).toEqual({ pick: ids.c2, firm2: true });
    expect(ok<Json>(r, 'hold_c1_booked_c2')).toEqual({ pick: null, firm1: true, firm2: false });
    expect(ok<Json>(r, 'lapsed_c1')).toEqual({ pick: ids.c1, firm1: true });
    expect(ok<Json>(r, 'maintenance')).toEqual({ pick: null, firm1: false });
    expect(ok<Json>(r, 'length')).toEqual({ firm2: false, firm1_60: true, pick_c2: ids.c1 });
    expect(ok<Json>(r, 'inactive')).toEqual({ firm2: false, pick_c2: ids.c1 });
    // c1 taken: the court at the stamped price first, then the cheapest.
    expect(ok<Json>(r, 'price_order')).toMatchObject({ stamped_40000: ids.c3, stamped_48000: ids.c2, no_equal_price: ids.c4 });
  });

  it('match_expire_holds expires exactly the branch rows expire_stale_holds does, and no other branch\'s', () => {
    const ids = ok<Record<string, string>>(r, 'twin_ids');
    expect(ok(r, 'twin_match_n')).toBe(1);
    expect(ok(r, 'twin_match')).toEqual([ids.xh1]);
    expect(Number(ok(r, 'twin_chain_n'))).toBeGreaterThanOrEqual(2);
    // The same branch rows; the chain-wide form also reaches the other branch.
    expect(ok<string[]>(r, 'twin_chain').sort()).toEqual([ids.xh1, ids.xh6].sort());
  });

  it('a. four carriers: match_lock asserts the branch, then booked at the stamped price on the tapped court; requests expire', () => {
    expect(ok(r, 'lock_ma')).toBe('filling');
    expect(ok(r, 'book_ma')).toBe('booked');
    const b = ok<Json>(r, 'ma_booking');
    expect(ok(r, 'venue_guc')).toBeTruthy();
    expect(b).toMatchObject({
      court: b.c1, kind: 'booking', status: 'confirmed', guest_id: null, guest_name: 'Open match', price_iqd: 40001,
      source: 'mobile', rate_rule_id: b.rule, staff: null, period: true, guc: '',
      event: { reservation_id: b.res_id, court_id: b.c1 },
    });
    const s = ok<Json>(r, 'ma_state');
    expect(s.match).toMatchObject({ status: 'booked', reservation_id: b.res_id });
    expect(s.requests).toEqual([{ status: 'expired', ticket: 'available' }]);
    expect(s.events).toEqual([
      { type: 'booked', actor: 'system', code: null },
      { type: 'request_expired', actor: 'system', code: 'match_full' },
    ]);
    expect(ok<Json[]>(r, 'ma_req_tickets')).toContainEqual({ type: 'released', code: 'match_full' });
  });

  it('b, c. only a hold in the way: awaiting_court once; booked when the hold lapses (DF-18)', () => {
    expect(ok(r, 'book_mb')).toBe('awaiting_court');
    expect(ok(r, 'book_mb_again')).toBe('awaiting_court');
    expect((ok<Json>(r, 'mb_waiting').events as Json[]).filter((e) => e.type === 'awaiting_court')).toHaveLength(1);
    expect(ok(r, 'lock_mb')).toBe('awaiting_court');
    expect(ok(r, 'book_mb_lapsed')).toBe('booked');
    const b = ok<Json>(r, 'mb_booked');
    expect(b.hold).toBe('expired');
    expect(b.court).toBe(b.c2);
    expect((b.state as Json).match).toMatchObject({ status: 'booked' });
  });

  it('d. no firm-free court: bumped, seats cancelled, every ticket back (code bumped)', () => {
    expect(ok(r, 'book_mc')).toBe('bumped');
    const { state, tickets } = ok<{ state: Json; tickets: Json[] }>(r, 'mc_state');
    expect(state.match).toMatchObject({ status: 'bumped', ended_reason: 'bumped', reservation_id: null });
    expect((state.seats as Json[]).map((x) => [x.status, x.end_reason, x.ticket])).toEqual(
      Array(4).fill(['cancelled', 'match_ended', 'available']),
    );
    expect(tickets.filter((t) => t.type === 'released')).toEqual(Array(4).fill({ type: 'released', code: 'bumped' }));
    expect((state.events as Json[]).at(-1)).toEqual({ type: 'bumped', actor: 'system', code: 'bumped' });
  });

  it('g. a sandbox match is booked with no court (DF-19)', () => {
    expect(ok(r, 'book_ms')).toBe('booked');
    expect(ok<Json>(r, 'ms_state').match).toMatchObject({ status: 'booked', reservation_id: null });
  });

  it('e. R18: a deleted holder is dropped (ticket released, never forfeited); a banned one sends a waiting match back to filling', () => {
    expect(ok(r, 'book_md')).toBe('filling');
    const { state, tickets } = ok<{ state: Json; tickets: Json[] }>(r, 'md_state');
    expect((state.seats as Json[])[3]).toMatchObject({ status: 'left', end_reason: 'account_deleted', ticket: 'available' });
    expect(tickets).toContainEqual({ type: 'released', code: 'account_deleted' });
    expect(tickets.some((t) => t.type === 'forfeited')).toBe(false);
    expect(state.events).toEqual([{ type: 'left', actor: 'system', code: 'account_deleted' }]);

    expect(ok(r, 'book_mw')).toBe('filling');
    const w = ok<Json>(r, 'mw_state');
    expect(w.match).toMatchObject({ status: 'filling' });
    expect((w.seats as Json[])[3]).toMatchObject({ status: 'removed', end_reason: 'banned', ticket: 'available' });
  });

  it('f. R22: a waiting match is served before a newer one reaching four, which is bumped', () => {
    expect(ok(r, 'book_me')).toBe('awaiting_court');
    expect(ok(r, 'lock_mf')).toBe('filling');
    expect(ok(r, 'book_mf')).toBe('bumped');
    const w = ok<Json>(r, 'waiting_first');
    expect(w).toMatchObject({ me: 'booked', mf: 'bumped', mf_reason: 'bumped' });
    expect(w.me_court).toBe(w.c2);
  });

  it('h, i, j. a closed date cancels (venue_closed); under four stays filling; nothing books after the start', () => {
    expect(ok(r, 'book_mg')).toBe('cancelled');
    expect(ok<Json>(r, 'mg_state').match).toMatchObject({ status: 'cancelled', ended_reason: 'venue_closed' });
    expect(ok(r, 'book_mi')).toBe('filling');
    expect(ok(r, 'book_mj')).toBe('filling');
    expect(ok(r, 'book_ended')).toBe('bumped');
    expect(failed(r, 'book_unknown').code).toBe('MATCH_NOT_FOUND');
    expect(failed(r, 'lock_unknown').code).toBe('MATCH_NOT_FOUND');
    // R16: no ticket stays in use on an ended match.
    expect(ok(r, 'no_in_use_on_ended')).toBe(0);
  });
});

// ── 4. Ending, organiser, drops, marks, counts, events, picks ────────────────

describe.skipIf(!docker)('0260 match_end, organiser, drops, marks window, counts, events, ticket_pick', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m259d', [
      SETUP,
      `select pg_temp.branch();`,
      ...['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'gc'].map((g) => GUEST(g)),

      // a. filling -> cancelled by the organiser.
      K('mf1', `select pg_temp.m()`),
      X(`select pg_temp.seat({{mf1}}, 1, 'account', {{g1}}, 'in')`),
      X(`select pg_temp.seat({{mf1}}, 2, 'friend', {{g1}}, 'in')`),
      X(`select pg_temp.seat({{mf1}}, 3, 'account', {{g2}}, 'in')`),
      X(`select pg_temp.req({{mf1}}, {{g3}})`),
      E('end_mf1', 'g1', `select to_jsonb(app.match_end({{mf1}}, 'cancelled', 'organiser_cancelled', 'guest'))`),
      E('end_mf1_again', 'g1', `select to_jsonb(app.match_end({{mf1}}, 'cancelled', 'organiser_cancelled', 'guest'))`),
      Q('mf1_state', `select jsonb_build_object('state', pg_temp.state('mf1'), 'tickets', pg_temp.tevents('mf1'),
          'actor', (select e.actor_guest_id from match_events e where e.match_id = {{mf1}} and e.type = 'cancelled'),
          'g1', {{g1}})`),
      // b. pairings the contract does not allow.
      K('mf2', `select pg_temp.m()`),
      K('mb0', `select pg_temp.mb('c1', 'booked', ${at(3)})`),
      E('end_filling_played', null, `select to_jsonb(app.match_end({{mf2}}, 'played', null, 'system'))`),
      E('end_booked_staff', null, `select to_jsonb(app.match_end({{mb0}}, 'cancelled', 'staff_cancelled', 'staff'))`),
      E('end_bad_actor', null, `select to_jsonb(app.match_end({{mf2}}, 'expired', 'deadline', 'robot'))`),

      // c. booked -> the booking is cancelled: nobody loses a ticket.
      K('mb1', `select pg_temp.mb('c1', 'booked', ${at(4)})`),
      X(`select pg_temp.seat({{mb1}}, 1, 'account', {{g1}}, 'in')`),
      X(`select pg_temp.seat({{mb1}}, 2, 'account', {{g2}}, 'attended')`),
      X(`select pg_temp.seat({{mb1}}, 3, 'account', {{g3}}, 'no_show')`),
      X(`select pg_temp.seat({{mb1}}, 4, 'account', {{g4}}, 'left_late')`),
      K('mb1b', `select pg_temp.mb('c2', 'booked', ${at(4)})`),
      K('mb1b1', `select pg_temp.seat({{mb1b}}, 1, 'account', {{g5}}, 'left_late')`),
      X(`update match_tickets set status = 'forfeited', seat_id = null, forfeited_at = now(), forfeited_venue_id = {{v}},
                                  forfeited_seat_id = {{mb1b1}} where seat_id = {{mb1b1}}`),
      E('end_mb1', 'desk', `select to_jsonb(app.match_end({{mb1}}, 'cancelled', 'reservation_cancelled', 'staff'))`),
      E('end_mb1b', null, `select to_jsonb(app.match_end({{mb1b}}, 'cancelled', 'reservation_cancelled', 'system'))`),
      Q('mb1_state', `select jsonb_build_object('state', pg_temp.state('mb1'), 'tickets', pg_temp.tevents('mb1'),
          'b', pg_temp.state('mb1b'), 'b_tickets', pg_temp.tevents('mb1b'),
          'actor', (select e.actor_staff_id from match_events e where e.match_id = {{mb1}} and e.type = 'cancelled'),
          'desk', {{desk}})`),

      // d. booked -> played: carriers still in are auto-attended; a late leaver forfeits.
      K('mb2', `select pg_temp.mb('c1', 'booked', ${at(5)})`),
      X(`select pg_temp.seat({{mb2}}, 1, 'account', {{g1}}, 'in')`),
      X(`select pg_temp.seat({{mb2}}, 2, 'account', {{g2}}, 'in')`),
      X(`select pg_temp.seat({{mb2}}, 3, 'account', {{g3}}, 'left_late')`),
      X(`select pg_temp.seat({{mb2}}, 4, 'account', {{g4}}, 'attended')`),
      E('end_mb2', null, `select to_jsonb(app.match_end({{mb2}}, 'played', null, 'system'))`),
      Q('mb2_state', `select jsonb_build_object('state', pg_temp.state('mb2'), 'tickets', pg_temp.tevents('mb2'),
          'forfeit', (select jsonb_build_object('venue', k.forfeited_venue_id = {{v}}, 'seat', k.forfeited_seat_id is not null)
                        from match_tickets k join match_ticket_events e on e.ticket_id = k.id
                       where e.match_id = {{mb2}} and e.type = 'forfeited' limit 1),
          'match', (select jsonb_build_object('ended_at', ended_at is not null, 'ended_reason', ended_reason)
                      from matches where id = {{mb2}}))`),
      // e. booked -> called off short: marks stand; the late leaver forfeits.
      K('mb3', `select pg_temp.mb('c2', 'booked', ${at(5)})`),
      X(`select pg_temp.seat({{mb3}}, 1, 'account', {{g1}}, 'attended')`),
      X(`select pg_temp.seat({{mb3}}, 2, 'account', {{g2}}, 'no_show')`),
      X(`select pg_temp.seat({{mb3}}, 3, 'account', {{g3}}, 'left_late')`),
      X(`select pg_temp.seat({{mb3}}, 4, 'account', {{g4}}, 'attended')`),
      E('end_mb3', 'desk', `select to_jsonb(app.match_end({{mb3}}, 'cancelled', 'called_off_short', 'staff'))`),
      Q('mb3_state', `select jsonb_build_object('state', pg_temp.state('mb3'), 'tickets', pg_temp.tevents('mb3'))`),
      // f. booked -> all no-show.
      K('mb4', `select pg_temp.mb('c1', 'booked', ${at(6)})`),
      X(`select pg_temp.seat({{mb4}}, 1, 'account', {{g1}}, 'no_show')`),
      X(`select pg_temp.seat({{mb4}}, 2, 'account', {{g2}}, 'left_late')`),
      X(`select pg_temp.seat({{mb4}}, 3, 'desk', null, 'no_show')`),
      E('end_mb4', 'desk', `select to_jsonb(app.match_end({{mb4}}, 'no_show', 'all_no_show', 'staff'))`),
      Q('mb4_state', `select jsonb_build_object('state', pg_temp.state('mb4'), 'tickets', pg_temp.tevents('mb4'))`),
      // g. R18: a deleted late leaver's ticket is released at the end, never forfeited.
      K('mb5', `select pg_temp.mb('c2', 'booked', ${at(6)})`),
      X(`select pg_temp.seat({{mb5}}, 1, 'account', {{g6}}, 'left_late')`),
      X(`select pg_temp.seat({{mb5}}, 2, 'account', {{g2}}, 'in')`),
      X(`update profiles set deleted_at = now() where id = {{g6}}`),
      E('end_mb5', null, `select to_jsonb(app.match_end({{mb5}}, 'played', null, 'system'))`),
      Q('mb5_tickets', `select pg_temp.tevents('mb5')`),

      // Organiser (OM-34).
      K('mo1', `select pg_temp.m()`),
      K('mo1a', `select pg_temp.seat({{mo1}}, 1, 'account', {{g1}}, 'in')`),
      K('mo1b', `select pg_temp.seat({{mo1}}, 2, 'account', {{g2}}, 'in')`),
      X(`select pg_temp.seat({{mo1}}, 3, 'account', {{g3}}, 'in')`),
      X(`select pg_temp.leave({{mo1a}})`),
      E('org_mo1', null, `select to_jsonb(app.match_recompute_organiser({{mo1}}))`),
      Q('mo1_state', `select jsonb_build_object('state', pg_temp.state('mo1'),
          'event', (select jsonb_build_object('data', e.data, 'seat', e.seat_id) from match_events e
                     where e.match_id = {{mo1}} and e.type = 'organiser_changed'),
          'g1', {{g1}}, 'g2', {{g2}}, 'seat', {{mo1b}})`),
      K('mo2', `select pg_temp.m('{"join_policy":"approve"}')`),
      K('mo2a', `select pg_temp.seat({{mo2}}, 1, 'account', {{g1}}, 'in')`),
      X(`select pg_temp.seat({{mo2}}, 2, 'desk', null, 'in')`),
      X(`select pg_temp.req({{mo2}}, {{g4}})`),
      X(`select pg_temp.leave({{mo2a}})`),
      E('org_mo2', null, `select to_jsonb(app.match_recompute_organiser({{mo2}}))`),
      E('org_mo2_again', null, `select to_jsonb(app.match_recompute_organiser({{mo2}}))`),
      Q('mo2_state', `select jsonb_build_object('state', pg_temp.state('mo2'),
          'data', (select e.data from match_events e where e.match_id = {{mo2}} and e.type = 'organiser_changed'))`),
      K('mo3', `select pg_temp.m()`),
      K('mo3a', `select pg_temp.seat({{mo3}}, 1, 'account', {{g1}}, 'in')`),
      X(`select pg_temp.leave({{mo3a}})`),
      E('org_mo3', null, `select to_jsonb(app.match_recompute_organiser({{mo3}}))`),
      Q('mo3_state', `select pg_temp.state('mo3')`),
      K('mo4', `select pg_temp.m(jsonb_build_object('organised_by', 'desk', 'created_by_staff_id', {{desk}}, 'organiser_id', null))`),
      E('org_mo4', null, `select to_jsonb(app.match_recompute_organiser({{mo4}}))`),
      K('mo5', `select pg_temp.mb('c1', 'booked', ${at(7)})`),
      X(`select pg_temp.seat({{mo5}}, 1, 'account', {{g1}}, 'left_late')`),
      X(`select pg_temp.seat({{mo5}}, 2, 'account', {{g2}}, 'in')`),
      E('org_mo5', null, `select to_jsonb(app.match_recompute_organiser({{mo5}}))`),
      K('mo6', `select pg_temp.m()`),
      K('mo6a', `select pg_temp.seat({{mo6}}, 1, 'account', {{g1}}, 'in')`),
      X(`select pg_temp.seat({{mo6}}, 2, 'account', {{g5}}, 'in')`),
      X(`select pg_temp.seat({{mo6}}, 3, 'account', {{g3}}, 'in')`),
      `select pg_temp.ban('g5');`,
      X(`select pg_temp.leave({{mo6a}})`),
      E('org_mo6', null, `select to_jsonb(app.match_recompute_organiser({{mo6}}))`),
      Q('mo6_org', `select jsonb_build_object('organiser', (select organiser_id from matches where id = {{mo6}}), 'g3', {{g3}})`),

      // match_drop_ineligible, directly: a banned holder with a friend, a
      // deleted holder, a banned and a deleted requester.
      GUEST('gb'), GUEST('gd'), GUEST('gbr'), GUEST('gdr'),
      K('mdi', `select pg_temp.m()`),
      X(`select pg_temp.seat({{mdi}}, 1, 'account', {{g1}}, 'in')`),
      K('mdi2', `select pg_temp.seat({{mdi}}, 2, 'account', {{gb}}, 'in')`),
      X(`select pg_temp.seat({{mdi}}, 3, 'friend', {{gb}}, 'in')`),
      X(`select pg_temp.seat({{mdi}}, 4, 'account', {{gd}}, 'in')`),
      X(`select pg_temp.req({{mdi}}, {{gbr}})`),
      X(`select pg_temp.req({{mdi}}, {{gdr}})`),
      `select pg_temp.ban('gb');`,
      `select pg_temp.ban('gbr');`,
      X(`update profiles set deleted_at = now() where id in ({{gd}}, {{gdr}})`),
      E('drop_mdi', null, `select to_jsonb(app.match_drop_ineligible({{mdi}}))`),
      E('drop_mdi_again', null, `select to_jsonb(app.match_drop_ineligible({{mdi}}))`),
      Q('mdi_state', `select jsonb_build_object('state', pg_temp.state('mdi'), 'tickets', pg_temp.tevents('mdi'),
          'removed', (select jsonb_build_object('seat', e.seat_id, 'seats', jsonb_array_length(e.data->'seats'))
                        from match_events e where e.match_id = {{mdi}} and e.type = 'removed'),
          'mdi2', {{mdi2}})`),
      E('drop_booked', null, `select to_jsonb(app.match_drop_ineligible({{mb0}}))`),

      // The marks window (R13).
      K('mk_past', `select pg_temp.mb('c1', 'played', ${at(-3)})`),
      K('mk_past_seat', `select pg_temp.seat({{mk_past}}, 1, 'account', {{g1}}, 'no_show')`),
      K('mk_open', `select pg_temp.mb('c2', 'played', ${at(-2)})`),
      K('mk_open_seat', `select pg_temp.seat({{mk_open}}, 1, 'account', {{g2}}, 'no_show')`),
      X(`insert into day_sessions (venue_id, business_date, status, opened_by, opening_float_iqd)
         values ({{v}}, app.venue_business_date({{v}}, ${at(-2)}), 'open', {{manager}}, 0)`),
      K('mk_closed', `select pg_temp.mb('c1', 'booked', ${at(9)})`),
      X(`insert into day_sessions (venue_id, business_date, status, opened_by, opening_float_iqd)
         values ({{v}}, app.venue_business_date({{v}}, ${at(9)}), 'closed', {{manager}}, 0)`),
      K('mk_sandbox', `select pg_temp.m(jsonb_build_object('status', 'booked', 'sandbox', true))`),
      Q('marks_all', `select jsonb_build_object(
          'booked_future', app.match_marks_open({{mb0}}), 'filling', app.match_marks_open({{mf2}}),
          'sandbox', app.match_marks_open({{mk_sandbox}}), 'past_no_session', app.match_marks_open({{mk_past}}),
          'past_open_session', app.match_marks_open({{mk_open}}), 'day_closed', app.match_marks_open({{mk_closed}}),
          'unknown', app.match_marks_open('00000000-0000-4000-8000-000000000259'))`),
      // Separate statements: a later expression of one statement would not see
      // what an earlier call in it wrote.
      E('restore_past', null, `select to_jsonb(app.ticket_restore((select ticket_id from match_seats where id = {{mk_past_seat}}), {{mk_past_seat}}))`),
      E('restore_open', null, `select to_jsonb(app.ticket_restore((select ticket_id from match_seats where id = {{mk_open_seat}}), {{mk_open_seat}}))`),
      E('restore_open_again', null, `select to_jsonb(app.ticket_restore((select ticket_id from match_seats where id = {{mk_open_seat}}), {{mk_open_seat}}))`),
      Q('restore_statuses', `select jsonb_build_object(
          'past', (select k.status from match_seats s join match_tickets k on k.id = s.ticket_id where s.id = {{mk_past_seat}}),
          'open', (select k.status from match_seats s join match_tickets k on k.id = s.ticket_id where s.id = {{mk_open_seat}}))`),

      // OM-41 counts for one guest.
      K('p1', `select pg_temp.mb('c1', 'played', ${at(-10)})`),
      X(`select pg_temp.seat({{p1}}, 1, 'account', {{gc}}, 'attended')`),
      K('p2', `select pg_temp.mb('c1', 'played', ${at(-11)})`),
      X(`select pg_temp.seat({{p2}}, 1, 'desk', {{gc}}, 'attended')`),
      K('p3', `select pg_temp.mb('c1', 'played', ${at(-12)})`),
      X(`select pg_temp.seat({{p3}}, 1, 'friend', {{gc}}, 'attended')`),
      K('p4', `select pg_temp.m(jsonb_build_object('status', 'played', 'sandbox', true, 'ended_at', now()))`),
      X(`select pg_temp.seat({{p4}}, 1, 'account', {{gc}}, 'attended')`),
      K('p5', `select pg_temp.m(jsonb_build_object('status', 'cancelled', 'ended_at', now(), 'ended_reason', 'organiser_cancelled'))`),
      X(`select pg_temp.seat({{p5}}, 1, 'account', {{gc}}, 'attended')`),
      K('n1', `select pg_temp.mb('c2', 'played', ${at(-10)})`),
      X(`select pg_temp.seat({{n1}}, 1, 'account', {{gc}}, 'no_show')`),
      K('n2', `select pg_temp.mb('c2', 'played', ${at(-11)})`),
      X(`select pg_temp.seat({{n2}}, 1, 'friend', {{gc}}, 'no_show')`),
      K('n3', `select pg_temp.m(jsonb_build_object('status', 'played', 'sandbox', true, 'ended_at', now()))`),
      X(`select pg_temp.seat({{n3}}, 1, 'account', {{gc}}, 'no_show')`),
      X(`select pg_temp.res('c2', ${at(-20)}, 60, 'booking', 'arrived', 'gc')`),
      X(`select pg_temp.res('c2', ${at(-21)}, 60, 'booking', 'completed', 'gc')`),
      X(`select pg_temp.res('c2', ${at(20)}, 60, 'booking', 'confirmed', 'gc')`),
      X(`select pg_temp.res('c2', ${at(-22)}, 60, 'booking', 'no_show', 'gc')`),
      Q('counts', `select jsonb_build_object('games', app.guest_games_played({{gc}}), 'no_shows', app.guest_match_no_shows({{gc}}),
                                             'stranger', app.guest_games_played({{g6}}))`),

      // match_event: actor ids from auth.uid(), degraded to system without one.
      E('ev_staff_none', null, `select to_jsonb(app.match_event({{mf2}}, null, 'message', 'staff', null, null, 'on_my_way'))`),
      E('ev_staff', 'desk', `select to_jsonb(app.match_event({{mf2}}, null, 'message', 'staff'))`),
      E('ev_guest', 'g2', `select to_jsonb(app.match_event({{mf2}}, {{v}}, 'message', 'guest', null, null, 'bring_balls'))`),
      E('ev_guest_none', null, `select to_jsonb(app.match_event({{mf2}}, null, 'message', 'guest'))`),
      E('ev_bad_actor', null, `select to_jsonb(app.match_event({{mf2}}, null, 'message', 'robot'))`),
      Q('events', `select jsonb_agg(jsonb_build_object('actor', e.actor, 'guest', e.actor_guest_id, 'staff', e.actor_staff_id,
                                                       'venue', e.venue_id = {{v}}, 'code', e.code) order by e.id)
                     from match_events e where e.match_id = {{mf2}}`),
      Q('event_ids', `select jsonb_build_object('g2', {{g2}}, 'desk', {{desk}})`),

      // ticket_pick: FIFO, sandbox apart, NEED_TICKETS with its detail.
      GUEST('gp'),
      K('t1', `select pg_temp.ticket({{gp}})`),
      K('t2', `select pg_temp.ticket({{gp}})`),
      K('t3', `select pg_temp.ticket({{gp}})`),
      X(`update match_tickets set created_at = now() - interval '1 day' where id = {{t3}}`),
      K('ts', `select pg_temp.ticket({{gp}}, true)`),
      Q('pick', `select jsonb_build_object('two', to_jsonb(app.ticket_pick({{gp}}, 2, false)),
          'sandbox', to_jsonb(app.ticket_pick({{gp}}, 1, true)),
          'ids', jsonb_build_object('t1', {{t1}}, 't2', {{t2}}, 't3', {{t3}}, 'ts', {{ts}}))`),
      E('pick_short', null, `select to_jsonb(app.ticket_pick({{gp}}, 5, false))`),
      E('pick_short_sandbox', null, `select to_jsonb(app.ticket_pick({{gp}}, 2, true))`),
      E('pick_bad', null, `select to_jsonb(app.ticket_pick({{gp}}, 0, false))`),
      E('pick_nobody', null, `select to_jsonb(app.ticket_pick(null, 1, false))`),

      // R16 over everything this scenario ended.
      Q('r16', `select jsonb_build_object(
          'in_use', (select count(*) from match_tickets k join match_seats s on s.id = k.seat_id
                       join matches x on x.id = s.match_id
                      where k.status = 'in_use' and x.status in ('played', 'no_show', 'cancelled', 'bumped', 'expired')),
          'reserved', (select count(*) from match_tickets k join match_requests q on q.id = k.request_id
                         join matches x on x.id = q.match_id
                        where k.status = 'reserved' and x.status in ('played', 'no_show', 'cancelled', 'bumped', 'expired')))`),
    ]);
  });

  it('a. filling -> cancelled: seats cancelled, tickets and the request\'s ticket back, the organiser is the actor', () => {
    expect(ok(r, 'end_mf1')).toBe(true);
    expect(ok(r, 'end_mf1_again')).toBe(false);
    const { state, tickets, actor, g1 } = ok<{ state: Json; tickets: Json[]; actor: string; g1: string }>(r, 'mf1_state');
    expect(state.match).toMatchObject({ status: 'cancelled', ended_reason: 'organiser_cancelled' });
    expect((state.seats as Json[]).map((s) => [s.status, s.ticket])).toEqual(Array(3).fill(['cancelled', 'available']));
    expect(state.requests).toEqual([{ status: 'expired', ticket: 'available' }]);
    expect(state.events).toEqual([
      { type: 'request_expired', actor: 'system', code: 'organiser_cancelled' },
      { type: 'cancelled', actor: 'guest', code: 'organiser_cancelled' },
    ]);
    expect(actor).toBe(g1);
    expect(tickets.filter((t) => t.type === 'released')).toEqual(Array(4).fill({ type: 'released', code: 'organiser_cancelled' }));
  });

  it('b. a pairing outside the contract is INVALID_TRANSITION; a bad actor INVALID_ARGUMENT', () => {
    expect(failed(r, 'end_filling_played').code).toBe('INVALID_TRANSITION');
    expect(failed(r, 'end_booked_staff').code).toBe('INVALID_TRANSITION');
    expect(failed(r, 'end_bad_actor')).toEqual({ code: 'INVALID_ARGUMENT', detail: 'p_actor' });
  });

  it('c. the booking cancelled: every seat cancelled, forfeits restored inside the marks window', () => {
    expect(ok(r, 'end_mb1')).toBe(true);
    expect(ok(r, 'end_mb1b')).toBe(true);
    const s = ok<{ state: Json; tickets: Json[]; b: Json; b_tickets: Json[]; actor: string; desk: string }>(r, 'mb1_state');
    expect(s.state.match).toMatchObject({ status: 'cancelled', ended_reason: 'reservation_cancelled' });
    expect((s.state.seats as Json[]).map((x) => [x.status, x.ticket])).toEqual([
      ['cancelled', 'available'], ['cancelled', 'available'], ['cancelled', 'available'], ['cancelled', 'available'],
    ]);
    expect(s.tickets.slice(-3)).toEqual([
      { type: 'released', code: 'reservation_cancelled' },
      { type: 'restored', code: null },
      { type: 'released', code: 'reservation_cancelled' },
    ]);
    expect(s.actor).toBe(s.desk);
    expect((s.b.seats as Json[])[0]).toMatchObject({ status: 'cancelled', ticket: 'available' });
    expect(s.b_tickets.at(-1)).toEqual({ type: 'restored', code: null });
  });

  it('d. played (R37): in carriers auto-attended, their tickets released; an unrefilled late leaver forfeits', () => {
    expect(ok(r, 'end_mb2')).toBe(true);
    const s = ok<{ state: Json; tickets: Json[]; forfeit: Json; match: Json }>(r, 'mb2_state');
    expect((s.state.seats as Json[]).map((x) => [x.status, x.ticket, x.marked])).toEqual([
      ['attended', 'available', true], ['attended', 'available', true], ['left_late', 'forfeited', false], ['attended', 'available', true],
    ]);
    expect(s.state.events).toEqual([
      { type: 'seat_attended', actor: 'system', code: 'auto' },
      { type: 'seat_attended', actor: 'system', code: 'auto' },
      { type: 'played', actor: 'system', code: null },
    ]);
    expect(s.tickets.slice(-3)).toEqual([
      { type: 'released', code: 'auto' }, { type: 'released', code: 'auto' }, { type: 'forfeited', code: 'late_leave' },
    ]);
    expect(s.forfeit).toEqual({ venue: true, seat: true });
    expect(s.match).toEqual({ ended_at: true, ended_reason: null });
  });

  it('e, f. called off short and all no-show: marks stand, late leavers forfeit, the call-off has its own event', () => {
    const s3 = ok<{ state: Json; tickets: Json[] }>(r, 'mb3_state');
    expect(ok(r, 'end_mb3')).toBe(true);
    expect(s3.state.match).toMatchObject({ status: 'cancelled', ended_reason: 'called_off_short' });
    expect((s3.state.seats as Json[]).map((x) => [x.status, x.ticket])).toEqual([
      ['attended', 'available'], ['no_show', 'forfeited'], ['left_late', 'forfeited'], ['attended', 'available'],
    ]);
    expect((s3.state.events as Json[]).at(-1)).toEqual({ type: 'called_off_short', actor: 'staff', code: 'called_off_short' });
    expect(s3.tickets.at(-1)).toEqual({ type: 'forfeited', code: 'late_leave' });

    expect(ok(r, 'end_mb4')).toBe(true);
    const s4 = ok<{ state: Json; tickets: Json[] }>(r, 'mb4_state');
    expect(s4.state.match).toMatchObject({ status: 'no_show', ended_reason: 'all_no_show' });
    expect((s4.state.seats as Json[]).map((x) => x.status)).toEqual(['no_show', 'left_late', 'no_show']);
    expect((s4.state.events as Json[]).at(-1)).toEqual({ type: 'no_show', actor: 'staff', code: 'all_no_show' });
  });

  it('g. R18: a deleted late leaver\'s ticket is released at the end, never forfeited', () => {
    expect(ok(r, 'end_mb5')).toBe(true);
    const t = ok<Json[]>(r, 'mb5_tickets');
    expect(t).toContainEqual({ type: 'released', code: 'account_deleted' });
    expect(t.some((x) => x.type === 'forfeited')).toBe(false);
  });

  it('match_recompute_organiser: handover, only walk-ins, empty, desk, still carrying, a banned candidate skipped', () => {
    expect(ok(r, 'org_mo1')).toBe(true);
    const o1 = ok<{ state: Json; event: Json; g1: string; g2: string; seat: string }>(r, 'mo1_state');
    expect(o1.state.match).toMatchObject({ status: 'filling', organiser_id: o1.g2 });
    expect(o1.event).toEqual({ data: { from_guest_id: o1.g1, to_guest_id: o1.g2 }, seat: o1.seat });

    expect(ok(r, 'org_mo2')).toBe(true);
    expect(ok(r, 'org_mo2_again')).toBe(false);
    const o2 = ok<{ state: Json; data: Json }>(r, 'mo2_state');
    expect(o2.state.match).toMatchObject({ organiser_id: null, join_policy: 'open' });
    expect(o2.state.requests).toEqual([{ status: 'expired', ticket: 'available' }]);
    expect(o2.data).toMatchObject({ to_guest_id: null });
    expect(o2.state.events).toEqual([
      { type: 'request_expired', actor: 'system', code: 'organiser_gone' },
      { type: 'organiser_changed', actor: 'system', code: null },
    ]);

    expect(ok(r, 'org_mo3')).toBe(true);
    expect(ok<Json>(r, 'mo3_state').match).toMatchObject({ status: 'cancelled', ended_reason: 'empty' });
    expect(ok(r, 'org_mo4')).toBe(false);
    expect(ok(r, 'org_mo5')).toBe(false);
    expect(ok(r, 'org_mo6')).toBe(true);
    const o6 = ok<Json>(r, 'mo6_org');
    expect(o6.organiser).toBe(o6.g3);
  });

  it('match_drop_ineligible: banned seats removed, deleted seats left, their requests closed, tickets back (R18)', () => {
    expect(ok(r, 'drop_mdi')).toBe(3);
    expect(ok(r, 'drop_mdi_again')).toBe(0);
    const d = ok<{ state: Json; tickets: Json[]; removed: Json; mdi2: string }>(r, 'mdi_state');
    expect((d.state.seats as Json[]).map((x) => [x.status, x.end_reason, x.ticket])).toEqual([
      ['in', null, 'in_use'],
      ['removed', 'banned', 'available'],
      ['removed', 'banned', 'available'],
      ['left', 'account_deleted', 'available'],
    ]);
    expect((d.state.requests as Json[]).map((q) => `${q.status}:${q.ticket}`).sort()).toEqual([
      'expired:available', 'withdrawn:available',
    ]);
    expect(d.removed).toEqual({ seat: d.mdi2, seats: 2 });
    // Holders go first, then requests (each group in id order).
    const ev = (d.state.events as Json[]).map((e) => `${e.type}:${e.code}`);
    expect(ev.slice(0, 2).sort()).toEqual(['left:account_deleted', 'removed:banned']);
    expect(ev.slice(2).sort()).toEqual(['request_expired:banned', 'withdrawn:account_deleted']);
    expect(d.tickets.filter((t) => t.type === 'released').map((t) => t.code).sort()).toEqual(
      ['account_deleted', 'account_deleted', 'banned', 'banned', 'banned'],
    );
    expect((d.state.match as Json).organiser_id).toBeTruthy();
    expect(ok(r, 'drop_booked')).toBe(0);
  });

  it('match_marks_open: booked and not sandbox, the day of the start not closed; a past day only with an open session', () => {
    expect(ok<Json>(r, 'marks_all')).toEqual({
      booked_future: true,
      filling: false,
      sandbox: false,
      past_no_session: false,
      past_open_session: true,
      day_closed: false,
      unknown: false,
    });
    // ticket_restore follows the same window (R13).
    expect([ok(r, 'restore_past'), ok(r, 'restore_open'), ok(r, 'restore_open_again')]).toEqual([false, true, false]);
    expect(ok(r, 'restore_statuses')).toEqual({ past: 'forfeited', open: 'available' });
  });

  it('OM-41: games played and no-shows, friend seats on the holder, sandbox never, bookings too', () => {
    expect(ok<Json>(r, 'counts')).toEqual({ games: 4, no_shows: 3, stranger: 0 });
  });

  it('match_event: guest and staff ids from the session; staff or guest without one is system', () => {
    const ids = ok<Record<string, string>>(r, 'event_ids');
    for (const l of ['ev_staff_none', 'ev_staff', 'ev_guest', 'ev_guest_none']) expect(typeof ok(r, l), l).toBe('number');
    expect(failed(r, 'ev_bad_actor')).toEqual({ code: 'INVALID_ARGUMENT', detail: 'p_actor' });
    expect(ok<Json[]>(r, 'events')).toEqual([
      { actor: 'system', guest: null, staff: null, venue: true, code: 'on_my_way' },
      { actor: 'staff', guest: null, staff: ids.desk, venue: true, code: null },
      { actor: 'guest', guest: ids.g2, staff: null, venue: true, code: 'bring_balls' },
      { actor: 'system', guest: null, staff: null, venue: true, code: null },
    ]);
  });

  it('ticket_pick: the oldest first, sandbox apart (DF-19), NEED_TICKETS with {needed, available, buy}', () => {
    const p = ok<{ two: string[]; sandbox: string[]; ids: Record<string, string> }>(r, 'pick');
    const byAge = [p.ids.t3, ...[p.ids.t1, p.ids.t2]];
    expect(p.two).toHaveLength(2);
    expect(p.two[0]).toBe(p.ids.t3); // the oldest
    expect(byAge).toContain(p.two[1]);
    expect(p.sandbox).toEqual([p.ids.ts]);
    expect(failed(r, 'pick_short')).toEqual({ code: 'NEED_TICKETS', detail: '{"needed":5,"available":3,"buy":2}' });
    expect(JSON.parse(failed(r, 'pick_short_sandbox').detail!)).toEqual({ needed: 2, available: 1, buy: 1 });
    expect(failed(r, 'pick_bad')).toEqual({ code: 'INVALID_ARGUMENT', detail: 'p_count' });
    expect(failed(r, 'pick_nobody')).toEqual({ code: 'INVALID_ARGUMENT', detail: 'p_guest_id' });
  });

  it('R16: no ticket in use or reserved on an ended match', () => {
    expect(ok(r, 'r16')).toEqual({ in_use: 0, reserved: 0 });
  });
});

// ── 5. The mutex and the money lock across two sessions ──────────────────────

describe.skipIf(!docker)('0260 advisory locks across sessions', () => {
  it('a held mutex makes try_lock_match_venue false, never waiting; the money lock is its own key', async () => {
    const venue = crypto.randomUUID();
    const match = crypto.randomUUID();
    const holder = psqlSession(`set application_name = 'm260-mutex-holder';
begin;
select app.lock_match_venue('${venue}');
select app.lock_match_money('${match}');
select pg_sleep(8);
rollback;`);
    await waitForSleeper('m260-mutex-holder');
    const started = Date.now();
    const probe = psql(`begin;
select app.try_lock_match_venue('${venue}');
select app.try_lock_match_venue('${crypto.randomUUID()}', true);
select pg_try_advisory_xact_lock(hashtextextended('app.matches:money:${match}', 0));
select pg_try_advisory_xact_lock(hashtextextended('app.matches:venue:${match}', 0));
rollback;`);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(probe.split('\n')).toEqual(['f', 't', 'f', 't']);
    await holder;
    expect(psql(`begin; select app.try_lock_match_venue('${venue}', true); rollback;`)).toBe('t');
  });

  it('all or nothing: a busy court makes it false with nothing held, not the mutex and the courts before it', async () => {
    const venue = crypto.randomUUID();
    // Two courts; the later one in id order is the busy one, so the mutex and
    // the first court are taken before the attempt fails.
    const [first, busy] = [crypto.randomUUID(), crypto.randomUUID()].sort();
    const holder = psqlSession(`set application_name = 'm260-court-holder';
begin;
select pg_advisory_xact_lock(hashtextextended('app.reservations:court:${busy}', 0));
select pg_sleep(8);
rollback;`);
    await waitForSleeper('m260-court-holder');
    const probe = psql(`begin;
select set_config('request.jwt.claims', '', true);
insert into venues (id, slug, name_en, name_ar, timezone, is_active)
values ('${venue}', 'm260-try-${venue.slice(0, 8)}', 'M260 try', 'فرع', 'Asia/Baghdad', true);
insert into courts (id, venue_id, name_en, name_ar, duration_options, sort_order, is_active)
values ('${first}', '${venue}', 'M260 try 1', 'ملعب ١', '{90}', 1, true),
       ('${busy}', '${venue}', 'M260 try 2', 'ملعب ٢', '{90}', 2, true);
select count(*) from pg_locks where locktype = 'advisory' and pid = pg_backend_pid();
select app.try_lock_match_venue('${venue}', true);
select count(*) from pg_locks where locktype = 'advisory' and pid = pg_backend_pid();
select pg_try_advisory_xact_lock(hashtextextended('app.reservations:court:${first}', 0));
rollback;`);
    // set_config's empty line, then: no advisory lock before, false, still none
    // after (the mutex and the first court were let go), the first court free.
    expect(probe.split('\n').slice(-4)).toEqual(['0', 'f', '0', 't']);
    await holder;
  });
});
