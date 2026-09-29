/**
 * 0258 match_tables (docs/design/open-matches/db.md §4.4, money.md §4): the
 * open-match tables and their CHECKs, the R4 seat indexes, the ticket ledger's
 * CHECKs (R8), the guards and append-only triggers, and Money's part of the
 * file: the booking_payments anchor (R7) and its companions, and the nine 0242
 * deposit hooks scoped to purpose 'deposit' (the R15 hoist, R23).
 *
 * Nothing writes these tables before 0260, so every case here is one psql
 * transaction that is rolled back (the stores-harness scenario): rows are
 * planted as postgres, staff calls run as `authenticated` with the caller's
 * claims, and nothing is left behind. In particular no ticket purchase is
 * committed: a stray one would break the ticket ledger's invariants (money.md
 * §9, T1/T7) that 0259's suites assert.
 */
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { dockerReachable, KEEP, Q, T, scenario, ok, refused, type Results } from './stores-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

/** The planting helpers of this file: e() captures a refusal as postgres. */
const SETUP = String.raw`
create function pg_temp.e(p_label text, p_sql text) returns void language plpgsql as $f$
declare v_res jsonb; v_msg text; v_con text; v_detail text;
begin
  perform set_config('request.jwt.claims', '', true);  -- a fixture write, not a staff write
  begin
    if p_sql ~* '^\s*(select|with)\M' then
      execute pg_temp.sub(p_sql) into v_res;
    else
      execute pg_temp.sub(p_sql);
    end if;
    insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v_res));
  exception when others then
    get stacked diagnostics v_msg = message_text, v_con = constraint_name, v_detail = pg_exception_detail;
    insert into pg_temp.out(label, res)
    values (p_label, jsonb_build_object('ok', false, 'code', v_msg, 'constraint', nullif(v_con, ''),
                                        'detail', nullif(v_detail, '')));
  end;
end $f$;

create function pg_temp.var(p_name text) returns text language sql as $f$
  select val from pg_temp.vars where name = p_name
$f$;

create function pg_temp.m(p jsonb default '{}') returns uuid language plpgsql as $f$
declare
  v_start timestamptz := date_trunc('hour', now()) + interval '3 days';
  r matches;
  v uuid;
begin
  r := jsonb_populate_record(null::matches, jsonb_build_object(
         'venue_id', pg_temp.var('venue'), 'status', 'filling',
         'start_at', v_start, 'end_at', v_start + interval '90 minutes', 'duration_min', 90,
         'visibility', 'public', 'join_policy', 'open', 'category', 'open',
         'price_iqd', 40001, 'shares_iqd', jsonb_build_array(10001, 10000, 10000, 10000),
         'price_court_id', pg_temp.var('court'), 'fill_deadline_at', v_start - interval '2 hours',
         'share_token', substr(md5(random()::text), 1, 22), 'organiser_id', pg_temp.var('g1'),
         'organised_by', 'guest', 'sandbox', false) || p);
  insert into matches (venue_id, status, start_at, end_at, duration_min, visibility, join_policy, category,
                       price_iqd, shares_iqd, price_court_id, fill_deadline_at, share_token, organiser_id,
                       organised_by, created_by_staff_id, reservation_id, sandbox, ended_at, ended_reason,
                       idempotency_key)
  values (r.venue_id, r.status, r.start_at, r.end_at, r.duration_min, r.visibility, r.join_policy, r.category,
          r.price_iqd, r.shares_iqd, r.price_court_id, r.fill_deadline_at, r.share_token, r.organiser_id,
          r.organised_by, r.created_by_staff_id, r.reservation_id, r.sandbox, r.ended_at, r.ended_reason,
          r.idempotency_key)
  returning id into v;
  return v;
end $f$;

create function pg_temp.s(p jsonb default '{}') returns uuid language plpgsql as $f$
declare r match_seats; v uuid;
begin
  r := jsonb_populate_record(null::match_seats, jsonb_build_object(
         'venue_id', pg_temp.var('venue'), 'match_id', pg_temp.var('m'), 'seat_no', 1, 'kind', 'desk',
         'status', 'in', 'share_iqd', 10000, 'created_by_staff_id', pg_temp.var('desk')) || p);
  insert into match_seats (venue_id, match_id, seat_no, kind, guest_id, guest_name, guest_phone, gender, status,
                           ticket_id, share_iqd, request_id, replaces_seat_id, created_by_staff_id, ended_at,
                           end_reason, marked_by_staff_id, marked_at, written_off_by_staff_id, written_off_at,
                           write_off_reason)
  values (r.venue_id, r.match_id, r.seat_no, r.kind, r.guest_id, r.guest_name, r.guest_phone, r.gender, r.status,
          r.ticket_id, r.share_iqd, r.request_id, r.replaces_seat_id, r.created_by_staff_id, r.ended_at,
          r.end_reason, r.marked_by_staff_id, r.marked_at, r.written_off_by_staff_id, r.written_off_at,
          r.write_off_reason)
  returning id into v;
  return v;
end $f$;

-- A ticket purchase (Money writes these from 0259): venue_id named NULL.
create function pg_temp.p(p jsonb default '{}') returns uuid language plpgsql as $f$
declare r booking_payments; v uuid;
begin
  r := jsonb_populate_record(null::booking_payments, jsonb_build_object(
         'purpose', 'ticket', 'provider', 'fake', 'sandbox', false, 'request_id', gen_random_uuid(),
         'amount_iqd', 20000, 'quoted_price_iqd', 10000, 'ticket_count', 2, 'status', 'succeeded',
         'succeeded_at', now(), 'deadline_at', now() + interval '15 minutes', 'guest_id', pg_temp.var('g1')) || p);
  insert into booking_payments (venue_id, reservation_id, hold_id, guest_id, purpose, provider, sandbox, request_id,
                                amount_iqd, quoted_price_iqd, ticket_count, status, succeeded_at, deadline_at,
                                refund_reason, refund_amount_iqd, refund_requested_at)
  values (r.venue_id, r.reservation_id, r.hold_id, r.guest_id, r.purpose, r.provider, r.sandbox, r.request_id,
          r.amount_iqd, r.quoted_price_iqd, r.ticket_count, r.status, r.succeeded_at, r.deadline_at,
          r.refund_reason, r.refund_amount_iqd, r.refund_requested_at)
  returning id into v;
  return v;
end $f$;

create function pg_temp.tk(p jsonb default '{}') returns uuid language plpgsql as $f$
declare r match_tickets; v uuid;
begin
  r := jsonb_populate_record(null::match_tickets, jsonb_build_object(
         'guest_id', pg_temp.var('g1'), 'status', 'available', 'price_iqd', 10000,
         'purchase_payment_id', pg_temp.var('pay'), 'sandbox', false) || p);
  insert into match_tickets (guest_id, status, price_iqd, purchase_payment_id, sandbox, request_id, seat_id,
                             forfeited_venue_id, forfeited_seat_id, forfeited_at, cashed_out_at, cashout_payment_id)
  values (r.guest_id, r.status, r.price_iqd, r.purchase_payment_id, r.sandbox, r.request_id, r.seat_id,
          r.forfeited_venue_id, r.forfeited_seat_id, r.forfeited_at, r.cashed_out_at, r.cashout_payment_id)
  returning id into v;
  return v;
end $f$;
`;

/** Plant as postgres and capture the outcome (e() above). The SQL must return jsonb or nothing. */
const E = (label: string, sql: string) => `select pg_temp.e('${label}', $q$${sql}$q$);`;

const GUEST = (name: string) =>
  KEEP(name, `insert into auth.users (id, email, raw_user_meta_data, aud, role)
              values (gen_random_uuid(), 'm257-${name}-' || gen_random_uuid() || '@test.touch.local',
                      '{"full_name":"Test ${name}"}', 'authenticated', 'authenticated') returning id`);

const COURT = KEEP('court', `insert into courts (name_en, name_ar, venue_id)
                             values ('M257 court', 'ملعب ٢٥٧', {{venue}}) returning id`);

/**
 * Plant a match / seat / purchase / ticket and keep its id. `patch` is a SQL
 * jsonb expression over the defaults: a literal ('{"seat_no":2}') or a
 * jsonb_build_object(...) when it names a kept id ({{g1}}).
 */
const M = (name: string, patch = `'{}'`) => KEEP(name, `select pg_temp.m(${patch})`);
const S = (name: string, patch = `'{}'`) => KEEP(name, `select pg_temp.s(${patch})`);
const P = (name: string, patch = `'{}'`) => KEEP(name, `select pg_temp.p(${patch})`);
const TK = (name: string, patch = `'{}'`) => KEEP(name, `select pg_temp.tk(${patch})`);

/** The constraint (or, when none is named, the message) a refused plant tripped. */
function tripped(r: Results, label: string): string {
  const o = r[label] as { ok: boolean; code?: string; constraint?: string | null } | undefined;
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label} was expected to fail`).toBe(false);
  return o!.constraint ?? o!.code!;
}

const BRANCH_TABLES = [
  'matches', 'match_requests', 'match_seats', 'match_events', 'match_reports', 'match_exclusions',
  'payment_match_seats',
];
const CHAIN_TABLES = ['match_tickets', 'match_ticket_events', 'match_blocks'];

describe.skipIf(!docker)('0258 open-match tables', () => {
  it('ten tables: RLS on, no policy, no client grant; the guard on the branch tables only', () => {
    const r = scenario('m257a', [
      SETUP,
      Q('tables', `select jsonb_object_agg(c.relname, jsonb_build_object(
                     'rls', c.relrowsecurity,
                     'policies', (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname),
                     'client', has_table_privilege('anon', c.oid, 'select,insert,update,delete')
                               or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete'),
                     'service', has_table_privilege('service_role', c.oid, 'select,insert,update,delete'),
                     'guard', exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'zz_branch_guard'),
                     'venue_id', (select case when a.attnotnull then 'not null' else 'nullable' end
                                    from pg_attribute a
                                   where a.attrelid = c.oid and a.attname = 'venue_id' and not a.attisdropped)))
                     from pg_class c
                    where c.relnamespace = 'public'::regnamespace
                      and c.relname in (${[...BRANCH_TABLES, ...CHAIN_TABLES].map((t) => `'${t}'`).join(', ')})`),
    ]);
    const tables = ok<Record<string, Record<string, unknown>>>(r, 'tables');
    expect(Object.keys(tables).sort()).toEqual([...BRANCH_TABLES, ...CHAIN_TABLES].sort());
    for (const [name, t] of Object.entries(tables)) {
      expect(t, name).toMatchObject({ rls: true, policies: 0, client: false, service: true });
      const branch = BRANCH_TABLES.includes(name);
      expect(t.guard, `${name} zz_branch_guard`).toBe(branch);
      // A branch row always names its branch; a ticket event may name the
      // branch it moved at (a forfeit); the other chain tables have none.
      expect(t.venue_id, `${name} venue_id`).toBe(
        branch ? 'not null' : name === 'match_ticket_events' ? 'nullable' : null,
      );
    }
  });

  it('the constraints on existing tables are validated; the seat→ticket FK too; sandbox has no default', () => {
    const r = scenario('m257b', [
      SETUP,
      Q('cons', `select jsonb_object_agg(conname, jsonb_build_object('valid', convalidated, 'rel', conrelid::regclass::text))
                   from pg_constraint
                  where conname in ('booking_payments_anchor', 'booking_payments_ticket_amount',
                                    'booking_payments_reason_by_purpose', 'tabs_court_cap_positive',
                                    'match_seats_ticket_fk')`),
      Q('cols', `select jsonb_object_agg(table_name || '.' || column_name,
                                         jsonb_build_object('nullable', is_nullable, 'default', column_default, 'type', data_type))
                   from information_schema.columns
                  where table_schema = 'public'
                    and ((table_name = 'booking_payments' and column_name in ('hold_id', 'reservation_id', 'venue_id', 'ticket_count'))
                      or (table_name = 'match_tickets' and column_name = 'sandbox')
                      or (table_name = 'tabs' and column_name = 'court_cap_iqd'))`),
      Q('one_active_ticket', `select to_jsonb(pg_get_indexdef('public.booking_payments_one_active_ticket'::regclass))`),
    ]);
    const cons = ok<Record<string, { valid: boolean; rel: string }>>(r, 'cons');
    expect(cons).toEqual({
      booking_payments_anchor: { valid: true, rel: 'booking_payments' },
      booking_payments_ticket_amount: { valid: true, rel: 'booking_payments' },
      booking_payments_reason_by_purpose: { valid: true, rel: 'booking_payments' },
      tabs_court_cap_positive: { valid: true, rel: 'tabs' },
      match_seats_ticket_fk: { valid: true, rel: 'match_seats' },
    });
    const cols = ok<Record<string, { nullable: string; default: string | null; type: string }>>(r, 'cols');
    expect(cols['booking_payments.hold_id']!.nullable).toBe('YES');
    expect(cols['booking_payments.reservation_id']!.nullable).toBe('YES');
    // R7: nullable for a ticket purchase, and the default stays for deposits.
    expect(cols['booking_payments.venue_id']).toMatchObject({ nullable: 'YES', default: 'app.current_venue()' });
    expect(cols['booking_payments.ticket_count']).toMatchObject({ nullable: 'YES', type: 'smallint' });
    expect(cols['match_tickets.sandbox']).toMatchObject({ nullable: 'NO', default: null });
    expect(cols['tabs.court_cap_iqd']).toMatchObject({ nullable: 'YES', default: null });
    expect(ok<string>(r, 'one_active_ticket')).toMatch(
      /UNIQUE INDEX booking_payments_one_active_ticket ON public\.booking_payments USING btree \(guest_id\) WHERE \(\(purpose = 'ticket'::text\) AND \(status = ANY \(ARRAY\['created'::text, 'pending'::text\]\)\)\)/,
    );
  });

  it('matches: shares, token, time, deadline, organiser, reservation and ending rules', () => {
    const r = scenario('m257c', [
      SETUP,
      GUEST('g1'),
      COURT,
      E('valid', `select to_jsonb(pg_temp.m())`),
      E('sandbox_booked', `select to_jsonb(pg_temp.m('{"status":"booked","sandbox":true}'))`),
      E('desk_run', `select to_jsonb(pg_temp.m(jsonb_build_object('organised_by', 'desk', 'organiser_id', null, 'created_by_staff_id', {{desk}})))`),
      E('shares_sum', `select to_jsonb(pg_temp.m('{"shares_iqd":[10001,10000,10000,10001]}'))`),
      E('shares_order', `select to_jsonb(pg_temp.m('{"shares_iqd":[10000,10001,10000,10000]}'))`),
      E('shares_spread', `select to_jsonb(pg_temp.m('{"price_iqd":40000,"shares_iqd":[10002,10000,10000,9998]}'))`),
      E('token', `select to_jsonb(pg_temp.m('{"share_token":"short"}'))`),
      E('time', `select to_jsonb(pg_temp.m('{"duration_min":60}'))`),
      E('deadline', `select to_jsonb(pg_temp.m(jsonb_build_object('fill_deadline_at', date_trunc('hour', now()) + interval '3 days 1 hour')))`),
      E('approve_without_organiser', `select to_jsonb(pg_temp.m('{"join_policy":"approve","organiser_id":null}'))`),
      E('desk_without_staff', `select to_jsonb(pg_temp.m('{"organised_by":"desk"}'))`),
      E('booked_without_booking', `select to_jsonb(pg_temp.m('{"status":"booked"}'))`),
      E('cancelled_unstamped', `select to_jsonb(pg_temp.m('{"status":"cancelled","ended_reason":"staff_cancelled"}'))`),
      E('cancelled_wrong_reason', `select to_jsonb(pg_temp.m(jsonb_build_object('status', 'cancelled', 'ended_at', now(), 'ended_reason', 'deadline')))`),
      E('cancelled', `select to_jsonb(pg_temp.m(jsonb_build_object('status', 'cancelled', 'ended_at', now(), 'ended_reason', 'staff_cancelled')))`),
      E('category', `select to_jsonb(pg_temp.m('{"category":"mixed"}'))`),
      E('token_twice', `select to_jsonb(pg_temp.m('{"share_token":"abcdefghijABCDEFGHIJ_-"}')), to_jsonb(pg_temp.m('{"share_token":"abcdefghijABCDEFGHIJ_-"}'))`),
    ]);
    ok(r, 'valid');
    ok(r, 'sandbox_booked'); // a sandbox match never books a court
    ok(r, 'desk_run');
    ok(r, 'cancelled');
    expect(tripped(r, 'shares_sum')).toBe('matches_shares');
    expect(tripped(r, 'shares_order')).toBe('matches_shares');
    expect(tripped(r, 'shares_spread')).toBe('matches_shares');
    expect(tripped(r, 'token')).toBe('matches_token');
    expect(tripped(r, 'time')).toBe('matches_time');
    expect(tripped(r, 'deadline')).toBe('matches_deadline');
    expect(tripped(r, 'approve_without_organiser')).toBe('matches_organiser_policy');
    expect(tripped(r, 'desk_without_staff')).toBe('matches_organised_by');
    expect(tripped(r, 'booked_without_booking')).toBe('matches_reservation');
    expect(tripped(r, 'cancelled_unstamped')).toBe('matches_ended');
    expect(tripped(r, 'cancelled_wrong_reason')).toBe('matches_ended');
    expect(tripped(r, 'category')).toBe('matches_enums');
    expect(tripped(r, 'token_twice')).toBe('matches_share_token_key');
  });

  it('match_seats: the kind rule, R4 (a walk-in on a no-show\'s number), the sanitiser and the branch guard', () => {
    const r = scenario('m257d', [
      SETUP,
      GUEST('g1'),
      COURT,
      M('m'),
      S('seat1', `'{"guest_name":"  Omar\\u0007 ","guest_phone":"+964 770 000 0000"}'`),
      Q('seat1_row', `select to_jsonb(s) - 'id' from match_seats s where id = {{seat1}}`),
      E('blank_walk_in', `select to_jsonb(pg_temp.s('{"seat_no":2,"guest_name":"\\u0007","guest_phone":"   "}'))`),
      Q('blank_row', `select jsonb_build_object('name', guest_name, 'phone', guest_phone) from match_seats where seat_no = 2 and match_id = {{m}}`),
      E('same_number', `select to_jsonb(pg_temp.s())`),
      // A no-show carries number 3 after the start; a walk-in may take it (R4).
      S('no_show', `'{"seat_no":3,"status":"no_show","marked_at":"2026-01-01T00:00:00Z"}'`),
      E('walk_in_on_no_show', `select to_jsonb(pg_temp.s(jsonb_build_object('seat_no', 3, 'replaces_seat_id', {{no_show}})))`),
      E('seat_5', `select to_jsonb(pg_temp.s('{"seat_no":5}'))`),
      E('account_without_ticket', `select to_jsonb(pg_temp.s(jsonb_build_object('seat_no', 4, 'kind', 'account', 'guest_id', {{g1}}, 'created_by_staff_id', null)))`),
      E('desk_customer_named', `select to_jsonb(pg_temp.s(jsonb_build_object('seat_no', 4, 'guest_id', {{g1}}, 'guest_name', 'Omar')))`),
      E('left_unstamped', `select to_jsonb(pg_temp.s('{"seat_no":4,"status":"left"}'))`),
      E('attended_unmarked', `select to_jsonb(pg_temp.s('{"seat_no":4,"status":"attended"}'))`),
      E('bad_phone', `select to_jsonb(pg_temp.s('{"seat_no":4,"guest_phone":"call me"}'))`),
      E('write_off_half', `select to_jsonb(pg_temp.s(jsonb_build_object('seat_no', 4, 'written_off_at', now())))`),
      E('other_branch', `select to_jsonb(pg_temp.s(jsonb_build_object('seat_no', 4, 'venue_id', {{other_venue}})))`),
    ]);
    expect(ok<Record<string, unknown>>(r, 'seat1_row')).toMatchObject({
      guest_name: 'Omar', guest_phone: '+964 770 000 0000', status: 'in', vouched: true, kind: 'desk',
    });
    ok(r, 'blank_walk_in');
    expect(ok(r, 'blank_row')).toEqual({ name: null, phone: null });
    expect(tripped(r, 'same_number')).toBe('match_seats_occupying_no');
    ok(r, 'walk_in_on_no_show');
    expect(tripped(r, 'seat_5')).toBe('match_seats_seat_no_check');
    expect(tripped(r, 'account_without_ticket')).toBe('match_seats_kind');
    expect(tripped(r, 'desk_customer_named')).toBe('match_seats_kind');
    expect(tripped(r, 'left_unstamped')).toBe('match_seats_ended');
    expect(tripped(r, 'attended_unmarked')).toBe('match_seats_marked');
    expect(tripped(r, 'bad_phone')).toBe('match_seats_guest_phone_check');
    expect(tripped(r, 'write_off_half')).toBe('match_seats_write_off');
    expect(tripped(r, 'other_branch')).toBe('VENUE_MISMATCH');
  });

  it('match_tickets: the ledger CHECKs, R8, no default sandbox, one live seat per ticket, the seat FK', () => {
    const r = scenario('m257e', [
      SETUP,
      GUEST('g1'),
      GUEST('g2'),
      COURT,
      M('m'),
      P('pay'),
      P('pay2', `'{"guest_id":null}'`),
      TK('t1'),
      E('no_sandbox', `insert into match_tickets (guest_id, price_iqd, purchase_payment_id) values ({{g1}}, 10000, {{pay}})`),
      E('free', `select to_jsonb(pg_temp.tk('{"price_iqd":0}'))`),
      E('reserved_alone', `select to_jsonb(pg_temp.tk('{"status":"reserved"}'))`),
      E('in_use_alone', `select to_jsonb(pg_temp.tk('{"status":"in_use"}'))`),
      E('forfeited_half', `select to_jsonb(pg_temp.tk(jsonb_build_object('status', 'forfeited', 'forfeited_at', now())))`),
      E('cashed_out_half', `select to_jsonb(pg_temp.tk(jsonb_build_object('status', 'cashed_out', 'cashed_out_at', now())))`),
      E('cashout_other_payment', `select to_jsonb(pg_temp.tk(jsonb_build_object('status', 'cashed_out', 'cashed_out_at', now(), 'cashout_payment_id', {{pay2}})))`),
      E('cashed_out', `select to_jsonb(pg_temp.tk(jsonb_build_object('status', 'cashed_out', 'cashed_out_at', now(), 'cashout_payment_id', {{pay}})))`),
      E('stray_seat_ticket', `select to_jsonb(pg_temp.s(jsonb_build_object('seat_no', 2, 'kind', 'account', 'guest_id', {{g1}}, 'created_by_staff_id', null, 'ticket_id', gen_random_uuid())))`),
      S('seat1', `jsonb_build_object('kind', 'account', 'guest_id', {{g1}}, 'created_by_staff_id', null, 'ticket_id', {{t1}})`),
      E('ticket_twice', `select to_jsonb(pg_temp.s(jsonb_build_object('seat_no', 2, 'kind', 'friend', 'guest_id', {{g1}}, 'created_by_staff_id', null, 'ticket_id', {{t1}})))`),
      E('in_use', `update match_tickets set status = 'in_use', seat_id = {{seat1}} where id = {{t1}}`),
      E('second_ticket_same_seat', `select to_jsonb(pg_temp.tk(jsonb_build_object('status', 'in_use', 'seat_id', {{seat1}})))`),
    ]);
    expect(tripped(r, 'no_sandbox')).toMatch(/null value in column "sandbox"/);
    expect(tripped(r, 'free')).toBe('match_tickets_price_iqd_check');
    expect(tripped(r, 'reserved_alone')).toBe('match_tickets_reserved');
    expect(tripped(r, 'in_use_alone')).toBe('match_tickets_in_use');
    expect(tripped(r, 'forfeited_half')).toBe('match_tickets_forfeited');
    expect(tripped(r, 'cashed_out_half')).toBe('match_tickets_cashed_out');
    expect(tripped(r, 'cashout_other_payment')).toBe('match_tickets_cashout_same');
    ok(r, 'cashed_out');
    expect(tripped(r, 'stray_seat_ticket')).toBe('match_seats_ticket_fk');
    expect(tripped(r, 'ticket_twice')).toBe('match_seats_ticket_live');
    ok(r, 'in_use');
    expect(tripped(r, 'second_ticket_same_seat')).toBe('match_tickets_seat');
  });

  it('requests, events, blocks, reports, exclusions: their rules; the three logs are append-only', () => {
    const r = scenario('m257f', [
      SETUP,
      GUEST('g1'),
      GUEST('g2'),
      COURT,
      M('m'),
      P('pay'),
      TK('t1'),
      S('seat1'),
      KEEP('req', `insert into match_requests (venue_id, match_id, guest_id, seats_requested)
                   values ({{venue}}, {{m}}, {{g2}}, 1) returning id`),
      E('second_pending', `insert into match_requests (venue_id, match_id, guest_id, seats_requested)
                           values ({{venue}}, {{m}}, {{g2}}, 1)`),
      E('friend_genders', `insert into match_requests (venue_id, match_id, guest_id, seats_requested, friend_genders)
                           values ({{venue}}, {{m}}, {{g1}}, 3, array['female'])`),
      E('decided_open', `insert into match_requests (venue_id, match_id, guest_id, seats_requested, status)
                         values ({{venue}}, {{m}}, {{g1}}, 1, 'approved')`),
      E('event', `insert into match_events (venue_id, match_id, type, actor, data)
                  values ({{venue}}, {{m}}, 'started', 'system', '{"seats_taken":1}')`),
      E('event_type', `insert into match_events (venue_id, match_id, type, actor) values ({{venue}}, {{m}}, 'teleported', 'system')`),
      E('event_actor', `insert into match_events (venue_id, match_id, type, actor) values ({{venue}}, {{m}}, 'joined', 'guest')`),
      E('event_data', `insert into match_events (venue_id, match_id, type, actor, data) values ({{venue}}, {{m}}, 'joined', 'system', '[1]')`),
      E('event_update', `update match_events set code = 'x' where match_id = {{m}}`),
      E('event_delete', `delete from match_events where false`),
      E('ticket_event', `insert into match_ticket_events (ticket_id, guest_id, type, payment_id)
                         values ({{t1}}, {{g1}}, 'bought', {{pay}})`),
      E('ticket_event_type', `insert into match_ticket_events (ticket_id, guest_id, type) values ({{t1}}, {{g1}}, 'lost')`),
      E('ticket_event_code', `insert into match_ticket_events (ticket_id, guest_id, type, code)
                              values ({{t1}}, {{g1}}, 'released', repeat('x', 41))`),
      E('ticket_event_update', `update match_ticket_events set code = 'x' where ticket_id = {{t1}}`),
      E('link_delete', `delete from payment_match_seats where false`),
      E('link_update', `update payment_match_seats set amount_iqd = 1 where false`),
      E('block', `insert into match_blocks (blocker_id, blocked_id) values ({{g1}}, {{g2}})`),
      E('block_twice', `insert into match_blocks (blocker_id, blocked_id) values ({{g1}}, {{g2}})`),
      E('block_self', `insert into match_blocks (blocker_id, blocked_id) values ({{g1}}, {{g1}})`),
      E('report', `insert into match_reports (venue_id, match_id, reporter_id, reported_id, request_id, reason)
                   values ({{venue}}, {{m}}, {{g1}}, {{g2}}, {{req}}, 'harassment')`),
      E('report_twice', `insert into match_reports (venue_id, match_id, reporter_id, reported_id, seat_id, reason)
                         values ({{venue}}, {{m}}, {{g1}}, {{g2}}, {{seat1}}, 'other')`),
      E('report_no_target', `insert into match_reports (venue_id, match_id, reporter_id, reported_id, reason)
                             values ({{venue}}, {{m}}, {{g2}}, {{g1}}, 'other')`),
      E('report_self', `insert into match_reports (venue_id, match_id, reporter_id, reported_id, seat_id, reason)
                        values ({{venue}}, {{m}}, {{g1}}, {{g1}}, {{seat1}}, 'other')`),
      E('report_reviewed_open', `insert into match_reports (venue_id, match_id, reporter_id, reported_id, seat_id, reason, reviewed_at)
                                 values ({{venue}}, {{m}}, {{g2}}, {{g1}}, {{seat1}}, 'other', now())`),
      E('exclusion', `insert into match_exclusions (match_id, guest_id, venue_id, reason)
                      values ({{m}}, {{g2}}, {{venue}}, 'removed_by_organiser')`),
      E('exclusion_reason', `insert into match_exclusions (match_id, guest_id, venue_id, reason)
                             values ({{m}}, {{g1}}, {{venue}}, 'banned')`),
      E('exclusion_other_branch', `insert into match_exclusions (match_id, guest_id, venue_id, reason)
                                   values ({{m}}, {{g1}}, {{other_venue}}, 'removed_by_staff')`),
    ]);
    expect(tripped(r, 'second_pending')).toBe('match_requests_one_pending');
    expect(tripped(r, 'friend_genders')).toBe('match_requests_friend_genders');
    expect(tripped(r, 'decided_open')).toBe('match_requests_decided');
    ok(r, 'event');
    expect(tripped(r, 'event_type')).toBe('match_events_type');
    expect(tripped(r, 'event_actor')).toBe('match_events_actor');
    expect(tripped(r, 'event_data')).toBe('match_events_data_check');
    expect(tripped(r, 'event_update')).toBe('match_events is append-only');
    expect(tripped(r, 'event_delete')).toBe('match_events is append-only');
    ok(r, 'ticket_event');
    expect(tripped(r, 'ticket_event_type')).toBe('match_ticket_events_type_check');
    expect(tripped(r, 'ticket_event_code')).toBe('match_ticket_events_code_check');
    expect(tripped(r, 'ticket_event_update')).toBe('match_ticket_events is append-only');
    expect(tripped(r, 'link_delete')).toBe('payment_match_seats is append-only');
    expect(tripped(r, 'link_update')).toBe('payment_match_seats is append-only');
    ok(r, 'block');
    expect(tripped(r, 'block_twice')).toBe('match_blocks_pair');
    expect(tripped(r, 'block_self')).toBe('match_blocks_not_self');
    ok(r, 'report');
    expect(tripped(r, 'report_twice')).toBe('match_reports_once');
    expect(tripped(r, 'report_no_target')).toBe('match_reports_target');
    expect(tripped(r, 'report_self')).toBe('match_reports_not_self');
    expect(tripped(r, 'report_reviewed_open')).toBe('match_reports_reviewed');
    ok(r, 'exclusion');
    expect(tripped(r, 'exclusion_reason')).toBe('match_exclusions_reason_check');
    expect(tripped(r, 'exclusion_other_branch')).toBe('VENUE_MISMATCH');
  });

  it('booking_payments: a ticket purchase is a chain row (R7); its amount, reasons and one live attempt', () => {
    const r = scenario('m257g', [
      SETUP,
      GUEST('g1'),
      E('ticket', `select to_jsonb(pg_temp.p())`),
      E('ticket_with_hold', `select to_jsonb(pg_temp.p(jsonb_build_object('hold_id', gen_random_uuid())))`),
      E('ticket_at_branch', `select to_jsonb(pg_temp.p(jsonb_build_object('venue_id', {{venue}})))`),
      E('ticket_four', `select to_jsonb(pg_temp.p('{"ticket_count":4,"amount_iqd":40000}'))`),
      E('ticket_amount', `select to_jsonb(pg_temp.p('{"amount_iqd":15000}'))`),
      E('deposit_without_hold', `select to_jsonb(pg_temp.p(jsonb_build_object('purpose', 'deposit', 'ticket_count', null, 'venue_id', {{venue}})))`),
      E('ticket_deposit_reason', `select to_jsonb(pg_temp.p(jsonb_build_object('status', 'refund_pending', 'refund_reason', 'guest_cancel',
                                                                              'refund_amount_iqd', 20000, 'refund_requested_at', now())))`),
      E('ticket_cashout', `select to_jsonb(pg_temp.p(jsonb_build_object('status', 'refund_pending', 'refund_reason', 'ticket_cashout',
                                                                       'refund_amount_iqd', 20000, 'refund_requested_at', now())))`),
      E('attempt', `select to_jsonb(pg_temp.p('{"status":"created","succeeded_at":null}'))`),
      E('second_attempt', `select to_jsonb(pg_temp.p('{"status":"pending","succeeded_at":null}'))`),
      // tabs.court_cap_iqd (R2): positive or NULL. The rule itself, since a
      // fresh stack may hold no tab to write.
      Q('cap_rule', `select to_jsonb(pg_get_constraintdef(oid)) from pg_constraint
                      where conname = 'tabs_court_cap_positive' and conrelid = 'public.tabs'::regclass`),
    ]);
    ok(r, 'ticket');
    expect(tripped(r, 'ticket_with_hold')).toBe('booking_payments_anchor');
    expect(tripped(r, 'ticket_at_branch')).toBe('booking_payments_anchor');
    expect(tripped(r, 'ticket_four')).toBe('booking_payments_anchor');
    expect(tripped(r, 'ticket_amount')).toBe('booking_payments_ticket_amount');
    expect(tripped(r, 'deposit_without_hold')).toBe('booking_payments_anchor');
    expect(tripped(r, 'ticket_deposit_reason')).toBe('booking_payments_reason_by_purpose');
    ok(r, 'ticket_cashout');
    ok(r, 'attempt');
    expect(tripped(r, 'second_attempt')).toBe('booking_payments_one_active_ticket');
    expect(ok(r, 'cap_rule')).toBe('CHECK (((court_cap_iqd IS NULL) OR (court_cap_iqd > 0)))');
  });

  it('the deposit hooks leave a ticket purchase alone; refunds of one are chain money (R23 for both)', () => {
    const r = scenario('m257h', [
      SETUP,
      GUEST('g1'),
      GUEST('g2'),
      GUEST('g3'),
      GUEST('g4'),
      // A: a purchase that succeeded (its tickets are in use somewhere).
      P('a'),
      // B: a cash-out Qi refused; C the same on the review account's sandbox;
      // D: a cash-out Qi has not answered for a day.
      P('b', `jsonb_build_object('guest_id', {{g2}}, 'status', 'refund_failed', 'refund_reason', 'ticket_cashout',
                                 'refund_amount_iqd', 20000, 'refund_requested_at', now() - interval '2 days')`),
      P('c', `jsonb_build_object('guest_id', {{g3}}, 'sandbox', true, 'status', 'refund_failed',
                                 'refund_reason', 'ticket_cashout', 'refund_amount_iqd', 20000,
                                 'refund_requested_at', now() - interval '2 days')`),
      P('d', `jsonb_build_object('guest_id', {{g4}}, 'status', 'refund_pending', 'refund_reason', 'ticket_cashout',
                                 'refund_amount_iqd', 20000, 'refund_requested_at', now() - interval '2 days',
                                 'deadline_at', now() - interval '2 days')`),
      Q('ids', `select jsonb_build_object('a', {{a}}, 'b', {{b}}, 'c', {{c}}, 'd', {{d}}, 'g2', {{g2}})`),

      // The attention list, at the manager's branch: B and D (chain money), not
      // the succeeded purchase (the not-live case is deposit-only), not C.
      T('attention', 'manager', `select app.deposit_attention({{venue}})`),
      T('attention_desk', 'desk', `select app.deposit_attention({{venue}})`),

      // The reconciler: the first loop leaves A succeeded; D is claimed as a
      // refund with its purpose and count.
      E('due', `select app.deposits_due_for_reconcile(100)`),
      E('a_after_due', `select to_jsonb(status) from booking_payments where id = {{a}}`),

      // A purchase goes back only by a cash-out.
      T('request', 'manager', `select app.deposit_refund_request({{a}}, null)`),

      // Retry: any manager, no branch check (its venue is NULL).
      T('retry', 'manager', `select app.deposit_refund_retry({{b}})`),
      E('b_after_retry', `select to_jsonb(status) from booking_payments where id = {{b}}`),

      // R23: "settled another way" only from refund_failed.
      T('pin_1', 'manager', `select to_jsonb(app.verify_manager_pin('380517', null))`),
      T('manual_pending', 'manager', `select app.deposit_refund_manual({{d}}, null, 'cash at the desk', null)`),
      T('pin_2', 'manager', `select to_jsonb(app.verify_manager_pin('380517', null))`),
      T('manual_succeeded', 'manager', `select app.deposit_refund_manual({{a}}, null, 'cash at the desk', null)`),
      T('pin_3', 'manager', `select to_jsonb(app.verify_manager_pin('380517', null))`),
      T('manual', 'manager', `select app.deposit_refund_manual({{c}}, null, 'cash at the desk', null)`),
      E('c_after_manual', `select to_jsonb(p) - 'id' from (select status, refund_reason, refund_note, refund_amount_iqd, refunded_at is not null as stamped
                                                             from booking_payments where id = {{c}}) p`),
    ]);
    type Item = Record<string, unknown>;
    const id = ok<Record<string, string>>(r, 'ids');
    const attention = ok<Item[]>(r, 'attention');
    const listed = attention.map((i) => i.id);
    expect(listed).toContain(id.b);
    expect(listed).toContain(id.d);
    expect(listed, 'a sandbox purchase is never listed').not.toContain(id.c);
    expect(listed, 'a succeeded purchase is not a "booking not live"').not.toContain(id.a);
    expect(attention.find((i) => i.id === id.b)).toMatchObject({
      purpose: 'ticket', ticket_count: 2, customer_id: id.g2, reservation_id: null, start_at: null,
      court_name_en: null, guest_name: 'Test g2', status: 'refund_failed', refund_reason: 'ticket_cashout',
      amount_iqd: 20000, sandbox: false,
    });
    expect(attention.find((i) => i.id === id.d)).toMatchObject({ purpose: 'ticket', status: 'refund_pending' });
    // Every row, deposits included, carries the three new keys.
    for (const row of attention) {
      expect(Object.keys(row)).toEqual(expect.arrayContaining(['purpose', 'ticket_count', 'customer_id']));
    }
    expect(refused(r, 'attention_desk')).toBe('FORBIDDEN');

    const due = ok<Item[]>(r, 'due');
    const dueD = due.find((i) => i.id === id.d);
    expect(dueD).toMatchObject({ action: 'refund', purpose: 'ticket', ticket_count: 2, refund_amount_iqd: 20000 });
    for (const row of due) expect(row).toHaveProperty('purpose');
    expect(ok(r, 'a_after_due')).toBe('succeeded');

    const request = r.request as { ok: boolean; code?: string; detail?: string | null };
    expect(request.ok).toBe(false);
    expect(request.code).toBe('PAYMENT_STATE');
    expect(request.detail).toBe('ticket');

    expect(ok<Item>(r, 'retry')).toMatchObject({ status: 'refund_pending' });
    expect(ok(r, 'b_after_retry')).toBe('refund_pending');

    expect(ok<string>(r, 'pin_1')).toEqual(expect.any(String));
    const pending = r.manual_pending as { ok: boolean; code?: string; detail?: string | null };
    expect(pending).toMatchObject({ ok: false, code: 'PAYMENT_STATE', detail: 'refund_pending' });
    const succeeded = r.manual_succeeded as { ok: boolean; code?: string; detail?: string | null };
    expect(succeeded).toMatchObject({ ok: false, code: 'PAYMENT_STATE', detail: 'succeeded' });
    expect(ok<Item>(r, 'manual')).toMatchObject({ status: 'refunded' });
    expect(ok<Item>(r, 'c_after_manual')).toEqual({
      status: 'refunded', refund_reason: 'ticket_cashout', refund_note: 'cash at the desk', refund_amount_iqd: 20000,
      stamped: true,
    });
  });

  it('the nine re-issues: scoped to deposits in the text; R15 puts the hold expiry before any reservations write', () => {
    const r = scenario('m257i', [
      SETUP,
      Q('src', `select jsonb_object_agg(p.proname, p.prosrc)
                  from pg_proc p
                 where p.pronamespace = 'app'::regnamespace
                   and p.proname in ('trg_reservation_deposit', 'deposit_settle_success', 'deposits_due_for_reconcile',
                                     'deposit_attention', 'deposit_refund_request', 'deposit_refund_manual',
                                     'deposit_refund_retry', 'my_reservations', 'deposit_net_paid')`),
    ]);
    const src = ok<Record<string, string>>(r, 'src');
    expect(Object.keys(src).sort()).toEqual([
      'deposit_attention', 'deposit_net_paid', 'deposit_refund_manual', 'deposit_refund_request',
      'deposit_refund_retry', 'deposit_settle_success', 'deposits_due_for_reconcile', 'my_reservations',
      'trg_reservation_deposit',
    ]);
    for (const fn of ['trg_reservation_deposit', 'deposit_settle_success', 'deposits_due_for_reconcile',
                      'deposit_attention', 'my_reservations', 'deposit_net_paid']) {
      expect(src[fn], fn).toMatch(/purpose = 'deposit'/);
    }
    for (const fn of ['deposit_refund_request', 'deposit_refund_manual', 'deposit_refund_retry']) {
      expect(src[fn], fn).toMatch(/purpose = 'ticket'/);
    }
    // R15: one hold expiry, above the first reservations write in the text
    // (the lock walker reads the body in order).
    const settle = src.deposit_settle_success!;
    expect(settle.match(/app\.expire_stale_holds\(/g)).toHaveLength(1);
    const expiry = settle.indexOf('app.expire_stale_holds(');
    const firstWrite = Math.min(
      ...[/update\s+reservations\b/i, /insert\s+into\s+reservations\b/i].map((re) => settle.search(re)).filter((i) => i >= 0),
    );
    expect(expiry).toBeGreaterThan(0);
    expect(expiry).toBeLessThan(firstWrite);
    // R23: the manual settle accepts refund_failed and nothing else.
    expect(src.deposit_refund_manual).toMatch(/if v\.status <> 'refund_failed' then/);
    expect(src.deposit_refund_manual).not.toMatch(/'succeeded' then 'manual'/);
  });

  it('the assistant reads matches and seats without identity columns (table_read, owner only)', () => {
    const r = scenario('m257j', [
      SETUP,
      Q('cols', `select jsonb_object_agg(table_name, cols) from (
                   select table_name, jsonb_agg(column_name order by ordinal) as cols
                     from app.assistant_readable_columns
                    where table_name in ('matches', 'match_seats', 'match_tickets', 'match_requests',
                                         'match_events', 'match_ticket_events', 'match_blocks', 'match_reports',
                                         'match_exclusions', 'payment_match_seats')
                    group by table_name) x`),
    ]);
    const cols = ok<Record<string, string[]>>(r, 'cols');
    expect(Object.keys(cols).sort()).toEqual(['match_seats', 'matches']);
    expect(cols.matches).toEqual([
      'id', 'venue_id', 'status', 'start_at', 'end_at', 'duration_min', 'visibility', 'join_policy', 'category',
      'price_iqd', 'fill_deadline_at', 'organised_by', 'sandbox', 'ended_at', 'ended_reason', 'created_at',
    ]);
    expect(cols.match_seats).toEqual([
      'id', 'venue_id', 'match_id', 'seat_no', 'kind', 'status', 'share_iqd', 'vouched', 'joined_at', 'ended_at',
      'end_reason', 'marked_at', 'written_off_at', 'write_off_reason',
    ]);
    for (const c of [...cols.matches!, ...cols.match_seats!]) {
      expect(c).not.toMatch(/guest|organiser|name|phone|gender|token/);
    }
  });
});
