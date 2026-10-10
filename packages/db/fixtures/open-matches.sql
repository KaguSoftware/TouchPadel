-- FIXTURE — open-match test data, dev/staging ONLY. Never applied to prod.
--
-- Reserved fixture UUID prefix 'f1f7' (see courts.sql / packages/db/README.md).
-- Suffix namespace: open matches 00000000f0**.
--
-- Content: open matches switched on at the main branch, seven guests who may
-- play (phone, current terms, gender), paid tickets for each, and six upcoming
-- matches in the states a tester wants to see. Every match is made through the
-- RPCs the phone and the desk call, with auth.uid() set the way PostgREST sets
-- it, so every guard, trigger, ticket move and push row is the real one.
--
-- Needs fixtures/courts.sql (Indoor Court 1 and 2 and their rate rules), so run
-- the default fixtures first.
--
-- Apply:  pnpm --filter @touch/db db:fixtures:matches
-- Undo:   pnpm --filter @touch/db db:reset && pnpm --filter @touch/db db:fixtures
--
-- NOT IN THE DEFAULT FIXTURE LIST: it switches matches on at the main branch and
-- books courts, which the e2e and bench suites do not expect.
--
-- Re-running is safe. Guests and tickets are topped up, and the matches are
-- skipped while any match a fixture guest organised is still upcoming.
--
-- Sign in (email, password touch-dev-password):
--   tester@dev.touch.local   Test Tester   male    in no match: join, start, buy
--   ali@dev.touch.local      Ali Karim     male    organiser of M1 and M4
--   omar@dev.touch.local     Omar Saleh    male    organiser of M3, in M1 and M4
--   hassan@dev.touch.local   Hassan Jabir  male    in M4
--   karim@dev.touch.local    Karim Nouri   male    organiser of M5, in M4
--   sara@dev.touch.local     Sara Hadi     female  organiser of M2 (approves Noor)
--   noor@dev.touch.local     Noor Aziz     female  has a pending request on M2
--
-- Matches (times are Baghdad, D = today):
--   M1  D+1 18:00 Court 1  open, public, instant join     2/4 filling
--   M2  D+1 20:00 Court 2  women, public, approve         2/4 filling, 1 request
--   M3  D+2 19:00 Court 1  open, public, instant join     3/4 filling (one seat left)
--   M4  D+2 21:00 Court 2  open, public, instant join     4/4 booked
--   M5  D+3 20:00 Court 1  open, link only, instant join  1/4 filling (token printed)
--   M6  D+3 18:00 Court 2  open, public, desk-organised   2/4 filling (walk-ins)

begin;

-- ---------------------------------------------------------------------------
-- Settings: matches on at the main branch.
-- ---------------------------------------------------------------------------
update venue_settings set matches_enabled = true
 where venue_id = 'c0000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- Guests. The 0069 trigger makes each profile; the update makes them eligible.
-- ---------------------------------------------------------------------------
create temp table om_guests (id uuid primary key, email text, given text, family text, gender text,
                             phone text, tickets int) on commit drop;
insert into om_guests values
  ('f1f70000-0000-4000-8000-00000000f001', 'tester@dev.touch.local', 'Test',   'Tester', 'male',   '+9647900000001', 6),
  ('f1f70000-0000-4000-8000-00000000f002', 'ali@dev.touch.local',    'Ali',    'Karim',  'male',   '+9647900000002', 6),
  ('f1f70000-0000-4000-8000-00000000f003', 'omar@dev.touch.local',   'Omar',   'Saleh',  'male',   '+9647900000003', 6),
  ('f1f70000-0000-4000-8000-00000000f004', 'hassan@dev.touch.local', 'Hassan', 'Jabir',  'male',   '+9647900000004', 3),
  ('f1f70000-0000-4000-8000-00000000f005', 'karim@dev.touch.local',  'Karim',  'Nouri',  'male',   '+9647900000005', 3),
  ('f1f70000-0000-4000-8000-00000000f006', 'sara@dev.touch.local',   'Sara',   'Hadi',   'female', '+9647900000006', 4),
  ('f1f70000-0000-4000-8000-00000000f007', 'noor@dev.touch.local',   'Noor',   'Aziz',   'female', '+9647900000007', 3);

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current)
select '00000000-0000-0000-0000-000000000000', g.id, 'authenticated', 'authenticated', g.email,
       extensions.crypt('touch-dev-password', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}',
       jsonb_build_object('full_name', g.given || ' ' || g.family, 'phone', g.phone), now(), now(),
       '', '', '', '', ''
  from om_guests g
on conflict (id) do nothing;

insert into auth.identities
  (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select g.id::text, g.id,
       jsonb_build_object('sub', g.id::text, 'email', g.email, 'email_verified', true),
       'email', now(), now(), now()
  from om_guests g
on conflict (provider_id, provider) do nothing;

-- terms_version: packages/core CURRENT_TERMS_VERSION, so the phone does not ask again.
update profiles p
   set phone         = g.phone,
       given_name    = g.given,
       family_name   = g.family,
       terms_version = '2026-09-29',
       gender        = g.gender,
       gender_set_at = coalesce(p.gender_set_at, now()),
       gender_set_by = coalesce(p.gender_set_by, 'guest')
  from om_guests g
 where p.id = g.id;

-- ---------------------------------------------------------------------------
-- Tickets: each guest topped up to their count of AVAILABLE tickets, one paid
-- one-ticket purchase each (the shape the fake bank leaves behind).
-- ---------------------------------------------------------------------------
do $om_tickets$
declare
  g       record;
  v_price bigint := (select match_ticket_price_iqd from platform_settings limit 1);
  v_have  int;
  v_pay   uuid;
  v_t     uuid;
begin
  for g in select * from om_guests loop
    select count(*) into v_have from match_tickets t where t.guest_id = g.id and t.status = 'available';
    for i in 1 .. greatest(g.tickets - v_have, 0) loop
      insert into booking_payments (venue_id, reservation_id, hold_id, guest_id, purpose, provider, sandbox,
                                    request_id, amount_iqd, quoted_price_iqd, ticket_count, status,
                                    succeeded_at, deadline_at)
      values (null, null, null, g.id, 'ticket', 'fake', false, gen_random_uuid(), v_price, v_price, 1,
              'succeeded', now(), now() + interval '15 minutes')
      returning id into v_pay;
      insert into match_tickets (guest_id, status, price_iqd, purchase_payment_id, sandbox)
      values (g.id, 'available', v_price, v_pay, false) returning id into v_t;
      insert into match_ticket_events (ticket_id, guest_id, type, payment_id) values (v_t, g.id, 'bought', v_pay);
    end loop;
  end loop;
end $om_tickets$;

-- ---------------------------------------------------------------------------
-- Matches, through the real RPCs.
-- ---------------------------------------------------------------------------
-- Runs p_sql with auth.uid() = p_uid and returns its jsonb result.
create function pg_temp.om_as(p_uid uuid, p_sql text) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute p_sql into v;
  perform set_config('request.jwt.claims', '', true);
  return v;
end $f$;

-- A guest starts a match the way the phone does: match_quote, then match_start.
create function pg_temp.om_start(p_uid uuid, p_court uuid, p_at timestamptz, p_category text,
                                 p_visibility text, p_policy text, p_friends jsonb default '[]')
returns jsonb language plpgsql as $f$
declare v_q jsonb; v_args text;
begin
  v_args := format('p_venue_id => %L, p_court_id => %L, p_start_at => %L, p_duration_min => 90',
                   'c0000000-0000-4000-8000-000000000001', p_court, p_at);
  v_q := pg_temp.om_as(p_uid, format('select app.match_quote(%s)', v_args));
  return pg_temp.om_as(p_uid, format(
    'select app.match_start(%s, p_category => %L, p_visibility => %L, p_join_policy => %L, '
    'p_friends => %L::jsonb, p_quoted_price_iqd => %s, p_idempotency_key => %L)',
    v_args, p_category, p_visibility, p_policy, p_friends, v_q->>'price_iqd',
    'fixture:match.start:' || gen_random_uuid()));
end $f$;

do $om_matches$
declare
  c1      constant uuid := 'f1f70000-0000-4000-8000-00000000c001';
  c2      constant uuid := 'f1f70000-0000-4000-8000-00000000c002';
  tester  constant uuid := 'f1f70000-0000-4000-8000-00000000f001';
  ali     constant uuid := 'f1f70000-0000-4000-8000-00000000f002';
  omar    constant uuid := 'f1f70000-0000-4000-8000-00000000f003';
  hassan  constant uuid := 'f1f70000-0000-4000-8000-00000000f004';
  karim   constant uuid := 'f1f70000-0000-4000-8000-00000000f005';
  sara    constant uuid := 'f1f70000-0000-4000-8000-00000000f006';
  noor    constant uuid := 'f1f70000-0000-4000-8000-00000000f007';
  desk    constant uuid := 'a0000000-0000-4000-8000-000000000005';
  d       date := (now() at time zone 'Asia/Baghdad')::date;
  r       jsonb;
  m1      uuid;
  m2      uuid;
  m3      uuid;
  m4      uuid;
  m5      uuid;
  m6      uuid;
begin
  if exists (select 1 from matches m
              where m.status in ('filling', 'awaiting_court', 'booked') and m.start_at > now()
                and (m.organiser_id in (select id from om_guests)
                     or m.created_by_staff_id = desk and m.venue_id = 'c0000000-0000-4000-8000-000000000001'
                        and exists (select 1 from match_seats s where s.match_id = m.id
                                     and s.guest_name like 'Fixture %'))) then
    raise notice '[open-matches] upcoming fixture matches already exist; matches skipped';
    return;
  end if;

  -- M1: 2/4, instant join.
  m1 := (pg_temp.om_start(ali, c1, ((d + 1) + time '18:00') at time zone 'Asia/Baghdad',
                          'open', 'public', 'open')->>'match_id')::uuid;
  perform pg_temp.om_as(omar, format('select app.match_join(p_match_id => %L)', m1));

  -- M2: women only, organiser approves. Sara brings a friend; Noor asks.
  m2 := (pg_temp.om_start(sara, c2, ((d + 1) + time '20:00') at time zone 'Asia/Baghdad',
                          'women', 'public', 'approve', '[{"gender":"female"}]')->>'match_id')::uuid;
  perform pg_temp.om_as(noor, format('select app.match_request(p_match_id => %L)', m2));

  -- M3: 3/4, Omar and two friends; whoever joins next books the court.
  m3 := (pg_temp.om_start(omar, c1, ((d + 2) + time '19:00') at time zone 'Asia/Baghdad',
                          'open', 'public', 'open', '[{"gender":"male"},{"gender":null}]')->>'match_id')::uuid;

  -- M4: full, so the 4th join books the court.
  m4 := (pg_temp.om_start(ali, c2, ((d + 2) + time '21:00') at time zone 'Asia/Baghdad',
                          'open', 'public', 'open')->>'match_id')::uuid;
  perform pg_temp.om_as(hassan, format('select app.match_join(p_match_id => %L)', m4));
  perform pg_temp.om_as(karim,  format('select app.match_join(p_match_id => %L)', m4));
  perform pg_temp.om_as(omar,   format('select app.match_join(p_match_id => %L)', m4));

  -- M5: link only; open it with the printed token (touchpadel://m/<token>).
  r  := pg_temp.om_start(karim, c1, ((d + 3) + time '20:00') at time zone 'Asia/Baghdad',
                         'open', 'link', 'open');
  m5 := (r->>'match_id')::uuid;

  -- M6: started at the desk for a walk-in, plus one nameless desk seat.
  m6 := (pg_temp.om_as(desk, format(
          'select app.desk_start_match(p_start_at => %L, p_duration_min => 90, p_category => %L, '
          'p_visibility => %L, p_join_policy => %L, p_guest_name => %L, p_guest_phone => %L, '
          'p_extra_seats => 1, p_court_id => %L, p_venue_id => %L, p_idempotency_key => %L)',
          ((d + 3) + time '18:00') at time zone 'Asia/Baghdad', 'open', 'public', 'open',
          'Fixture Walk-in', '+9647900000099', c2, 'c0000000-0000-4000-8000-000000000001',
          'fixture:match.desk_start:' || gen_random_uuid()))->>'match_id')::uuid;

  raise notice '[open-matches] M1 % | M2 % | M3 % | M4 % | M5 % | M6 %', m1, m2, m3, m4, m5, m6;
  raise notice '[open-matches] M5 link: touchpadel://m/%', r->>'share_token';
end $om_matches$;

commit;

select m.status, m.category, m.visibility, m.join_policy,
       to_char(m.start_at at time zone 'Asia/Baghdad', 'Dy DD Mon HH24:MI') as starts,
       (select count(*) from match_seats s where s.match_id = m.id and s.status = 'in') as seats,
       (select count(*) from match_requests q where q.match_id = m.id and q.status = 'pending') as requests
  from matches m
 where m.start_at > now()
   and m.venue_id = 'c0000000-0000-4000-8000-000000000001'
   and m.status in ('filling', 'awaiting_court', 'booked')
 order by m.start_at;
