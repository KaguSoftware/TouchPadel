/**
 * 03XX account_identity and 03XX profiles_phone_unique (loyalty contracts
 * §1.1–1.2; plan §3.1–3.3): one account per person.
 *
 * Every case is one rolled-back psql transaction (stores-harness `scenario`)
 * over the open-match and tournament plant (or the coaching one for a lesson
 * place), so nothing here is committed:
 *
 * - the merge: an email account and a desk walk-in folded into a phone
 *   account through app.merge_accounts (owner, manager-PIN grant), with their
 *   bookings, match seats and tickets, tournament entry, notes and flags moved,
 *   the unique scopes resolved, the drops tombstoned and banned, and the auth
 *   email and Google identity carried over;
 * - the refusals: staff with staff, a staff drop, coach with coach;
 * - the one-time run (app.merge_duplicates_internal, what the migration's DO
 *   block calls) over a planted email + phone + walk-in group and a staff pair
 *   with one number, after which the unique index builds;
 * - the index, PHONE_TAKEN on a guest's edit, and handle_new_user storing NULL
 *   instead of failing, or claiming a desk walk-in on a confirmed number;
 * - 0307 identity_hardening: a phone is a key only when proven (the account's
 *   confirmed auth phone, or a desk walk-in), so a typed number never blocks
 *   its owner or answers PHONE_TAKEN; a confirmed phone claims a desk walk-in
 *   that never signed in, without its name, notes or flags; logins move only
 *   between proven accounts and never onto a staff keep; the push token never
 *   moves; the drop's auth row is emptied; a tournament both accounts entered
 *   keeps the live, paid entry; the one-time run raises any error that is not
 *   MERGE_REFUSED;
 * - THE FK-COVERAGE GUARD: every foreign key to profiles or auth.users must be
 *   named by app.profile_merge_columns(). A new table with such a column fails
 *   here until the merge knows what to do with it.
 */
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { dockerReachable, KEEP, psql, Q, scenario, T, X, type Results } from './stores-harness';
import { at, E, GUEST } from './matches-harness';
import { KEY, PUBLISH, RUN, TOUR_BRANCH, TOUR_SETUP } from './tournaments-plant';
import { SETUP as COACH_SETUP, at as cAt } from './coaching-core-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Row = Record<string, unknown>;

/** Accounts as GoTrue makes them, planted as postgres (handle_new_user makes each profile). */
const ACCOUNTS = String.raw`
create function pg_temp.rphone() returns text language sql as $f$
  select '+9647' || lpad((floor(random() * 1e9))::bigint::text, 9, '0')
$f$;

create function pg_temp.keepid(p_name text, v uuid) returns uuid language plpgsql as $f$
begin
  insert into pg_temp.vars values (p_name, v::text) on conflict (name) do update set val = excluded.val;
  insert into pg_temp.guests values (v) on conflict do nothing;
  return v;
end $f$;

-- A phone sign-up: no email, the number confirmed (digits without '+').
create function pg_temp.phone_user(p_name text, p_phone text, p_confirmed boolean default true)
returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', '', true);
  insert into auth.users (id, phone, phone_confirmed_at, raw_user_meta_data, aud, role, created_at)
  values (v, app.phone_digits(p_phone), case when p_confirmed then now() end, '{}'::jsonb,
          'authenticated', 'authenticated', now());
  return pg_temp.keepid(p_name, v);
end $f$;

-- An email account (confirmed) that typed its phone at sign-up, with a Google identity.
create function pg_temp.email_user(p_name text, p_phone text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid(); v_email text := 'merge-' || p_name || '-' || v || '@test.touch.local';
begin
  perform set_config('request.jwt.claims', '', true);
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, aud, role, created_at)
  values (v, v_email, now(), jsonb_build_object('full_name', 'Email ' || p_name, 'phone', p_phone),
          'authenticated', 'authenticated', now());
  insert into auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
  values (gen_random_uuid(), v::text, v, jsonb_build_object('sub', v::text, 'email', v_email), 'email', now(), now()),
         (gen_random_uuid(), 'g-' || v, v, jsonb_build_object('sub', 'g-' || v, 'email', v_email), 'google', now(), now());
  return pg_temp.keepid(p_name, v);
end $f$;

-- A desk walk-in (desk-customer-create): <digits>@guest.touch.local (or the real address the
-- desk typed, p_email), the phone typed by staff, and desk_register_customer's customer.create
-- audit row: the server-side proof (0307 app.profile_is_desk_walkin) that keys its phone.
create function pg_temp.walkin(p_name text, p_phone text, p_email text default null) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
        v_email text := coalesce(p_email, app.phone_digits(p_phone) || '-' || substr(v::text, 1, 4) || '@guest.touch.local');
begin
  perform set_config('request.jwt.claims', '', true);
  insert into audit_log (actor_id, actor_role, action, entity, entity_id, after)
  values (pg_temp.var('desk')::uuid, 'court_desk', 'customer.create', 'profiles', v::text, '{"source":"desk"}');
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, aud, role, created_at)
  values (v, v_email, now(),
          jsonb_build_object('full_name', 'Walk In ' || p_name, 'phone', p_phone),
          'authenticated', 'authenticated', now());
  -- admin.createUser gives the synthetic address its email identity too.
  insert into auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
  values (gen_random_uuid(), v::text, v, jsonb_build_object('sub', v::text, 'email', v_email), 'email', now(), now());
  return pg_temp.keepid(p_name, v);
end $f$;

create function pg_temp.pin_grant() returns void language sql as $f$
  insert into app.pin_grants (caller_id, authorizer_id)
  values (pg_temp.var('owner')::uuid, pg_temp.var('manager')::uuid)
$f$;
`;

function ok<T = Row>(r: Results, label: string): T {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label}: ${o!.code ?? ''} ${o!.detail ?? ''} ${o!.hint ?? ''}`).toBe(true);
  return o!.data as T;
}

/** A refusal as CODE, or CODE:detail. */
function refused(r: Results, label: string): string {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label} was expected to fail: ${JSON.stringify(o!.data)}`).toBe(false);
  return o!.detail ? `${o!.code}:${o!.detail}` : o!.code!;
}

describe.skipIf(!docker)('03XX account identity: the FK-coverage guard', () => {
  it('every foreign key to profiles or auth.users is named by app.profile_merge_columns()', () => {
    const unhandled = JSON.parse(
      psql(`select coalesce(json_agg(x order by x.sch, x.tbl, x.col), '[]') from (
              select n.nspname as sch, c.relname as tbl, a.attname as col
                from pg_constraint k
                join pg_class c on c.oid = k.conrelid
                join pg_namespace n on n.oid = c.relnamespace
                join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
               where k.contype = 'f'
                 and k.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
              except
              select m.sch, m.tbl, m.col from app.profile_merge_columns() m) x`),
    ) as Row[];
    // A new table pointing at an account: add it to app.profile_merge_columns()
    // (repoint, or rule with its own statement in app.merge_profiles_internal).
    expect(unhandled).toEqual([]);
  });

  it('every rule column has its own statement in the merge, and every how is known', () => {
    const r = JSON.parse(
      psql(`select json_build_object(
              'rules', (select json_agg(distinct m.tbl) from app.profile_merge_columns() m where m.how = 'rule'),
              'hows', (select json_agg(distinct m.how) from app.profile_merge_columns() m),
              'body', (select p.prosrc from pg_proc p where p.oid = 'app.merge_profiles_internal(uuid,uuid,text)'::regprocedure))`),
    ) as { rules: string[]; hows: string[]; body: string };
    for (const t of r.rules)
      expect(r.body, `merge body handles ${t}`).toMatch(new RegExp(`\\b${t}\\b`));
    expect([...r.hows].sort()).toEqual(
      ['auth', 'drop_only', 'record', 'refuse', 'repoint', 'rule', 'signout'].sort(),
    );
    expect(r.body).toMatch(/app\.profile_merge_columns\(\)/);
    expect(r.body).toMatch(/set_config\('app\.loyalty_merge', 'on', true\)/);
    // 0307 (c20): the profiles are locked FOR NO KEY UPDATE, so a settle's deferred ledger insert
    // (an FK key share on the profile, taken while it holds the tab) never waits on the merge.
    expect(r.body).toMatch(/where id in \(p_keep, p_drop\) order by id for no key update/);
    expect(r.body).not.toMatch(/where id in \(p_keep, p_drop\) order by id for update/);
    // 0307 (c11, c31): the tournaments of both, then both loyalty accounts in uuid order.
    expect(r.body).toMatch(
      /from tournaments\s+where id in \(select tournament_id from tournament_entries/,
    );
    expect(r.body).toMatch(
      /from loyalty_accounts where profile_id in \(p_keep, p_drop\) order by profile_id for update/,
    );
  });

  it('the merge, the run and the groups are granted to nobody; the two RPCs to authenticated only', () => {
    const g = JSON.parse(
      psql(`select json_object_agg(f, json_build_object(
              'anon', has_function_privilege('anon', f, 'execute'),
              'authenticated', has_function_privilege('authenticated', f, 'execute'),
              'service_role', has_function_privilege('service_role', f, 'execute')))
              from unnest(array['app.merge_profiles_internal(uuid,uuid,text)', 'app.merge_duplicates_internal()',
                                'app.duplicate_groups_internal()', 'app.profile_merge_columns()',
                                'app.duplicate_account_groups()', 'app.merge_accounts(uuid,uuid,text)']) f`),
    ) as Record<string, Record<string, boolean>>;
    for (const f of [
      'app.merge_profiles_internal(uuid,uuid,text)',
      'app.merge_duplicates_internal()',
      'app.duplicate_groups_internal()',
      'app.profile_merge_columns()',
    ]) {
      expect(g[f], f).toEqual({ anon: false, authenticated: false, service_role: false });
    }
    expect(g['app.duplicate_account_groups()']).toMatchObject({ anon: false, authenticated: true });
    expect(g['app.merge_accounts(uuid,uuid,text)']).toMatchObject({
      anon: false,
      authenticated: true,
    });
  });
});

describe.skipIf(!docker)('03XX account identity: merging three accounts of one person', () => {
  // ph: the phone account (keep). em: an email account that typed another
  // number. wi: a desk walk-in. Each holds history the merge must carry.
  const r = docker
    ? scenario('merge-three', [
        TOUR_SETUP,
        ACCOUNTS,
        ...TOUR_BRANCH,
        RUN('r1', { count: 4 }),
        ...PUBLISH('pub', 'r1', 't1'),
        GUEST('other'),
        `select pg_temp.phone_user('ph', pg_temp.rphone());`,
        `select pg_temp.email_user('em', pg_temp.rphone());`,
        `select pg_temp.walkin('wi', pg_temp.rphone());`,
        X(`update profiles set terms_version = '2026-09-23', gender = 'female', gender_set_at = now(),
                               gender_set_by = 'guest', birth_date = '1990-04-01'
            where id = {{em}}`),
        KEEP('em_email', `select email from auth.users where id = {{em}}`),
        KEEP('ph_phone', `select phone from profiles where id = {{ph}}`),
        // em signs in with a password; ph (an OTP sign-up) has none.
        X(`update auth.users set encrypted_password = 'pw-em' where id = {{em}}`),
        X(`update auth.users set encrypted_password = '' where id = {{ph}}`),
        // em's device: its pushes must never reach ph's account (0307, c0).
        X(`update profiles set expo_push_token = 'ExponentPushToken[em]' where id = {{em}}`),
        // An owner keeping a desk walk-in over the app account of the same person.
        `select pg_temp.walkin('wk', pg_temp.rphone());`,
        `select pg_temp.email_user('em2', pg_temp.rphone());`,
        X(`update auth.users set encrypted_password = 'pw-em2' where id = {{em2}}`),
        KEEP('em2_email', `select email from auth.users where id = {{em2}}`),

        // em's history: a booking, a match it organises with its seat and ticket, a tournament
        // entry, a note, two flags (one keep also has), a standing, blocks (one of keep).
        KEEP('em_res', `select pg_temp.res('c1', ${at(5)}, 60, 'booking', 'confirmed', 'em')`),
        KEEP('em_m', `select pg_temp.m(jsonb_build_object('organiser_id', {{em}}))`),
        KEEP('em_seat', `select pg_temp.seat({{em_m}}::uuid, 1, 'account', {{em}}::uuid)`),
        KEEP(
          'em_e',
          `insert into tournament_entries (venue_id, tournament_id, guest_id, status, added_by_kind)
                      select t.venue_id, t.id, {{em}}, 'registered', 'guest' from tournaments t where t.id = {{t1}}
                      returning id`,
        ),
        X(
          `insert into customer_notes (customer_id, body, author_id) values ({{em}}, 'likes court 2', {{manager}})`,
        ),
        X(`insert into customer_flags (customer_id, type, label, created_by)
           values ({{em}}, 'vip', null, {{manager}}), ({{em}}, 'birthday', 'em', {{manager}}),
                  ({{ph}}, 'birthday', 'ph', {{manager}})`),
        X(
          `insert into hold_standing (key, guest_id, strikes, last_strike_at) values ('u:' || {{em}}, {{em}}, 2, now())`,
        ),
        X(
          `insert into match_blocks (blocker_id, blocked_id) values ({{em}}, {{ph}}), ({{em}}, {{other}})`,
        ),
        // wi's history: a desk booking and a note.
        KEEP('wi_res', `select pg_temp.res('c2', ${at(6)}, 60, 'booking', 'confirmed', 'wi')`),
        X(
          `insert into customer_notes (customer_id, body, author_id) values ({{wi}}, 'walk-in regular', {{manager}})`,
        ),

        // Who may call.
        T('mgr', 'manager', `select app.merge_accounts({{ph}}, {{em}}, 'same person')`),
        T('groups_mgr', 'manager', `select app.duplicate_account_groups()`),
        T('no_grant', 'owner', `select app.merge_accounts({{ph}}, {{em}}, 'same person')`),
        X(`select pg_temp.pin_grant()`),
        T('no_reason', 'owner', `select app.merge_accounts({{ph}}, {{em}}, '  ')`),
        T('same', 'owner', `select app.merge_accounts({{ph}}, {{ph}}, 'x')`),

        // The two merges.
        T('m_em', 'owner', `select app.merge_accounts({{ph}}, {{em}}, 'same person')`),
        X(`select pg_temp.pin_grant()`),
        T('m_wi', 'owner', `select app.merge_accounts({{ph}}, {{wi}}, 'walk-in')`),
        X(`select pg_temp.pin_grant()`),
        T('again', 'owner', `select app.merge_accounts({{ph}}, {{em}}, 'again')`),
        T('groups', 'owner', `select app.duplicate_account_groups()`),
        // The owner's decision (merge_accounts' 'owner: …' reason) is what lets the auth slots move.
        Q('m_synth', `select app.merge_profiles_internal({{wk}}, {{em2}}, 'owner: desk keep')`),
        Q(
          'synth',
          `select jsonb_build_object(
            'email', (select email = {{em2_email}} from auth.users where id = {{wk}}),
            'password', (select encrypted_password from auth.users where id = {{wk}}),
            'identity', (select jsonb_agg(i.identity_data->>'email' = {{em2_email}} order by i.provider)
                           from auth.identities i where i.user_id = {{wk}} and i.provider = 'email'),
            'drop_email', (select email from auth.users where id = {{em2}}))`,
        ),

        Q(
          'keep',
          `select jsonb_build_object(
            'reservations', (select count(*) from reservations where guest_id = {{ph}}),
            'organised', (select count(*) from matches where organiser_id = {{ph}}),
            'seat', (select guest_id = {{ph}} from match_seats where id = {{em_seat}}),
            'tickets', (select count(*) from match_tickets where guest_id = {{ph}}),
            'ticket_events', (select count(*) from match_ticket_events where guest_id = {{ph}}),
            'entry', (select guest_id = {{ph}} from tournament_entries where id = {{em_e}}),
            'notes', (select count(*) from customer_notes where customer_id = {{ph}}),
            'flags', (select jsonb_object_agg(type, label) from customer_flags where customer_id = {{ph}}),
            'standing', (select jsonb_build_object('guest', guest_id = {{ph}}, 'strikes', strikes)
                           from hold_standing where key = 'u:' || {{ph}}),
            'blocks', (select jsonb_agg(blocked_id = {{other}}) from match_blocks where blocker_id = {{ph}}),
            'profile', (select jsonb_build_object('phone', phone = {{ph_phone}}, 'name', full_name, 'gender', gender,
                                                  'terms', terms_version, 'birth', birth_date, 'live', deleted_at is null,
                                                  'push', expo_push_token)
                          from profiles where id = {{ph}}),
            'auth', (select jsonb_build_object('email', email = {{em_email}}, 'confirmed', email_confirmed_at is not null,
                                               'password', encrypted_password)
                       from auth.users where id = {{ph}}),
            'providers', (select jsonb_agg(provider order by provider) from auth.identities where user_id = {{ph}}),
            'ledger', pg_temp.ledger())`,
        ),
        Q(
          'drops',
          `select jsonb_object_agg(p.id::text, jsonb_build_object(
            'name', p.full_name, 'phone', p.phone, 'phone_key', p.phone_key, 'given', p.given_name,
            'birth', p.birth_date, 'deleted', p.deleted_at is not null,
            'banned', (select u.banned_until = 'infinity' from auth.users u where u.id = p.id),
            'email', (select u.email from auth.users u where u.id = p.id),
            'auth_phone', (select u.phone from auth.users u where u.id = p.id),
            'meta', (select u.raw_user_meta_data from auth.users u where u.id = p.id),
            'identities', (select count(*) from auth.identities i where i.user_id = p.id),
            'purge_queued', exists (select 1 from avatar_purges a where a.path = p.id::text),
            'remaining', (select count(*) from reservations where guest_id = p.id)
                    + (select count(*) from customer_notes where customer_id = p.id)
                    + (select count(*) from customer_flags where customer_id = p.id)
                    + (select count(*) from match_blocks where blocker_id = p.id or blocked_id = p.id)
                    + (select count(*) from hold_standing where guest_id = p.id)))
            from profiles p where p.id in ({{em}}, {{wi}})`,
        ),
        Q(
          'records',
          `select jsonb_build_object(
            'merges', (select jsonb_agg(jsonb_build_object('drop', drop_id, 'reason', reason, 'actor', actor_id)
                                        order by created_at, reason)
                         from app.profile_merges where keep_id = {{ph}}),
            'audit', (select count(*) from audit_log where action = 'account.merge' and entity_id = {{ph}}::text),
            'grants_left', (select count(*) from app.pin_grants
                             where caller_id = {{owner}} and consumed_at is null))`,
        ),
        Q('ids', `select jsonb_build_object('em', {{em}}, 'wi', {{wi}}, 'owner', {{owner}})`),
      ])
    : ({} as Results);

  it('only the owner merges, behind a manager-PIN grant and a reason', () => {
    expect(refused(r, 'mgr')).toBe('FORBIDDEN');
    expect(refused(r, 'groups_mgr')).toBe('FORBIDDEN');
    expect(refused(r, 'no_grant')).toBe('PIN_GRANT_REQUIRED');
    expect(refused(r, 'no_reason')).toBe('REASON_REQUIRED');
    expect(refused(r, 'same')).toBe('MERGE_REFUSED:same');
    expect(refused(r, 'again')).toBe('MERGE_REFUSED:missing');
  });

  it('moves bookings, the match, seat and tickets, the entry, notes, flags, the standing and blocks to keep', () => {
    const em = ok<{ moved: Row }>(r, 'm_em');
    expect(em.moved).toMatchObject({
      'reservations.guest_id': 1,
      'matches.organiser_id': 1,
      'match_seats.guest_id': 1,
      'tournament_entries.guest_id': 1,
      'customer_notes.customer_id': 1,
      'customer_flags.customer_id': 1,
      'hold_standing.account': 1,
      'match_blocks.blocker_id': 1,
      'auth.email': 1,
      'auth.identities': 1,
    });
    ok(r, 'm_wi');
    const k = ok<Row>(r, 'keep');
    expect(k).toMatchObject({
      reservations: 2,
      organised: 1,
      seat: true,
      tickets: 1,
      entry: true,
      notes: 2,
      // keep's own birthday flag wins; em's vip comes across
      flags: { vip: null, birthday: 'ph' },
      standing: { guest: true, strikes: 2 },
      // em blocking ph is a self-block now: gone; em blocking other: kept
      blocks: [true],
      ledger: [],
    });
    expect(k.ticket_events).toBeGreaterThanOrEqual(2);
  });

  it('keep keeps its phone and takes what it lacked; not the avatar', () => {
    const k = ok<Row>(r, 'keep');
    expect(k.profile).toMatchObject({
      phone: true,
      gender: 'female',
      terms: '2026-09-23',
      birth: '1990-04-01',
      live: true,
      // 0307 (c0): the drop's push token never comes across.
      push: null,
    });
    // A phone sign-up has an empty name; the first drop's name fills it.
    expect((k.profile as Row).name).toBe('Email em');
    // The email slot was empty: em's confirmed email and both its identities come across.
    expect(k.auth).toEqual({ email: true, confirmed: true, password: 'pw-em' });
    expect(k.providers).toEqual(['email', 'google']);
  });

  it('a walk-in keep gives up its synthetic address: the real email, password and identity come across', () => {
    ok(r, 'm_synth');
    expect(ok<Row>(r, 'synth')).toEqual({
      email: true,
      password: 'pw-em2',
      identity: [true],
      drop_email: null,
    });
  });

  it('the drops are tombstoned, banned and emptied; the merges are recorded', () => {
    const ids = ok<Record<string, string>>(r, 'ids');
    const d = ok<Record<string, Row>>(r, 'drops');
    for (const id of [ids.em!, ids.wi!]) {
      expect(d[id], id).toMatchObject({
        name: 'Deleted account',
        phone: null,
        phone_key: null,
        given: null,
        birth: null,
        deleted: true,
        banned: true,
        purge_queued: true,
        remaining: 0,
      });
    }
    // 0307 (c45): nothing personal or usable is left on either drop's auth row: no metadata, no
    // email, no phone, no identity (the walk-in's synthetic email identity included).
    for (const id of [ids.em!, ids.wi!]) {
      expect(d[id], id).toMatchObject({ email: null, auth_phone: null, meta: {}, identities: 0 });
    }
    const rec = ok<{ merges: Row[]; audit: number; grants_left: number }>(r, 'records');
    expect(rec.merges.map((m) => m.drop).sort()).toEqual([ids.em, ids.wi].sort());
    expect(rec.merges.every((m) => m.actor === ids.owner)).toBe(true);
    expect(rec.merges.map((m) => m.reason).sort()).toEqual([
      'owner: same person',
      'owner: walk-in',
    ]);
    expect(rec.audit).toBe(2);
    expect(rec.grants_left).toBe(1); // the third grant: 'again' was refused and rolled its spend back
  });

  it('the owner sees no group left for these accounts', () => {
    const ids = ok<Record<string, string>>(r, 'ids');
    const groups = ok<Array<{ profiles: Row[] }>>(r, 'groups');
    expect(Array.isArray(groups)).toBe(true);
    const named = groups.flatMap((g) => g.profiles.map((p) => p.id));
    expect(named).not.toContain(ids.em);
    expect(named).not.toContain(ids.wi);
  });
});

describe.skipIf(!docker)('03XX account identity: refusals', () => {
  it('staff with staff, a staff drop and coach with coach are MERGE_REFUSED; nothing moves', () => {
    const r = scenario('merge-refusals', [
      COACH_SETUP,
      ACCOUNTS,
      `create temp table guests (id uuid primary key);`,
      `select pg_temp.branch('v');`,
      `select pg_temp.mk('s1', 'cashier');`,
      `select pg_temp.mk('s2', 'court_desk');`,
      `select pg_temp.guest('g1');`,
      `select pg_temp.guest('g2');`,
      `select pg_temp.guest('a');`,
      `select pg_temp.guest('b');`,
      `select pg_temp.coach('c1', 'g1', 'v');`,
      `select pg_temp.coach('c2', 'g2', 'v');`,
      `select pg_temp.lt('lt_p', 'private', 'v');`,
      `select pg_temp.teach('c1', 'lt_p');`,
      `select pg_temp.e('book', 'desk', $q$select app.desk_book_lesson({{c1}}, {{lt_p}}, ${cAt(3, 4)}, {{a}}, null, null, 1, 'k-am')$q$);`,
      `select pg_temp.e('staff_both', null, $q$select app.merge_profiles_internal({{s1}}, {{s2}}, 't')$q$);`,
      `select pg_temp.e('staff_drop', null, $q$select app.merge_profiles_internal({{a}}, {{s1}}, 't')$q$);`,
      `select pg_temp.e('coach_both', null, $q$select app.merge_profiles_internal({{g1}}, {{g2}}, 't')$q$);`,
      // 0307 (c11): b holds an unpaid online hold on the same lesson a is booked on.
      X(`insert into lesson_enrolments
           select (jsonb_populate_record(null::lesson_enrolments, to_jsonb(e) || jsonb_build_object(
                     'id', gen_random_uuid(), 'guest_id', {{b}}, 'status', 'held', 'payment_mode', 'online',
                     'hold_expires_at', now() + interval '10 minutes', 'booked_by_kind', 'guest',
                     'booked_by_profile_id', {{b}}, 'booked_by_staff_id', null, 'idempotency_key', null,
                     'created_at', now(), 'updated_at', now()))).*
             from lesson_enrolments e where e.guest_id = {{a}}`),
      KEEP('a_place', `select id from lesson_enrolments where guest_id = {{a}}`),
      // A guest with a lesson place folded into another: the booked place moves and beats b's
      // hold; a staff keep takes a guest drop.
      `select pg_temp.e('lesson', null, $q$select app.merge_profiles_internal({{b}}, {{a}}, 't')$q$);`,
      Q(
        'b_places',
        `select jsonb_agg(jsonb_build_object('a', id = {{a_place}}, 'status', status) order by status)
           from lesson_enrolments where guest_id = {{b}}`,
      ),
      `select pg_temp.e('staff_keep', null, $q$select app.merge_profiles_internal({{s1}}, {{b}}, 't')$q$);`,
      // 0307 (c0): a staff keep never receives another account's login, even by the owner's merge.
      `select pg_temp.phone_user('gp', pg_temp.rphone());`,
      `select pg_temp.e('staff_keep_auth', null, $q$select app.merge_profiles_internal({{s2}}, {{gp}}, 'owner: same person')$q$);`,
      Q(
        'after',
        `select jsonb_build_object(
          'live', (select jsonb_agg(deleted_at is null order by id) from profiles where id in ({{s2}}, {{g2}})),
          'gp_live', (select deleted_at is null from profiles where id = {{gp}}),
          's2_phone', (select phone from auth.users where id = {{s2}}),
          'enrolments_b', (select count(*) from lesson_enrolments where guest_id = {{b}}),
          'enrolments_s1', (select count(*) from lesson_enrolments where guest_id = {{s1}}))`,
      ),
    ]);
    expect(ok(r, 'book')).toBeTruthy();
    expect(refused(r, 'staff_both')).toBe('MERGE_REFUSED:staff_both');
    expect(refused(r, 'staff_drop')).toBe('MERGE_REFUSED:staff_drop');
    expect(refused(r, 'coach_both')).toBe('MERGE_REFUSED:coach_both');
    expect(ok<{ moved: Row }>(r, 'lesson').moved).toMatchObject({
      'lesson_enrolments.guest_id': 1,
      'lesson_enrolments.held_expired': 1,
    });
    expect(ok(r, 'b_places')).toEqual([
      { a: true, status: 'booked' },
      { a: false, status: 'expired' },
    ]);
    ok(r, 'staff_keep');
    expect(refused(r, 'staff_keep_auth')).toBe('MERGE_REFUSED:staff_keep_auth');
    expect(ok(r, 'after')).toEqual({
      live: [true, true],
      gp_live: true,
      s2_phone: null,
      enrolments_b: 0,
      enrolments_s1: 2,
    });
  });
});

describe.skipIf(!docker)('03XX account identity: the one-time run', () => {
  it('groups phones by the confirmed auth phone only, merges a proven pair, and clears the key of a refused one', () => {
    const r = scenario('merge-run', [
      TOUR_SETUP,
      ACCOUNTS,
      ...TOUR_BRANCH,
      KEEP('p_dup', `select pg_temp.rphone()`),
      KEEP('p_staff', `select pg_temp.rphone()`),
      // Two confirmed auth phones, one number in two spellings (GoTrue holds the text unique,
      // not the number), and an email account that only typed it.
      `select pg_temp.phone_user('p1', pg_temp.var('p_dup'));`,
      `select pg_temp.phone_user('p2', '0' || substr(pg_temp.var('p_dup'), 5));`,
      `select pg_temp.email_user('e1', pg_temp.var('p_dup'));`,
      `select pg_temp.mk('s1', 'cashier');`,
      `select pg_temp.mk('s2', 'court_desk');`,
      X(
        `update auth.users set phone = app.phone_digits({{p_staff}}), phone_confirmed_at = now() where id = {{s1}}`,
      ),
      X(`update auth.users set phone = '0' || substr(app.phone_digits({{p_staff}}), 4), phone_confirmed_at = now()
          where id = {{s2}}`),
      KEEP('p1_res', `select pg_temp.res('c1', ${at(5)}, 60, 'booking', 'confirmed', 'p1')`),
      // s2 typed its number too: a verified holder already has it, so it is stored keyless.
      X(`update profiles set phone = {{p_staff}} where id = {{s2}}`),
      X(`update profiles set created_at = now() - interval '3 days' where id in ({{p1}}, {{s1}})`),
      X(`update profiles set created_at = now() - interval '2 days' where id in ({{p2}}, {{s2}})`),
      Q(
        'before',
        `select jsonb_agg(jsonb_build_object('kind', kind, 'p', profile_id in ({{p1}}, {{p2}}),
                                             's', profile_id in ({{s1}}, {{s2}}), 'e1', profile_id = {{e1}})
                          order by kind, profile_id in ({{p1}}, {{p2}}) desc)
           from app.duplicate_groups_internal() where profile_id in ({{e1}}, {{p1}}, {{p2}}, {{s1}}, {{s2}})`,
      ),
      Q('run', `select app.merge_duplicates_internal()`),
      Q(
        'after',
        `select jsonb_build_object(
          'p1', (select jsonb_build_object('live', deleted_at is null, 'key', phone_key = app.phone_canon({{p_dup}}))
                   from profiles where id = {{p1}}),
          'p2', (select deleted_at is not null from profiles where id = {{p2}}),
          'bookings_p1', (select count(*) from reservations where guest_id = {{p1}}),
          'e1', (select jsonb_build_object('live', deleted_at is null, 'key', phone_key) from profiles where id = {{e1}}),
          'p1_email', (select email from auth.users where id = {{p1}}),
          's1', (select phone_key = app.phone_canon({{p_staff}}) from profiles where id = {{s1}}),
          's2', (select jsonb_build_object('key', phone_key, 'phone', phone is not null, 'live', deleted_at is null)
                   from profiles where id = {{s2}}),
          'merges', (select jsonb_agg(jsonb_build_object('keep', keep_id, 'drop', drop_id, 'reason', reason)
                                      order by reason, drop_id)
                       from app.profile_merges where keep_id in ({{p1}}, {{s1}}) and reason <> 'phone_reclaimed'),
          'groups_left', (select count(*) from app.duplicate_groups_internal()
                           where profile_id in ({{e1}}, {{p1}}, {{p2}}, {{s1}}, {{s2}})))`,
      ),
      Q('ids', `select jsonb_build_object('p1', {{p1}}, 'p2', {{p2}}, 's1', {{s1}}, 's2', {{s2}})`),
    ]);
    // 0307 (c0): only the two confirmed auth phones group; the email account's typed phone never does.
    expect(ok<Row[]>(r, 'before')).toEqual([
      { kind: 'phone', p: true, s: false, e1: false },
      { kind: 'phone', p: true, s: false, e1: false },
      { kind: 'phone', p: false, s: true, e1: false },
      { kind: 'phone', p: false, s: true, e1: false },
    ]);
    expect(ok(r, 'run')).toMatchObject({ merged: 1, phones_cleared: 1 });
    const ids = ok<Record<string, string>>(r, 'ids');
    const a = ok<Row>(r, 'after');
    expect(a).toMatchObject({
      p1: { live: true, key: true },
      p2: true,
      bookings_p1: 1,
      // the email account is not folded in, and its typed phone holds no key
      e1: { live: true, key: null },
      p1_email: null,
      s1: true,
      // c19: the refused pair loses the newer's KEY; its phone text (bookings need it) stays
      s2: { key: null, phone: true, live: true },
      // the refused staff pair still shares a confirmed number: it stays on the owner's list
      groups_left: 2,
    });
    expect(a.merges).toEqual([
      { keep: ids.p1, drop: ids.p2, reason: 'duplicate_phone' },
      { keep: ids.s1, drop: ids.s2, reason: 'phone_cleared_conflict' },
    ]);
  });

  it('only MERGE_REFUSED is a refusal: any other error in a merge is raised, never turned into a cleared phone', () => {
    const r = scenario('merge-run-error', [
      TOUR_SETUP,
      ACCOUNTS,
      ...TOUR_BRANCH,
      KEEP('p_dup', `select pg_temp.rphone()`),
      `select pg_temp.phone_user('p1', pg_temp.var('p_dup'));`,
      `select pg_temp.phone_user('p2', '0' || substr(pg_temp.var('p_dup'), 5));`,
      KEEP('p1_res', `select pg_temp.res('c1', ${at(5)}, 60, 'booking', 'confirmed', 'p1')`),
      KEEP('p2_res', `select pg_temp.res('c2', ${at(5)}, 60, 'booking', 'confirmed', 'p2')`),
      // A failure that is not a refusal (a lock timeout, a deadlock, a bug) inside the merge.
      X(`create function app.zz_test_boom_0307() returns trigger language plpgsql as $b$
         begin raise exception 'BOOM_0307'; end $b$`),
      X(`create trigger zz_test_boom_0307 before update on reservations for each row
         when (old.guest_id in ({{p1}}::uuid, {{p2}}::uuid)) execute function app.zz_test_boom_0307()`),
      E('run', null, `select app.merge_duplicates_internal()`),
      Q(
        'after',
        `select jsonb_build_object(
          'keys', (select count(*) from profiles where id in ({{p1}}, {{p2}}) and phone_key is not null),
          'records', (select count(*) from app.profile_merges where {{p1}} in (keep_id, drop_id) or {{p2}} in (keep_id, drop_id)
                                                             and reason like 'phone_cleared%'))`,
      ),
    ]);
    const o = r['run'];
    expect(o?.ok).toBe(false);
    expect(o?.code).toBe('BOOM_0307');
    expect(ok(r, 'after')).toEqual({ keys: 1, records: 0 });
  });
});

describe.skipIf(!docker)('03XX account identity: one live profile per proven phone', () => {
  const r = docker
    ? scenario('merge-unique', [
        TOUR_SETUP,
        ACCOUNTS,
        ...TOUR_BRANCH,
        GUEST('a'),
        GUEST('b'),
        GUEST('c'),
        KEEP('pa', `select phone from profiles where id = {{a}}`),
        KEEP('pc', `select phone from profiles where id = {{c}}`),
        // v holds its number by proof: a confirmed auth phone.
        KEEP('pv', `select pg_temp.rphone()`),
        `select pg_temp.phone_user('v', pg_temp.var('pv'));`,
        // 0307 (c1, c18): a guest typing a number someone holds is no error and takes no key,
        // in any spelling, so the edit neither squats the number nor tells who holds it.
        T(
          'edit',
          'b',
          `update profiles set phone = {{pv}} where id = auth.uid() returning to_jsonb(phone = {{pv}})`,
        ),
        Q('edit_key', `select to_jsonb(phone_key) from profiles where id = {{b}}`),
        T(
          'edit_local',
          'b',
          `update profiles set phone = '0' || substr({{pv}}, 5) where id = auth.uid() returning to_jsonb(phone is not null)`,
        ),
        Q('edit_local_key', `select to_jsonb(phone_key) from profiles where id = {{b}}`),
        T(
          'edit_free',
          'b',
          `update profiles set phone = {{pc}} where id = auth.uid() returning to_jsonb(phone = {{pc}})`,
        ),
        Q('edit_free_key', `select to_jsonb(phone_key) from profiles where id = {{b}}`),
        // The index itself, under the trigger (a write of phone_key alone).
        E(
          'index',
          null,
          `update profiles set phone_key = (select p.phone_key from profiles p where p.id = {{v}})
                           where id = {{b}} returning to_jsonb(phone_key)`,
        ),

        // Sign-up never fails: an email sign-up that typed v's number keeps it as text, keyless.
        `select pg_temp.email_user('su', pg_temp.var('pv'));`,
        // A confirmed phone sign-up claims a desk walk-in holding the number; the walk-in's name,
        // notes and flags stay behind (c21), its bookings come across.
        KEEP('pw', `select pg_temp.rphone()`),
        `select pg_temp.walkin('w', pg_temp.var('pw'));`,
        KEEP('w_res', `select pg_temp.res('c1', ${at(4)}, 60, 'booking', 'confirmed', 'w')`),
        X(
          `insert into customer_notes (customer_id, body, author_id) values ({{w}}, 'walk-in note', {{manager}})`,
        ),
        X(
          `insert into customer_flags (customer_id, type, label, created_by) values ({{w}}, 'vip', null, {{manager}})`,
        ),
        X(`update profiles set gender = 'male', gender_set_at = now(), gender_set_by = 'staff', birth_date = '1980-01-01'
            where id = {{w}}`),
        `select pg_temp.phone_user('n', pg_temp.var('pw'));`,
        // An OTP sign-up is inserted unconfirmed, then confirmed: the claim waits for it.
        KEEP('pw2', `select pg_temp.rphone()`),
        `select pg_temp.walkin('w2', pg_temp.var('pw2'));`,
        `select pg_temp.phone_user('n2', pg_temp.var('pw2'), false);`,
        Q(
          'n2_before',
          `select jsonb_build_object('key', p.phone_key, 'w2_live', (select deleted_at is null from profiles where id = {{w2}}))
                          from profiles p where p.id = {{n2}}`,
        ),
        X(`update auth.users set phone_confirmed_at = now() where id = {{n2}}`),
        // A number a guest only typed (a's) never blocks its verified owner (c1).
        `select pg_temp.phone_user('n3', pg_temp.var('pa'));`,
        // A walk-in the desk registered with a real email is claimed too.
        KEEP('pr', `select pg_temp.rphone()`),
        `select pg_temp.walkin('wr', pg_temp.var('pr'), 'walkin-real-' || gen_random_uuid() || '@test.touch.local');`,
        `select pg_temp.phone_user('n4', pg_temp.var('pr'));`,
        // A walk-in that has signed in itself is somebody's account: it gives the key up, not its history.
        KEEP('ps', `select pg_temp.rphone()`),
        `select pg_temp.walkin('ws', pg_temp.var('ps'), 'walkin-signed-' || gen_random_uuid() || '@test.touch.local');`,
        X(`update auth.users set last_sign_in_at = now() where id = {{ws}}`),
        KEEP('ws_res', `select pg_temp.res('c2', ${at(4)}, 60, 'booking', 'confirmed', 'ws')`),
        `select pg_temp.phone_user('n5', pg_temp.var('ps'));`,
        // A changed auth phone drops the old number's key, and frees it for its next owner.
        KEEP('p6', `select pg_temp.rphone()`),
        `select pg_temp.phone_user('n6', pg_temp.var('p6'));`,
        X(`update auth.users set phone = app.phone_digits(pg_temp.rphone()) where id = {{n6}}`),
        `select pg_temp.phone_user('n7', pg_temp.var('p6'));`,
        Q(
          'after',
          `select jsonb_build_object(
            'v', (select phone_key = app.phone_canon({{pv}}) from profiles where id = {{v}}),
            'su', (select jsonb_build_object('phone', phone = {{pv}}, 'key', phone_key, 'live', deleted_at is null)
                     from profiles where id = {{su}}),
            'n', (select jsonb_build_object('phone', phone = {{pw}}, 'key', phone_key = app.phone_canon({{pw}}),
                                            'name', full_name, 'gender', gender, 'birth', birth_date,
                                            'bookings', (select count(*) from reservations where guest_id = {{n}}),
                                            'notes', (select count(*) from customer_notes where customer_id = {{n}}),
                                            'flags', (select count(*) from customer_flags where customer_id = {{n}}))
                    from profiles where id = {{n}}),
            'w', (select jsonb_build_object('deleted', deleted_at is not null,
                                            'banned', (select banned_until = 'infinity' from auth.users where id = {{w}}),
                                            'notes', (select count(*) from customer_notes where customer_id = {{w}}))
                    from profiles where id = {{w}}),
            'claims', (select jsonb_agg(reason order by reason) from app.profile_merges
                        where keep_id in ({{n}}, {{n2}}, {{n4}}) and reason like 'walkin%'),
            'n2', (select phone_key = app.phone_canon({{pw2}}) from profiles where id = {{n2}}),
            'w2', (select deleted_at is not null from profiles where id = {{w2}}),
            'n3', (select jsonb_build_object('phone', phone = {{pa}}, 'key', phone_key = app.phone_canon({{pa}}))
                     from profiles where id = {{n3}}),
            'a', (select jsonb_build_object('phone', phone = {{pa}}, 'key', phone_key, 'live', deleted_at is null)
                    from profiles where id = {{a}}),
            'n4', (select phone_key = app.phone_canon({{pr}}) from profiles where id = {{n4}}),
            'wr', (select deleted_at is not null from profiles where id = {{wr}}),
            'n5', (select jsonb_build_object('key', phone_key = app.phone_canon({{ps}}),
                                             'bookings', (select count(*) from reservations where guest_id = {{n5}}))
                     from profiles where id = {{n5}}),
            'ws', (select jsonb_build_object('live', deleted_at is null, 'key', phone_key, 'phone', phone = {{ps}},
                                             'bookings', (select count(*) from reservations where guest_id = {{ws}}))
                     from profiles where id = {{ws}}),
            'ws_record', (select jsonb_agg(reason) from app.profile_merges where drop_id = {{ws}}),
            'n6', (select jsonb_build_object('phone', phone = {{p6}}, 'key', phone_key) from profiles where id = {{n6}}),
            'n7', (select phone_key = app.phone_canon({{p6}}) from profiles where id = {{n7}}))`,
        ),
      ])
    : ({} as Results);

  it('a guest typing a number another live profile holds is no error and takes no key, in any spelling', () => {
    expect(ok(r, 'edit')).toBe(true);
    expect(ok(r, 'edit_key')).toBeNull();
    expect(ok(r, 'edit_local')).toBe(true);
    expect(ok(r, 'edit_local_key')).toBeNull();
    // b's free number is still only typed: no key without proof.
    expect(ok(r, 'edit_free')).toBe(true);
    expect(ok(r, 'edit_free_key')).toBeNull();
    expect(ok<Row>(r, 'after').v).toBe(true);
  });

  it('the unique index refuses a second live holder of a key', () => {
    const o = r['index'];
    expect(o?.ok).toBe(false);
    expect(o?.code).toMatch(/profiles_phone_key_live/);
  });

  it('handle_new_user keeps a typed phone as text, and a confirmed one claims a never-signed-in desk walk-in', () => {
    const a = ok<Row>(r, 'after');
    expect(a.su).toEqual({ phone: true, key: null, live: true });
    expect(a.n).toEqual({
      phone: true,
      key: true,
      bookings: 1,
      // c21: nothing personal comes across with a claim: the empty name stays empty
      name: '',
      gender: null,
      birth: null,
      notes: 0,
      flags: 0,
    });
    expect(a.w).toEqual({ deleted: true, banned: true, notes: 1 });
    expect(ok(r, 'n2_before')).toEqual({ key: null, w2_live: true });
    expect(a.n2).toBe(true);
    expect(a.w2).toBe(true);
    expect(a.claims).toEqual(['walkin_claim', 'walkin_claim', 'walkin_claim']);
    expect(a.n4).toBe(true);
    expect(a.wr).toBe(true);
  });

  it('a typed number never blocks its verified owner; a signed-in walk-in gives the key up and keeps its history', () => {
    const a = ok<Row>(r, 'after');
    expect(a.n3).toEqual({ phone: true, key: true });
    expect(a.a).toEqual({ phone: true, key: null, live: true });
    expect(a.n5).toEqual({ key: true, bookings: 0 });
    expect(a.ws).toEqual({ live: true, key: null, phone: true, bookings: 1 });
    expect(a.ws_record).toEqual(['phone_reclaimed']);
  });

  it('a changed auth phone drops the old key and frees the number', () => {
    const a = ok<Row>(r, 'after');
    expect(a.n6).toEqual({ phone: true, key: null });
    expect(a.n7).toBe(true);
  });
});

describe.skipIf(!docker)('03XX account identity: proof before any login moves (c0)', () => {
  it("an email account that typed a verified account's number never groups with it, and a merge without proof moves no login", () => {
    const r = scenario('merge-proof', [
      TOUR_SETUP,
      ACCOUNTS,
      ...TOUR_BRANCH,
      KEEP('pp', `select pg_temp.rphone()`),
      `select pg_temp.phone_user('ph', pg_temp.var('pp'));`,
      `select pg_temp.email_user('em', pg_temp.var('pp'));`,
      X(`update auth.users set encrypted_password = 'pw-em' where id = {{em}}`),
      X(`update auth.users set encrypted_password = '' where id = {{ph}}`),
      X(`update profiles set expo_push_token = 'ExponentPushToken[em]' where id = {{em}}`),
      Q(
        'groups',
        `select to_jsonb(count(*)) from app.duplicate_groups_internal() where profile_id in ({{ph}}, {{em}})`,
      ),
      Q('m', `select app.merge_profiles_internal({{ph}}, {{em}}, 'duplicate_phone')`),
      Q(
        'after',
        `select jsonb_build_object(
          'ph', (select jsonb_build_object('email', email, 'password', encrypted_password,
                                           'providers', (select coalesce(jsonb_agg(provider order by provider), '[]')
                                                           from auth.identities where user_id = {{ph}}),
                                           'push', (select expo_push_token from profiles where id = {{ph}}))
                   from auth.users where id = {{ph}}),
          'em', (select jsonb_build_object('email', email, 'meta', raw_user_meta_data, 'banned', banned_until = 'infinity',
                                           'identities', (select count(*) from auth.identities where user_id = {{em}}))
                   from auth.users where id = {{em}}))`,
      ),
    ]);
    expect(ok(r, 'groups')).toBe(0);
    const m = ok<{ moved: Row }>(r, 'm').moved;
    expect(m['auth.email']).toBeUndefined();
    expect(m['auth.identities']).toBeUndefined();
    expect(ok(r, 'after')).toEqual({
      ph: { email: null, password: '', providers: [], push: null },
      em: { email: null, meta: {}, banned: true, identities: 0 },
    });
  });
});

describe.skipIf(!docker)('03XX account identity: tournament entries on both accounts (c11)', () => {
  const FEE = 25000;
  const SETTLE = (e: string, key: string) =>
    T(
      key,
      'cashier',
      `select app.tournament_settle({{${e}}}, 'cash', ${FEE}, ${FEE}, ${KEY(key)}, null)`,
    );

  it('the live, paid entry wins: its money stays counted, the other entry goes, and the sweep leaves it alone', () => {
    const r = scenario('merge-tour', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { fee: FEE, count: 4 }),
      ...PUBLISH('pub', 'r1', 't1', { waitlist_max: 2 }),
      `select pg_temp.field('t1', 4, 'p');`,
      GUEST('w1'),
      T('w1_reg', 'w1', `select app.tournament_register({{t1}})`),
      KEEP('w1_e', `select id::text from tournament_entries where guest_id = {{w1}}::uuid`),
      `select pg_temp.day('day1');`,
      SETTLE('p1_e', 's1'),
      SETTLE('p2_e', 's2'),
      // (a) k: an earlier, withdrawn entry on the account that is kept; p1's entry is the paid one.
      GUEST('k'),
      KEEP(
        'k_e',
        `insert into tournament_entries (venue_id, tournament_id, guest_id, status, added_by_kind, withdrawn_reason, withdrawn_at)
         select t.venue_id, t.id, {{k}}, 'withdrawn', 'guest', 'guest', now() from tournaments t where t.id = {{t1}}
         returning id`,
      ),
      Q('m_a', `select app.merge_profiles_internal({{k}}, {{p1}}, 'same person')`),
      // (b) both registered, the drop (p2) paid: keep (p3) owes nothing after, one place frees.
      Q('m_b', `select app.merge_profiles_internal({{p3}}, {{p2}}, 'same person')`),
      Q('sweep', `select to_jsonb(app.tournament_sweep())`),
      Q(
        'after',
        `select jsonb_build_object(
          'a_entry', (select jsonb_build_object('mine', guest_id = {{k}}, 'status', status) from tournament_entries where id = {{p1_e}}),
          'a_money', (select jsonb_build_object('net', m->'net_iqd', 'owed', m->'owed_iqd', 'due', m->'refund_due_iqd')
                        from app.tournament_entry_money({{p1_e}}) m),
          'k_withdrawn_gone', not exists (select 1 from tournament_entries where id = {{k_e}}),
          'b_entry', (select jsonb_build_object('mine', guest_id = {{p3}}, 'status', status) from tournament_entries where id = {{p2_e}}),
          'b_money', (select jsonb_build_object('owed', m->'owed_iqd', 'net', m->'net_iqd') from app.tournament_entry_money({{p2_e}}) m),
          'p3_entries', (select count(*) from tournament_entries where guest_id = {{p3}}),
          'drops_left', (select count(*) from tournament_entries where guest_id in ({{p1}}, {{p2}})),
          'w1', (select status from tournament_entries where id = {{w1_e}}))`,
      ),
    ]);
    expect(ok<{ moved: Row }>(r, 'm_a').moved).toMatchObject({
      'tournament_entries.merged': 1,
      'tournament_entries.guest_id': 1,
    });
    expect(ok<{ moved: Row }>(r, 'm_b').moved).toMatchObject({
      'tournament_entries.merged': 1,
      'tournament_entries.guest_id': 1,
    });
    expect(ok(r, 'after')).toEqual({
      a_entry: { mine: true, status: 'registered' },
      a_money: { net: FEE, owed: 0, due: 0 },
      k_withdrawn_gone: true,
      b_entry: { mine: true, status: 'registered' },
      b_money: { owed: 0, net: FEE },
      p3_entries: 1,
      drops_left: 0,
      // p3's own unpaid place went with the merge: the waitlist moves up
      w1: 'registered',
    });
  });
});
