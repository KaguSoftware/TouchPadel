/**
 * 0261: reports, blocks and quick messages (docs/design/open-matches/db.md
 * §4.6.10, §4.6.11, §8.2 item 6; guest.md §4.17; build contracts OM-17,
 * OM-27, R5, R43).
 *
 * One rolled-back scenario at a branch made inside the transaction, with the
 * seeded manager given that branch too, so the report push has a manager
 * and the owner to reach. Covers the target rules, duplicates, the rate
 * limits (10 reports a day, 12 messages a match, one repeat per 10 minutes),
 * the staff push (match_report_new, naming nobody; never for a sandbox
 * match), what a block refuses (joins and approvals, both ways) and unblock.
 */
import { describe, expect, it } from 'vitest';
import { SEED_STAFF_IDS, stackAvailable } from './helpers';
import { Q, X, dockerReachable, scenario, type Results } from './stores-harness';
import { E, GUEST, K, SETUP, START, at, data, failed } from './matches-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;

const KEPT = (name: string, label: string, path: string) =>
  K(name, `select res #>> '{data,${path}}' from pg_temp.out where label = '${label}'`);
const SEAT = (m: string, who: string, kind = 'account') =>
  `(select s.id from match_seats s where s.match_id = {{${m}}} and s.guest_id = {{${who}}} and s.kind = '${kind}' limit 1)`;
const REPORT = (m: string, reason: string, seat = 'null', request = 'null', block = 'false') =>
  `select app.match_report({{${m}}}, '${reason}', ${seat}, ${request}, ${block})`;
const BLOCK = (m: string, seat = 'null', request = 'null') => `select app.match_block({{${m}}}, ${seat}, ${request})`;
const MSG = (m: string, code: string) => `select app.match_post_message({{${m}}}, '${code}')`;

describe.skipIf(!docker)('0261 moderation: report, block, messages (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m260m', [
      SETUP,
      `select pg_temp.branch();`,
      X(`insert into staff_venues (staff_id, venue_id, role) values ('${SEED_STAFF_IDS.manager}', {{v}}, 'manager')`),
      GUEST('org', '{"given":"Zainab","family":"Khafaji","phone":"+9647711110001"}'),
      GUEST('p2', '{"given":"Noor","family":"Rubaie","phone":"+9647711110002"}'),
      GUEST('p3'), GUEST('req'), GUEST('stranger'), GUEST('rl'), GUEST('sb1', '{"sandbox":true}'),
      GUEST('sb2', '{"sandbox":true}'),
      ...['org', 'p2', 'p3', 'req', 'stranger', 'rl', 'sb1', 'sb2'].map((g) => `select pg_temp.tickets('${g}', 3);`),
      `select pg_temp.tickets('org', 1);`,

      // MP: an approve-mode match filled by approvals: org; p2; p3 with a
      // friend (booked at four). MQ: another of org's, with a typed walk-in the
      // desk seated and two pending requests (req, rl).
      E('start', 'org', START({ policy: 'approve', key: 'k-mod' })),
      KEPT('mp', 'start', 'match_id'),
      E('ask_p2', 'p2', `select app.match_request({{mp}})`),
      KEPT('q2', 'ask_p2', 'request_id'),
      E('ok_p2', 'org', `select app.match_decide({{q2}}, true)`),
      E('ask_p3', 'p3', `select app.match_request({{mp}}, '[{}]'::jsonb)`),
      KEPT('q3', 'ask_p3', 'request_id'),
      E('ok_p3', 'org', `select app.match_decide({{q3}}, true)`),
      E('start_q', 'org', START({ when: at(4), policy: 'approve', key: 'k-modq' })),
      KEPT('mq', 'start_q', 'match_id'),
      X(`insert into match_seats (venue_id, match_id, seat_no, kind, guest_name, share_iqd, created_by_staff_id)
         values ({{v}}, {{mq}}, 2, 'desk', 'Walk In', 10000, {{desk}})`),
      E('ask_req', 'req', `select app.match_request({{mq}})`),
      KEPT('qreq', 'ask_req', 'request_id'),
      E('ask_rl', 'rl', `select app.match_request({{mq}})`),
      K('other', `select pg_temp.m(jsonb_build_object('start_at', ${at(9)}, 'organiser_id', {{stranger}}))`),
      K('other_seat', `select pg_temp.seat({{other}}, 1, 'account', {{stranger}})`),
      E('state', 'org', `select pg_temp.state('mp')`),

      // Reports: the arguments, then every target rule.
      E('r_bad_reason', 'p2', REPORT('mp', 'rude', SEAT('mp', 'org'))),
      E('r_null_block', 'p2', `select app.match_report({{mp}}, 'other', ${SEAT('mp', 'org')}, null, null)`),
      E('r_both', 'org', REPORT('mq', 'other', SEAT('mq', 'org'), '{{qreq}}')),
      E('r_neither', 'p2', REPORT('mp', 'other')),
      E('r_elsewhere', 'p2', REPORT('mp', 'other', '{{other_seat}}')),
      E('r_stranger', 'stranger', REPORT('mp', 'other', SEAT('mp', 'org'))),
      E('r_self', 'p2', REPORT('mp', 'other', SEAT('mp', 'p2'))),
      E('r_request_not_org', 'rl', REPORT('mq', 'other', 'null', '{{qreq}}')),
      E('r_desk', 'org', REPORT('mq', 'other', `(select id from match_seats where match_id = {{mq}} and kind = 'desk')`)),
      E('r_unknown', 'p2', `select app.match_report('00000000-0000-4000-8000-000000000000', 'other', ${SEAT('mp', 'org')}, null, false)`),
      // A friend seat names its holder.
      E('r_friend', 'p2', REPORT('mp', 'no_show', SEAT('mp', 'p3', 'friend'))),
      Q('r_friend_row', `select jsonb_build_object('reported_is_p3', reported_id = {{p3}}, 'status', status, 'reason', reason)
                          from match_reports where reporter_id = {{p2}}`),
      Q('push', `select coalesce(jsonb_agg(jsonb_build_object('kind', o.kind, 'payload', o.payload,
                   'to', case o.profile_id when '${SEED_STAFF_IDS.owner}' then 'owner'
                                            when '${SEED_STAFF_IDS.manager}' then 'manager' else o.profile_id::text end)
                   order by o.profile_id), '[]'::jsonb)
                   from notification_outbox o where o.payload->>'title_key' = 'match_report_new'
                    and o.created_at = now()`),
      E('r_again', 'p2', REPORT('mp', 'harassment', SEAT('mp', 'p3'), 'null', 'true')),
      Q('block_after_again', `select to_jsonb(count(*)) from match_blocks where blocker_id = {{p2}} and blocked_id = {{p3}}`),
      // The organiser reports a requester.
      E('r_request', 'org', REPORT('mq', 'offensive_name', 'null', '{{qreq}}')),
      // RATE_LIMITED past ten reports a day.
      X(`insert into match_reports (venue_id, match_id, reporter_id, reported_id, request_id, reason)
         select {{v}}, {{mq}}, {{rl}}, pg_temp.guest('dummy' || i), {{qreq}}, 'other' from generate_series(1, 10) i`),
      E('r_limited', 'rl', REPORT('mq', 'other', SEAT('mq', 'org'))),
      // A sandbox match reports to nobody (D-10).
      E('sb_start', 'sb1', START({ when: at(5), key: 'k-sb-mod' })),
      KEPT('msb', 'sb_start', 'match_id'),
      E('sb_join', 'sb2', `select app.match_join({{msb}})`),
      E('r_sandbox', 'sb2', REPORT('msb', 'other', SEAT('msb', 'sb1'))),
      Q('push_sandbox', `select to_jsonb(count(*)) from notification_outbox o
                          where o.payload->>'title_key' = 'match_report_new'
                            and o.payload->>'id' = (select res #>> '{data,report_id}' from pg_temp.out where label = 'r_sandbox')`),

      // Blocks.
      E('b_desk', 'org', BLOCK('mq', `(select id from match_seats where match_id = {{mq}} and kind = 'desk')`)),
      E('b_self', 'org', BLOCK('mp', SEAT('mp', 'org'))),
      E('b_null', 'org', `select app.match_block(null, null, null)`),
      E('b_p2', 'org', BLOCK('mp', SEAT('mp', 'p2'))),
      KEPT('block_org_p2', 'b_p2', 'block_id'),
      E('b_again', 'org', BLOCK('mp', SEAT('mp', 'p2'))),
      E('blocks_org', 'org', `select app.my_match_blocks()`),
      // A block refuses future joins both ways, and an approval.
      E('p2_starts', 'p2', START({ when: at(7), key: 'k-p2m' })),
      KEPT('mp2', 'p2_starts', 'match_id'),
      E('org_joins_p2', 'org', `select app.match_join({{mp2}}, '[]'::jsonb, (select share_token from matches where id = {{mp2}}))`),
      E('org_starts', 'org', START({ when: at(8), policy: 'approve', key: 'k-orgm' })),
      KEPT('mo', 'org_starts', 'match_id'),
      E('p2_joins_org', 'p2', `select app.match_request({{mo}}, '[]'::jsonb, (select share_token from matches where id = {{mo}}))`),
      E('stranger_asks', 'stranger', `select app.match_request({{mo}})`),
      KEPT('qs', 'stranger_asks', 'request_id'),
      X(`insert into match_blocks (blocker_id, blocked_id) values ({{stranger}}, {{org}})`),
      E('approve_blocked', 'org', `select app.match_decide({{qs}}, true)`),
      // Unblock: only one's own.
      E('unblock_other', 'p2', `select app.match_unblock({{block_org_p2}})`),
      E('unblock', 'org', `select app.match_unblock({{block_org_p2}})`),
      E('unblock_again', 'org', `select app.match_unblock({{block_org_p2}})`),
      E('org_joins_p2_after', 'org', `select app.match_join({{mp2}}, '[]'::jsonb, (select share_token from matches where id = {{mp2}}))`),

      // Messages.
      E('m_bad', 'p2', MSG('mp', 'hello')),
      E('m_stranger', 'stranger', MSG('mp', 'on_my_way')),
      E('m_requester', 'req', MSG('mq', 'on_my_way')),
      E('m_first', 'p2', MSG('mp', 'on_my_way')),
      E('m_repeat', 'p2', MSG('mp', 'on_my_way')),
      E('m_other_code', 'p2', MSG('mp', 'running_late')),
      E('m_organiser', 'org', MSG('mp', 'bring_balls')),
      X(`insert into match_events (venue_id, match_id, type, actor, actor_guest_id, code, at)
         select {{v}}, {{mp}}, 'message', 'guest', {{p3}}, 'cant_make_it', now() - make_interval(hours => i)
           from generate_series(1, 12) i`),
      E('m_limited', 'p3', MSG('mp', 'on_my_way')),
      E('m_cancel', 'org', `select app.match_cancel({{mo}})`),
      E('m_closed', 'org', MSG('mo', 'on_my_way')),
      E('detail', 'p2', `select app.match_detail({{mp}})`),
    ]);
  });

  it('a report names a player of this match, from a participant, never oneself or a typed walk-in', () => {
    expect(data<Json>(r, 'state')).toMatchObject({ match: { status: 'booked' }, requests: [{ status: 'approved' }, { status: 'approved' }] });
    expect(failed(r, 'r_bad_reason')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_reason' });
    expect(failed(r, 'r_null_block')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_block' });
    for (const label of ['r_both', 'r_neither', 'r_elsewhere', 'r_stranger', 'r_self', 'r_request_not_org', 'r_desk', 'r_unknown']) {
      expect(failed(r, label).code, label).toBe('REPORT_TARGET_INVALID');
    }
    expect(data<Json>(r, 'r_friend')).toMatchObject({ duplicate: false, blocked: false });
    expect(data(r, 'r_friend_row')).toEqual({ reported_is_p3: true, status: 'open', reason: 'no_show' });
    expect(data<Json>(r, 'r_request')).toMatchObject({ duplicate: false });
  });

  it('the branch\'s manager and owner hear of it (match_report_new, R43); the push names nobody', () => {
    const rows = data<Json[]>(r, 'push');
    const id = data<Json>(r, 'r_friend').report_id as string;
    const mine = rows.filter((x) => (x.payload as Json).id === id);
    expect(mine.map((x) => x.to).sort()).toEqual(['manager', 'owner']);
    for (const x of mine) {
      expect(x.kind).toBe('staff_info');
      expect(x.payload).toEqual({ route: 'staff', id, title_key: 'match_report_new', params: {}, dedupe: `match_report:${id}` });
    }
    expect(JSON.stringify(rows)).not.toMatch(/Zainab|Noor|Khafaji|Rubaie|7711110/);
    expect(data(r, 'push_sandbox')).toBe(0);
  });

  it('the same report again is a duplicate (a block asked for now is still added); ten a day at most', () => {
    const again = data<Json>(r, 'r_again');
    expect(again).toMatchObject({ duplicate: true, blocked: true, report_id: data<Json>(r, 'r_friend').report_id });
    expect(data(r, 'block_after_again')).toBe(1);
    expect(failed(r, 'r_limited').code).toBe('RATE_LIMITED');
  });

  it('a block: the target rules, once per pair, listed by name, and only its owner removes it', () => {
    expect(failed(r, 'b_desk').code).toBe('BLOCK_TARGET_INVALID');
    expect(failed(r, 'b_self').code).toBe('BLOCK_TARGET_INVALID');
    expect(failed(r, 'b_null')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_match_id' });
    expect(data<Json>(r, 'b_p2')).toMatchObject({ duplicate: false });
    expect(data<Json>(r, 'b_again')).toMatchObject({ duplicate: true, block_id: data<Json>(r, 'b_p2').block_id });
    expect(data<Json[]>(r, 'blocks_org').map((b) => [b.name, b.former])).toEqual([['Noor R.', false]]);
    expect(data(r, 'unblock_other')).toEqual({ unblocked: false });
    expect(data(r, 'unblock')).toEqual({ unblocked: true });
    expect(data(r, 'unblock_again')).toEqual({ unblocked: false });
  });

  it('a block refuses joins and requests both ways, and an approval (REQUESTER_INELIGIBLE)', () => {
    expect(failed(r, 'org_joins_p2').code).toBe('MATCH_UNAVAILABLE');
    expect(failed(r, 'p2_joins_org').code).toBe('MATCH_UNAVAILABLE');
    expect(failed(r, 'approve_blocked')).toMatchObject({ code: 'REQUESTER_INELIGIBLE', detail: 'MATCH_UNAVAILABLE' });
    // Unblocked, the join goes through.
    expect(data<Json>(r, 'org_joins_p2_after')).toMatchObject({ duplicate: false, match_status: 'filling' });
  });

  it('messages: preset codes only, carriers and the organiser, one repeat per 10 minutes, 12 a match', () => {
    expect(failed(r, 'm_bad')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_code' });
    expect(failed(r, 'm_stranger').code).toBe('MATCH_NOT_FOUND');
    expect(failed(r, 'm_requester').code).toBe('FORBIDDEN');
    expect(data<Json>(r, 'm_first')).toMatchObject({ duplicate: false });
    expect(data<Json>(r, 'm_repeat')).toMatchObject({ duplicate: true, event_id: data<Json>(r, 'm_first').event_id });
    expect(data<Json>(r, 'm_other_code')).toMatchObject({ duplicate: false });
    expect(data<Json>(r, 'm_organiser')).toMatchObject({ duplicate: false });
    expect(failed(r, 'm_limited').code).toBe('RATE_LIMITED');
    expect(failed(r, 'm_closed').code).toBe('MATCH_CLOSED');
    const d = data<Json>(r, 'detail');
    const codes = (d.messages as Json[]).map((m) => m.code);
    expect(codes).toHaveLength(15);
    expect(codes.slice(-3)).toEqual(['on_my_way', 'running_late', 'bring_balls']);
    expect((d.me as Json).can).toMatchObject({ message: true, report: true, block: true });
  });
});
