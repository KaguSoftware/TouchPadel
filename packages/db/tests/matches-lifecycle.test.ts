/**
 * 0261 match_guest_rpcs: the guest's open-match lifecycle (docs/design/
 * open-matches/db.md §3, §4.6, §6, §7; build contracts §1.6, OM-20, OM-34,
 * OM-35, OM-37, OM-42, OM-43, OM-44, DF-3, DF-19, R10, R17, R24, R41).
 *
 * Two halves:
 *   * rolled-back scenarios at a branch made inside the transaction (two
 *     courts, so OM-42 and SLOT_TAKEN are reachable), calling the RPCs as the
 *     guest: every refusal in its order, start, join to four and the booking,
 *     approve mode, leave while filling and after booking, a refill, OM-44,
 *     cancel, handover, sandbox isolation; pg_temp.ledger() (the ticket ledger
 *     rules) after every ticket move;
 *   * one committed flow over HTTP at venue A with real ticket purchases (the
 *     fake bank), assertTicketLedger (T1–T12) after every case: a double tap
 *     on Start, join to four and the booked court, a late leave and its
 *     refill, approve mode with decline, withdraw and approval.
 *
 * The sweep's deadline expiry and bumps are 0263's (matches-bump,
 * matches-sweep); the desk's calls are 0262's (matches-desk).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  MATCH_MONEY_CHECK,
  SEED_STAFF,
  SEED_STAFF_IDS,
  VENUE_A_ID,
  appRpc,
  assertMatchMoney,
  assertTicketLedger,
  createTestCourt,
  createTestMatch,
  ensureTestRateRule,
  futureSlot,
  grantTestTickets,
  guestClient,
  serviceClient,
  signedInClient,
  stackAvailable,
  testIdemKey,
} from './helpers';
import { Q, X, dockerReachable, psql, psqlSession, scenario, waitForSleeper, type Results } from './stores-harness';
import { E, GUEST, K, SETUP, START, at, data, failed } from './matches-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;

// ── 1. match_start: every refusal, in order ────────────────────────────────

describe.skipIf(!docker)('match_start and match_quote (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m260s', [
      SETUP,
      `select pg_temp.branch();`,
      GUEST('g1', '{"gender":"male"}'),
      GUEST('g2'),
      GUEST('g3'),
      GUEST('g4'),
      GUEST('sb', '{"sandbox":true}'),
      GUEST('nogender', '{"gender":null}'),
      GUEST('nophone', '{"phone":null}'),
      `select pg_temp.tickets('g1', 3);`,
      `select pg_temp.tickets('g2', 1);`,
      `select pg_temp.tickets('g3', 2);`,
      `select pg_temp.tickets('sb', 1);`,

      // The guard, then the arguments by name.
      E('anon', null, START()),
      E('nophone', 'nophone', START()),
      E('nogender', 'nogender', START()),
      E('no_key', 'g1', START({ key: null })),
      E('no_quote', 'g1', START({ price: null })),
      E('bad_category', 'g1', START({ category: 'mixed' })),
      E('bad_friends', 'g1', START({ friends: '[{"gender":"other"}]' })),
      E('friend_gender_unset', 'g1', START({ category: 'men', friends: '[{"gender":null}]' })),
      E('seat_limit', 'g1', START({ friends: '[{},{},{}]' })),
      E('court_unknown', 'g1', `select app.match_start({{v}}, '00000000-0000-4000-8000-000000000000', ${at(3)}, 90, 'open', 'public', 'open', '[]', 40000, 'k-x')`),
      X(`update venue_settings set matches_enabled = false where venue_id = {{v}}`),
      E('off', 'g1', START()),
      X(`update venue_settings set matches_enabled = true where venue_id = {{v}}`),
      E('duration', 'g1', START({ dur: 45 })),
      E('horizon', 'g1', START({ when: at(200) })),
      E('past', 'g1', START({ when: at(-1) })),
      E('too_late', 'g1', START({ when: `now() + interval '150 minutes'` })),
      E('gender', 'g1', START({ category: 'women' })),
      E('friend_gender', 'g1', START({ category: 'men', friends: '[{"gender":"female"}]' })),
      E('price', 'g1', START({ price: 1 })),
      E('need', 'g2', START({ friends: '[{}]' })),

      // The quote first, then the start it describes (DF-3: quote = charge).
      E('quote', 'g1', `select app.match_quote({{v}}, {{c2}}, ${at(3)}, 90)`),
      E('start', 'g1', START({ court: 'c2', price: 48000, friends: '[{"gender":"male"}]', key: 'k-start' })),
      K('m', `select res #>> '{data,match_id}' from pg_temp.out where label = 'start'`),
      Q('match', `select to_jsonb(m) - 'id' - 'venue_id' - 'created_at' - 'updated_at' - 'share_token' - 'period'
                     - 'price_court_id' - 'rate_rule_id' - 'organiser_id' - 'start_at' - 'end_at' - 'fill_deadline_at'
                     || jsonb_build_object('token_ok', m.share_token ~ '^[A-Za-z0-9_-]{22}$',
                                           'court_is_c2', m.price_court_id = {{c2}},
                                           'organiser_is_g1', m.organiser_id = {{g1}},
                                           'deadline_ok', m.fill_deadline_at = m.start_at - interval '120 minutes')
                     from matches m where m.id = {{m}}`),
      Q('state', `select pg_temp.state('m')`),
      Q('wallet_g1', `select pg_temp.wallet('g1')`),
      Q('ledger_start', `select pg_temp.ledger()`),
      // R24: a replay answers the same match; the key under anyone else is a conflict.
      E('replay', 'g1', START({ court: 'c2', price: 48000, friends: '[{"gender":"male"}]', key: 'k-start' })),
      E('conflict', 'g2', START({ key: 'k-start' })),

      // R41: the starter cannot start another match over the same time.
      E('clash', 'g1', START({ when: `${at(3)} + interval '30 minutes'` })),
      // OM-42 at two courts: one filling match, then a firm booking on one
      // court leaves one free court for two matches.
      E('second', 'g2', START({ key: 'k-second', when: at(4) })),
      X(`select pg_temp.res('c2', ${at(4)}, 90)`),
      E('slot_full', 'g3', START({ when: at(4) })),
      // A hold is not firm (R22): court 1 held and court 2 booked still leave
      // one firm-free court, so the start goes ahead.
      X(`select pg_temp.res('c1', ${at(5)}, 90, 'hold', 'pending', 'g4')`),
      X(`select pg_temp.res('c2', ${at(5)}, 90)`),
      E('held_not_firm', 'g3', START({ when: at(5) })),
      X(`select pg_temp.res('c1', ${at(6)}, 90)`),
      X(`select pg_temp.res('c2', ${at(6)}, 90)`),
      E('slot_taken', 'g3', START({ when: at(6) })),
      E('quote_taken', 'g3', `select app.match_quote({{v}}, {{c1}}, ${at(6)}, 90)`),
      E('quote_full', 'g3', `select app.match_quote({{v}}, {{c1}}, ${at(4)}, 90)`),
      // A sandbox start is neither counted nor checked by OM-42 (DF-19).
      E('sandbox_start', 'sb', START({ when: at(4) })),

      // OM-37: the cap, counted over filling and waiting matches.
      X(`update platform_settings set max_filling_matches_per_guest = 1 where id`),
      E('limit', 'g1', START({ when: at(7) })),
      E('quote_limit', 'g1', `select app.match_quote({{v}}, {{c1}}, ${at(7)}, 90)`),
      E('quote_bad', 'g1', `select app.match_quote({{v}}, {{c1}}, ${at(7)}, 45)`),
      E('quote_unset', 'nogender', `select app.match_quote({{v}}, {{c1}}, ${at(7)}, 90)`),
      E('quote_too_late', 'g3', `select app.match_quote({{v}}, {{c1}}, now() + interval '150 minutes', 90)`),
      Q('ledger_end', `select pg_temp.ledger()`),
    ]);
  });

  it('refuses in the §4.6.2 order, each code with its detail', () => {
    expect(failed(r, 'anon').code).toBe('AUTH_REQUIRED');
    expect(failed(r, 'nophone').code).toBe('PHONE_REQUIRED');
    expect(failed(r, 'nogender').code).toBe('GENDER_REQUIRED');
    expect(failed(r, 'no_key')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_idempotency_key' });
    expect(failed(r, 'no_quote')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_quoted_price_iqd' });
    expect(failed(r, 'bad_category')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_category' });
    expect(failed(r, 'bad_friends')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_friends' });
    expect(failed(r, 'friend_gender_unset')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_friends' });
    expect(failed(r, 'seat_limit').code).toBe('MATCH_SEAT_LIMIT');
    expect(failed(r, 'court_unknown').code).toBe('COURT_NOT_FOUND');
    expect(failed(r, 'off').code).toBe('MATCHES_OFF');
    expect(failed(r, 'duration').code).toBe('INVALID_DURATION');
    expect(failed(r, 'horizon')).toMatchObject({ code: 'BEYOND_HORIZON', detail: '180' });
    expect(failed(r, 'past').code).toBe('SLOT_IN_PAST');
    // OM-43 with the default 120-minute deadline: 180 minutes' notice.
    expect(failed(r, 'too_late')).toMatchObject({ code: 'MATCH_TOO_LATE', detail: '180' });
    expect(failed(r, 'gender')).toMatchObject({ code: 'MATCH_GENDER_MISMATCH', detail: null });
    expect(failed(r, 'friend_gender')).toMatchObject({ code: 'MATCH_GENDER_MISMATCH', detail: 'friend' });
    const price = failed(r, 'price');
    expect(price.code).toBe('PRICE_CHANGED');
    expect(JSON.parse(price.detail!)).toEqual({ quoted_iqd: 1, current_iqd: 40000 });
    const need = failed(r, 'need');
    expect(need.code).toBe('NEED_TICKETS');
    expect(JSON.parse(need.detail!)).toEqual({ needed: 2, available: 1, buy: 1 });
  });

  it('the quote says what the start charges (DF-3), and names no refusal for tickets or gender', () => {
    const q = data<Json>(r, 'quote');
    expect(q).toMatchObject({
      enabled: true, duration_min: 90, price_iqd: 48000, shares_iqd: [12000, 12000, 12000, 12000],
      categories: ['open', 'men'], my_gender: 'male', tickets_available: 3, ticket_price_iqd: 10000,
      seats_max: 3, filling_at_time: 0, courts_free: 2, refusal: null,
    });
    expect(data<Json>(r, 'quote_unset')).toMatchObject({ categories: ['open', 'women', 'men'], my_gender: null, refusal: null });
    expect(data<Json>(r, 'quote_taken')).toMatchObject({ courts_free: 0, refusal: 'SLOT_TAKEN' });
    expect(data<Json>(r, 'quote_full')).toMatchObject({ courts_free: 1, filling_at_time: 1, refusal: 'MATCH_SLOT_FULL' });
    expect(data<Json>(r, 'quote_limit')).toMatchObject({ refusal: 'MATCH_LIMIT_REACHED' });
    expect(data<Json>(r, 'quote_too_late')).toMatchObject({ refusal: 'MATCH_TOO_LATE' });
    expect(failed(r, 'quote_bad').code).toBe('INVALID_DURATION');
  });

  it('starts a filling match: the stamped price, shares, deadline, token; seat 1 and a friend seat on tickets', () => {
    const s = data<Json>(r, 'start');
    expect(s).toMatchObject({
      duplicate: false, status: 'filling', price_iqd: 48000, shares_iqd: [12000, 12000, 12000, 12000],
      tickets_locked: 2, tickets_available: 1,
    });
    expect((s.seats as Json[]).map((x) => [x.seat_no, x.kind])).toEqual([[1, 'account'], [2, 'friend']]);
    expect(data<Json>(r, 'match')).toMatchObject({
      status: 'filling', duration_min: 90, visibility: 'public', join_policy: 'open', category: 'open',
      price_iqd: 48000, organised_by: 'guest', sandbox: false, reservation_id: null,
      token_ok: true, court_is_c2: true, organiser_is_g1: true, deadline_ok: true,
    });
    expect(data<Json>(r, 'state')).toMatchObject({
      seats: [
        { no: 1, kind: 'account', status: 'in', ticket: 'in_use', guest: 'g1' },
        { no: 2, kind: 'friend', status: 'in', ticket: 'in_use', guest: 'g1' },
      ],
      events: ['started'],
    });
    expect(data(r, 'wallet_g1')).toEqual({ in_use: 2, available: 1 });
    expect(data(r, 'ledger_start')).toEqual([]);
  });

  it('R24: the same key is the same match for its starter, a conflict for anyone else', () => {
    expect(data<Json>(r, 'replay')).toMatchObject({ duplicate: true, match_id: data<Json>(r, 'start').match_id, tickets_locked: 2 });
    expect(failed(r, 'conflict').code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('R41, OM-42, OM-37: a clash, the slot count against firm-free courts, the cap', () => {
    expect(failed(r, 'clash').code).toBe('MATCH_TIME_CLASH');
    expect(data<Json>(r, 'second')).toMatchObject({ status: 'filling' });
    expect(failed(r, 'slot_full')).toMatchObject({ code: 'MATCH_SLOT_FULL', detail: '1' });
    expect(data<Json>(r, 'held_not_firm')).toMatchObject({ status: 'filling' });
    expect(failed(r, 'slot_taken').code).toBe('SLOT_TAKEN');
    expect(data<Json>(r, 'sandbox_start')).toMatchObject({ status: 'filling', duplicate: false });
    expect(failed(r, 'limit')).toMatchObject({ code: 'MATCH_LIMIT_REACHED', detail: '1' });
    expect(data(r, 'ledger_end')).toEqual([]);
  });
});

// ── 2. Join, request, decide ───────────────────────────────────────────────

const JOIN = (m: string, friends = '[]', token = 'null') =>
  `select app.match_join({{${m}}}, '${friends}'::jsonb, ${token})`;
const REQUEST = (m: string, friends = '[]', token = 'null') =>
  `select app.match_request({{${m}}}, '${friends}'::jsonb, ${token})`;
const TOKEN = (m: string) => `(select share_token from matches where id = {{${m}}})`;
const KEPT = (name: string, label: string, path: string) =>
  K(name, `select res #>> '{data,${path}}' from pg_temp.out where label = '${label}'`);

describe.skipIf(!docker)('match_join, match_request, match_withdraw, match_decide (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m260j', [
      SETUP,
      `select pg_temp.branch();`,
      GUEST('g1'), GUEST('g2'), GUEST('g3'), GUEST('g4'), GUEST('g5', '{"gender":"male"}'), GUEST('g6'), GUEST('g7'),
      GUEST('broke'),
      `select pg_temp.tickets('g1', 3);`, `select pg_temp.tickets('g2', 3);`, `select pg_temp.tickets('g3', 3);`,
      `select pg_temp.tickets('g4', 3);`, `select pg_temp.tickets('g5', 1);`, `select pg_temp.tickets('g6', 2);`,
      `select pg_temp.tickets('g7', 1);`,

      // M1: an instant match at 2/4, filled to four.
      E('start1', 'g1', START({ friends: '[{}]', key: 'k-m1' })),
      KEPT('m1', 'start1', 'match_id'),
      E('join_g2', 'g2', JOIN('m1')),
      E('join_again', 'g2', JOIN('m1')),
      E('join_more', 'g2', JOIN('m1', '[{}]')),
      E('join_seat_limit', 'g3', JOIN('m1', '[{},{},{}]')),
      E('join_full', 'g3', JOIN('m1', '[{}]')),
      E('join_broke', 'broke', JOIN('m1')),
      E('request_open', 'g3', REQUEST('m1')),
      Q('ledger_j1', `select pg_temp.ledger()`),
      E('join_fourth', 'g3', JOIN('m1')),
      Q('state1', `select pg_temp.state('m1')`),
      Q('booking1', `select jsonb_build_object('guest_id', r.guest_id, 'guest_name', r.guest_name, 'kind', r.kind,
                        'status', r.status, 'price_iqd', r.price_iqd, 'source', r.source,
                        'court_is_c1', r.court_id = {{c1}}, 'same_time', r.start_at = m.start_at and r.end_at = m.end_at)
                       from matches m join reservations r on r.id = m.reservation_id where m.id = {{m1}}`),
      E('join_booked_full', 'g4', JOIN('m1')),
      E('join_booked_full_token', 'g4', JOIN('m1', '[]', TOKEN('m1'))),
      Q('ledger_j2', `select pg_temp.ledger()`),

      // M2: a women-only approve-mode match.
      E('start2', 'g1', START({ when: at(5), category: 'women', policy: 'approve', key: 'k-m2' })),
      KEPT('m2', 'start2', 'match_id'),
      E('join_approve', 'g4', JOIN('m2')),
      E('request_g4', 'g4', REQUEST('m2', '[{"gender":"female"}]')),
      KEPT('q4', 'request_g4', 'request_id'),
      Q('wallet_g4_requested', `select pg_temp.wallet('g4')`),
      E('request_again', 'g4', REQUEST('m2', '[{"gender":"female"}]')),
      E('request_man_hidden', 'g5', REQUEST('m2')),
      E('request_man_token', 'g5', REQUEST('m2', '[]', TOKEN('m2'))),
      E('request_friend_man', 'g6', REQUEST('m2', '[{"gender":"male"}]')),
      E('withdraw_other', 'g6', `select app.match_withdraw({{q4}})`),
      E('withdraw', 'g4', `select app.match_withdraw({{q4}})`),
      E('withdraw_again', 'g4', `select app.match_withdraw({{q4}})`),
      Q('wallet_g4_withdrawn', `select pg_temp.wallet('g4')`),
      E('request_g4b', 'g4', REQUEST('m2')),
      KEPT('q4b', 'request_g4b', 'request_id'),
      E('decide_stranger', 'g2', `select app.match_decide({{q4b}}, true)`),
      E('decide_requester', 'g4', `select app.match_decide({{q4b}}, true)`),
      E('decline', 'g1', `select app.match_decide({{q4b}}, false)`),
      E('decline_again', 'g1', `select app.match_decide({{q4b}}, false)`),
      E('approve_declined', 'g1', `select app.match_decide({{q4b}}, true)`),
      Q('wallet_g4_declined', `select pg_temp.wallet('g4')`),

      // R41 at approval: g6 asks, then takes a seat in a match over the same
      // time; the approval names why (the request stays pending).
      E('request_g6', 'g6', REQUEST('m2')),
      KEPT('q6', 'request_g6', 'request_id'),
      E('start3', 'g2', START({ when: `${at(5)} + interval '30 minutes'`, key: 'k-m3' })),
      KEPT('m3', 'start3', 'match_id'),
      E('join3_g6', 'g6', JOIN('m3')),
      E('approve_clash', 'g1', `select app.match_decide({{q6}}, true)`),
      Q('q6_status', `select to_jsonb(status) from match_requests where id = {{q6}}`),
      E('request_on_open', 'g7', REQUEST('m3')),
      E('leave3_g6', 'g6', `select app.match_leave({{m3}})`),
      E('approve', 'g1', `select app.match_decide({{q6}}, true)`),
      E('approve_again', 'g1', `select app.match_decide({{q6}}, true)`),
      Q('state2', `select pg_temp.state('m2')`),
      Q('wallet_g6', `select pg_temp.wallet('g6')`),

      // REQUEST_LIMIT: five pending requests across matches.
      X(`insert into match_requests (venue_id, match_id, guest_id, seats_requested)
         select {{v}}, pg_temp.m(jsonb_build_object('join_policy', 'approve', 'start_at', ${at(9)} + make_interval(days => d))),
                {{g7}}, 1
           from generate_series(1, 5) d`),
      E('request_limit', 'g7', REQUEST('m2')),
      Q('ledger_end', `select pg_temp.ledger()`),
    ]);
  });

  it('joins take the lowest free numbers; a replay is a duplicate; OM-20; NEED_TICKETS names the shortfall', () => {
    expect(data<Json>(r, 'join_g2')).toMatchObject({
      duplicate: false, match_status: 'filling', refill: false, tickets_locked: 1, tickets_available: 2,
      seats: [{ seat_no: 3, kind: 'account' }],
    });
    expect(data<Json>(r, 'join_again')).toMatchObject({ duplicate: true, seats: [{ seat_no: 3 }] });
    expect(failed(r, 'join_more').code).toBe('MATCH_ALREADY_IN');
    expect(failed(r, 'join_seat_limit').code).toBe('MATCH_SEAT_LIMIT');
    expect(failed(r, 'join_full').code).toBe('MATCH_FULL');
    const broke = failed(r, 'join_broke');
    expect(broke.code).toBe('NEED_TICKETS');
    expect(JSON.parse(broke.detail!)).toEqual({ needed: 1, available: 0, buy: 1 });
    expect(failed(r, 'request_open').code).toBe('MATCH_NOT_APPROVAL');
    expect(data(r, 'ledger_j1')).toEqual([]);
  });

  it('the fourth seat books the court: guest_id NULL, "Open match", the stamped price, the tapped court', () => {
    expect(data<Json>(r, 'join_fourth')).toMatchObject({ match_status: 'booked', seats: [{ seat_no: 4 }] });
    expect(data<Json>(r, 'state1')).toMatchObject({
      match: { status: 'booked' },
      seats: [
        { no: 1, kind: 'account', status: 'in', ticket: 'in_use', guest: 'g1' },
        { no: 2, kind: 'friend', status: 'in', ticket: 'in_use', guest: 'g1' },
        { no: 3, kind: 'account', status: 'in', ticket: 'in_use', guest: 'g2' },
        { no: 4, kind: 'account', status: 'in', ticket: 'in_use', guest: 'g3' },
      ],
      events: ['started', 'joined', 'joined', 'booked'],
    });
    expect(data<Json>(r, 'booking1')).toEqual({
      guest_id: null, guest_name: 'Open match', kind: 'booking', status: 'confirmed', price_iqd: 40000,
      source: 'mobile', court_is_c1: true, same_time: true,
    });
    // A full booked match is not listed; by its link it is full.
    expect(failed(r, 'join_booked_full').code).toBe('MATCH_NOT_FOUND');
    expect(failed(r, 'join_booked_full_token').code).toBe('MATCH_FULL');
    expect(data(r, 'ledger_j2')).toEqual([]);
  });

  it('approve mode: a request reserves, withdraw and decline give the tickets back, each answer once', () => {
    expect(failed(r, 'join_approve').code).toBe('MATCH_APPROVAL_REQUIRED');
    expect(data<Json>(r, 'request_g4')).toMatchObject({ duplicate: false, status: 'pending', seats_requested: 2, tickets_reserved: 2 });
    expect(data(r, 'wallet_g4_requested')).toEqual({ reserved: 2, available: 1 });
    expect(data<Json>(r, 'request_again')).toMatchObject({ duplicate: true, request_id: data<Json>(r, 'request_g4').request_id });
    // DF-10: a declared man does not see a women's match; by its link he is refused.
    expect(failed(r, 'request_man_hidden').code).toBe('MATCH_NOT_FOUND');
    expect(failed(r, 'request_man_token').code).toBe('MATCH_GENDER_MISMATCH');
    expect(failed(r, 'request_friend_man')).toMatchObject({ code: 'MATCH_GENDER_MISMATCH', detail: 'friend' });
    expect(failed(r, 'withdraw_other').code).toBe('REQUEST_NOT_FOUND');
    expect(data<Json>(r, 'withdraw')).toMatchObject({ status: 'withdrawn', duplicate: false, tickets_released: 2 });
    expect(data<Json>(r, 'withdraw_again')).toMatchObject({ status: 'withdrawn', duplicate: true });
    expect(data(r, 'wallet_g4_withdrawn')).toEqual({ available: 3 });
    expect(failed(r, 'decide_stranger').code).toBe('REQUEST_NOT_FOUND');
    expect(failed(r, 'decide_requester').code).toBe('NOT_ORGANISER');
    expect(data<Json>(r, 'decline')).toMatchObject({ status: 'declined', duplicate: false, tickets_released: 1 });
    expect(data<Json>(r, 'decline_again')).toMatchObject({ status: 'declined', duplicate: true });
    expect(failed(r, 'approve_declined').code).toBe('REQUEST_CLOSED');
    expect(data(r, 'wallet_g4_declined')).toEqual({ available: 3 });
  });

  it('R41 at approval is REQUESTER_INELIGIBLE with the code; the request waits; approval seats at once', () => {
    expect(data<Json>(r, 'join3_g6')).toMatchObject({ match_status: 'filling' });
    expect(failed(r, 'approve_clash')).toMatchObject({ code: 'REQUESTER_INELIGIBLE', detail: 'MATCH_TIME_CLASH' });
    expect(data(r, 'q6_status')).toBe('pending');
    expect(data<Json>(r, 'approve')).toMatchObject({ status: 'approved', duplicate: false, match_status: 'filling', seats: [{ seat_no: 2, kind: 'account' }] });
    expect(data<Json>(r, 'approve_again')).toMatchObject({ status: 'approved', duplicate: true });
    expect(data<Json>(r, 'state2')).toMatchObject({
      seats: [{ no: 1, guest: 'g1', ticket: 'in_use' }, { no: 2, guest: 'g6', ticket: 'in_use', status: 'in' }],
      events: ['started', 'requested', 'withdrawn', 'requested', 'declined', 'requested', 'approved', 'joined'],
    });
    // Made in one transaction, the three requests share a created_at: compare them as a set.
    expect(((data<Json>(r, 'state2').requests as Json[]).map((q) => q.status)).sort()).toEqual(['approved', 'declined', 'withdrawn']);
    expect(data(r, 'wallet_g6')).toEqual({ in_use: 1, available: 1 });
    expect(failed(r, 'request_limit')).toMatchObject({ code: 'REQUEST_LIMIT', detail: '5' });
    expect(data(r, 'ledger_end')).toEqual([]);
  });
});

// ── 3. Leave, remove, cancel, handover, refill, sandbox ───────────────────────

const LEAVE = (m: string, seats = 'null') => `select app.match_leave({{${m}}}, ${seats})`;
const SEAT = (m: string, who: string, kind = 'account') =>
  `(select s.id from match_seats s where s.match_id = {{${m}}} and s.guest_id = {{${who}}} and s.kind = '${kind}'
     order by s.joined_at desc limit 1)`;

describe.skipIf(!docker)('match_leave, match_remove_player, match_cancel, handover, refill, sandbox (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m260l', [
      SETUP,
      `select pg_temp.branch();`,
      GUEST('g1'), GUEST('g2'), GUEST('g3'), GUEST('g4'), GUEST('g5'), GUEST('g6'), GUEST('g7'),
      GUEST('s1', '{"sandbox":true}'), GUEST('s2', '{"sandbox":true}'), GUEST('s3', '{"sandbox":true}'),
      GUEST('s4', '{"sandbox":true}'),
      ...['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 's1', 's2', 's3', 's4'].map((g) => `select pg_temp.tickets('${g}', 3);`),

      // M1 filling: g1 with a friend, g2; then g3.
      E('start1', 'g1', START({ friends: '[{}]', key: 'k-l1' })),
      KEPT('m1', 'start1', 'match_id'),
      E('j1_g2', 'g2', JOIN('m1')),
      E('holder_required', 'g1', LEAVE('m1', `array[${SEAT('m1', 'g1')}]`)),
      E('seat_not_found', 'g1', LEAVE('m1', `array[${SEAT('m1', 'g2')}]`)),
      E('leave_friend', 'g1', LEAVE('m1', `array[${SEAT('m1', 'g1', 'friend')}]`)),
      Q('wallet_g1_friend', `select pg_temp.wallet('g1')`),
      // OM-44: the organiser removes g2, who cannot come back.
      E('remove_stranger', 'g3', `select app.match_remove_player({{m1}}, ${SEAT('m1', 'g2')})`),
      E('j1_g3', 'g3', JOIN('m1')),
      E('remove_not_organiser', 'g3', `select app.match_remove_player({{m1}}, ${SEAT('m1', 'g2')})`),
      E('remove_own', 'g1', `select app.match_remove_player({{m1}}, ${SEAT('m1', 'g1')})`),
      E('remove', 'g1', `select app.match_remove_player({{m1}}, ${SEAT('m1', 'g2')})`),
      Q('wallet_g2_removed', `select pg_temp.wallet('g2')`),
      E('rejoin_removed', 'g2', JOIN('m1')),
      E('detail_removed', 'g2', `select app.match_detail({{m1}})`),
      // The lists leave the match out for the removed player only (guest.md
      // §4.15: excluded has no row; the detail above shows it).
      E('open_removed', 'g2', `select app.open_matches({{v}}, now(), now() + interval '15 days')`),
      E('open_other', 'g5', `select app.open_matches({{v}}, now(), now() + interval '15 days')`),
      E('slots_removed', 'g2', `select app.match_slots({{v}}, now(), now() + interval '15 days')`),
      E('slots_other', 'g5', `select app.match_slots({{v}}, now(), now() + interval '15 days')`),
      Q('m1_row', `select jsonb_build_object('id', id, 'start_at', start_at) from matches where id = {{m1}}`),
      // OM-34: the organiser leaves; the earliest account carrier takes over.
      E('j1_g4', 'g4', JOIN('m1')),
      // One transaction gives every seat the same joined_at; make g4 the later joiner, as two calls would.
      X(`update match_seats set joined_at = joined_at + interval '1 minute' where match_id = {{m1}} and guest_id = {{g4}}`),
      E('leave_organiser', 'g1', LEAVE('m1')),
      Q('organiser_after', `select to_jsonb(organiser_id = {{g3}}) from matches where id = {{m1}}`),
      E('leave_again', 'g1', LEAVE('m1')),
      E('leave_g4', 'g4', LEAVE('m1')),
      E('leave_last', 'g3', LEAVE('m1')),
      Q('state1', `select pg_temp.state('m1')`),
      Q('ledger_1', `select pg_temp.ledger()`),

      // Cancel: only the organiser, only before the booking.
      E('start2', 'g5', START({ when: at(4), key: 'k-l2' })),
      KEPT('m2', 'start2', 'match_id'),
      E('j2_g6', 'g6', JOIN('m2')),
      E('cancel_not_organiser', 'g6', `select app.match_cancel({{m2}})`),
      E('cancel_bad_reason', 'g5', `select app.match_cancel({{m2}}, 'bored')`),
      E('cancel', 'g5', `select app.match_cancel({{m2}}, 'plans_changed')`),
      E('cancel_again', 'g5', `select app.match_cancel({{m2}}, 'plans_changed')`),
      E('leave_cancelled', 'g6', LEAVE('m2')),
      Q('state2', `select pg_temp.state('m2')`),
      Q('wallets2', `select jsonb_build_object('g5', pg_temp.wallet('g5'), 'g6', pg_temp.wallet('g6'))`),
      Q('audit2', `select to_jsonb(reason_code) from audit_log where action = 'match.cancel' and entity_id = {{m2}}::text`),

      // A late leave and its refill (OM-11): M3 books at four, g2 leaves
      // before the start, g7 takes the seat and g2's ticket comes back.
      E('start3', 'g1', START({ when: at(6), key: 'k-l3' })),
      KEPT('m3', 'start3', 'match_id'),
      E('j3_g2', 'g2', JOIN('m3')),
      E('j3_g3', 'g3', JOIN('m3')),
      E('j3_g4', 'g4', JOIN('m3')),
      E('detail_g2_booked', 'g2', `select app.match_detail({{m3}})`),
      E('cancel_booked', 'g1', `select app.match_cancel({{m3}})`),
      E('remove_booked', 'g1', `select app.match_remove_player({{m3}}, ${SEAT('m3', 'g2')})`),
      E('late_leave', 'g2', LEAVE('m3')),
      Q('wallet_g2_late', `select pg_temp.wallet('g2')`),
      E('refill', 'g7', JOIN('m3')),
      Q('state3', `select pg_temp.state('m3')`),
      Q('refill_link', `select to_jsonb(n.replaces_seat_id = o.id) from match_seats n join match_seats o
                          on o.match_id = n.match_id and o.guest_id = {{g2}} where n.guest_id = {{g7}} and n.match_id = {{m3}}`),
      Q('wallet_g2_refilled', `select pg_temp.wallet('g2')`),
      Q('ledger_3', `select pg_temp.ledger()`),

      // SEAT_STARTED: a booked match that started an hour ago.
      K('m4', `select pg_temp.m(jsonb_build_object('status', 'booked', 'start_at', now() - interval '1 hour',
                 'reservation_id', pg_temp.res('c2', now() - interval '1 hour', 90), 'organiser_id', {{g6}}))`),
      X(`select pg_temp.seat({{m4}}, 1, 'account', {{g6}})`),
      E('seat_started', 'g6', LEAVE('m4')),
      E('join_started', 'g5', `select app.match_join({{m4}}, '[]'::jsonb, (select share_token from matches where id = {{m4}}))`),

      // Past its deadline: listed nowhere; by its link, closed. Waiting for a
      // court: full.
      K('m5', `select pg_temp.m(jsonb_build_object('start_at', now() + interval '90 minutes', 'organiser_id', {{g6}}))`),
      X(`select pg_temp.seat({{m5}}, 1, 'account', {{g6}})`),
      E('join_past_deadline', 'g5', `select app.match_join({{m5}})`),
      E('join_past_deadline_token', 'g5', `select app.match_join({{m5}}, '[]'::jsonb, (select share_token from matches where id = {{m5}}))`),
      K('m6', `select pg_temp.m(jsonb_build_object('status', 'awaiting_court', 'start_at', ${at(10)}, 'organiser_id', {{g6}}))`),
      E('join_awaiting', 'g5', `select app.match_join({{m6}}, '[]'::jsonb, (select share_token from matches where id = {{m6}}))`),

      // DF-19: a sandbox match is invisible to real players and books no court.
      E('start_sb', 's1', START({ when: at(8), key: 'k-sb' })),
      KEPT('msb', 'start_sb', 'match_id'),
      E('join_sb_real', 'g5', `select app.match_join({{msb}}, '[]'::jsonb, (select share_token from matches where id = {{msb}}))`),
      E('join_real_sb', 's2', JOIN('m3')),
      E('sb_2', 's2', JOIN('msb')),
      E('sb_3', 's3', JOIN('msb')),
      E('sb_4', 's4', JOIN('msb')),
      Q('sb_state', `select jsonb_build_object('status', status, 'reservation_id', reservation_id, 'sandbox', sandbox)
                       from matches where id = {{msb}}`),

      // R10: matches switched off stop joins, not leaves or cancels.
      E('start7', 'g5', START({ when: at(12), key: 'k-l7' })),
      KEPT('m7', 'start7', 'match_id'),
      E('j7_g6', 'g6', JOIN('m7')),
      X(`update venue_settings set matches_enabled = false where venue_id = {{v}}`),
      E('join_off_listed', 'g4', JOIN('m7')),
      E('join_off', 'g4', JOIN('m7', '[]', TOKEN('m7'))),
      E('leave_off', 'g6', LEAVE('m7')),
      E('cancel_off', 'g5', `select app.match_cancel({{m7}})`),
      Q('ledger_end', `select pg_temp.ledger()`),
    ]);
  });

  it('leave: the friends never stay without their holder; a friend seat alone is fine; tickets back', () => {
    expect(failed(r, 'holder_required').code).toBe('SEAT_HOLDER_REQUIRED');
    expect(failed(r, 'seat_not_found').code).toBe('SEAT_NOT_FOUND');
    expect(data<Json>(r, 'leave_friend')).toMatchObject({ match_status: 'filling', tickets_released: 1 });
    expect(data<Json>(r, 'leave_friend').left).toMatchObject([{ status: 'left' }]);
    expect(data(r, 'wallet_g1_friend')).toEqual({ in_use: 1, available: 2 });
  });

  it('OM-44: only the organiser removes, another holder only; the removed player cannot rejoin', () => {
    expect(failed(r, 'remove_stranger').code).toBe('MATCH_NOT_FOUND');
    expect(failed(r, 'remove_not_organiser').code).toBe('NOT_ORGANISER');
    expect(failed(r, 'remove_own').code).toBe('SEAT_NOT_FOUND');
    expect(data<Json>(r, 'remove')).toMatchObject({ match_status: 'filling', tickets_released: 1 });
    expect(data(r, 'wallet_g2_removed')).toEqual({ available: 3 });
    expect(failed(r, 'rejoin_removed').code).toBe('MATCH_UNAVAILABLE');
    const d = data<Json>(r, 'detail_removed');
    expect(d.me).toMatchObject({ role: 'removed', excluded: true, refusal: 'MATCH_UNAVAILABLE' });
    expect((d.me as Json).can).toMatchObject({ join: false, request: false, leave: false });
  });

  it('OM-44: the removed player\'s lists leave the match out; anyone else still sees it', () => {
    const m1 = data<{ id: string; start_at: string }>(r, 'm1_row');
    const ids = (label: string) => (data<{ matches: Json[] }>(r, label).matches).map((x) => x.match_id);
    const starts = (label: string) => data<Json[]>(r, label).map((x) => x.start_at);
    expect(ids('open_removed')).not.toContain(m1.id);
    expect(ids('open_other')).toContain(m1.id);
    expect(starts('slots_removed')).not.toContain(m1.start_at);
    expect(starts('slots_other')).toContain(m1.start_at);
  });

  it('OM-34: the organiser leaving hands over; the last player leaving closes the match (empty)', () => {
    expect(data<Json>(r, 'leave_organiser')).toMatchObject({ organiser_changed: true });
    expect(data<Json>(r, 'leave_organiser').left).toMatchObject([{ status: 'left' }]);
    expect(data(r, 'organiser_after')).toBe(true);
    expect(data<Json>(r, 'leave_again')).toMatchObject({ duplicate: true });
    expect(data<Json>(r, 'leave_last')).toMatchObject({ match_status: 'cancelled', organiser_changed: true });
    expect(data<Json>(r, 'state1')).toMatchObject({
      match: { status: 'cancelled', ended_reason: 'empty' },
      events: ['started', 'joined', 'left:left', 'joined', 'removed:removed_by_organiser', 'joined', 'left:left',
               'organiser_changed', 'left:left', 'left:left', 'cancelled:empty'],
    });
    expect(data(r, 'ledger_1')).toEqual([]);
  });

  it('cancel: the organiser only, a known reason, before the booking; every ticket back; audited', () => {
    expect(failed(r, 'cancel_not_organiser').code).toBe('NOT_ORGANISER');
    expect(failed(r, 'cancel_bad_reason')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_reason' });
    expect(data<Json>(r, 'cancel')).toMatchObject({ status: 'cancelled', duplicate: false });
    expect(data<Json>(r, 'cancel_again')).toMatchObject({ status: 'cancelled', duplicate: true });
    expect(data<Json>(r, 'leave_cancelled')).toMatchObject({ duplicate: true });
    expect(data<Json>(r, 'state2')).toMatchObject({
      match: { status: 'cancelled', ended_reason: 'organiser_cancelled' },
      seats: [{ status: 'cancelled', end_reason: 'match_ended', ticket: 'available' },
              { status: 'cancelled', end_reason: 'match_ended', ticket: 'available' }],
    });
    expect(data(r, 'wallets2')).toEqual({ g5: { available: 3 }, g6: { available: 3 } });
    expect(data(r, 'audit2')).toBe('plans_changed');
  });

  it('a booked match: no cancel or removal by the organiser; a late leave holds the ticket until a refill', () => {
    const d = data<Json>(r, 'detail_g2_booked');
    expect((d.me as Json).leave_outcome).toBe('locked_until_refill');
    expect(failed(r, 'cancel_booked').code).toBe('MATCH_BOOKED');
    expect(failed(r, 'remove_booked').code).toBe('MATCH_BOOKED');
    expect(data<Json>(r, 'late_leave')).toMatchObject({ match_status: 'booked', tickets_locked: 1, tickets_released: 0 });
    expect(data<Json>(r, 'late_leave').left).toMatchObject([{ status: 'left_late' }]);
    expect(data(r, 'wallet_g2_late')).toEqual({ in_use: 1, available: 2 });
    expect(data<Json>(r, 'refill')).toMatchObject({ match_status: 'booked', refill: true, seats: [{ seat_no: 2 }] });
    expect(data(r, 'refill_link')).toBe(true);
    expect(data(r, 'wallet_g2_refilled')).toEqual({ available: 3 });
    expect(data<Json>(r, 'state3')).toMatchObject({
      match: { status: 'booked' },
      events: ['started', 'joined', 'joined', 'joined', 'booked', 'left_late:left', 'refilled:refilled', 'joined'],
    });
    expect(data(r, 'ledger_3')).toEqual([]);
  });

  it('after the start and past the deadline nobody joins; a waiting match is full', () => {
    expect(failed(r, 'seat_started').code).toBe('SEAT_STARTED');
    expect(failed(r, 'join_started').code).toBe('MATCH_CLOSED');
    expect(failed(r, 'join_past_deadline').code).toBe('MATCH_NOT_FOUND');
    expect(failed(r, 'join_past_deadline_token').code).toBe('MATCH_CLOSED');
    expect(failed(r, 'join_awaiting').code).toBe('MATCH_FULL');
  });

  it('DF-19: sandbox and real players never meet; a sandbox match at four books no court', () => {
    expect(failed(r, 'join_sb_real').code).toBe('MATCH_NOT_FOUND');
    expect(failed(r, 'join_real_sb').code).toBe('MATCH_NOT_FOUND');
    expect(data<Json>(r, 'sb_4')).toMatchObject({ match_status: 'booked' });
    expect(data(r, 'sb_state')).toEqual({ status: 'booked', reservation_id: null, sandbox: true });
  });

  it('R10: matches off stop joins; leaving and cancelling still work', () => {
    // Switched off, the branch lists nothing (not found); by a link, MATCHES_OFF.
    expect(failed(r, 'join_off_listed').code).toBe('MATCH_NOT_FOUND');
    expect(failed(r, 'join_off').code).toBe('MATCHES_OFF');
    expect(data<Json>(r, 'leave_off').left).toMatchObject([{ status: 'left' }]);
    expect(data<Json>(r, 'cancel_off')).toMatchObject({ status: 'cancelled' });
    expect(data(r, 'ledger_end')).toEqual([]);
  });
});

// ── 3b. Late leavers: already in, a clash, and the organiser's refill ───────

describe.skipIf(!docker)('late leavers hold their number; a refill of the organiser\'s hands over (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m261x', [
      SETUP,
      `select pg_temp.branch();`,
      GUEST('g1'), GUEST('g2'), GUEST('g3'), GUEST('g4'), GUEST('g5'), GUEST('g6'),
      ...['g1', 'g2', 'g3', 'g4', 'g5', 'g6'].map((g) => `select pg_temp.tickets('${g}', 3);`),
      MATCH_MONEY_CHECK,

      // M booked at four: g1 (organiser) on 1, g2 on 2, g3 on 3, g4 on 4. g3
      // was seated first of the three who stay (a minute earlier).
      E('start', 'g1', START({ key: 'k-x1' })),
      KEPT('m', 'start', 'match_id'),
      E('j_g2', 'g2', JOIN('m')),
      E('j_g3', 'g3', JOIN('m')),
      X(`update match_seats set joined_at = joined_at - interval '1 minute' where match_id = {{m}} and guest_id = {{g3}}`),
      E('j_g4', 'g4', JOIN('m')),
      // Both g2 and the organiser leave after the booking: 1 and 2 are open
      // for a refill, each late leaver still carrying their own number.
      E('late_g2', 'g2', LEAVE('m')),
      E('late_g1', 'g1', LEAVE('m')),
      Q('org_late', `select to_jsonb(organiser_id = {{g1}}) from matches where id = {{m}}`),
      // g2 cannot take number 1 (their own ticket would then be lost at the
      // start while they play): already in, the detail offers no join.
      E('rejoin_g2', 'g2', JOIN('m')),
      E('detail_g2', 'g2', `select app.match_detail({{m}})`),
      // R41 counts the late leave: g2 cannot start another match over it.
      E('clash_g2', 'g2', START({ when: `${at(3)} + interval '30 minutes'`, key: 'k-x2' })),
      E('quote_g2', 'g2', `select app.match_quote({{v}}, {{c2}}, ${at(3)} + interval '30 minutes', 90)`),
      // g5 refills the lowest open number, 1: the organiser's. g3 takes over.
      E('refill_g5', 'g5', JOIN('m')),
      Q('state', `select pg_temp.state('m')`),
      Q('org_after', `select jsonb_build_object('g3', organiser_id = {{g3}}) from matches where id = {{m}}`),
      E('detail_g1', 'g1', `select app.match_detail({{m}})`),
      E('detail_g3', 'g3', `select app.match_detail({{m}})`),
      Q('wallets', `select jsonb_build_object('g1', pg_temp.wallet('g1'), 'g2', pg_temp.wallet('g2'))`),
      // g6 refills number 2, g2's: g2's ticket comes back and g2 may start again.
      E('refill_g6', 'g6', JOIN('m')),
      E('start_g2_after', 'g2', START({ when: `${at(3)} + interval '30 minutes'`, key: 'k-x3' })),
      Q('ledger', `select pg_temp.ledger()`),
      Q('money', `select pg_temp.money_of({{m}})`),
    ]);
  });

  it('a late leaver is already in: no second number, no join card (db.md §4.6.3 step 7)', () => {
    expect(data<Json>(r, 'late_g1')).toMatchObject({ match_status: 'booked', organiser_changed: false });
    expect(data(r, 'org_late')).toBe(true);
    expect(failed(r, 'rejoin_g2').code).toBe('MATCH_ALREADY_IN');
    const d = data<{ me: Json }>(r, 'detail_g2');
    expect(d.me).toMatchObject({ role: 'player', refusal: null });
    expect(d.me.can).toMatchObject({ join: false, request: false, leave: false });
  });

  it('R41: a late leave still clashes with another match over its time, until the refill', () => {
    expect(failed(r, 'clash_g2').code).toBe('MATCH_TIME_CLASH');
    expect(data<Json>(r, 'quote_g2').refusal).toBe('MATCH_TIME_CLASH');
    expect(data<Json>(r, 'start_g2_after')).toMatchObject({ duplicate: false, status: 'filling' });
  });

  it('OM-34: the refill of the organiser\'s number hands the organiser\'s part to the earliest account holder', () => {
    expect(data<Json>(r, 'refill_g5')).toMatchObject({ refill: true, seats: [{ seat_no: 1 }] });
    expect(data(r, 'org_after')).toEqual({ g3: true });
    expect(data<Json>(r, 'state')).toMatchObject({
      events: ['started', 'joined', 'joined', 'joined', 'booked', 'left_late:left', 'left_late:left',
               'refilled:refilled', 'joined', 'organiser_changed'],
    });
    const g1 = data<{ me: Json; share_token: string | null }>(r, 'detail_g1');
    expect(g1.me.role).not.toBe('organiser');
    expect(g1.me.can).toMatchObject({ decide: false, cancel: false, remove: false });
    expect(g1.share_token).toBeNull();
    expect(data<{ me: Json }>(r, 'detail_g3').me.role).toBe('organiser');
    expect(data(r, 'wallets')).toEqual({ g1: { available: 3 }, g2: { in_use: 1, available: 2 } });
    expect(data<Json>(r, 'refill_g6')).toMatchObject({ refill: true, seats: [{ seat_no: 2 }] });
    expect(data(r, 'ledger')).toEqual([]);
    expect(data(r, 'money')).toEqual([]);
  });
});

// ── 4. Committed, over HTTP, with real purchases (assertTicketLedger) ────────

describe.skipIf(!docker)('the lifecycle over HTTP with paid tickets (committed; the ledger after every case)', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let savedEnabled: boolean | undefined;
  let court: string;
  const touched = new Set<string>();
  const g: Record<string, { client: SupabaseClient; id: string }> = {};
  const slot1 = futureSlot(7).start;
  const slot2 = futureSlot(7).start;
  const ids = { m1: '', m2: '', q: '', res: '' };

  const rpc = async (c: SupabaseClient, fn: string, args: Json) => {
    const { data, error } = await appRpc(c, fn, args);
    return { ok: !error, code: error?.message, detail: error?.details, data: data as Json };
  };
  const wallet = async (id: string) => {
    const { data } = await svc.from('match_tickets').select('status').eq('guest_id', id);
    const out: Record<string, number> = {};
    for (const t of (data ?? []) as Array<{ status: string }>) out[t.status] = (out[t.status] ?? 0) + 1;
    return out;
  };

  /** A guest who may play: the terms, a gender, `count` paid tickets. */
  const player = async (tag: string, count: number) => {
    const client = await guestClient(svc, tag);
    const id = (await client.auth.getUser()).data.user!.id;
    expect((await rpc(client, 'accept_terms', { p_version: '2026-09-23' })).ok).toBe(true);
    expect((await rpc(client, 'set_my_gender', { p_gender: 'female' })).ok).toBe(true);
    await grantTestTickets(svc, id, count);
    touched.add(id);
    return { client, id };
  };

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    const s = await rpc(owner, 'match_settings', { p_venue_id: VENUE_A_ID });
    expect(s.ok, s.code).toBe(true);
    savedEnabled = s.data.matches_enabled as boolean;
    expect((await rpc(owner, 'set_match_settings', { p_patch: { matches_enabled: true }, p_venue_id: VENUE_A_ID })).ok).toBe(true);
    await ensureTestRateRule(svc);
    court = await createTestCourt(svc, `m260 lifecycle ${Date.now()}`);
    for (const [tag, n] of [['g1', 2], ['g2', 2], ['g3', 1], ['g4', 1], ['g5', 1]] as const) g[tag] = await player(`m260-${tag}`, n);
  });

  afterAll(async () => {
    if (!owner || savedEnabled === undefined) return;
    await rpc(owner, 'set_match_settings', { p_patch: { matches_enabled: savedEnabled }, p_venue_id: VENUE_A_ID });
  });

  // money.md §9: the ledger holds after every case, for every guest touched,
  // and the court-money invariants for every match made so far.
  afterEach(async () => {
    for (const id of touched) expect(await assertTicketLedger(svc, id), `ledger of ${id}`).toEqual([]);
    for (const id of [ids.m1, ids.m2].filter(Boolean)) expect(assertMatchMoney(id), `money of ${id}`).toEqual([]);
  });

  it('R24: a double tap on Start makes one match, both taps answering it', async () => {
    const quote = await rpc(g.g1!.client, 'match_quote', {
      p_venue_id: VENUE_A_ID, p_court_id: court, p_start_at: slot1.toISOString(), p_duration_min: 90,
    });
    expect(quote.ok, quote.code).toBe(true);
    expect(quote.data).toMatchObject({ enabled: true, tickets_available: 2, refusal: null });
    const args = {
      p_venue_id: VENUE_A_ID, p_court_id: court, p_start_at: slot1.toISOString(), p_duration_min: 90,
      p_category: 'open', p_visibility: 'public', p_join_policy: 'open', p_friends: [{ gender: 'female' }],
      p_quoted_price_iqd: quote.data.price_iqd, p_idempotency_key: testIdemKey('match.start'),
    };
    const [a, b] = await Promise.all([rpc(g.g1!.client, 'match_start', args), rpc(g.g1!.client, 'match_start', args)]);
    expect(a.ok && b.ok, `${a.code} ${b.code}`).toBe(true);
    expect([a.data.duplicate, b.data.duplicate].sort()).toEqual([false, true]);
    expect(a.data.match_id).toBe(b.data.match_id);
    ids.m1 = a.data.match_id as string;
    expect(await wallet(g.g1!.id)).toEqual({ in_use: 2 });
  });

  it('two joins fill it (a double tap is one seat): the fourth seat books the tapped court at the stamped price, for nobody', async () => {
    // A double tap on Join: one seat, both taps answering it.
    const [a, b] = await Promise.all([
      rpc(g.g2!.client, 'match_join', { p_match_id: ids.m1 }), rpc(g.g2!.client, 'match_join', { p_match_id: ids.m1 }),
    ]);
    expect(a.ok && b.ok, `${a.code} ${b.code}`).toBe(true);
    expect([a.data.duplicate, b.data.duplicate].sort()).toEqual([false, true]);
    expect(a.data).toMatchObject({ match_status: 'filling', seats: [{ seat_no: 3 }] });
    expect(await wallet(g.g2!.id)).toEqual({ in_use: 1, available: 1 });
    const fourth = await rpc(g.g3!.client, 'match_join', { p_match_id: ids.m1 });
    expect(fourth.ok, fourth.code).toBe(true);
    expect(fourth.data).toMatchObject({ match_status: 'booked', seats: [{ seat_no: 4, kind: 'account' }] });
    const { data: m } = await svc.from('matches').select('status, price_iqd, reservation_id').eq('id', ids.m1).single();
    const { data: res } = await svc.from('reservations')
      .select('court_id, guest_id, guest_name, kind, status, price_iqd').eq('id', (m as Json).reservation_id as string).single();
    ids.res = (m as Json).reservation_id as string;
    expect(res).toEqual({
      court_id: court, guest_id: null, guest_name: 'Open match', kind: 'booking', status: 'confirmed',
      price_iqd: (m as Json).price_iqd,
    });
  });

  it('a late leave holds the ticket; a refill gives it back (OM-11)', async () => {
    const left = await rpc(g.g2!.client, 'match_leave', { p_match_id: ids.m1 });
    expect(left.ok, left.code).toBe(true);
    expect(left.data).toMatchObject({ match_status: 'booked', tickets_locked: 1 });
    expect(left.data.left).toMatchObject([{ status: 'left_late' }]);
    expect(await wallet(g.g2!.id)).toEqual({ in_use: 1, available: 1 });
    const refill = await rpc(g.g4!.client, 'match_join', { p_match_id: ids.m1 });
    expect(refill.ok, refill.code).toBe(true);
    expect(refill.data).toMatchObject({ match_status: 'booked', refill: true });
    expect(await wallet(g.g2!.id)).toEqual({ available: 2 });
    expect(await wallet(g.g4!.id)).toEqual({ in_use: 1 });
  });

  it('approve mode: decline and withdraw give the ticket back; an approval seats at once', async () => {
    const started = await createTestMatch(g.g5!.client, { courtId: court, startAt: slot2, joinPolicy: 'approve', visibility: 'link' });
    ids.m2 = started.match_id;
    const token = started.share_token;
    const ask = async () => {
      const q = await rpc(g.g2!.client, 'match_request', { p_match_id: ids.m2, p_token: token });
      expect(q.ok, q.code).toBe(true);
      return q.data.request_id as string;
    };
    let q = await ask();
    expect(await wallet(g.g2!.id)).toEqual({ reserved: 1, available: 1 });
    expect((await rpc(g.g5!.client, 'match_decide', { p_request_id: q, p_approve: false })).data)
      .toMatchObject({ status: 'declined', tickets_released: 1 });
    q = await ask();
    expect((await rpc(g.g2!.client, 'match_withdraw', { p_request_id: q })).data).toMatchObject({ status: 'withdrawn' });
    q = await ask();
    const ok = await rpc(g.g5!.client, 'match_decide', { p_request_id: q, p_approve: true });
    expect(ok.ok, ok.code).toBe(true);
    expect(ok.data).toMatchObject({ status: 'approved', match_status: 'filling', seats: [{ seat_no: 2 }] });
    expect(await wallet(g.g2!.id)).toEqual({ in_use: 1, available: 1 });
    ids.q = q;
  });

  it('ends both: the organiser cancels the filling one; the venue cancels the booking of the other', async () => {
    expect((await rpc(g.g5!.client, 'match_cancel', { p_match_id: ids.m2, p_reason: 'other' })).data)
      .toMatchObject({ status: 'cancelled', duplicate: false });
    // The reservation trigger (0263) cancels a booked match with its booking.
    psql(`begin;
update reservations set status = 'cancelled', cancelled_at = now(), cancelled_by = 'staff',
                        cancellation_reason = 'm260 lifecycle test' where id = '${ids.res}';
commit;`);
    expect(psql(`select status || ':' || ended_reason from matches where id = '${ids.m1}';`))
      .toBe('cancelled:reservation_cancelled');
    for (const t of ['g1', 'g2', 'g3', 'g4', 'g5']) {
      const w = await wallet(g[t]!.id);
      expect(Object.keys(w), t).toEqual(['available']);
    }
  });
});

// ── 5. R41 across branches, two connections (committed) ──────────────────────

describe.skipIf(!docker)('R41 across branches: two joins over the same time by one guest (committed, two connections)', () => {
  it('the second join waits on the first one\'s ticket pick, then sees its seat: one seat, one MATCH_TIME_CLASH', async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const venues = [crypto.randomUUID(), crypto.randomUUID()];
    const courts = [crypto.randomUUID(), crypto.randomUUID()];
    const matches = [crypto.randomUUID(), crypto.randomUUID()];
    const guest = crypto.randomUUID();
    const desk = SEED_STAFF_IDS.court_desk;
    // Match 0 at branch 0, match 1 at branch 1 half an hour later: they overlap.
    const start = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 5 * 86_400_000);
    const atMin = (min: number) => `'${new Date(start.getTime() + min * 60_000).toISOString()}'::timestamptz`;
    const claims = JSON.stringify({ sub: guest, role: 'authenticated' });

    psql(`begin;
select set_config('request.jwt.claims', '', true);
${[0, 1].map((i) => `
insert into venues (id, slug, name_en, name_ar, timezone, is_active)
values ('${venues[i]}', 'm261-r41-${tag}-${i}', 'M261 R41 ${i}', 'فرع ${i}', 'Asia/Baghdad', true);
insert into venue_settings (venue_id, venue_name, opening_hours, matches_enabled)
select '${venues[i]}', 'M261 R41 ${i}', jsonb_object_agg(d, '[["00:00","24:00"]]'::jsonb), true
  from unnest(array['mon','tue','wed','thu','fri','sat','sun']) d;
insert into courts (id, venue_id, name_en, name_ar, duration_options, sort_order, is_active)
values ('${courts[i]}', '${venues[i]}', 'M261 R41 ${i}', 'ملعب', '{60,90,120}', 1, true);
insert into matches (id, venue_id, status, start_at, end_at, duration_min, visibility, join_policy, category,
                     price_iqd, shares_iqd, price_court_id, fill_deadline_at, share_token, organised_by,
                     created_by_staff_id)
values ('${matches[i]}', '${venues[i]}', 'filling', ${atMin(30 * i)}, ${atMin(30 * i + 90)}, 90, 'public', 'open',
        'open', 40000, '{10000,10000,10000,10000}', '${courts[i]}', ${atMin(30 * i - 120)},
        '${`${tag}r41m${i}`.padEnd(22, 'x')}', 'desk', '${desk}');
insert into match_seats (venue_id, match_id, seat_no, kind, guest_name, share_iqd, created_by_staff_id)
values ('${venues[i]}', '${matches[i]}', 1, 'desk', 'M261 walk-in', 10000, '${desk}');`).join('\n')}
insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('${guest}', 'm261-r41-${tag}@test.touch.local', '{"full_name":"Test R41"}', 'authenticated', 'authenticated');
update profiles set phone = '+9647700000041', terms_version = '2026-09-23', gender = 'female',
                    gender_set_at = now(), gender_set_by = 'guest'
 where id = '${guest}';
with p as (
  insert into booking_payments (venue_id, reservation_id, hold_id, guest_id, purpose, provider, sandbox, request_id,
                                amount_iqd, quoted_price_iqd, ticket_count, status, succeeded_at, deadline_at)
  values (null, null, null, '${guest}', 'ticket', 'fake', false, gen_random_uuid(), 20000, 10000, 2, 'succeeded',
          now(), now() + interval '15 minutes')
  returning id
), k as (
  insert into match_tickets (guest_id, status, price_iqd, purchase_payment_id, sandbox)
  select '${guest}', 'available', 10000, p.id, false from p, generate_series(1, 2)
  returning id, purchase_payment_id
)
insert into match_ticket_events (ticket_id, guest_id, type, payment_id)
select k.id, '${guest}', 'bought', k.purchase_payment_id from k;
commit;`);

    try {
      // Join 0 holds its transaction (the seat and both tickets locked) for
      // two seconds; join 1 starts meanwhile at the other branch, whose mutex
      // is free, so its unlocked R41 check cannot see join 0's seat yet.
      const first = psqlSession(`set application_name = 'm261-r41-first';
begin;
select set_config('request.jwt.claims', '${claims}', true);
select app.match_join('${matches[0]}', '[]'::jsonb, null)->>'duplicate';
select pg_sleep(2);
commit;`);
      await waitForSleeper('m261-r41-first');
      const second = psqlSession(`begin;
select set_config('request.jwt.claims', '${claims}', true);
create function pg_temp.try_join(p uuid) returns text language plpgsql as $f$
begin
  perform app.match_join(p, '[]'::jsonb, null);
  return 'ok';
exception when others then
  return sqlerrm;
end $f$;
select pg_temp.try_join('${matches[1]}');
commit;`);
      const [a, b] = await Promise.all([first, second]);
      expect(a.split('\n')).toContain('false');
      expect(b.split('\n').at(-1)).toBe('MATCH_TIME_CLASH');
      expect(psql(`select string_agg(m.id::text, ',') from match_seats s join matches m on m.id = s.match_id
                    where s.guest_id = '${guest}' and s.status = 'in';`)).toBe(matches[0]);
      expect(psql(`select string_agg(status, ',' order by status) from match_tickets where guest_id = '${guest}';`))
        .toBe('available,in_use');
    } finally {
      psql(`begin;
select set_config('request.jwt.claims', '', true);
select app.match_end('${matches[0]}', 'cancelled', 'staff_cancelled', 'system');
select app.match_end('${matches[1]}', 'cancelled', 'staff_cancelled', 'system');
update courts set is_active = false where id in ('${courts[0]}', '${courts[1]}');
update venue_settings set matches_enabled = false where venue_id in ('${venues[0]}', '${venues[1]}');
update venues set is_active = false where id in ('${venues[0]}', '${venues[1]}');
commit;`);
    }
  }, 30_000);
});
