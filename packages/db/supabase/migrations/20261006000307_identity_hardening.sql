set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0307 identity_hardening — the account-identity review of 0303/0304
-- (plan go-over-the-backend-partitioned-metcalfe, 0307; findings c0, c1, c18,
-- c19, c20, c21, c11, c45). No data repair of the pairs the 0303 run already
-- merged on hosted: that is a hand-run, owner-approved step.
--
--   1. A phone number is an identity only when it is proven. profiles.phone_key
--      is the canonical number when the account's own auth phone is confirmed
--      and equal to it, or the profile is a desk walk-in (desk_register_customer
--      vouched for it: its customer.create audit row, or the transaction-local
--      app.desk_walkin flag while it writes). Any other typed phone stays on the
--      profile as text (bookings need it) with phone_key NULL, so it neither
--      blocks the real owner (c1) nor answers PHONE_TAKEN to a prober (c18):
--      zz_phone_key no longer raises. A verified owner editing in a number a
--      walk-in holds takes the key over (phone_reclaimed).
--   2. The existing keys are recomputed under that rule. A key two live
--      profiles would now share goes to the verified owner, then the oldest;
--      the others keep their phone text with phone_key NULL, so the unique
--      index profiles_phone_key_live (0304) holds throughout.
--   3. app.phone_claim_internal(user): what a confirmed auth phone does. A desk
--      walk-in holding the number that never signed in and is not staff or a
--      coach is merged in (walkin_claim); a failed claim is recorded
--      (walkin_claim_failed, c20) and, like any other unverified holder, loses
--      the key (phone_reclaimed); a verified holder keeps it. handle_new_user
--      calls it for a sign-up confirmed at insert, and the auth.users trigger
--      on_auth_user_phone_changed (AFTER UPDATE OF phone, phone_confirmed_at,
--      only when a value changed) for every later confirmation or change.
--   4. app.merge_profiles_internal, re-issued from 0303:
--      - auth slots (email and password, phone, OAuth identities) move only
--        when the two accounts are proven one person: an owner merge
--        ('owner: …', merge_accounts) or a confirmed auth phone, or a confirmed
--        email, the two hold alike. A staff or coach keep that would receive an
--        email or phone it lacks is MERGE_REFUSED detail staff_keep_auth. The
--        push token never moves (c0);
--      - a walk-in claim moves bookings, tabs, points and places, never the
--        walk-in's name, gender, birth date, terms, notes or flags (c21);
--      - profiles are locked FOR NO KEY UPDATE (a settle's FK key share on the
--        profile no longer waits on the merge, c20), after the tournaments of
--        both accounts' entries in id order; loyalty_accounts in uuid order;
--      - a tournament both accounts entered keeps the better entry (registered,
--        waitlisted, no-show, withdrawn; then the money paid; then keep's): the
--        other's tabs move to it and the other is deleted, or the merge is
--        MERGE_REFUSED detail tournament_entry when that entry is in the draw.
--        A booked lesson place on the drop beats a held one on keep (c11);
--      - the drop's auth row is emptied: metadata, email, phone and every
--        identity left on it go, and it stays banned (c45).
--   5. app.duplicate_groups_internal groups phones by the confirmed auth phone
--      only; app.merge_duplicates_internal treats only MERGE_REFUSED as a
--      refusal (any other error is raised) and clears the key, not the phone,
--      of the side without a confirmed phone, the newer when both or neither
--      have one (c19).
--   6. app.desk_register_customer (0065) sets app.desk_walkin around its
--      upsert; app.find_customer_by_phone (0065) prefers the keyed holder.

-- ---------------------------------------------------------------------------
-- 1. The proof helpers
-- ---------------------------------------------------------------------------
create or replace function app.phone_verified_owner(p_profile uuid, p_key text) returns boolean
language sql stable security definer set search_path = public as $phone_verified_owner_0307$
  select p_key is not null
     and exists (select 1 from auth.users u
                  where u.id = p_profile
                    and u.phone_confirmed_at is not null
                    and coalesce(app.phone_digits(u.phone), '') ~ '^[0-9]{7,15}$'
                    and app.phone_canon(u.phone) = p_key);
$phone_verified_owner_0307$;

comment on function app.phone_verified_owner(uuid, text) is
  '0307. Internal. True when the account''s own auth phone is confirmed and canonically equal to p_key.';

revoke all on function app.phone_verified_owner(uuid, text) from public, anon, authenticated;

create or replace function app.profile_is_desk_walkin(p_profile uuid) returns boolean
language sql stable security definer set search_path = public as $profile_is_desk_walkin_0307$
  select coalesce(current_setting('app.desk_walkin', true), '') = p_profile::text
      or exists (select 1 from audit_log a
                  where a.entity = 'profiles' and a.entity_id = p_profile::text
                    and a.action = 'customer.create');
$profile_is_desk_walkin_0307$;

comment on function app.profile_is_desk_walkin(uuid) is
  '0307. Internal. A desk walk-in: desk_register_customer wrote its customer.create audit row, or is writing it now (the transaction-local app.desk_walkin flag). Server-side proof only; user metadata never counts.';

revoke all on function app.profile_is_desk_walkin(uuid) from public, anon, authenticated;

create or replace function app.profile_phone_key(p_profile uuid, p_phone text) returns text
language sql stable security definer set search_path = public as $profile_phone_key_0307$
  select case when x.k is not null
               and (app.phone_verified_owner(p_profile, x.k) or app.profile_is_desk_walkin(p_profile))
              then x.k end
    from (select case when coalesce(app.phone_digits(p_phone), '') ~ '^[0-9]{7,15}$'
                      then app.phone_canon(p_phone) end as k) x;
$profile_phone_key_0307$;

comment on function app.profile_phone_key(uuid, text) is
  '0307. Internal. The phone_key a profile may hold for p_phone: app.phone_canon when it has 7-15 digits AND the account''s confirmed auth phone is that number or the profile is a desk walk-in; otherwise NULL.';

revoke all on function app.profile_phone_key(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. zz_phone_key, re-issued from 0303:45
-- ---------------------------------------------------------------------------
create or replace function app.trg_profile_phone_key() returns trigger
language plpgsql security definer set search_path = public as $trg_profile_phone_key_0307$
declare
  v_holder uuid;
begin
  new.phone_key := case when new.deleted_at is null then app.profile_phone_key(new.id, new.phone) end;
  if new.phone_key is null then
    return new;
  end if;

  select p.id into v_holder
    from profiles p
   where p.phone_key = new.phone_key and p.deleted_at is null and p.id <> new.id
   limit 1;
  if v_holder is null then
    return new;
  end if;

  -- 0307 (c1, c18): never PHONE_TAKEN. The verified owner takes the key from
  -- a holder that is not one (a desk walk-in; the holder keeps its phone
  -- text); anything else is stored without a key.
  if tg_op = 'UPDATE'
     and app.phone_verified_owner(new.id, new.phone_key)
     and not app.phone_verified_owner(v_holder, new.phone_key) then
    update profiles set phone_key = null where id = v_holder;
    insert into app.profile_merges (keep_id, drop_id, reason, moved)
    values (new.id, v_holder, 'phone_reclaimed', jsonb_build_object('key', new.phone_key));
  else
    new.phone_key := null;
  end if;
  return new;
end $trg_profile_phone_key_0307$;

comment on function app.trg_profile_phone_key() is
  '0303, 0307. Trigger zz_phone_key (BEFORE INSERT OR UPDATE OF phone on profiles, after the sanitiser): phone_key := app.profile_phone_key (a confirmed own auth phone or a desk walk-in, else NULL). Never raises: on a key another live profile holds, a verified owner takes it from an unverified holder (profile_merges phone_reclaimed); otherwise the row is stored without a key.';

revoke all on function app.trg_profile_phone_key() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Recompute every key (phone_key alone fires no profiles trigger). Winner
--    per key: the verified owner, then the oldest. Losers first, so the
--    unique index never sees two holders.
-- ---------------------------------------------------------------------------
with w as materialized (
  select q.id, x.k,
         row_number() over (partition by x.k
                            order by app.phone_verified_owner(q.id, x.k) desc, q.created_at, q.id) as rn
    from profiles q
    cross join lateral (select app.profile_phone_key(q.id, q.phone) as k) x
   where q.deleted_at is null and x.k is not null
)
update profiles p
   set phone_key = null
 where p.phone_key is not null
   and not exists (select 1 from w where w.id = p.id and w.rn = 1 and w.k = p.phone_key);

with w as materialized (
  select q.id, x.k,
         row_number() over (partition by x.k
                            order by app.phone_verified_owner(q.id, x.k) desc, q.created_at, q.id) as rn
    from profiles q
    cross join lateral (select app.profile_phone_key(q.id, q.phone) as k) x
   where q.deleted_at is null and x.k is not null
)
update profiles p
   set phone_key = w.k
  from w
 where w.id = p.id and w.rn = 1
   and p.phone_key is distinct from w.k;

comment on column profiles.phone_key is
  '0303, 0307. app.profile_phone_key(id, phone): the canonical number when the account''s confirmed auth phone is that number or the profile is a desk walk-in, else NULL. Kept by the zz_phone_key trigger and app.phone_claim_internal; unique among live profiles (profiles_phone_key_live, 0304). No client grant.';

-- ---------------------------------------------------------------------------
-- 4a. app.profile_merge_columns, re-issued from 0303:168: lesson_enrolments.
--     booked_by_profile_id is a rule (it moves with guest_id, see the merge).
-- ---------------------------------------------------------------------------
create or replace function app.profile_merge_columns()
returns table (ord int, sch text, tbl text, col text, how text)
language sql immutable set search_path = public as $profile_merge_columns_0307$
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
$profile_merge_columns_0307$;

comment on function app.profile_merge_columns() is
  '0303, 0307. Every column referencing profiles(id) or auth.users(id) and what app.merge_profiles_internal does with it (repoint | rule | auth | signout | drop_only | refuse | record). The repoint rows ARE the merge''s generic loop; account-merge.test.ts holds the list to pg_constraint. 0307: lesson_enrolments.booked_by_profile_id is a rule (it moves with guest_id on a place the guest booked).';

revoke all on function app.profile_merge_columns() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.merge_profiles_internal, re-issued from 0303:227
-- ---------------------------------------------------------------------------
create or replace function app.merge_profiles_internal(p_keep uuid, p_drop uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $merge_profiles_internal_0307$
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
  -- person: the owner's explicit merge, or a confirmed phone or confirmed
  -- email the two hold alike. Never on a walk-in claim (its email, if any,
  -- was typed by the desk).
  select * into v_ku from auth.users where id = p_keep;
  select * into v_du from auth.users where id = p_drop;
  v_proven := not v_claim and v_ku.id is not null and v_du.id is not null
              and (coalesce(p_reason, '') like 'owner:%'
                   or (v_ku.phone_confirmed_at is not null and v_du.phone_confirmed_at is not null
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
    if (v_take_email or v_take_phone)
       and (exists (select 1 from staff where id = p_keep)
            or exists (select 1 from coaches where profile_id = p_keep)) then
      raise exception 'MERGE_REFUSED' using errcode = 'P0001', detail = 'staff_keep_auth';
    end if;
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
  -- bye, a substitution) cannot go: MERGE_REFUSED detail tournament_entry.
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
end $merge_profiles_internal_0307$;

comment on function app.merge_profiles_internal(uuid, uuid, text) is
  '0303, 0307 (loyalty contracts §1.1). Internal, granted to nobody. Folds p_drop into p_keep. Locks the tournaments both entered (id order), then both profiles FOR NO KEY UPDATE (uuid order). A tournament both entered keeps the better entry (registered > waitlisted > no_show > withdrawn, then net paid, then keep''s): the loser''s tournament tabs move to it and the loser is deleted (a registered loser frees its place: promotion when open, a revision otherwise); a loser in the draw is MERGE_REFUSED detail tournament_entry. Every column of app.profile_merge_columns() is re-pointed (a flag, block, report, exclusion or standing keep already has is deleted on the drop; a seat, request, enrolment or ticket payment in flight stays on the drop, counted <table>_left; a booked lesson place beats a held one on keep that no payment can still book). Keep takes the names (when its full_name is empty), gender, birth_date and terms it lacks, then the phone it lacks; never the push token. A walk-in claim (reason walkin_claim) moves no name, gender, birth date, terms, customer_notes or customer_flags. The drop is tombstoned as delete_my_account does (0302 purges its avatar). Auth moves only between proven accounts (an ''owner:'' merge, or a confirmed phone or email the two share): the email or phone slot keep lacks with its identity (a walk-in''s synthetic address counts as empty), the email with its password when keep has none, other providers keep lacks; a staff or coach keep that would receive an email or phone is MERGE_REFUSED detail staff_keep_auth. The drop''s auth row is then emptied (metadata, email, phone, identities), banned (infinity) and signed out. Loyalty: both accounts locked in uuid order, the drop''s card and account go, keep''s is recomputed. Writes app.profile_merges and audit_log account.merge. MERGE_REFUSED detail missing | same | staff_drop | staff_both | coach_both | staff_keep_auth | tournament_entry. Returns {merge_id, keep_id, drop_id, moved}.';

revoke all on function app.merge_profiles_internal(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Duplicate groups: phones by the confirmed auth phone only (0303:610)
-- ---------------------------------------------------------------------------
create or replace function app.duplicate_groups_internal()
returns table (kind text, key text, profile_id uuid)
language sql stable security definer set search_path = public as $duplicate_groups_internal_0307$
  with phones as (
    select app.phone_canon(u.phone) as key, p.id
      from profiles p join auth.users u on u.id = p.id
     where p.deleted_at is null and u.phone_confirmed_at is not null
       and coalesce(app.phone_digits(u.phone), '') ~ '^[0-9]{7,15}$'
  ), emails as (
    select lower(btrim(u.email)) as key, p.id
      from profiles p join auth.users u on u.id = p.id
     where p.deleted_at is null and u.email_confirmed_at is not null
       and nullif(btrim(u.email), '') is not null
    union
    select lower(btrim(i.email)), p.id
      from profiles p join auth.identities i on i.user_id = p.id
     where p.deleted_at is null and i.provider in ('google', 'apple')
       and nullif(btrim(i.email), '') is not null
  )
  select 'phone', x.key, x.id from phones x
   where x.key in (select key from phones group by key having count(*) > 1)
  union all
  select 'email', e.key, e.id from emails e
   where e.key not like '%@guest.touch.local'
     and e.key in (select key from emails group by key having count(distinct id) > 1);
$duplicate_groups_internal_0307$;

comment on function app.duplicate_groups_internal() is
  '0303, 0307. Internal. (kind phone | email, key, profile_id) for every live profile that shares a confirmed auth phone (canonical) or a verified email with another live profile. A phone only typed into a profile never groups (0307, c0).';

revoke all on function app.duplicate_groups_internal() from public, anon, authenticated;

-- 0303:720, re-issued (c19): only MERGE_REFUSED is a refusal; a refused phone
-- pair loses the key (not the phone text) of the side without a confirmed
-- matching auth phone, the newer when both or neither have one.
create or replace function app.merge_duplicates_internal() returns jsonb
language plpgsql security definer set search_path = public as $merge_duplicates_internal_0307$
declare
  v_g        record;
  v_keep     uuid;
  v_drop     uuid;
  v_newer    uuid;
  v_older    uuid;
  v_skip     text[] := '{}';
  v_merged   int := 0;
  v_cleared  int := 0;
  v_kept     int := 0;
  v_guard    int := 0;
begin
  loop
    v_guard := v_guard + 1;
    exit when v_guard > 100000;

    select d.kind, d.key into v_g
      from app.duplicate_groups_internal() d
     group by d.kind, d.key
    having count(*) filter (where not (d.kind || ':' || d.key || ':' || d.profile_id::text) = any (v_skip)) > 1
     order by case d.kind when 'phone' then 0 else 1 end, d.key
     limit 1;
    exit when not found;

    select r.id into v_keep
      from (
        select p.id, p.created_at,
               (exists (select 1 from staff s where s.id = p.id)
                or exists (select 1 from coaches c where c.profile_id = p.id)) as staffish,
               (u.phone_confirmed_at is not null and v_g.kind = 'phone'
                and app.phone_canon(u.phone) = v_g.key) as confirmed,
               not coalesce(u.email ilike '%@guest.touch.local', false) as real_email,
               app.profile_activity(p.id) as activity
          from app.duplicate_groups_internal() d
          join profiles p on p.id = d.profile_id
          left join auth.users u on u.id = p.id
         where d.kind = v_g.kind and d.key = v_g.key
      ) r
     order by r.staffish desc, r.confirmed desc, r.real_email desc, r.activity desc, r.created_at, r.id
     limit 1;

    select d.profile_id into v_drop
      from app.duplicate_groups_internal() d
      join profiles p on p.id = d.profile_id
     where d.kind = v_g.kind and d.key = v_g.key and d.profile_id <> v_keep
       and not (d.kind || ':' || d.key || ':' || d.profile_id::text) = any (v_skip)
     order by p.created_at, p.id
     limit 1;
    if v_drop is null then
      v_skip := v_skip || (v_g.kind || ':' || v_g.key || ':' || v_keep::text);
      continue;
    end if;

    begin
      perform app.merge_profiles_internal(v_keep, v_drop, 'duplicate_' || v_g.kind);
      v_merged := v_merged + 1;
    exception when raise_exception then
      if sqlerrm <> 'MERGE_REFUSED' then
        raise;
      end if;
      if v_g.kind = 'phone' then
        select p.id into v_newer
          from profiles p
         where p.id in (v_keep, v_drop)
         order by app.phone_verified_owner(p.id, v_g.key), p.created_at desc, p.id desc
         limit 1;
        v_older := case when v_newer = v_keep then v_drop else v_keep end;
        update profiles set phone_key = null where id = v_newer and phone_key = v_g.key;
        insert into app.profile_merges (keep_id, drop_id, reason, moved)
        values (v_older, v_newer, 'phone_cleared_conflict',
                jsonb_build_object('key', v_g.key, 'code', sqlerrm, 'sqlstate', sqlstate));
        v_skip := v_skip || (v_g.kind || ':' || v_g.key || ':' || v_newer::text);
        v_cleared := v_cleared + 1;
      else
        insert into app.profile_merges (keep_id, drop_id, reason, moved)
        values (v_keep, v_drop, 'email_conflict_kept', jsonb_build_object('code', sqlerrm, 'sqlstate', sqlstate));
        v_skip := v_skip || (v_g.kind || ':' || v_g.key || ':' || v_drop::text);
        v_kept := v_kept + 1;
      end if;
    end;
  end loop;

  return jsonb_build_object('merged', v_merged, 'phones_cleared', v_cleared, 'emails_kept_apart', v_kept);
end $merge_duplicates_internal_0307$;

comment on function app.merge_duplicates_internal() is
  '0303, 0307. Internal, granted to nobody; run once by migration 0303 and not since. Merges every duplicate group (phone groups by confirmed auth phone first) one pair at a time, keep chosen by: staff or coach row, auth phone confirmed and equal to the number, a real email, most activity, oldest. Only MERGE_REFUSED counts as a refusal (any other error is raised): a refused phone pair loses the key of the side without a confirmed matching auth phone (the newer when both or neither; profile_merges phone_cleared_conflict; the phone text stays); a refused email pair is recorded (email_conflict_kept) and kept apart. Returns {merged, phones_cleared, emails_kept_apart}.';

revoke all on function app.merge_duplicates_internal() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. What a confirmed auth phone does
-- ---------------------------------------------------------------------------
create or replace function app.phone_claim_internal(p_user uuid) returns text
language plpgsql security definer set search_path = public as $phone_claim_internal_0307$
declare
  v_u         auth.users%rowtype;
  v_key       text;
  v_holder    uuid;
  v_claimable boolean;
  v_out       text := 'none';
begin
  select * into v_u from auth.users where id = p_user;
  if not found or coalesce(v_u.is_anonymous, false) then
    return 'none';
  end if;
  if not exists (select 1 from profiles where id = p_user and deleted_at is null) then
    return 'none';
  end if;

  v_key := case when v_u.phone_confirmed_at is not null
                 and coalesce(app.phone_digits(v_u.phone), '') ~ '^[0-9]{7,15}$'
                then app.phone_canon(v_u.phone) end;

  if v_key is not null then
    select p.id into v_holder
      from profiles p
     where p.phone_key = v_key and p.deleted_at is null and p.id <> p_user
     order by p.created_at, p.id
     limit 1;
    if v_holder is not null then
      if app.phone_verified_owner(v_holder, v_key) then
        v_out := 'held';
      else
        -- A desk walk-in that never signed in and is no staff or coach is the
        -- person: merged in. Anything else keeps its history and its phone
        -- text, and gives the key up.
        v_claimable := app.profile_is_desk_walkin(v_holder)
                       and not exists (select 1 from staff s where s.id = v_holder)
                       and not exists (select 1 from coaches c where c.profile_id = v_holder)
                       and not exists (select 1 from auth.users hu
                                        where hu.id = v_holder and hu.last_sign_in_at is not null);
        if v_claimable then
          begin
            perform app.merge_profiles_internal(p_user, v_holder, 'walkin_claim');
            v_out := 'claimed';
          exception when others then
            -- c20: recorded, so the owner can merge the pair by hand.
            insert into app.profile_merges (keep_id, drop_id, reason, moved)
            values (p_user, v_holder, 'walkin_claim_failed',
                    jsonb_build_object('key', v_key, 'code', sqlerrm, 'sqlstate', sqlstate));
            v_out := 'claim_failed';
          end;
        end if;
        if v_out <> 'claimed' then
          update profiles set phone_key = null where id = v_holder and phone_key = v_key;
          insert into app.profile_merges (keep_id, drop_id, reason, moved)
          values (p_user, v_holder, 'phone_reclaimed', jsonb_build_object('key', v_key));
          if v_out = 'none' then
            v_out := 'reclaimed';
          end if;
        end if;
      end if;
    end if;
  end if;

  -- The account's own profile: the confirmed number when it has no phone,
  -- then its key recomputed (set when proven and free, cleared when not).
  update profiles
     set phone = case when v_key is not null and v_out <> 'held'
                       and nullif(btrim(coalesce(phone, '')), '') is null
                      then '+' || app.phone_digits(v_u.phone) else phone end
   where id = p_user and deleted_at is null;
  return v_out;
end $phone_claim_internal_0307$;

comment on function app.phone_claim_internal(uuid) is
  '0307 (c1, c20, c21). Internal. Runs when an account''s auth phone is confirmed or changes: a live profile holding the confirmed number''s key that is a desk walk-in, never signed in and no staff or coach is merged in (walkin_claim; a failure is recorded walkin_claim_failed); any other holder that is not a verified owner gives the key up (phone_reclaimed, its phone text stays). Then the account''s own profile takes the number when it has no phone, and its key is recomputed. Returns none | held | claimed | claim_failed | reclaimed.';

revoke all on function app.phone_claim_internal(uuid) from public, anon, authenticated;

-- handle_new_user, re-issued from 0303:821. A sign-up's phone is stored as
-- text and never blocks anyone: only a confirmed one becomes a key, through
-- app.phone_claim_internal.
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $handle_new_user_0307$
declare
  v_meta      jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_email     text  := coalesce(new.email, '');
  v_name      text;
  v_phone     text;
  v_given     text;
  v_family    text;
  v_confirmed boolean;
begin
  if coalesce(new.is_anonymous, false) then
    return new;                                -- cafe anonymous sessions: no profile
  end if;

  v_name := coalesce(
    nullif(btrim(v_meta->>'full_name'), ''),                                          -- email/password sign-up; Google
    nullif(btrim(v_meta->>'name'), ''),                                               -- Google `name` claim
    nullif(btrim(concat_ws(' ', v_meta->>'given_name', v_meta->>'family_name')), ''), -- standard OIDC, belt and braces
    case when v_email ilike '%@privaterelay.appleid.com' then null                     -- a relay token is not a name; the app's complete-profile step fills it
         else nullif(split_part(v_email, '@', 1), '') end,                              -- historical fallback kept: admin-created staff users (staff-admin edge fn passes no metadata) rely on it
    '');

  -- 0307 (c1): a confirmed auth phone is stored by app.phone_claim_internal
  -- below, after any walk-in holding it is claimed. Otherwise the typed or
  -- unconfirmed number is stored as text (bookings need a phone); the zz_phone_key
  -- trigger gives it no key, so it blocks nobody.
  v_confirmed := new.phone_confirmed_at is not null
                 and coalesce(app.phone_digits(new.phone), '') ~ '^[0-9]{7,15}$';
  v_phone := case when v_confirmed then null
                  else coalesce(
                         nullif(btrim(v_meta->>'phone'), ''),
                         case when nullif(btrim(coalesce(new.phone, '')), '') is not null
                              then '+' || app.phone_digits(new.phone) end) end;

  -- 0256: the sign-up's two name parts, clamped to 39, only when they rebuild
  -- the resolved name exactly.
  v_given  := nullif(rtrim(left(btrim(v_meta->>'given_name'), 39)), '');
  v_family := nullif(rtrim(left(btrim(v_meta->>'family_name'), 39)), '');
  if v_given is null or concat_ws(' ', v_given, v_family) is distinct from v_name then
    v_given  := null;
    v_family := null;
  end if;

  begin
    insert into public.profiles (id, full_name, phone, preferred_lang, given_name, family_name)
    values (
      new.id,
      v_name,
      v_phone,
      case when v_meta->>'preferred_lang' in ('en','ar')
           then v_meta->>'preferred_lang' else 'en' end,
      v_given,
      v_family
    )
    on conflict (id) do nothing;
  exception when unique_violation then
    -- A racing writer of the same key (profiles_phone_key_live): the sign-up
    -- still never fails, stored without the phone.
    insert into public.profiles (id, full_name, phone, preferred_lang, given_name, family_name)
    values (
      new.id,
      v_name,
      null,
      case when v_meta->>'preferred_lang' in ('en','ar')
           then v_meta->>'preferred_lang' else 'en' end,
      v_given,
      v_family
    )
    on conflict (id) do nothing;
  end;

  if v_confirmed then
    begin
      perform app.phone_claim_internal(new.id);
    exception when others then
      raise warning 'handle_new_user: phone claim for % skipped: % (%)', new.id, sqlerrm, sqlstate;
    end;
  end if;
  return new;
end $handle_new_user_0307$;
-- Grants + trigger binding unchanged (0004:56, 0004:150): replace preserves them.

-- handle_user_phone_confirmed, re-issued from 0303:932: every confirmation or
-- change of the auth phone, not only the first (a changed number must drop
-- the old key, a re-confirmed one claim again).
create or replace function app.handle_user_phone_confirmed() returns trigger
language plpgsql security definer set search_path = public as $handle_user_phone_confirmed_0307$
begin
  -- The merge moves and clears auth phones itself.
  if coalesce(current_setting('app.profile_merge', true), '') = 'on'
     or coalesce(new.is_anonymous, false) then
    return new;
  end if;
  begin
    perform app.phone_claim_internal(new.id);
  exception when others then
    raise warning 'handle_user_phone_confirmed: phone claim for % skipped: % (%)', new.id, sqlerrm, sqlstate;
  end;
  return new;
end $handle_user_phone_confirmed_0307$;

comment on function app.handle_user_phone_confirmed() is
  '0303, 0307. Trigger on_auth_user_phone_changed (AFTER UPDATE OF phone, phone_confirmed_at on auth.users, when either value changed): app.phone_claim_internal for the account, except inside a merge. Never fails the auth write: an unexpected error is a warning (a failed walk-in claim is recorded by the claim itself).';

revoke all on function app.handle_user_phone_confirmed() from public, anon, authenticated;

drop trigger if exists on_auth_user_phone_confirmed on auth.users;
drop trigger if exists on_auth_user_phone_changed on auth.users;
create trigger on_auth_user_phone_changed
  after update of phone, phone_confirmed_at on auth.users
  for each row
  when (old.phone is distinct from new.phone or old.phone_confirmed_at is distinct from new.phone_confirmed_at)
  execute function app.handle_user_phone_confirmed();

-- ---------------------------------------------------------------------------
-- 7. The desk's two service-role functions (0065)
-- ---------------------------------------------------------------------------
-- 0307 (c1): the keyed holder of a number (a verified owner or a desk walk-in)
-- comes first, so a guest who only typed the number is never the one found
-- while its owner exists.
create or replace function app.find_customer_by_phone(p_phone text) returns uuid
language sql stable security definer set search_path = public as $find_customer_by_phone_0307$
  select p.id
    from profiles p
   where app.phone_canon(p_phone) is not null
     and app.phone_canon(p.phone) = app.phone_canon(p_phone)
   order by (p.phone_key is not null and p.deleted_at is null) desc, p.created_at
   limit 1
$find_customer_by_phone_0307$;
revoke all on function app.find_customer_by_phone(text) from public, anon, authenticated;
grant execute on function app.find_customer_by_phone(text) to service_role;

create or replace function app.desk_register_customer(
  p_customer_id    uuid,
  p_full_name      text,
  p_phone          text,
  p_preferred_lang text,
  p_actor_id       uuid
) returns jsonb
language plpgsql security definer set search_path = public as $desk_register_customer_0307$
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
  if not exists (select 1 from auth.users where id = p_customer_id) then
    raise exception 'AUTH_USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Re-check under the write: the edge function's pre-check and this call are
  -- two round trips, and two desks can type the same walk-in at once.
  select p.id into v_dup
    from profiles p
   where p.id <> p_customer_id
     and app.phone_canon(p.phone) = v_canon
   limit 1;
  if v_dup is not null then
    raise exception 'DUPLICATE_PHONE' using errcode = 'P0001',
      detail = v_dup::text;
  end if;

  -- 0307: the desk vouches for this number, so zz_phone_key keys it
  -- (app.profile_is_desk_walkin) before the audit row below exists.
  perform set_config('app.desk_walkin', p_customer_id::text, true);

  -- The 0058 trigger normally created this row from user_metadata already;
  -- the upsert makes the outcome the same either way.
  insert into profiles (id, full_name, phone, preferred_lang)
  values (p_customer_id, v_name, v_phone, v_lang)
  on conflict (id) do update
    set full_name      = excluded.full_name,
        phone          = excluded.phone,
        preferred_lang = excluded.preferred_lang
  returning * into v_row;

  perform set_config('app.desk_walkin', '', true);

  insert into audit_log (actor_id, actor_role, action, entity, entity_id, before, after)
  values (p_actor_id, v_actor.role::text, 'customer.create', 'profiles', p_customer_id::text, null,
          jsonb_build_object('full_name', v_row.full_name, 'phone', v_row.phone,
                             'preferred_lang', v_row.preferred_lang, 'source', 'desk'));

  return jsonb_build_object('id', v_row.id, 'full_name', v_row.full_name,
                            'phone', v_row.phone, 'preferred_lang', v_row.preferred_lang);
end $desk_register_customer_0307$;

revoke all on function app.desk_register_customer(uuid, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function app.desk_register_customer(uuid, text, text, text, uuid) to service_role;
