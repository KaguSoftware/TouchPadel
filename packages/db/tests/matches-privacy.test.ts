/**
 * 0261: what the guest reads may say about other people (docs/design/
 * open-matches/db.md §4.5.2, §4.6.12, §7; guest.md §4.3; build contracts
 * OM-26, OM-31, DF-9, DF-10, R31, R32).
 *
 * One rolled-back scenario at a branch made inside the transaction. Every
 * guest read (match_detail full and restricted, open_matches, my_matches,
 * my_match_blocks, match_quote, match_slots signed in and anon, match_invite)
 * is scanned for phones, full names, family names and profile ids; names
 * appear only as "First I." (or "Former player" for a deleted account).
 * Then who sees what: DF-10 (the other gender, an unset gender), a link match
 * versus a public one, blocks either way, a banned organiser, a banned viewer,
 * and the invite's closed answers.
 */
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { Q, X, dockerReachable, scenario, type Results } from './stores-harness';
import { E, GUEST, K, SETUP, START, at, data, failed } from './matches-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;

const PEOPLE = {
  org: '{"given":"Zainab","family":"Al-Khafaji","phone":"+9647711110001"}',
  p2: '{"given":"Noor","family":"Rubaie-Unique","phone":"+9647711110002"}',
  p3: '{"given":"هدى","family":"آل ياسين","phone":"+9647711110003"}',
  gone: '{"given":"Layla","family":"Departed","phone":"+9647711110005"}',
  viewer: '{"given":"Maryam","family":"Qassab","phone":"+9647711110004"}',
  man: '{"given":"Ali","family":"Hamdani","phone":"+9647711110006","gender":"male"}',
  unset: '{"given":"Sama","family":"Unsetova","phone":"+9647711110007","gender":null}',
  blocker: '{"given":"Rana","family":"Blockwell","phone":"+9647711110008"}',
  blocked: '{"given":"Dima","family":"Blockedova","phone":"+9647711110009"}',
  org2: '{"given":"Suha","family":"Bannedova","phone":"+9647711110010"}',
  bannedv: '{"given":"Rasha","family":"Outcast","phone":"+9647711110011"}',
} as const;
const FAMILY = ['Khafaji', 'Rubaie-Unique', 'ياسين', 'Departed', 'Qassab', 'Hamdani', 'Unsetova', 'Blockwell',
  'Blockedova', 'Bannedova', 'Outcast'];
const FULL = ['Test org', 'Test p2', 'Test viewer', 'Zainab Al-Khafaji', 'Noor Rubaie-Unique'];

const READ = (label: string, who: string | null, sql: string) => E(label, who, sql);
const TOKEN = (m: string) => `(select share_token from matches where id = {{${m}}})`;
const KEPT = (name: string, label: string, path: string) =>
  K(name, `select res #>> '{data,${path}}' from pg_temp.out where label = '${label}'`);

describe.skipIf(!docker)('0261 privacy: no phone, full name, family name or other person\'s id in any guest read', () => {
  let r: Results;
  let ids: Record<string, string>;

  it('runs the scenario', () => {
    r = scenario('m260p', [
      SETUP,
      `select pg_temp.branch();`,
      ...Object.entries(PEOPLE).map(([name, p]) => GUEST(name, p)),
      ...Object.keys(PEOPLE).map((g) => `select pg_temp.tickets('${g}', 2);`),

      // MP: a public women's instant match, 3/4 with a former player.
      E('start_mp', 'org', START({ category: 'women', key: 'k-mp' })),
      KEPT('mp', 'start_mp', 'match_id'),
      E('j_p2', 'p2', `select app.match_join({{mp}})`),
      E('j_gone', 'gone', `select app.match_join({{mp}})`),
      E('msg_gone', 'gone', `select app.match_post_message({{mp}}, 'on_my_way')`),
      E('msg_p2', 'p2', `select app.match_post_message({{mp}}, 'bring_balls')`),
      X(`update profiles set deleted_at = now() where id = {{gone}}`),
      // MW: a women's approve-mode match with a pending request.
      E('start_mw', 'org', START({ when: at(5), category: 'women', policy: 'approve', key: 'k-mw' })),
      KEPT('mw', 'start_mw', 'match_id'),
      E('ask_p3', 'p3', `select app.match_request({{mw}})`),
      // ML: a link-only match.
      E('start_ml', 'p2', START({ when: at(7), visibility: 'link', key: 'k-ml' })),
      KEPT('ml', 'start_ml', 'match_id'),
      // A block for my_match_blocks.
      X(`insert into match_blocks (blocker_id, blocked_id) values ({{blocker}}, {{blocked}})`),

      // The reads, as a stranger, a participant, the organiser, anon.
      READ('d_viewer', 'viewer', `select app.match_detail({{mp}})`),
      READ('d_org', 'org', `select app.match_detail({{mp}})`),
      READ('d_org_mw', 'org', `select app.match_detail({{mw}})`),
      READ('d_p2', 'p2', `select app.match_detail({{mp}})`),
      READ('d_token', 'viewer', `select app.match_detail(null, ${TOKEN('ml')})`),
      READ('list_viewer', 'viewer', `select app.open_matches({{v}}, now(), now() + interval '16 days')`),
      READ('list_unset', 'unset', `select app.open_matches({{v}}, now(), now() + interval '16 days')`),
      READ('mine_p2', 'p2', `select app.my_matches('upcoming')`),
      READ('mine_past', 'p2', `select app.my_matches('past')`),
      READ('blocks', 'blocker', `select app.my_match_blocks()`),
      READ('quote', 'viewer', `select app.match_quote({{v}}, {{c1}}, ${at(3)}, 90)`),
      READ('slots_viewer', 'viewer', `select app.match_slots({{v}}, now(), now() + interval '16 days')`),
      READ('slots_anon', null, `select app.match_slots({{v}}, now(), now() + interval '16 days')`),
      READ('invite', null, `select app.match_invite(${TOKEN('mp')})`),
      READ('invite_signed_in', 'man', `select app.match_invite(${TOKEN('mp')})`),

      // DF-10: a declared man, an unset gender.
      READ('list_man', 'man', `select app.open_matches({{v}}, now(), now() + interval '16 days')`),
      READ('slots_man', 'man', `select app.match_slots({{v}}, now(), now() + interval '16 days')`),
      READ('d_man_id', 'man', `select app.match_detail({{mp}})`),
      READ('d_man_token', 'man', `select app.match_detail(null, ${TOKEN('mp')})`),
      READ('d_unset', 'unset', `select app.match_detail({{mp}})`),

      // Token versus public.
      READ('d_link_by_id', 'viewer', `select app.match_detail({{ml}})`),
      READ('d_link_both', 'viewer', `select app.match_detail({{ml}}, ${TOKEN('ml')})`),
      READ('invite_link', null, `select app.match_invite(${TOKEN('ml')})`),

      // Blocks either way: the viewer blocks a carrier; the organiser blocks another viewer.
      X(`insert into match_blocks (blocker_id, blocked_id) values ({{viewer}}, {{p2}})`),
      X(`insert into match_blocks (blocker_id, blocked_id) values ({{org}}, {{blocked}})`),
      READ('list_blocking', 'viewer', `select app.open_matches({{v}}, now(), now() + interval '16 days')`),
      READ('slots_blocking', 'viewer', `select app.match_slots({{v}}, now(), now() + interval '16 days')`),
      READ('d_blocking_token', 'viewer', `select app.match_detail(null, ${TOKEN('mp')})`),
      READ('list_blocked', 'blocked', `select app.open_matches({{v}}, now(), now() + interval '16 days')`),
      READ('d_blocked_token', 'blocked', `select app.match_detail(null, ${TOKEN('mp')})`),
      READ('join_blocked', 'blocked', `select app.match_join({{mp}}, '[]'::jsonb, ${TOKEN('mp')})`),

      // A banned organiser's match; a banned viewer.
      `select pg_temp.ban('org2');`,
      K('mb', `select pg_temp.m(jsonb_build_object('start_at', ${at(9)}, 'organiser_id', {{org2}}))`),
      X(`select pg_temp.seat({{mb}}, 1, 'account', {{org2}})`),
      READ('list_banned_org', 'unset', `select app.open_matches({{v}}, ${at(8)}, ${at(10)})`),
      READ('d_banned_org_token', 'unset', `select app.match_detail(null, ${TOKEN('mb')})`),
      `select pg_temp.ban('bannedv');`,
      READ('list_banned_viewer', 'bannedv', `select app.open_matches({{v}}, now(), now() + interval '16 days')`),
      READ('d_banned_viewer', 'bannedv', `select app.match_detail(null, ${TOKEN('mp')})`),

      // The invite answers closed for every miss, and nothing else.
      READ('inv_malformed', null, `select app.match_invite('not-a-token')`),
      READ('inv_unknown', null, `select app.match_invite('AAAAAAAAAAAAAAAAAAAAAA')`),
      READ('inv_null', null, `select app.match_invite(null)`),
      K('msb', `select pg_temp.m(jsonb_build_object('start_at', ${at(11)}, 'sandbox', true, 'organiser_id', {{viewer}}))`),
      READ('inv_sandbox', null, `select app.match_invite(${TOKEN('msb')})`),
      K('mx', `select pg_temp.m(jsonb_build_object('start_at', ${at(12)}, 'status', 'cancelled', 'ended_at', now(),
                'ended_reason', 'organiser_cancelled'))`),
      READ('inv_ended', null, `select app.match_invite(${TOKEN('mx')})`),
      X(`update venue_settings set matches_enabled = false where venue_id = {{v}}`),
      READ('inv_off', null, `select app.match_invite(${TOKEN('mp')})`),
      READ('slots_off', null, `select app.match_slots({{v}}, now(), now() + interval '16 days')`),
      X(`update venue_settings set matches_enabled = true where venue_id = {{v}}`),
      X(`update venues set is_active = false where id = {{v}}`),
      READ('inv_closed_branch', null, `select app.match_invite(${TOKEN('mp')})`),
      READ('list_closed_branch', 'viewer', `select app.open_matches({{v}}, now(), now() + interval '16 days')`),
      X(`update venues set is_active = true where id = {{v}}`),
      READ('window', 'viewer', `select app.open_matches({{v}}, now(), now() + interval '17 days')`),
      READ('slots_window', null, `select app.match_slots({{v}}, now(), now() + interval '17 days')`),
      Q('ids', `select jsonb_object_agg(v.name, v.val) from pg_temp.vars v
                 where v.name in (${Object.keys(PEOPLE).map((p) => `'${p}'`).join(', ')}, 'mp', 'mw', 'ml')`),
    ]);
    ids = data<Record<string, string>>(r, 'ids');
  });

  /** Every read, as text: no phone, no family or full name, no profile id. */
  it('no read carries a phone, a full or family name, or a profile id', () => {
    const reads = ['d_viewer', 'd_org', 'd_org_mw', 'd_p2', 'd_token', 'list_viewer', 'list_unset', 'mine_p2', 'mine_past',
      'blocks', 'quote', 'slots_viewer', 'slots_anon', 'invite', 'invite_signed_in', 'list_man', 'slots_man', 'd_man_token',
      'd_unset', 'd_link_both', 'invite_link', 'list_blocking', 'slots_blocking', 'd_blocking_token', 'list_blocked',
      'd_blocked_token', 'list_banned_org', 'd_banned_org_token', 'list_banned_viewer', 'd_banned_viewer'];
    for (const label of reads) {
      const text = JSON.stringify(data(r, label));
      expect(text, label).not.toMatch(/7711110|\+964/);
      for (const f of FAMILY) expect(text, `${label}: ${f}`).not.toContain(f);
      for (const f of FULL) expect(text, `${label}: ${f}`).not.toContain(f);
      for (const [who, id] of Object.entries(ids)) {
        if (['mp', 'mw', 'ml'].includes(who)) continue;
        expect(text, `${label}: the id of ${who}`).not.toContain(id);
      }
    }
  });

  it('names read "First I." (Arabic included) and a deleted account "Former player" (OM-26)', () => {
    const d = data<Json>(r, 'd_viewer');
    expect(d.organiser).toEqual({ name: 'Zainab K.', former: false, is_me: false });
    const seats = d.seats as Json[];
    expect(seats.map((s) => [s.seat_no, s.name, s.former])).toEqual([
      [1, 'Zainab K.', false], [2, 'Noor R.', false], [3, null, true],
    ]);
    for (const s of seats) expect(Object.keys(s).sort()).toEqual([
      'can', 'former', 'holder_seat_no', 'is_me', 'is_mine', 'kind', 'name', 'open', 'seat_id', 'seat_no', 'share_iqd', 'status',
    ]);
    // A stranger reads no messages; the players do, names as seats read them.
    expect(d.messages).toEqual([]);
    const msgs = data<Json>(r, 'd_p2').messages as Json[];
    expect(msgs.map((m) => [m.code, m.name, m.former, m.is_me])).toEqual([
      ['on_my_way', null, true, false], ['bring_balls', 'Noor R.', false, true],
    ]);
    // The organiser's request list (OM-41) names the requester the same way.
    const reqs = data<Json>(r, 'd_org_mw').requests as Json[];
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ name: 'هدى ي.', former: false, seats_requested: 1, games_played: 0, no_shows: 0 });
    expect(Object.keys(reqs[0]!).sort()).toEqual([
      'created_at', 'former', 'friend_genders', 'games_played', 'name', 'no_shows', 'request_id', 'seats_requested',
    ]);
    // Only the organiser and seated players get the share token.
    expect(d.share_token).toBeNull();
    expect(data<Json>(r, 'd_org').share_token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(data<Json>(r, 'd_p2').share_token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(data<Json[]>(r, 'blocks').map((b) => [b.name, b.former])).toEqual([['Dima B.', false]]);
  });

  it('open_matches, match_slots and match_invite carry no names or ids of people (D13, D14, DF-9)', () => {
    const list = data<Json>(r, 'list_viewer');
    expect(list.banned).toBe(false);
    const rows = list.matches as Json[];
    expect(rows.map((m) => m.match_id)).toEqual([ids.mp, ids.mw]);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        'category', 'duration_min', 'end_at', 'fill_deadline_at', 'join_policy', 'match_id', 'mine', 'refill',
        'seats_left', 'seats_taken', 'share_iqd', 'start_at', 'status',
      ]);
    }
    expect(rows[0]).toMatchObject({ seats_taken: 3, seats_left: 1, mine: null, share_iqd: 10000, refill: false });
    for (const label of ['slots_viewer', 'slots_anon']) {
      for (const row of data<Json[]>(r, label)) {
        expect(Object.keys(row).sort(), label).toEqual(['category', 'duration_min', 'end_at', 'join_policy', 'mine', 'seats_left', 'start_at']);
      }
    }
    expect(data<Json[]>(r, 'slots_anon').map((s) => s.mine)).toEqual([false, false]);
    for (const label of ['invite', 'invite_signed_in', 'invite_link']) {
      const inv = data<Json>(r, label);
      expect(Object.keys(inv).sort(), label).toEqual(['category', 'end_at', 'join_policy', 'seats_left', 'start_at', 'status', 'timezone', 'venue']);
      expect(inv.venue).toEqual({ name_en: 'M260 branch', name_ar: 'فرع ٢٦٠' });
    }
    expect(data<Json>(r, 'invite')).toMatchObject({ status: 'open', seats_left: 1, category: 'women', timezone: 'Asia/Baghdad' });
  });

  it('DF-10: a declared man does not see a women\'s match; by its link he gets the restricted card; unset sees it', () => {
    const listed = (label: string) => (data<Json>(r, label).matches as Json[]).map((m) => m.match_id);
    expect(listed('list_man')).toEqual([]);
    expect(data<Json[]>(r, 'slots_man')).toEqual([]);
    expect(data<Json[]>(r, 'slots_anon')).toHaveLength(2);
    expect(listed('list_unset')).toEqual([ids.mp, ids.mw]);
    expect(failed(r, 'd_man_id').code).toBe('MATCH_NOT_FOUND');
    const card = data<Json>(r, 'd_man_token');
    expect(Object.keys(card).sort()).toEqual([
      'category', 'duration_min', 'end_at', 'join_policy', 'me', 'restricted', 'seats_left', 'server_now', 'start_at',
      'status', 'timezone', 'venue',
    ]);
    expect(card).toMatchObject({ restricted: true, category: 'women', seats_left: 1, me: { refusal: 'MATCH_GENDER_MISMATCH' } });
    // An unset gender sees both and is asked inline.
    expect((data<Json>(r, 'd_unset').me as Json).refusal).toBe('GENDER_REQUIRED');
  });

  it('a link match is found only by its token; the full shape then', () => {
    const listed = (data<Json>(r, 'list_viewer').matches as Json[]).map((m) => m.match_id);
    expect(listed).not.toContain(ids.ml);
    expect(failed(r, 'd_link_by_id').code).toBe('MATCH_NOT_FOUND');
    expect(data<Json>(r, 'd_token')).toMatchObject({ id: ids.ml, visibility: 'link', me: { role: 'viewer', refusal: null } });
    expect(data<Json>(r, 'd_link_both')).toMatchObject({ id: ids.ml });
    expect(data<Json>(r, 'invite_link')).toMatchObject({ status: 'open', seats_left: 3 });
  });

  it('blocks work both ways, a banned organiser hides the match, a banned viewer sees none', () => {
    const listed = (label: string) => (data<Json>(r, label).matches as Json[]).map((m) => m.match_id);
    expect(listed('list_blocking')).not.toContain(ids.mp);
    expect(data<Json[]>(r, 'slots_blocking')).toHaveLength(1);
    expect(data<Json>(r, 'd_blocking_token')).toMatchObject({ restricted: true, me: { refusal: 'MATCH_UNAVAILABLE' } });
    expect(listed('list_blocked')).not.toContain(ids.mp);
    expect(data<Json>(r, 'd_blocked_token')).toMatchObject({ restricted: true, me: { refusal: 'MATCH_UNAVAILABLE' } });
    expect(failed(r, 'join_blocked').code).toBe('MATCH_UNAVAILABLE');
    expect(listed('list_banned_org')).toEqual([]);
    expect(data<Json>(r, 'd_banned_org_token')).toMatchObject({ restricted: true, me: { refusal: 'MATCH_UNAVAILABLE' } });
    expect(data<Json>(r, 'list_banned_viewer')).toEqual({ banned: true, matches: [] });
    expect(data<Json>(r, 'd_banned_viewer')).toMatchObject({ restricted: true, me: { refusal: 'MATCH_BANNED' } });
  });

  it('the invite is no oracle: every miss is {"status":"closed"} alone (DF-9)', () => {
    for (const label of ['inv_malformed', 'inv_unknown', 'inv_null', 'inv_sandbox', 'inv_ended', 'inv_off', 'inv_closed_branch']) {
      expect(data(r, label), label).toEqual({ status: 'closed' });
    }
    expect(data(r, 'slots_off')).toEqual([]);
    expect(data(r, 'list_closed_branch')).toEqual({ banned: false, matches: [] });
    expect(failed(r, 'window')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_to' });
    expect(failed(r, 'slots_window')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_to' });
  });

  it('my_matches: the caller\'s own rows, the §4.3 keys', () => {
    const rows = data<Json[]>(r, 'mine_p2');
    expect(rows.map((m) => m.match_id).sort()).toEqual([ids.mp, ids.ml].sort());
    const mp = rows.find((m) => m.match_id === ids.mp)!;
    expect(Object.keys(mp).sort()).toEqual([
      'category', 'court_id', 'duration_min', 'end_at', 'ended_reason', 'fill_deadline_at', 'is_organiser', 'join_policy',
      'match_id', 'my_role', 'my_seats', 'my_tickets', 'request', 'seats_taken', 'start_at', 'status', 'venue_id', 'visibility',
    ]);
    expect(mp).toMatchObject({ my_role: 'player', is_organiser: false, request: null, my_tickets: { locked: 1, released: 0, forfeited: 0 } });
    expect((mp.my_seats as Json[])[0]).toMatchObject({ seat_no: 2, kind: 'account', status: 'in', ticket_status: 'in_use' });
    expect(data(r, 'mine_past')).toEqual([]);
  });
});
