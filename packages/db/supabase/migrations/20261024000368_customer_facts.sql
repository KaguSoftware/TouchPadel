set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0368 customer_facts — who the customer is (Majed 2026-10-24;
-- docs/design/customers/contracts-2026-10-24.md §1).
--
-- "The analytics currently shows a lot of numbers ... but there is nothing
-- that shows exactly who our customers are." Sign-up already asks the gender
-- (0256, a must since 0353) and the level (0334, skippable); nothing asked
-- the age, nobody ever checked a level, and no interest was ever derived.
--
--   1. profiles gains the age band (age_band, age_band_set_at) and the
--      CONFIRMED level (level_confirmed, _at, _by, _role, level_note): the
--      level a coach, the desk, a manager or the owner judged, beside the
--      play_level the guest claimed. Plain nullable columns with validated
--      CHECKs: no rewrite. Both stamped as pairs/blocks, like 0256's gender.
--      The effective level is coalesce(level_confirmed, play_level) —
--      app.effective_play_level — and nothing reads one without the other.
--   2. Writers: app.set_my_age_band (the guest's own, changeable: people age),
--      app.staff_set_customer_age_band and app.staff_set_customer_level (the
--      0262 staff_set_customer_gender pattern; the level also takes a coach,
--      who is not staff). app.set_my_play_profile (0334) is unchanged: the
--      level question being required is the phone's rule, not the server's, or
--      a skipped survey could no longer be recorded.
--   3. The measurement: app.level_suggestions reads CONFIRMED game_results
--      (0364) of the last 365 days and scores a player against the levels of
--      the opponents they beat, at five scored games or more;
--      app.customer_level_reviews lists the players whose suggestion
--      disagrees with the record, for the people allowed to judge.
--   4. The interests, derived and never asked (Majed: "without asking them,
--      of course, but by the data that they provide"):
--      app.customer_interest_tags turns what a player did in a window into a
--      closed, ordered list of behaviour words. No tag means money.
--   5. app.customer_record carries the three facts, the suggestion and the
--      tags (desk, manager, owner); app.desk_register_customer takes the age
--      band and the claimed level, so a walk-in is asked what the phone asks.
--   6. Account deletion and a merge: the six columns join
--      app.trg_profile_media_tombstone (0334) and the field-filling UPDATE of
--      app.merge_profiles_internal (0347), the level block as one unit so a
--      note never ends up under another judgment.
--
-- 0369 (customer_analytics) aggregates all of this for the owner's Analytics
-- and the marketing panel; nothing here reaches marketing by itself.
--
-- covered by packages/db/tests/customer-facts.test.ts

-- ---------------------------------------------------------------------------
-- 1. profiles: the age band and the confirmed level
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists age_band             text;
alter table profiles add column if not exists age_band_set_at      timestamptz;
alter table profiles add column if not exists level_confirmed      text;
alter table profiles add column if not exists level_confirmed_at   timestamptz;
alter table profiles add column if not exists level_confirmed_by   uuid references profiles(id);
alter table profiles add column if not exists level_confirmed_role text;
alter table profiles add column if not exists level_note           text;

comment on column profiles.age_band is
  '0368. The guest''s age band: u18 | 18_24 | 25_34 | 35_44 | 45_54 | 55_plus, NULL = not answered. Asked on the sign-up form (a must there, one tap), by complete-profile and by the survey; written by app.set_my_age_band (guest) or app.staff_set_customer_age_band / desk_register_customer (desk). Changeable: people age. Emptied by account deletion.';
comment on column profiles.age_band_set_at is
  '0368. When the age band was last written (never NULL while age_band is set, and NULL with it).';
comment on column profiles.level_confirmed is
  '0368. The level the club judged, in play_level''s vocabulary (new | beginner | intermediate | advanced); NULL = nobody has judged it, so the claimed play_level stands. Written only by app.staff_set_customer_level (coach, court desk, manager, owner). Emptied by account deletion.';
comment on column profiles.level_confirmed_at is
  '0368. When the level was confirmed.';
comment on column profiles.level_confirmed_by is
  '0368. The profile of the coach or staff member who confirmed the level. No client grant: the phone is told "confirmed by the club", never by whom; the desk reads the name through app.customer_record.';
comment on column profiles.level_confirmed_role is
  '0368. Who judged it: coach | court_desk | manager | owner.';
comment on column profiles.level_note is
  '0368. The judge''s optional note, one line of at most 120 characters (app.safe_line), staff-visible only.';

do $constraints_0368$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'profiles_age_band_chk'
                    and conrelid = 'public.profiles'::regclass) then
    alter table profiles add constraint profiles_age_band_chk check (
      age_band is null
      or age_band in ('u18', '18_24', '25_34', '35_44', '45_54', '55_plus')) not valid;
    alter table profiles validate constraint profiles_age_band_chk;
  end if;
  -- The band and its stamp are written together, or neither is.
  if not exists (select 1 from pg_constraint
                  where conname = 'profiles_age_band_stamp'
                    and conrelid = 'public.profiles'::regclass) then
    alter table profiles add constraint profiles_age_band_stamp check (
      (age_band is null) = (age_band_set_at is null)) not valid;
    alter table profiles validate constraint profiles_age_band_stamp;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'profiles_level_confirmed_chk'
                    and conrelid = 'public.profiles'::regclass) then
    alter table profiles add constraint profiles_level_confirmed_chk check (
      level_confirmed is null
      or level_confirmed in ('new', 'beginner', 'intermediate', 'advanced')) not valid;
    alter table profiles validate constraint profiles_level_confirmed_chk;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'profiles_level_confirmed_role_chk'
                    and conrelid = 'public.profiles'::regclass) then
    alter table profiles add constraint profiles_level_confirmed_role_chk check (
      level_confirmed_role is null
      or level_confirmed_role in ('coach', 'court_desk', 'manager', 'owner')) not valid;
    alter table profiles validate constraint profiles_level_confirmed_role_chk;
  end if;
  -- One judgment is one block: the level, its time, its judge and their role
  -- are all set or all NULL (the note may be NULL inside a set).
  if not exists (select 1 from pg_constraint
                  where conname = 'profiles_level_confirmed_stamp'
                    and conrelid = 'public.profiles'::regclass) then
    alter table profiles add constraint profiles_level_confirmed_stamp check (
      (level_confirmed is null) = (level_confirmed_at is null)
      and (level_confirmed is null) = (level_confirmed_by is null)
      and (level_confirmed is null) = (level_confirmed_role is null)
      and (level_confirmed is not null or level_note is null)) not valid;
    alter table profiles validate constraint profiles_level_confirmed_stamp;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'profiles_level_note_len'
                    and conrelid = 'public.profiles'::regclass) then
    alter table profiles add constraint profiles_level_note_len check (
      level_note is null or char_length(level_note) between 1 and 120) not valid;
    alter table profiles validate constraint profiles_level_note_len;
  end if;
end $constraints_0368$;

-- Read like the play profile (0334): the phone's own-profile select names
-- these columns, and the desk reads them through profiles_select as it reads
-- the name. No UPDATE grant: the RPCs below are the only writers. No grant on
-- level_confirmed_by — who judged is staff business (customer_record).
grant select (age_band, age_band_set_at, level_confirmed, level_confirmed_at,
              level_confirmed_role, level_note) on profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The level helpers. Internal: called by definer bodies only.
-- ---------------------------------------------------------------------------

-- A play level as a number: new 0, beginner 1, intermediate 2, advanced 3.
create or replace function app.play_level_rank(p_level text) returns int
language sql immutable set search_path = public as $play_level_rank_0368$
  select case p_level
           when 'new'          then 0
           when 'beginner'     then 1
           when 'intermediate' then 2
           when 'advanced'     then 3
           else null
         end
$play_level_rank_0368$;

comment on function app.play_level_rank(text) is
  '0368. Internal. A play level as a number (new 0 .. advanced 3), NULL for anything else.';

-- A rank back to its name, clamped into beginner..advanced: a suggestion from
-- five games never says "new".
create or replace function app.play_level_name(p_rank numeric) returns text
language sql immutable set search_path = public as $play_level_name_0368$
  select case
           when p_rank is null then null
           when p_rank <= 1 then 'beginner'
           when p_rank >= 3 then 'advanced'
           when round(p_rank) <= 1 then 'beginner'
           when round(p_rank) >= 3 then 'advanced'
           else 'intermediate'
         end
$play_level_name_0368$;

comment on function app.play_level_name(numeric) is
  '0368. Internal. A score back to a level name, clamped to beginner | intermediate | advanced: a measured suggestion never says "new".';

-- The level the club goes by: what it judged, else what the guest claimed.
create or replace function app.effective_play_level(p_confirmed text, p_claimed text) returns text
language sql immutable set search_path = public as $effective_play_level_0368$
  select coalesce(p_confirmed, p_claimed)
$effective_play_level_0368$;

comment on function app.effective_play_level(text, text) is
  '0368. Internal. The level every read goes by: profiles.level_confirmed when the club has judged one, else the claimed profiles.play_level.';

revoke all on function app.play_level_rank(text) from public, anon, authenticated;
revoke all on function app.play_level_name(numeric) from public, anon, authenticated;
revoke all on function app.effective_play_level(text, text) from public, anon, authenticated;
grant execute on function app.play_level_rank(text) to service_role;
grant execute on function app.play_level_name(numeric) to service_role;
grant execute on function app.effective_play_level(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. app.set_my_age_band — the guest's own band
-- ---------------------------------------------------------------------------
create or replace function app.set_my_age_band(p_band text) returns jsonb
language plpgsql security definer set search_path = public as $set_my_age_band_0368$
declare
  v_uid     uuid := auth.uid();
  v_profile profiles%rowtype;
  v_at      timestamptz;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  -- An anonymous café session has no profile (0004 skips is_anonymous), and a
  -- deleted account is a tombstone. This refusal is also what keeps
  -- check-rpc-authz.mjs, which calls every RPC as an anonymous guest, from
  -- writing anything.
  select * into v_profile from profiles where id = v_uid;
  if not found or v_profile.deleted_at is not null then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;

  if p_band is null or p_band not in ('u18', '18_24', '25_34', '35_44', '45_54', '55_plus') then
    raise exception 'INVALID_AGE_BAND' using errcode = 'P0001', detail = 'p_band', hint = 'p_band';
  end if;

  if v_profile.age_band = p_band then
    return jsonb_build_object('age_band', v_profile.age_band,
                              'age_band_set_at', v_profile.age_band_set_at, 'duplicate', true);
  end if;

  -- Unlike the gender (set once, OM-28) a band may be corrected and will be
  -- outgrown; the guest owns their own.
  update profiles
     set age_band        = p_band,
         age_band_set_at = now()
   where id = v_uid
     and deleted_at is null
  returning age_band_set_at into v_at;
  if not found then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;

  -- The audit row names the account and who set it, never the value (as
  -- set_my_gender, 0256): audit_log is append-only and outlives an account
  -- deletion, which erases the band.
  perform app.write_audit('profile.age_band_set', 'profiles', v_uid::text, null,
                          jsonb_build_object('set_by', 'guest',
                                             'had_band', v_profile.age_band is not null));

  return jsonb_build_object('age_band', p_band, 'age_band_set_at', v_at, 'duplicate', false);
end $set_my_age_band_0368$;

comment on function app.set_my_age_band(text) is
  '0368 (customers contracts §1.1). The caller''s own profile: the age band the sign-up form, complete-profile or the survey asked. p_band u18 | 18_24 | 25_34 | 35_44 | 45_54 | 55_plus. Changeable (people age), so the same value answers duplicate true rather than refusing. AUTH_REQUIRED; ACCOUNT_REQUIRED (no live profile); INVALID_AGE_BAND detail p_band. Audit profile.age_band_set without the value. Returns {age_band, age_band_set_at, duplicate}.';

revoke all on function app.set_my_age_band(text) from public, anon;
grant execute on function app.set_my_age_band(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.staff_set_customer_age_band — the desk asks a walk-in
--    (the 0262 app.staff_set_customer_gender pattern)
-- ---------------------------------------------------------------------------
create or replace function app.staff_set_customer_age_band(p_customer_id uuid, p_band text) returns jsonb
language plpgsql security definer set search_path = public as $staff_set_customer_age_band_0368$
declare
  v_p profiles%rowtype;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_band is not null and p_band not in ('u18', '18_24', '25_34', '35_44', '45_54', '55_plus') then
    raise exception 'INVALID_AGE_BAND' using errcode = 'P0001', detail = 'p_band';
  end if;
  if p_customer_id is not null then
    select * into v_p from profiles where id = p_customer_id;
  end if;
  if v_p.id is null or v_p.deleted_at is not null then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_p.age_band is not distinct from p_band then
    return jsonb_build_object('customer_id', v_p.id, 'age_band', v_p.age_band, 'duplicate', true);
  end if;

  update profiles
     set age_band        = p_band,
         age_band_set_at = case when p_band is null then null else now() end
   where id = v_p.id;

  perform app.write_audit('customer.age_band_set', 'profiles', v_p.id::text,
                          jsonb_build_object('had_band', v_p.age_band is not null),
                          jsonb_build_object('set_by', 'staff', 'cleared', p_band is null));

  return jsonb_build_object('customer_id', v_p.id, 'age_band', p_band, 'duplicate', false);
end $staff_set_customer_age_band_0368$;

comment on function app.staff_set_customer_age_band(uuid, text) is
  '0368 (customers contracts §1.1). Desk (court_desk, manager, owner): sets a customer''s age band, or clears it (NULL: the stamp goes with it). FORBIDDEN; INVALID_AGE_BAND detail p_band; CUSTOMER_NOT_FOUND (unknown or deleted); the same value -> duplicate. Audit customer.age_band_set without the value. Returns {customer_id, age_band, duplicate}.';

revoke all on function app.staff_set_customer_age_band(uuid, text) from public, anon;
grant execute on function app.staff_set_customer_age_band(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.staff_set_customer_level — "a manager or their performance will
--    judge if that level is actually accurate" (Majed 2026-10-24: a coach,
--    the desk or a manager writes it)
-- ---------------------------------------------------------------------------
create or replace function app.staff_set_customer_level(p_customer_id uuid,
                                                        p_level       text,
                                                        p_note        text default null)
returns jsonb
language plpgsql security definer set search_path = public as $staff_set_customer_level_0368$
declare
  v_uid  uuid := auth.uid();
  v_role text;
  v_p    profiles%rowtype;
  v_note text;
  v_at   timestamptz;
begin
  -- Who may judge: the owner, a manager, the court desk — or a coach, who is
  -- not staff at all (app.coach_self answers NULL for anyone else).
  if app.is_staff('owner') then
    v_role := 'owner';
  elsif app.is_staff('manager') then
    v_role := 'manager';
  elsif app.is_staff('court_desk') then
    v_role := 'court_desk';
  elsif (app.coach_self(false)).id is not null then
    v_role := 'coach';
  else
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_level is not null and p_level not in ('new', 'beginner', 'intermediate', 'advanced') then
    raise exception 'INVALID_PLAY_PROFILE' using errcode = 'P0001', detail = 'p_level', hint = 'p_level';
  end if;
  v_note := nullif(left(coalesce(app.safe_line(p_note), ''), 120), '');
  if p_level is null and v_note is not null then
    -- Clearing the judgment takes no note: there would be nothing to hang it on.
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_note';
  end if;

  if p_customer_id is not null then
    select * into v_p from profiles where id = p_customer_id;
  end if;
  if v_p.id is null or v_p.deleted_at is not null then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_p.level_confirmed is not distinct from p_level
     and v_p.level_note is not distinct from v_note then
    return jsonb_build_object('customer_id', v_p.id, 'level_confirmed', v_p.level_confirmed,
                              'level_confirmed_at', v_p.level_confirmed_at,
                              'level_confirmed_role', v_p.level_confirmed_role,
                              'level_note', v_p.level_note, 'duplicate', true);
  end if;

  -- profiles_level_confirmed_stamp: the judgment is one block, or all NULL.
  update profiles
     set level_confirmed      = p_level,
         level_confirmed_at   = case when p_level is null then null else now() end,
         level_confirmed_by   = case when p_level is null then null else v_uid end,
         level_confirmed_role = case when p_level is null then null else v_role end,
         level_note           = case when p_level is null then null else v_note end
   where id = v_p.id
  returning level_confirmed_at into v_at;

  -- The level is not personal information the way a gender or a band is: it is
  -- the club's own judgment about a player, so the audit row carries it.
  perform app.write_audit('customer.level_confirmed', 'profiles', v_p.id::text,
                          jsonb_build_object('level_confirmed', v_p.level_confirmed,
                                             'role', v_p.level_confirmed_role),
                          jsonb_build_object('level_confirmed', p_level, 'role',
                                             case when p_level is null then null else v_role end,
                                             'claimed', v_p.play_level,
                                             'cleared', p_level is null));

  return jsonb_build_object('customer_id', v_p.id, 'level_confirmed', p_level,
                            'level_confirmed_at', v_at,
                            'level_confirmed_role', case when p_level is null then null else v_role end,
                            'level_note', case when p_level is null then null else v_note end,
                            'duplicate', false);
end $staff_set_customer_level_0368$;

comment on function app.staff_set_customer_level(uuid, text, text) is
  '0368 (customers contracts §1.1, Majed 2026-10-24: "coach or manager or desk staff"). Coach (app.coach_self), court_desk, manager or owner: confirms a customer''s real level (new | beginner | intermediate | advanced) with an optional one-line note, stamping who judged and their role; p_level NULL clears the judgment back to the claimed play_level and takes no note. FORBIDDEN; INVALID_PLAY_PROFILE detail p_level; INVALID_ARGUMENT detail p_note (a note with no level); CUSTOMER_NOT_FOUND (unknown or deleted); the same level and note -> duplicate. Audit customer.level_confirmed with the level, the role and the claim. Returns {customer_id, level_confirmed, level_confirmed_at, level_confirmed_role, level_note, duplicate}.';

revoke all on function app.staff_set_customer_level(uuid, text, text) from public, anon;
grant execute on function app.staff_set_customer_level(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The measurement: a level suggested by the games actually played
--    ("it will be measured ... their performance will judge")
-- ---------------------------------------------------------------------------
-- Chain-wide on purpose: a player's level is a property of the player, not of
-- a branch. One confirmed result says something only when at least one of the
-- opponents has a level to compare against; a win against intermediate
-- players counts for more than a win against beginners, and a loss for less.
create or replace function app.level_suggestions(p_profile_ids uuid[] default null)
returns table (profile_id uuid, level text, games int, wins int, losses int, score numeric)
language sql stable security definer set search_path = public as $level_suggestions_0368$
  with seats as (
    select g.id, g.winner, s.pid, s.side
      from game_results g
      cross join lateral (values (g.a1, 'a'), (g.a2, 'a'), (g.b1, 'b'), (g.b2, 'b')) s(pid, side)
     where g.status = 'confirmed'
       and g.played_at >= now() - interval '365 days'
       and s.pid is not null
  ),
  -- Per game and player: how good the other side was, on average.
  opp as (
    select me.id, me.pid, me.winner, me.side,
           avg(app.play_level_rank(app.effective_play_level(p.level_confirmed, p.play_level)))::numeric as opp_rank
      from seats me
      join seats them on them.id = me.id and them.side <> me.side
      join profiles p on p.id = them.pid and p.deleted_at is null
     where (p_profile_ids is null or me.pid = any (p_profile_ids))
     group by me.id, me.pid, me.winner, me.side
  ),
  scored as (
    select o.pid,
           o.opp_rank + case when o.winner = 'draw' then 0
                             when o.winner = o.side then 0.5
                             else -0.5 end                        as point,
           (o.winner <> 'draw' and o.winner = o.side)             as won,
           (o.winner <> 'draw' and o.winner <> o.side)             as lost
      from opp o
     where o.opp_rank is not null
  )
  select s.pid,
         app.play_level_name(avg(s.point)),
         count(*)::int,
         count(*) filter (where s.won)::int,
         count(*) filter (where s.lost)::int,
         round(avg(s.point), 2)
    from scored s
   group by s.pid
  having count(*) >= 5
$level_suggestions_0368$;

comment on function app.level_suggestions(uuid[]) is
  '0368 (customers contracts §1.2). Internal, chain-wide: the level the last 365 days of CONFIRMED game_results suggest for each player (every player, or the ids given). A game counts only when at least one opponent has an effective level; the score is the average of the opponents'' level plus 0.5 for a win and -0.5 for a loss, and nobody is judged on fewer than five such games. Returns (profile_id, level beginner|intermediate|advanced, games, wins, losses, score).';

create or replace function app.level_suggested(p_profile_id uuid) returns jsonb
language sql stable security definer set search_path = public as $level_suggested_0368$
  select jsonb_build_object('level', s.level, 'games', s.games, 'wins', s.wins,
                            'losses', s.losses, 'score', s.score)
    from app.level_suggestions(array[p_profile_id]) s
$level_suggested_0368$;

comment on function app.level_suggested(uuid) is
  '0368. Internal: app.level_suggestions for one player as {level, games, wins, losses, score}, or no row (NULL) when there is not enough played to say anything.';

revoke all on function app.level_suggestions(uuid[]) from public, anon, authenticated;
revoke all on function app.level_suggested(uuid) from public, anon, authenticated;
grant execute on function app.level_suggestions(uuid[]) to service_role;
grant execute on function app.level_suggested(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7. app.customer_level_reviews — the players whose claim the games disagree
--    with, for the people allowed to judge
-- ---------------------------------------------------------------------------
create or replace function app.customer_level_reviews(p_limit int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $customer_level_reviews_0368$
declare
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_out   jsonb;
begin
  if not app.is_staff('court_desk', 'manager', 'owner')
     and (app.coach_self(false)).id is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(x.j order by x.gap desc, x.games desc, x.profile_id), '[]'::jsonb)
    into v_out
    from (select p.id as profile_id,
                 s.games,
                 abs(app.play_level_rank(s.level)
                     - app.play_level_rank(app.effective_play_level(p.level_confirmed, p.play_level))) as gap,
                 jsonb_build_object(
                   'profile_id',     p.id,
                   'full_name',      p.full_name,
                   'claimed',        p.play_level,
                   'confirmed',      p.level_confirmed,
                   'confirmed_role', p.level_confirmed_role,
                   'suggested',      s.level,
                   'games',          s.games,
                   'wins',           s.wins,
                   'losses',         s.losses,
                   'score',          s.score,
                   'last_played_at', (select max(g.played_at)
                                        from game_results g
                                       where g.status = 'confirmed'
                                         and p.id in (g.a1, g.a2, g.b1, g.b2))) as j
            from app.level_suggestions(null) s
            join profiles p on p.id = s.profile_id and p.deleted_at is null
           where p.level_confirmed is null or p.level_confirmed <> s.level
           order by abs(app.play_level_rank(s.level)
                        - coalesce(app.play_level_rank(app.effective_play_level(p.level_confirmed, p.play_level)), 0)) desc,
                    s.games desc, p.id
           limit v_limit) x;

  return v_out;
end $customer_level_reviews_0368$;

comment on function app.customer_level_reviews(int) is
  '0368 (customers contracts §1.2). Coach, court_desk, manager or owner: the players whose measured suggestion disagrees with what the club has on record (no confirmed level, or a different one), biggest disagreement first, then most games; at most p_limit (default 30, capped at 100). Each row {profile_id, full_name, claimed, confirmed, confirmed_role, suggested, games, wins, losses, score, last_played_at}. Confirm or agree through app.staff_set_customer_level, which takes the row off the list. FORBIDDEN.';

revoke all on function app.customer_level_reviews(int) from public, anon;
grant execute on function app.customer_level_reviews(int) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. app.customer_interest_tags — what they are into, never asked
--    (Majed: "without asking them, of course, but by the data that they
--    provide")
-- ---------------------------------------------------------------------------
-- A tag is a behaviour word, never a figure, and never money: 0360's rule is
-- that marketing sees no money, and a word that means money IS money. The
-- list is closed and ordered; a caller prints it as it comes.
create or replace function app.customer_interest_tags(
  p_venue_ids    uuid[],
  p_profile_ids  uuid[] default null,
  p_from         timestamptz default null,
  p_to           timestamptz default null,
  p_tz           text default 'Asia/Baghdad',
  p_start_hour   int default 4
) returns table (profile_id uuid, tags text[])
language sql stable security definer set search_path = public as $customer_interest_tags_0368$
  with args as (
    select coalesce(p_from, now() - interval '180 days') as ts_from,
           coalesce(p_to, now())                        as ts_to
  ),
  -- A play with a real start time: a court they booked, or an open-match seat
  -- they sat in. Only these carry a "when", so only these are measured for
  -- the time-of-day and weekend words.
  plays as (
    select r.guest_id as pid, r.start_at, 'court'::text as source
      from reservations r
      cross join args a
     where r.venue_id = any (p_venue_ids)
       and r.kind = 'booking'
       and r.status in ('confirmed', 'arrived', 'completed')
       and r.guest_id is not null
       and (p_profile_ids is null or r.guest_id = any (p_profile_ids))
       and r.start_at >= a.ts_from and r.start_at < a.ts_to
    union all
    select ms.guest_id, m.start_at, 'match'
      from match_seats ms
      join matches m on m.id = ms.match_id
      cross join args a
     where m.venue_id = any (p_venue_ids)
       and not m.sandbox
       and ms.guest_id is not null
       and (p_profile_ids is null or ms.guest_id = any (p_profile_ids))
       and ms.status in ('in', 'attended', 'left_late')
       and m.start_at >= a.ts_from and m.start_at < a.ts_to
  ),
  played as (
    select pid,
           count(*)::int                                                   as n,
           count(*) filter (where source = 'court')::int                   as courts,
           count(*) filter (where source = 'match')::int                   as matches,
           count(*) filter (where extract(dow from app.business_date(start_at, p_tz, p_start_hour)) in (5, 6))::int as weekend,
           count(*) filter (where extract(hour from (start_at at time zone p_tz)) >= 18)::int as evening,
           count(*) filter (where extract(hour from (start_at at time zone p_tz)) < 16)::int  as daytime,
           count(*) filter (where extract(hour from (start_at at time zone p_tz)) >= 22)::int as late
      from plays
     group by pid
  ),
  lessons as (
    select e.guest_id as pid, count(*)::int as n,
           count(*) filter (where e.party_size > 1)::int as with_friends
      from lesson_enrolments e
      cross join args a
     where e.venue_id = any (p_venue_ids)
       and e.guest_id is not null
       and (p_profile_ids is null or e.guest_id = any (p_profile_ids))
       and e.status = 'booked'
       and e.created_at >= a.ts_from and e.created_at < a.ts_to
     group by e.guest_id
  ),
  tourneys as (
    select te.guest_id as pid, count(*)::int as n
      from tournament_entries te
      cross join args a
     where te.venue_id = any (p_venue_ids)
       and (p_profile_ids is null or te.guest_id = any (p_profile_ids))
       and te.status in ('registered', 'waitlisted')
       and te.entered_at >= a.ts_from and te.entered_at < a.ts_to
     group by te.guest_id
  ),
  spend as (
    select t.customer_id as pid,
           count(*) filter (where t.kind = 'cafe')::int as cafe,
           count(*) filter (where t.kind = 'shop')::int as shop
      from tabs t
      cross join args a
     where t.venue_id = any (p_venue_ids)
       and t.customer_id is not null
       and (p_profile_ids is null or t.customer_id = any (p_profile_ids))
       and t.opened_at >= a.ts_from and t.opened_at < a.ts_to
     group by t.customer_id
  ),
  offers as (
    select l.profile_id as pid, count(*)::int as n
      from loyalty_ledger l
      cross join args a
     where l.kind in ('redeem', 'reward')
       and (p_profile_ids is null or l.profile_id = any (p_profile_ids))
       and l.created_at >= a.ts_from and l.created_at < a.ts_to
     group by l.profile_id
  ),
  discounted as (
    select cd.customer_id as pid
      from customer_discounts cd
     where (p_profile_ids is null or cd.customer_id = any (p_profile_ids))
  ),
  ranked as (
    select s.pid, count(*)::int as n
      from (select g.id, x.pid
              from game_results g
              cross join args a
              cross join lateral (values (g.a1), (g.a2), (g.b1), (g.b2)) x(pid)
             where g.status = 'confirmed'
               and x.pid is not null
               and (p_profile_ids is null or x.pid = any (p_profile_ids))
               and g.played_at >= a.ts_from and g.played_at < a.ts_to) s
     group by s.pid
  ),
  organised as (
    select m.organiser_id as pid, count(*)::int as n
      from matches m
      cross join args a
     where m.venue_id = any (p_venue_ids)
       and not m.sandbox
       and m.organiser_id is not null
       and (p_profile_ids is null or m.organiser_id = any (p_profile_ids))
       and m.start_at >= a.ts_from and m.start_at < a.ts_to
     group by m.organiser_id
  ),
  everyone as (
    select pid from played
    union select pid from lessons
    union select pid from tourneys
    union select pid from spend
    union select pid from offers
    union select pid from discounted
    union select pid from ranked
    union select pid from organised
  )
  select e.pid,
         array_remove(array[
           case when coalesce(pl.courts, 0) >= 2 then 'courts' end,
           case when coalesce(pl.matches, 0) >= 1 then 'matches' end,
           case when coalesce(tn.n, 0) >= 1 then 'tournaments' end,
           case when coalesce(ls.n, 0) >= 1 then 'lessons' end,
           case when coalesce(sp.cafe, 0) >= 2 then 'cafe' end,
           case when coalesce(sp.shop, 0) >= 1 then 'shop' end,
           case when coalesce(pl.n, 0) >= 4 then 'regular' end,
           -- A share needs something to be a share OF: three plays at least,
           -- or one evening visit would make somebody an evening player.
           case when coalesce(pl.n, 0) >= 3 and pl.weekend::numeric / pl.n >= 0.6 then 'weekend' end,
           case when coalesce(pl.n, 0) >= 3 and pl.evening::numeric / pl.n >= 0.6 then 'evenings' end,
           case when coalesce(pl.n, 0) >= 3 and pl.daytime::numeric / pl.n >= 0.6 then 'daytime' end,
           case when coalesce(pl.n, 0) >= 3 and pl.late::numeric / pl.n >= 0.4 then 'late' end,
           case when coalesce(og.n, 0) + coalesce(ls.with_friends, 0) >= 2 then 'group' end,
           case when coalesce(of.n, 0) >= 1 or dc.pid is not null then 'offers' end,
           case when coalesce(rk.n, 0) >= 1 then 'ranked' end
         ], null)
    from everyone e
    left join played    pl on pl.pid = e.pid
    left join lessons   ls on ls.pid = e.pid
    left join tourneys  tn on tn.pid = e.pid
    left join spend     sp on sp.pid = e.pid
    left join offers    of on of.pid = e.pid
    left join discounted dc on dc.pid = e.pid
    left join ranked    rk on rk.pid = e.pid
    left join organised og on og.pid = e.pid
$customer_interest_tags_0368$;

comment on function app.customer_interest_tags(uuid[], uuid[], timestamptz, timestamptz, text, int) is
  '0368 (customers contracts §1.3). Internal: what each player is into, derived from what they did at the branches given, inside the window (default the last 180 days), never asked. The closed, ordered list: courts (2+ bookings), matches (a seat), tournaments (an entry), lessons (an enrolment), cafe (2+ own tabs), shop (a Touch Shop tab), regular (4+ plays), weekend / evenings / daytime (60 % of 3+ plays, business day and branch time) and late (40 %), group (2+ matches organised or lessons for more than one), offers (a loyalty redemption, reward or standing discount) and ranked (a confirmed result). No tag means money. Returns (profile_id, tags).';

revoke all on function app.customer_interest_tags(uuid[], uuid[], timestamptz, timestamptz, text, int) from public, anon, authenticated;
grant execute on function app.customer_interest_tags(uuid[], uuid[], timestamptz, timestamptz, text, int) to service_role;

-- ---------------------------------------------------------------------------
-- 9. app.customer_record: re-issued from
--    20260929000262_match_desk_money.sql:3418 verbatim, plus the `player`
--    block — the three facts, the measured suggestion and the interest tags
--    (owner, manager and desk see a person's tags; marketing never does).
-- ---------------------------------------------------------------------------
create or replace function app.customer_record(p_customer_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $customer_record_0368$
declare
  v_customer jsonb;
  v_player   jsonb;
begin
  if not app.is_staff('court_desk','cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
           'id',             p.id,
           'full_name',      p.full_name,
           'phone',          p.phone,
           'email',          u.email,
           'preferred_lang', p.preferred_lang,
           'created_at',     p.created_at,
           'gender',         p.gender,
           'gender_set_by',  p.gender_set_by)
    into v_customer
    from profiles p
    left join auth.users u on u.id = p.id
   where p.id = p_customer_id;
  if v_customer is null then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- 0368: who this player is. `interests` is derived from the last 180 days at
  -- the branches in scope and is never asked (customers contracts §1.3);
  -- `suggested` is NULL until five scored games exist.
  select jsonb_build_object(
           'age_band',               p.age_band,
           'claimed_level',          p.play_level,
           'play_years',             p.play_years,
           'play_wants',             to_jsonb(coalesce(p.play_wants, '{}'::text[])),
           'level_confirmed',        p.level_confirmed,
           'level_confirmed_at',     p.level_confirmed_at,
           'level_confirmed_role',   p.level_confirmed_role,
           'level_confirmed_by_name', coalesce(
             (select s.display_name from staff s where s.id = p.level_confirmed_by),
             (select pr.full_name   from profiles pr where pr.id = p.level_confirmed_by)),
           'level_note',             p.level_note,
           'effective_level',        app.effective_play_level(p.level_confirmed, p.play_level),
           'suggested',              app.level_suggested(p.id),
           'interests', to_jsonb(coalesce(
             (select t.tags
                from app.customer_interest_tags((select app.visible_venue_ids())::uuid[],
                                                array[p.id], now() - interval '180 days', now()) t
               limit 1), '{}'::text[])))
    into v_player
    from profiles p
   where p.id = p_customer_id;

  return jsonb_build_object(
    'customer', v_customer,
    'player',   v_player,
    'flags',    app.customer_flags_json(p_customer_id),
    'counts',   app.customer_counts(p_customer_id),
    'upcoming', coalesce(
      (select jsonb_agg(app.customer_reservation_json(r, c) order by r.start_at)
         from reservations r
         join courts c on c.id = r.court_id
        where r.guest_id = p_customer_id
          and r.start_at >= now()
          and r.status in ('pending','confirmed','arrived')),
      '[]'::jsonb),
    'history', coalesce(
      (select jsonb_agg(h.payload order by h.start_at desc)
         from (select app.customer_reservation_json(r, c) as payload, r.start_at
                 from reservations r
                 join courts c on c.id = r.court_id
                where r.guest_id = p_customer_id
                  and r.kind <> 'hold'
                  and not (r.start_at >= now() and r.status in ('pending','confirmed','arrived'))
                order by r.start_at desc
                limit 50) h),
      '[]'::jsonb),
    -- 0262: open matches (one row per match: the customer's own seat, account
    -- or linked desk, before a friend seat they hold), newest first.
    'matches', coalesce(
      (select jsonb_agg(x.j order by x.start_at desc, x.id)
         from (select m.id, m.start_at,
                      jsonb_build_object('match_id', m.id, 'reservation_id', m.reservation_id,
                                         'venue_id', m.venue_id, 'status', m.status,
                                         'start_at', m.start_at, 'end_at', m.end_at, 'category', m.category,
                                         'seat_status', s.status, 'kind', s.kind) as j
                 from matches m
                 join lateral (select ms.status, ms.kind
                                 from match_seats ms
                                where ms.match_id = m.id and ms.guest_id = p_customer_id
                                order by (ms.kind <> 'friend') desc, ms.joined_at desc, ms.id desc
                                limit 1) s on true
                where not m.sandbox
                order by m.start_at desc, m.id
                limit 20) x),
      '[]'::jsonb),
    'cafeOrders', coalesce(
      (select jsonb_agg(jsonb_build_object(
                          'id',             t.id,
                          'opened_at',      t.opened_at,
                          'total_iqd',      t.total_iqd,
                          'status',         t.status,
                          'reservation_id', t.reservation_id)
                        order by t.opened_at desc)
         from tabs t
        where t.reservation_id in (select r.id from reservations r where r.guest_id = p_customer_id)),
      '[]'::jsonb),
    'notes', coalesce(
      (select jsonb_agg(jsonb_build_object(
                          'id',             n.id,
                          'body',           n.body,
                          'author_id',      n.author_id,
                          'author_name',    a.display_name,
                          'created_at',     n.created_at,
                          'edited_at',      n.edited_at,
                          'edited_by',      n.edited_by,
                          'edited_by_name', e.display_name)
                        order by n.created_at desc)
         from customer_notes n
         join staff a on a.id = n.author_id
         left join staff e on e.id = n.edited_by
        where n.customer_id = p_customer_id),
      '[]'::jsonb),
    -- 0066 (series lane) fills this; the key exists now so the screen can bind to it.
    'series', '[]'::jsonb);
end $customer_record_0368$;

comment on function app.customer_record(uuid) is
  '0368 = the 0262 record plus player: {age_band, claimed_level, play_years, play_wants, level_confirmed, level_confirmed_at, level_confirmed_role, level_confirmed_by_name, level_note, effective_level, suggested (app.level_suggested: {level, games, wins, losses, score} or null), interests (app.customer_interest_tags over the last 180 days at the branches in scope, derived, never asked)}. 0262 = the 0065 record plus customer.gender and customer.gender_set_by (OM-28) and matches[]; counts gain matchesPlayed, matchNoShows, lateLeaves (customer_counts). Court desk, cashier, manager, owner. CUSTOMER_NOT_FOUND.';

revoke all on function app.customer_record(uuid) from public, anon;
grant execute on function app.customer_record(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. app.desk_register_customer: re-issued from
--     20261019000353_court_gender_rules.sql:379 verbatim, plus p_age_band and
--     p_play_level — the desk asks a walk-in what the sign-up form asks.
-- ---------------------------------------------------------------------------
drop function if exists app.desk_register_customer(uuid, text, text, text, uuid, text);

create or replace function app.desk_register_customer(
  p_customer_id    uuid,
  p_full_name      text,
  p_phone          text,
  p_preferred_lang text,
  p_actor_id       uuid,
  p_gender         text default null,
  p_age_band       text default null,
  p_play_level     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $desk_register_customer_0368$
declare
  v_name   text := btrim(coalesce(p_full_name, ''));
  v_phone  text := btrim(coalesce(p_phone, ''));
  v_digits text := app.phone_digits(p_phone);
  v_canon  text := app.phone_canon(p_phone);
  v_lang   text := coalesce(p_preferred_lang, 'en');
  v_actor  staff%rowtype;
  v_dup    uuid;
  v_row    profiles%rowtype;
begin
  select * into v_actor from staff where id = p_actor_id and is_active;
  if not found or v_actor.role not in ('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if length(v_name) = 0 or length(v_name) > 80 then
    raise exception 'NAME_LENGTH' using errcode = 'P0001',
      hint = 'full name must be 1-80 characters';
  end if;
  if v_digits is null or length(v_digits) < 7 or length(v_digits) > 15 then
    raise exception 'INVALID_PHONE' using errcode = 'P0001',
      hint = '7-15 digits';
  end if;
  if v_lang not in ('en','ar') then
    raise exception 'INVALID_LANG' using errcode = 'P0001';
  end if;
  -- 0353: the desk says whether the customer is a woman or a man.
  if p_gender is not null and p_gender not in ('female', 'male') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_gender';
  end if;
  -- 0368: and, when the customer says so, their age band and their own level.
  if p_age_band is not null and p_age_band not in ('u18', '18_24', '25_34', '35_44', '45_54', '55_plus') then
    raise exception 'INVALID_AGE_BAND' using errcode = 'P0001', detail = 'p_age_band';
  end if;
  if p_play_level is not null and p_play_level not in ('new', 'beginner', 'intermediate', 'advanced') then
    raise exception 'INVALID_PLAY_PROFILE' using errcode = 'P0001', detail = 'p_play_level';
  end if;
  if not exists (select 1 from auth.users where id = p_customer_id) then
    raise exception 'AUTH_USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Re-check under the write: the edge function's pre-check and this call are
  -- two round trips, and two desks can type the same walk-in at once. 0307
  -- (c1): only a keyed holder (a verified owner, a desk walk-in) is a
  -- duplicate; a guest who only typed the number blocks nobody.
  select p.id into v_dup
    from profiles p
   where p.id <> p_customer_id
     and p.phone_key = v_canon
     and p.deleted_at is null
   limit 1;
  if v_dup is not null then
    raise exception 'DUPLICATE_PHONE' using errcode = 'P0001',
      detail = v_dup::text;
  end if;

  -- 0307: the desk vouches for this number, so zz_phone_key keys it
  -- (app.profile_is_desk_walkin) before the audit row below exists.
  perform set_config('app.desk_walkin', p_customer_id::text, true);

  -- The 0058 trigger normally created this row from user_metadata already;
  -- the upsert makes the outcome the same either way. A holder that keyed the
  -- number since the re-check (zz_phone_key then stores this row keyless, or
  -- the unique index refuses it) is the same duplicate.
  begin
    insert into profiles (id, full_name, phone, preferred_lang, gender, gender_set_at, gender_set_by,
                          age_band, age_band_set_at, play_level, play_survey_at)
    values (p_customer_id, v_name, v_phone, v_lang, p_gender,
            case when p_gender is not null then now() end,
            case when p_gender is not null then 'staff' end,
            p_age_band,
            case when p_age_band is not null then now() end,
            p_play_level,
            case when p_play_level is not null then now() end)
    on conflict (id) do update
      set full_name      = excluded.full_name,
          phone          = excluded.phone,
          preferred_lang = excluded.preferred_lang,
          gender         = coalesce(excluded.gender, profiles.gender),
          gender_set_at  = case when excluded.gender is not null then excluded.gender_set_at
                                else profiles.gender_set_at end,
          gender_set_by  = case when excluded.gender is not null then excluded.gender_set_by
                                else profiles.gender_set_by end,
          -- 0368: a band or a level given at the desk fills a hole, and
          -- never overwrites what the customer answered themselves.
          age_band       = coalesce(profiles.age_band, excluded.age_band),
          age_band_set_at = case when profiles.age_band is null and excluded.age_band is not null
                                 then excluded.age_band_set_at else profiles.age_band_set_at end,
          play_level     = coalesce(profiles.play_level, excluded.play_level),
          play_survey_at = coalesce(profiles.play_survey_at, excluded.play_survey_at)
    returning * into v_row;
  exception when unique_violation then
    v_row.phone_key := null;
  end;

  perform set_config('app.desk_walkin', '', true);

  if v_row.phone_key is distinct from v_canon then
    select p.id into v_dup
      from profiles p
     where p.id <> p_customer_id and p.phone_key = v_canon and p.deleted_at is null
     limit 1;
    raise exception 'DUPLICATE_PHONE' using errcode = 'P0001',
      detail = coalesce(v_dup::text, '');
  end if;

  insert into audit_log (actor_id, actor_role, action, entity, entity_id, before, after)
  values (p_actor_id, v_actor.role::text, 'customer.create', 'profiles', p_customer_id::text, null,
          jsonb_build_object('full_name', v_row.full_name, 'phone', v_row.phone,
                             'preferred_lang', v_row.preferred_lang, 'source', 'desk',
                             'gender_set', v_row.gender is not null,
                             'age_band_set', v_row.age_band is not null,
                             'level_set', v_row.play_level is not null));

  return jsonb_build_object('id', v_row.id, 'full_name', v_row.full_name,
                            'phone', v_row.phone, 'preferred_lang', v_row.preferred_lang,
                            'gender', v_row.gender, 'age_band', v_row.age_band,
                            'play_level', v_row.play_level);
end $desk_register_customer_0368$;

comment on function app.desk_register_customer(uuid, text, text, text, uuid, text, text, text) is
  '0065, 0307, 0353, 0368. Service role (desk-customer-create). Registers a desk walk-in''s profile for an auth user the edge function just made: FORBIDDEN unless p_actor_id is an active court_desk, manager or owner; NAME_LENGTH (1-80), INVALID_PHONE (7-15 digits), INVALID_LANG, INVALID_ARGUMENT detail p_gender (female | male, or NULL from a desk build before 0353), INVALID_AGE_BAND detail p_age_band, INVALID_PLAY_PROFILE detail p_play_level (both 0368, both NULL from an older desk), AUTH_USER_NOT_FOUND, DUPLICATE_PHONE (detail the keyed holder). The desk vouches for the number (app.desk_walkin), a given gender is stamped gender_set_by staff, and a band or level given only fills a hole — never over what the customer answered themselves. Audits customer.create (gender_set, age_band_set, level_set; never a value). Returns {id, full_name, phone, preferred_lang, gender, age_band, play_level}.';

revoke all on function app.desk_register_customer(uuid, text, text, text, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function app.desk_register_customer(uuid, text, text, text, uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 11. app.trg_profile_media_tombstone: re-created from
--     20261011000334_play_profile_coach_levels.sql:157 verbatim, plus the six
--     0368 columns. An account deletion (and a merge's drop) erases the band
--     and the judgment with everything else personal.
-- ---------------------------------------------------------------------------
create or replace function app.trg_profile_media_tombstone() returns trigger
language plpgsql security definer set search_path = public as $trg_profile_media_tombstone_0368$
begin
  if tg_op = 'DELETE' then
    insert into avatar_purges (path) values (old.id::text);
    return old;
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    new.avatar_path := null;
    new.birth_date  := null;
    insert into avatar_purges (path) values (new.id::text);
    -- 0314: the username is held from everyone else for 90 days.
    if old.username is not null then
      insert into username_holds (username, profile_id, released_at, reason)
      values (old.username, new.id, now() + interval '90 days', 'deleted')
      on conflict (username) do update
        set profile_id = excluded.profile_id, held_at = now(),
            released_at = excluded.released_at, reason = excluded.reason;
    end if;
    new.username            := null;
    new.username_changed_at := null;
    new.avatar_frame        := 'brand-green';
    new.avatar_frame_style  := 'solid';
    -- 0334: the play survey's answers.
    new.play_level     := null;
    new.play_years     := null;
    new.play_wants     := null;
    new.play_survey_at := null;
    -- 0368: the age band and the club's judgment of their level.
    new.age_band             := null;
    new.age_band_set_at      := null;
    new.level_confirmed      := null;
    new.level_confirmed_at   := null;
    new.level_confirmed_by   := null;
    new.level_confirmed_role := null;
    new.level_note           := null;
  end if;
  return new;
end $trg_profile_media_tombstone_0368$;

comment on function app.trg_profile_media_tombstone() is
  '0302, username and frame since 0314, frame style since 0317, the play profile since 0334, the age band and the confirmed level since 0368. Trigger profiles_media_tombstone: on the 0077 tombstone UPDATE (account deletion, or a 0303 merge''s drop), empties avatar_path, birth_date, the username (held 90 days in username_holds), the play profile (play_level, play_years, play_wants, play_survey_at), the age band (age_band, age_band_set_at) and the confirmed level (level_confirmed, _at, _by, _role, level_note), and puts the frame back to brand-green, solid; on that UPDATE or a DELETE, queues the account''s whole avatars folder in avatar_purges.';

-- ---------------------------------------------------------------------------
-- 12. app.merge_profiles_internal: re-created from
--     20261017000347_discounts_merge.sql:85, verbatim plus the age band and
--     the confirmed-level block in section 4 (the fields keep lacks).
-- ---------------------------------------------------------------------------
create or replace function app.merge_profiles_internal(p_keep uuid, p_drop uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $merge_profiles_internal_0368$
declare
  v_keep     profiles%rowtype;
  v_drop     profiles%rowtype;
  v_moved    jsonb := '{}'::jsonb;
  v_n        bigint;
  v_c        record;
  v_actor    uuid := auth.uid();
  v_claims   text := current_setting('request.jwt.claims', true);
  v_sub      text := current_setting('request.jwt.claim.sub', true);
  v_ku       auth.users%rowtype;
  v_du       auth.users%rowtype;
  v_keep_synth boolean;
  v_merge_id uuid;
  v_claim    boolean := p_reason = 'walkin_claim';
  v_proven   boolean;
  v_take_email boolean := false;
  v_take_phone boolean := false;
  v_take_ids boolean := false;
  v_venue    text := current_setting('app.venue_id', true);
  v_te       record;
  v_k        tournament_entries%rowtype;
  v_d        tournament_entries%rowtype;
  v_win      uuid;
  v_lose     tournament_entries%rowtype;
  v_ts       text;
  v_le       record;
begin
  if p_keep is null or p_drop is null then
    raise exception 'MERGE_REFUSED' using errcode = 'P0001', detail = 'missing';
  end if;
  if p_keep = p_drop then
    raise exception 'MERGE_REFUSED' using errcode = 'P0001', detail = 'same';
  end if;

  -- 1. Locks. The tournaments both accounts entered, in id order (every
  -- tournament body takes its tournaments row before its entries), then both
  -- profiles in uuid order FOR NO KEY UPDATE: the merge never changes a key,
  -- so a settle's deferred ledger insert (an FK key share on the profile,
  -- taken while it holds the tab) never waits on it (0307, c20).
  perform 1 from tournaments
   where id in (select tournament_id from tournament_entries where guest_id in (p_keep, p_drop))
   order by id for update;
  perform 1 from profiles where id in (p_keep, p_drop) order by id for no key update;
  select * into v_keep from profiles where id = p_keep;
  select * into v_drop from profiles where id = p_drop;
  if v_keep.id is null or v_drop.id is null
     or v_keep.deleted_at is not null or v_drop.deleted_at is not null then
    raise exception 'MERGE_REFUSED' using errcode = 'P0001', detail = 'missing';
  end if;

  -- Refusals. staff.id is auth.users(id) ON DELETE RESTRICT and every staff
  -- table points at it: a staff account is never the one folded away.
  if exists (select 1 from staff where id = p_drop) then
    raise exception 'MERGE_REFUSED' using errcode = 'P0001',
      detail = case when exists (select 1 from staff where id = p_keep) then 'staff_both' else 'staff_drop' end;
  end if;
  if exists (select 1 from coaches where profile_id = p_keep)
     and exists (select 1 from coaches where profile_id = p_drop) then
    raise exception 'MERGE_REFUSED' using errcode = 'P0001', detail = 'coach_both';
  end if;

  -- 0307 (c0): the auth slots move only between accounts proven to be one
  -- person: a confirmed phone or a verified email the two hold alike. Never
  -- on a walk-in claim (its email, if any, was typed by the desk), and not on
  -- the owner's word alone: the owner's list shows unproven pairs (kind
  -- phone_unproven), among them a guest who only typed someone's number, and
  -- an owner merge of such a pair must not hand one person's login to the
  -- other. It moves the data and leaves every login where it was.
  select * into v_ku from auth.users where id = p_keep;
  select * into v_du from auth.users where id = p_drop;
  v_proven := not v_claim and v_ku.id is not null and v_du.id is not null
              and ((v_ku.phone_confirmed_at is not null and v_du.phone_confirmed_at is not null
                       and coalesce(app.phone_digits(v_ku.phone), '') ~ '^[0-9]{7,15}$'
                       and app.phone_canon(v_ku.phone) = app.phone_canon(v_du.phone))
                   or exists (
                        -- a verified email both hold: the account's confirmed
                        -- email or a Google or Apple identity's (the email
                        -- groups of duplicate_groups_internal)
                        select 1
                          from (select lower(btrim(u.email)) as e from auth.users u
                                 where u.id = p_keep and u.email_confirmed_at is not null
                                union
                                select lower(btrim(i.email)) from auth.identities i
                                 where i.user_id = p_keep and i.provider in ('google', 'apple')) a
                          join (select lower(btrim(u.email)) as e from auth.users u
                                 where u.id = p_drop and u.email_confirmed_at is not null
                                union
                                select lower(btrim(i.email)) from auth.identities i
                                 where i.user_id = p_drop and i.provider in ('google', 'apple')) b
                            on a.e = b.e
                         where nullif(a.e, '') is not null and a.e not like '%@guest.touch.local'));
  if v_proven then
    v_keep_synth := coalesce(v_ku.email ilike '%@guest.touch.local', false);
    v_take_email := (nullif(btrim(coalesce(v_ku.email, '')), '') is null or v_keep_synth)
                    and nullif(btrim(coalesce(v_du.email, '')), '') is not null
                    and v_du.email not ilike '%@guest.touch.local';
    v_take_phone := nullif(btrim(coalesce(v_ku.phone, '')), '') is null
                    and nullif(btrim(coalesce(v_du.phone, '')), '') is not null;
    -- An OAuth login (Google, Apple, ...) keep lacks moves too (section 6),
    -- so it is a login a staff or coach keep would receive as well.
    v_take_ids := exists (
      select 1 from auth.identities d
       where d.user_id = p_drop and d.provider not in ('email', 'phone')
         and not exists (select 1 from auth.identities k
                          where k.user_id = p_keep and k.provider = d.provider));
    if (v_take_email or v_take_phone or v_take_ids)
       and (exists (select 1 from staff where id = p_keep)
            or exists (select 1 from coaches where profile_id = p_keep)) then
      raise exception 'MERGE_REFUSED' using errcode = 'P0001', detail = 'staff_keep_auth';
    end if;
  elsif not v_claim and v_ku.id is not null and v_du.id is not null
        -- An unproven merge moves no login and empties the drop's. When the
        -- drop is the only one of the two anybody can sign in to (a desk
        -- walk-in kept over the person's app account), the person would be
        -- locked out of their own history: the other way round, or not at all.
        and not (   (nullif(btrim(coalesce(v_ku.email, '')), '') is not null
                     and v_ku.email not ilike '%@guest.touch.local')
                 or v_ku.phone_confirmed_at is not null
                 or exists (select 1 from auth.identities i
                             where i.user_id = p_keep and i.provider not in ('email', 'phone')))
        and (   (nullif(btrim(coalesce(v_du.email, '')), '') is not null
                 and v_du.email not ilike '%@guest.touch.local')
             or v_du.phone_confirmed_at is not null
             or exists (select 1 from auth.identities i
                         where i.user_id = p_drop and i.provider not in ('email', 'phone'))) then
    raise exception 'MERGE_REFUSED' using errcode = 'P0001', detail = 'keep_no_login';
  end if;

  -- The writes below are the merge's own, made for whichever caller: the
  -- branch guard's "staff write only where they work" (0230) must not refuse
  -- the owner a row of a closed branch, so the caller's claims are set aside
  -- (as for a cron or service write) and restored before the audit row.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('app.profile_merge', 'on', true);
  perform set_config('app.loyalty_merge', 'on', true);   -- contracts §1.3: the ledger re-point

  -- 1b. 0307 (c11): a tournament both accounts entered. The better entry
  -- wins (registered, waitlisted, no_show, withdrawn; then the net paid;
  -- then keep's); the loser's tournament tabs move to it, so its money counts
  -- there, and the loser is deleted. A loser already in the draw (a match, a
  -- bye, a substitution), or a pair both paid, cannot go: MERGE_REFUSED
  -- detail tournament_entry.
  -- Before the re-point loop: its tabs update is the first tabs write.
  for v_te in
    select k.id as k_id, d.id as d_id
      from tournament_entries d
      join tournament_entries k on k.tournament_id = d.tournament_id and k.guest_id = p_keep
     where d.guest_id = p_drop
     order by d.tournament_id
  loop
    select * into v_k from tournament_entries where id = v_te.k_id;
    select * into v_d from tournament_entries where id = v_te.d_id;
    select x.id into v_win
      from (values (v_k.id, v_k.status, 1), (v_d.id, v_d.status, 2)) as x (id, status, side)
     order by case x.status when 'registered' then 0 when 'waitlisted' then 1 when 'no_show' then 2 else 3 end,
              coalesce((app.tournament_entry_money(x.id)->>'net_iqd')::bigint, 0) desc,
              x.side
     limit 1;
    v_lose := case when v_win = v_k.id then v_d else v_k end;
    -- Both entries paid: folding one into the other would hide the second
    -- fee from every refunds-due figure (refund_due counts a withdrawn or
    -- cancelled entry only). One is refunded first, then the merge runs.
    if coalesce((app.tournament_entry_money(v_k.id)->>'net_iqd')::bigint, 0) > 0
       and coalesce((app.tournament_entry_money(v_d.id)->>'net_iqd')::bigint, 0) > 0 then
      raise exception 'MERGE_REFUSED' using errcode = 'P0001', detail = 'tournament_entry';
    end if;
    if exists (select 1 from tournament_matches m where v_lose.id in (m.a1, m.a2, m.b1, m.b2))
       or exists (select 1 from tournament_entries s where s.substitute_for = v_lose.id)
       or exists (select 1 from tournament_rounds r where v_lose.id = any (r.bye_entry_ids)) then
      raise exception 'MERGE_REFUSED' using errcode = 'P0001', detail = 'tournament_entry';
    end if;
    update tabs set tournament_entry_id = v_win where tournament_entry_id = v_lose.id;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_moved := v_moved || jsonb_build_object('tabs.tournament_entry_id',
                                               coalesce((v_moved->>'tabs.tournament_entry_id')::bigint, 0) + v_n);
    end if;
    select status::text into v_ts from tournaments where id = v_lose.tournament_id;
    perform set_config('app.venue_id', v_lose.venue_id::text, true);
    delete from tournament_entries where id = v_lose.id;
    perform app.write_audit('tournament.merge_entry', 'tournament_entries', v_lose.id::text,
                            jsonb_build_object('status', v_lose.status, 'tournament_id', v_lose.tournament_id),
                            jsonb_build_object('kept_entry_id', v_win, 'keep_id', p_keep, 'drop_id', p_drop));
    if v_lose.status = 'registered' then
      if v_ts = 'open' then
        perform app.tournament_promote_internal(v_lose.tournament_id);
      elsif v_ts in ('closed', 'running') then
        update tournaments set revision = revision + 1, updated_at = now() where id = v_lose.tournament_id;
      end if;
    end if;
    v_moved := v_moved || jsonb_build_object('tournament_entries.merged',
                                             coalesce((v_moved->>'tournament_entries.merged')::bigint, 0) + 1);
  end loop;
  -- The caller's branch back: the tournament's was asserted for that
  -- entry's rows only, never for the rest of the merge or the caller.
  perform set_config('app.venue_id', coalesce(v_venue, ''), true);

  -- 2. The plain re-points, in lock order (tabs → reservations → … →
  -- match_tickets). A column that does not exist yet is skipped. A walk-in
  -- claim leaves the staff's notes about the walk-in on the tombstone (c21).
  for v_c in
    select m.sch, m.tbl, m.col from app.profile_merge_columns() m
     where m.how = 'repoint' order by m.ord
  loop
    continue when v_claim and v_c.tbl = 'customer_notes';
    continue when not exists (
      select 1 from pg_attribute a
       where a.attrelid = to_regclass(format('%I.%I', v_c.sch, v_c.tbl))
         and a.attname = v_c.col and not a.attisdropped);
    execute format('update %I.%I set %I = $1 where %I = $2', v_c.sch, v_c.tbl, v_c.col, v_c.col)
      using p_keep, p_drop;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_moved := v_moved || jsonb_build_object(v_c.tbl || '.' || v_c.col, v_n);
    end if;
  end loop;

  -- 3. The rule columns: each move first resolves the unique scope it would
  -- break. A row that only describes a relation (a flag, a block, a report,
  -- an exclusion, a standing) is deleted on the drop when keep already has
  -- it; a row that carries money or a place (a seat, a request, an enrolment,
  -- an entry, a ticket payment in flight) stays on the drop tombstone as
  -- history and is counted under <table>_left.

  -- customer_flags (customer_id, type): keep's flag wins. A walk-in claim
  -- leaves them on the tombstone (c21).
  if not v_claim then
    delete from customer_flags d
     where d.customer_id = p_drop
       and exists (select 1 from customer_flags k where k.customer_id = p_keep and k.type = d.type);
    update customer_flags set customer_id = p_keep where customer_id = p_drop;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_moved := v_moved || jsonb_build_object('customer_flags.customer_id', v_n); end if;
  end if;

  -- booking_payments_one_active_ticket: one ticket purchase in flight each.
  update booking_payments d set guest_id = p_keep
   where d.guest_id = p_drop
     and not (d.purpose = 'ticket' and d.status in ('created', 'pending')
              and exists (select 1 from booking_payments k
                           where k.guest_id = p_keep and k.purpose = 'ticket'
                             and k.status in ('created', 'pending')));
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('booking_payments.guest_id', v_n); end if;

  -- hold_standing: the account row is keyed u:<id>. Keep inherits the
  -- stricter standing of the two; a phone-keyed row (p:<hash>) just moves.
  if exists (select 1 from hold_standing where key = 'u:' || p_drop) then
    if exists (select 1 from hold_standing where key = 'u:' || p_keep) then
      update hold_standing k
         set strikes        = greatest(k.strikes, d.strikes),
             last_strike_at = greatest(k.last_strike_at, d.last_strike_at),
             blocked_until  = greatest(k.blocked_until, d.blocked_until),
             suspended_at   = coalesce(k.suspended_at, d.suspended_at),
             needs_review   = k.needs_review or d.needs_review,
             review_venue_id = coalesce(k.review_venue_id, d.review_venue_id),
             banned_at      = coalesce(k.banned_at, d.banned_at),
             banned_by      = case when k.banned_at is null then d.banned_by else k.banned_by end,
             updated_at     = now()
        from hold_standing d
       where k.key = 'u:' || p_keep and d.key = 'u:' || p_drop;
      delete from hold_standing where key = 'u:' || p_drop;
    else
      update hold_standing set key = 'u:' || p_keep, guest_id = p_keep, updated_at = now()
       where key = 'u:' || p_drop;
    end if;
    v_moved := v_moved || jsonb_build_object('hold_standing.account', 1);
  end if;
  update hold_standing set guest_id = p_keep where guest_id = p_drop;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('hold_standing.guest_id', v_n); end if;

  -- match_requests_one_pending (match_id, guest_id) where pending.
  update match_requests d set guest_id = p_keep
   where d.guest_id = p_drop
     and not (d.status = 'pending'
              and exists (select 1 from match_requests k
                           where k.match_id = d.match_id and k.guest_id = p_keep and k.status = 'pending'));
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('match_requests.guest_id', v_n); end if;

  -- match_seats_occupying_account (match_id, guest_id) where an account seat is in.
  update match_seats d set guest_id = p_keep
   where d.guest_id = p_drop
     and not (d.kind = 'account' and d.status in ('in', 'attended', 'no_show')
              and exists (select 1 from match_seats k
                           where k.match_id = d.match_id and k.guest_id = p_keep and k.kind = 'account'
                             and k.status in ('in', 'attended', 'no_show')));
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('match_seats.guest_id', v_n); end if;

  -- match_exclusions (match_id, guest_id).
  delete from match_exclusions d
   where d.guest_id = p_drop
     and exists (select 1 from match_exclusions k where k.match_id = d.match_id and k.guest_id = p_keep);
  update match_exclusions set guest_id = p_keep where guest_id = p_drop;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('match_exclusions.guest_id', v_n); end if;

  -- match_blocks (blocker_id, blocked_id), never a self-block: the pair
  -- between the two accounts goes, then the duplicates, then the moves.
  delete from match_blocks
   where blocker_id in (p_keep, p_drop) and blocked_id in (p_keep, p_drop);
  delete from match_blocks d
   where d.blocker_id = p_drop
     and exists (select 1 from match_blocks k where k.blocker_id = p_keep and k.blocked_id = d.blocked_id);
  delete from match_blocks d
   where d.blocked_id = p_drop
     and exists (select 1 from match_blocks k where k.blocked_id = p_keep and k.blocker_id = d.blocker_id);
  update match_blocks set blocker_id = p_keep where blocker_id = p_drop;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('match_blocks.blocker_id', v_n); end if;
  update match_blocks set blocked_id = p_keep where blocked_id = p_drop;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('match_blocks.blocked_id', v_n); end if;

  -- match_reports (reporter_id, reported_id, match_id), never a self-report.
  delete from match_reports
   where reporter_id in (p_keep, p_drop) and reported_id in (p_keep, p_drop);
  delete from match_reports d
   where d.reporter_id = p_drop
     and exists (select 1 from match_reports k
                  where k.reporter_id = p_keep and k.reported_id = d.reported_id and k.match_id = d.match_id);
  delete from match_reports d
   where d.reported_id = p_drop
     and exists (select 1 from match_reports k
                  where k.reported_id = p_keep and k.reporter_id = d.reporter_id and k.match_id = d.match_id);
  update match_reports set reporter_id = p_keep where reporter_id = p_drop;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('match_reports.reporter_id', v_n); end if;
  update match_reports set reported_id = p_keep where reported_id = p_drop;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('match_reports.reported_id', v_n); end if;

  -- lesson_enrolments_one_live_lesson / _course: one live place each. 0307
  -- (c11): a booked place on the drop beats a held one on keep that no
  -- payment can still book (a private lesson's held row is never one: it has
  -- one enrolment). Keep's hold ends as expired, then the booked place moves.
  for v_le in
    select k.id as k_id
      from lesson_enrolments d
      join lesson_enrolments k
        on k.guest_id = p_keep and k.status = 'held'
       and ((d.lesson_id is not null and k.lesson_id = d.lesson_id)
            or (d.course_id is not null and k.course_id = d.course_id))
     where d.guest_id = p_drop and d.status = 'booked'
       and not exists (select 1 from lessons l where l.id = k.lesson_id and l.status = 'held')
       and not exists (select 1 from booking_payments bp
                        where bp.lesson_enrolment_id = k.id
                          and bp.status in ('created', 'pending', 'succeeded'))
     order by k.id
  loop
    update lesson_enrolments
       set status = 'expired', cancel_kind = 'expired', cancelled_at = now(),
           hold_expires_at = null, updated_at = now()
     where id = v_le.k_id and status = 'held';
    v_moved := v_moved || jsonb_build_object('lesson_enrolments.held_expired',
                                             coalesce((v_moved->>'lesson_enrolments.held_expired')::bigint, 0) + 1);
  end loop;
  -- A place the guest booked names the guest twice (lesson_enrolments_booked_by:
  -- booked_by_profile_id = guest_id), so both move in one statement; 0303's
  -- generic re-point of booked_by_profile_id first broke the check for every
  -- guest-booked place (0307: the column is a rule now).
  update lesson_enrolments d
     set guest_id = p_keep,
         booked_by_profile_id = case when d.booked_by_profile_id = p_drop then p_keep else d.booked_by_profile_id end,
         updated_at = now()
   where d.guest_id = p_drop
     and not (d.status in ('held', 'booked')
              and exists (select 1 from lesson_enrolments k
                           where k.guest_id = p_keep and k.status in ('held', 'booked')
                             and ((d.lesson_id is not null and k.lesson_id = d.lesson_id)
                                  or (d.course_id is not null and k.course_id = d.course_id))));
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('lesson_enrolments.guest_id', v_n); end if;
  -- A place the drop booked for someone else, as a coach.
  update lesson_enrolments set booked_by_profile_id = p_keep, updated_at = now()
   where booked_by_profile_id = p_drop and booked_by_kind <> 'guest';
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('lesson_enrolments.booked_by_profile_id', v_n); end if;

  -- tournament_entries_guest_key (tournament_id, guest_id): every collision
  -- was resolved in 1b, so the drop's entries all move.
  update tournament_entries d set guest_id = p_keep, updated_at = now()
   where d.guest_id = p_drop
     and not exists (select 1 from tournament_entries k
                      where k.tournament_id = d.tournament_id and k.guest_id = p_keep);
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('tournament_entries.guest_id', v_n); end if;

  -- What stayed on the drop, by table.
  select v_moved || coalesce(jsonb_object_agg(t || '_left', n) filter (where n > 0), '{}'::jsonb)
    into v_moved
    from (values
      ('booking_payments',   (select count(*) from booking_payments   where guest_id = p_drop)),
      ('match_requests',     (select count(*) from match_requests     where guest_id = p_drop)),
      ('match_seats',        (select count(*) from match_seats        where guest_id = p_drop)),
      ('lesson_enrolments',  (select count(*) from lesson_enrolments  where guest_id = p_drop)),
      ('tournament_entries', (select count(*) from tournament_entries where guest_id = p_drop))
    ) as l (t, n);

  -- Loyalty: both cached accounts in uuid order (the last rank), then the
  -- drop's card and account go and keep's is recomputed from the moved ledger.
  perform 1 from loyalty_accounts where profile_id in (p_keep, p_drop) order by profile_id for update;
  delete from loyalty_cards where profile_id = p_drop;
  delete from loyalty_accounts where profile_id = p_drop;
  perform app.loyalty_recompute(p_keep);

  -- Frame grants (0318): one row per profile. The drop's grant moves to keep
  -- when keep has none; otherwise the drop's row goes.
  update frame_grants d set profile_id = p_keep
   where d.profile_id = p_drop
     and not exists (select 1 from frame_grants k where k.profile_id = p_keep);
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('frame_grants.profile_id', v_n); end if;
  delete from frame_grants where profile_id = p_drop;

  -- Standing discount (0342): one row per profile. The drop's moves to keep
  -- when keep has none; otherwise the drop's row goes and keep's stays.
  update customer_discounts d set customer_id = p_keep
   where d.customer_id = p_drop
     and not exists (select 1 from customer_discounts k where k.customer_id = p_keep);
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('customer_discounts.customer_id', v_n); end if;
  delete from customer_discounts where customer_id = p_drop;

  -- 4. The profile fields keep lacks. Not avatar_path: the path is the drop's
  -- own folder (0302 app.avatar_owner), purged by the tombstone below. Never
  -- the push token (0307, c0: one person's device must not get the other's
  -- pushes), and nothing personal on a walk-in claim (c21: the number may
  -- have been mistyped at the desk).
  if not v_claim then
    update profiles k
       set full_name       = case when nullif(btrim(k.full_name), '') is null then d.full_name   else k.full_name   end,
           given_name      = case when nullif(btrim(k.full_name), '') is null then d.given_name  else k.given_name  end,
           family_name     = case when nullif(btrim(k.full_name), '') is null then d.family_name else k.family_name end,
           gender          = case when k.gender is null then d.gender        else k.gender        end,
           gender_set_at   = case when k.gender is null then d.gender_set_at else k.gender_set_at end,
           gender_set_by   = case when k.gender is null then d.gender_set_by else k.gender_set_by end,
           birth_date      = coalesce(k.birth_date, d.birth_date),
           -- 0368: the age band with its stamp, and the club's judgment of
           -- the level as ONE block (level, time, judge, role and note), so a
           -- note never ends up under another judgment.
           age_band        = coalesce(k.age_band, d.age_band),
           age_band_set_at = case when k.age_band is null then d.age_band_set_at else k.age_band_set_at end,
           level_confirmed      = case when k.level_confirmed is null then d.level_confirmed      else k.level_confirmed      end,
           level_confirmed_at   = case when k.level_confirmed is null then d.level_confirmed_at   else k.level_confirmed_at   end,
           level_confirmed_by   = case when k.level_confirmed is null then d.level_confirmed_by   else k.level_confirmed_by   end,
           level_confirmed_role = case when k.level_confirmed is null then d.level_confirmed_role else k.level_confirmed_role end,
           level_note           = case when k.level_confirmed is null then d.level_note           else k.level_note           end,
           terms_version   = case when k.terms_version is null then d.terms_version     else k.terms_version     end,
           terms_accepted_at = case when k.terms_version is null then d.terms_accepted_at else k.terms_accepted_at end
      from profiles d
     where k.id = p_keep and d.id = p_drop;
  end if;

  -- 5. The drop, tombstoned as app.delete_my_account does it;
  -- profiles_media_tombstone (0302) empties avatar_path and birth_date and
  -- queues the drop's avatar folder.
  update profiles
     set full_name       = 'Deleted account',
         phone           = null,
         expo_push_token = null,
         given_name      = null,
         family_name     = null,
         gender          = null,
         gender_set_at   = null,
         gender_set_by   = null,
         deleted_at      = now()
   where id = p_drop;

  -- Keep takes the drop's phone when it has none and nobody else holds it
  -- (the key follows app.profile_phone_key: keep's own proof, not the drop's).
  if v_keep.phone is null and v_drop.phone is not null and v_drop.phone_key is not null
     and not exists (select 1 from profiles p
                      where p.phone_key = v_drop.phone_key and p.deleted_at is null and p.id <> p_keep) then
    update profiles set phone = v_drop.phone where id = p_keep;
    v_moved := v_moved || jsonb_build_object('profile.phone', 1);
  end if;

  -- 6. Auth. Only between proven accounts (above): the email or phone slot
  -- keep lacks comes across (cleared on the drop first: both are unique in
  -- GoTrue), with its identity, and any other provider keep lacks moves.
  -- Then whatever is left on the drop's auth row goes (0307, c45): its
  -- metadata, email, phone and identities; it is banned for good and signed
  -- out everywhere.
  if v_ku.id is not null and v_du.id is not null then
    if v_take_email then
      update auth.users set email = null, updated_at = now() where id = p_drop;
      if v_keep_synth then
        -- (provider_id, provider) is unique: keep's synthetic email identity
        -- gives way to the one that moves below.
        delete from auth.identities where user_id = p_keep and provider = 'email';
      end if;
      update auth.users
         set email              = v_du.email,
             email_confirmed_at = v_du.email_confirmed_at,
             encrypted_password = case when v_keep_synth or coalesce(encrypted_password, '') = ''
                                       then v_du.encrypted_password else encrypted_password end,
             updated_at         = now()
       where id = p_keep;
      update auth.identities
         set user_id = p_keep, provider_id = p_keep::text,
             identity_data = identity_data || jsonb_build_object('sub', p_keep::text), updated_at = now()
       where user_id = p_drop and provider = 'email'
         and not exists (select 1 from auth.identities i where i.user_id = p_keep and i.provider = 'email');
      v_moved := v_moved || jsonb_build_object('auth.email', 1);
    end if;
    if v_take_phone then
      update auth.users set phone = null, updated_at = now() where id = p_drop;
      update auth.users
         set phone = v_du.phone, phone_confirmed_at = v_du.phone_confirmed_at, updated_at = now()
       where id = p_keep;
      update auth.identities
         set user_id = p_keep, provider_id = p_keep::text,
             identity_data = identity_data || jsonb_build_object('sub', p_keep::text), updated_at = now()
       where user_id = p_drop and provider = 'phone'
         and not exists (select 1 from auth.identities i where i.user_id = p_keep and i.provider = 'phone');
      v_moved := v_moved || jsonb_build_object('auth.phone', 1);
    end if;
    if v_proven then
      update auth.identities d
         set user_id = p_keep, updated_at = now()
       where d.user_id = p_drop
         and d.provider not in ('email', 'phone')
         and not exists (select 1 from auth.identities k where k.user_id = p_keep and k.provider = d.provider);
      get diagnostics v_n = row_count;
      if v_n > 0 then v_moved := v_moved || jsonb_build_object('auth.identities', v_n); end if;
    end if;

    delete from auth.identities where user_id = p_drop;
    update auth.users
       set raw_user_meta_data = '{}'::jsonb,
           email              = null,
           phone              = null,
           banned_until       = 'infinity',
           updated_at         = now()
     where id = p_drop;
    delete from auth.sessions where user_id = p_drop;          -- refresh tokens cascade
    delete from auth.one_time_tokens where user_id = p_drop;
  end if;

  perform set_config('app.loyalty_merge', '', true);
  perform set_config('app.profile_merge', '', true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);

  -- Keep's key under its own proof now (a phone that came across, an auth
  -- phone that moved).
  update profiles set phone = phone where id = p_keep;

  -- 7. The record. No before-image of the drop: its name and phone are what
  -- the tombstone erased (the 0077 rule).
  insert into app.profile_merges (keep_id, drop_id, reason, moved, actor_id)
  values (p_keep, p_drop, left(coalesce(nullif(btrim(p_reason), ''), 'merge'), 200), v_moved, v_actor)
  returning id into v_merge_id;

  perform app.write_audit(
    'account.merge', 'profiles', p_keep::text,
    jsonb_build_object('drop_id', p_drop, 'drop_created_at', v_drop.created_at,
                       'drop_had_phone', v_drop.phone is not null),
    jsonb_build_object('merge_id', v_merge_id, 'moved', v_moved),
    left(coalesce(nullif(btrim(p_reason), ''), 'merge'), 200));

  return jsonb_build_object('merge_id', v_merge_id, 'keep_id', p_keep, 'drop_id', p_drop, 'moved', v_moved);
end $merge_profiles_internal_0368$;
comment on function app.merge_profiles_internal(uuid, uuid, text) is
  '0303, 0307, frame_grants since 0320, customer_discounts since 0347, the age band and the confirmed level since 0368 (loyalty contracts §1.1; customers contracts §1). Internal, granted to nobody. Folds p_drop into p_keep, exactly as 0347 does, and section 4 now also gives keep the age band it lacks (with its stamp) and the whole confirmed-level block (level, time, judge, role and note together, never mixed between the two rows). A walk-in claim still moves nothing personal. Every other refusal, lock and side effect is 0347''s: see that comment for the full contract. MERGE_REFUSED detail missing | same | staff_drop | staff_both | coach_both | staff_keep_auth | keep_no_login | tournament_entry. Returns {merge_id, keep_id, drop_id, moved}.';

revoke all on function app.merge_profiles_internal(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 13. app.profile_merge_columns: re-created from
--     20261022000364_ranks_leaderboard.sql:1073, verbatim plus
--     profiles.level_confirmed_by.
--
--     `level_confirmed_by` is a FOREIGN KEY to profiles(id) — the coach or
--     staff member who judged the level — so the merge has to know about it,
--     or a merged judge would leave a pointer at a tombstone
--     (account-merge.test.ts's FK-coverage guard fails until it is named). It
--     repoints like every other link: the same person, under the account that
--     was kept.
-- ---------------------------------------------------------------------------
create or replace function app.profile_merge_columns()
returns table (ord int, sch text, tbl text, col text, how text)
language sql immutable set search_path = public as $profile_merge_columns_0368$
  select * from (values
    ( 10, 'public', 'tabs',                  'customer_id',           'repoint'),
    ( 20, 'public', 'reservations',          'guest_id',              'repoint'),
    ( 30, 'public', 'reservation_series',    'guest_id',              'repoint'),
    ( 40, 'public', 'guest_sessions',        'linked_profile_id',     'repoint'),
    ( 50, 'public', 'customer_notes',        'customer_id',           'repoint'),
    ( 60, 'public', 'promotion_redemptions', 'customer_id',           'repoint'),
    ( 70, 'public', 'matches',               'organiser_id',          'repoint'),
    ( 80, 'public', 'match_events',          'actor_guest_id',        'repoint'),
    ( 90, 'public', 'coaches',               'profile_id',            'repoint'),
    (100, 'public', 'courses',               'created_by_profile_id', 'repoint'),
    (110, 'public', 'lessons',               'created_by_profile_id', 'repoint'),
    (130, 'public', 'lesson_attendance',     'marked_by_profile_id',  'repoint'),
    (140, 'public', 'lesson_strikes',        'guest_id',              'repoint'),
    (150, 'public', 'lesson_events',         'actor_profile_id',      'repoint'),
    (160, 'public', 'loyalty_ledger',        'profile_id',            'repoint'),
    (170, 'public', 'match_ticket_events',   'guest_id',              'repoint'),
    (180, 'public', 'match_tickets',         'guest_id',              'repoint'),
    (190, 'public', 'notification_outbox',   'profile_id',            'repoint'),
    (200, 'public', 'reservation_court_discounts', 'customer_id',     'repoint'),
    (210, 'public', 'game_results',          'a1',                    'repoint'),
    (211, 'public', 'game_results',          'a2',                    'repoint'),
    (212, 'public', 'game_results',          'b1',                    'repoint'),
    (213, 'public', 'game_results',          'b2',                    'repoint'),
    (220, 'public', 'ranks_ledger',          'profile_id',            'repoint'),
    (230, 'public', 'profiles',              'level_confirmed_by',    'repoint'),
    (300, 'public', 'customer_flags',        'customer_id',           'rule'),
    (310, 'public', 'booking_payments',      'guest_id',              'rule'),
    (320, 'public', 'hold_standing',         'guest_id',              'rule'),
    (330, 'public', 'match_requests',        'guest_id',              'rule'),
    (340, 'public', 'match_seats',           'guest_id',              'rule'),
    (350, 'public', 'match_exclusions',      'guest_id',              'rule'),
    (360, 'public', 'match_blocks',          'blocker_id',            'rule'),
    (361, 'public', 'match_blocks',          'blocked_id',            'rule'),
    (370, 'public', 'match_reports',         'reporter_id',           'rule'),
    (371, 'public', 'match_reports',         'reported_id',           'rule'),
    (380, 'public', 'lesson_enrolments',     'guest_id',              'rule'),
    (381, 'public', 'lesson_enrolments',     'booked_by_profile_id',  'rule'),
    (390, 'public', 'tournament_entries',    'guest_id',              'rule'),
    (400, 'public', 'loyalty_cards',         'profile_id',            'rule'),
    (410, 'public', 'loyalty_accounts',      'profile_id',            'rule'),
    (420, 'public', 'username_holds',        'profile_id',            'drop_only'),
    (430, 'public', 'frame_grants',          'profile_id',            'rule'),
    (440, 'public', 'customer_discounts',    'customer_id',           'rule'),
    (500, 'auth',   'identities',            'user_id',               'auth'),
    (510, 'auth',   'sessions',              'user_id',               'signout'),
    (520, 'auth',   'one_time_tokens',       'user_id',               'signout'),
    (530, 'auth',   'mfa_factors',           'user_id',               'drop_only'),
    (540, 'auth',   'oauth_authorizations',  'user_id',               'drop_only'),
    (550, 'auth',   'oauth_consents',        'user_id',               'drop_only'),
    (560, 'auth',   'webauthn_credentials',  'user_id',               'drop_only'),
    (570, 'auth',   'webauthn_challenges',   'user_id',               'drop_only'),
    (600, 'public', 'staff',                 'id',                    'refuse'),
    (700, 'app',    'profile_merges',        'keep_id',               'record')
  ) as t (ord, sch, tbl, col, how)
  order by 1;
$profile_merge_columns_0368$;

comment on function app.profile_merge_columns() is
  '0303, 0307, username_holds since 0314, frame_grants since 0320, customer_discounts and reservation_court_discounts since 0347, game_results and ranks_ledger since 0364, profiles.level_confirmed_by since 0368. Every column referencing profiles(id) or auth.users(id) and what app.merge_profiles_internal does with it (repoint | rule | auth | signout | drop_only | refuse | record). The repoint rows ARE the merge''s generic loop; account-merge.test.ts holds the list to pg_constraint.';

revoke all on function app.profile_merge_columns() from public, anon, authenticated;
