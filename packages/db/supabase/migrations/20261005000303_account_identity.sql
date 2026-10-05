set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0303 account_identity — one account per person (Phase 2 · M3 loyalty,
-- docs/design/loyalty/build-contracts-2026-10-05.md §1.1, plan §3.1–3.2).
--
-- Until now one person could hold two accounts: an email account plus a phone
-- account with the same number, an Apple Hide-My-Email account, or a desk
-- walk-in (`<digits>@guest.touch.local`) plus the guest's own sign-up. Loyalty
-- needs one balance per person, so this file merges them and the next one
-- (the unique index) keeps it that way.
--
--   1. profiles.phone_key: the canonical digits (app.phone_canon), kept by the
--      definer trigger zz_phone_key (0097:28-30: an expression index cannot
--      call phone_canon, which the writing roles may not execute). The trigger
--      raises PHONE_TAKEN when another live profile holds the key, before the
--      unique index of the next file would answer a raw 23505.
--   2. app.profile_merges: one row per merge or refused pair. Append-only,
--      manager and owner read it.
--   3. The three append-only event logs a merge must re-point (match_events,
--      match_ticket_events, lesson_events) let an UPDATE through while the
--      merge's transaction-local flag app.profile_merge is on, and nothing else.
--   4. app.profile_merge_columns(): every column that references profiles(id)
--      or auth.users(id) and what the merge does with it. account-merge.test.ts
--      compares it with pg_constraint and fails on an FK it does not name.
--   5. app.merge_profiles_internal(keep, drop, reason): the merge. Granted to
--      nobody.
--   6. app.duplicate_account_groups() (owner) and app.merge_accounts(keep,
--      drop, reason) (owner + manager-PIN grant, the 0115 pattern).
--   7. app.merge_duplicates_internal(): the deterministic run over every group,
--      called once below. It always completes, so the index can build.
--   8. handle_new_user (re-issued from 0256:180): a sign-up whose phone a live
--      profile holds never fails. A confirmed phone claims a synthetic desk
--      walk-in; anything else stores phone NULL. A trigger on the confirmation
--      itself (an OTP sign-up confirms after the insert) claims the walk-in then.

-- ---------------------------------------------------------------------------
-- 1. profiles.phone_key and its trigger
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists phone_key text;

comment on column profiles.phone_key is
  '0303. app.phone_canon(phone) when the phone has 7-15 digits, else NULL. Kept by the zz_phone_key trigger; unique among live profiles (profiles_phone_key_live, 0304). No client grant.';

create or replace function app.trg_profile_phone_key() returns trigger
language plpgsql security definer set search_path = public as $trg_profile_phone_key_0303$
begin
  new.phone_key := case when coalesce(app.phone_digits(new.phone), '') ~ '^[0-9]{7,15}$'
                        then app.phone_canon(new.phone) end;
  -- PHONE_TAKEN before the unique index answers 23505: a guest editing the
  -- phone, a desk upsert. handle_new_user and the merge check first and never
  -- reach it. A tombstone never holds a key that counts.
  if new.phone_key is not null and new.deleted_at is null
     and exists (select 1 from profiles p
                  where p.phone_key = new.phone_key
                    and p.deleted_at is null
                    and p.id <> new.id) then
    raise exception 'PHONE_TAKEN' using errcode = 'P0001';
  end if;
  return new;
end $trg_profile_phone_key_0303$;

comment on function app.trg_profile_phone_key() is
  '0303. Trigger zz_phone_key (BEFORE INSERT OR UPDATE OF phone on profiles, after the sanitiser): fills phone_key from app.phone_canon (7-15 digits, else NULL) and raises PHONE_TAKEN when another live profile holds the same key.';

revoke all on function app.trg_profile_phone_key() from public, anon, authenticated;

-- The column is filled before the trigger exists: an UPDATE of phone_key alone
-- fires none of the profiles triggers (all are OF other columns or of phone).
update profiles
   set phone_key = case when coalesce(app.phone_digits(phone), '') ~ '^[0-9]{7,15}$'
                        then app.phone_canon(phone) end
 where phone_key is distinct from
       (case when coalesce(app.phone_digits(phone), '') ~ '^[0-9]{7,15}$'
             then app.phone_canon(phone) end);

-- zz_: after profiles_sanitise, so the key is computed from the stored phone.
drop trigger if exists zz_phone_key on profiles;
create trigger zz_phone_key
  before insert or update of phone on profiles
  for each row execute function app.trg_profile_phone_key();

-- ---------------------------------------------------------------------------
-- 2. app.profile_merges
-- ---------------------------------------------------------------------------
create table if not exists app.profile_merges (
  id         uuid primary key default gen_random_uuid(),
  keep_id    uuid not null references profiles(id),
  drop_id    uuid not null,                 -- no FK: the record outlives anything done to the drop
  reason     text not null check (char_length(reason) between 1 and 200),
  moved      jsonb not null default '{}'::jsonb,
  actor_id   uuid,                          -- auth.uid() of merge_accounts; NULL for the migration run and sign-up claims
  created_at timestamptz not null default now()
);

comment on table app.profile_merges is
  '0303. One row per account merge (reason walkin_claim, the migration''s duplicate_phone / duplicate_email, or merge_accounts'' own reason) with the per-table moved counts, and one per refused pair the migration resolved another way (phone_cleared_conflict, phone_cleared_failed, email_conflict_kept, email_merge_failed). Append-only; manager and owner read it.';

alter table app.profile_merges enable row level security;
revoke all on app.profile_merges from public, anon, authenticated;
grant select on app.profile_merges to authenticated;
grant all on app.profile_merges to service_role;

drop policy if exists profile_merges_select_mgmt on app.profile_merges;
create policy profile_merges_select_mgmt on app.profile_merges
  for select to authenticated
  using ((select app.is_staff('manager', 'owner')));

drop trigger if exists profile_merges_ao on app.profile_merges;
create trigger profile_merges_ao
  before update or delete or truncate on app.profile_merges
  for each statement execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- 3. The event logs a merge re-points
-- ---------------------------------------------------------------------------
-- match_ticket_events must follow its tickets (the T6 invariant reads a
-- ticket's events by its holder), and the other two name the actor the merge
-- folds away. app.forbid_mutation guards eleven tables and stays as it is;
-- these three get a twin that lets an UPDATE through while the merge's
-- transaction-local flag is on. Clients hold no UPDATE grant on any of them.
create or replace function app.trg_append_only_but_merge() returns trigger
language plpgsql as $trg_append_only_but_merge_0303$
begin
  if tg_op = 'UPDATE' and current_setting('app.profile_merge', true) = 'on' then
    return null;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = 'P0001';
end $trg_append_only_but_merge_0303$;

comment on function app.trg_append_only_but_merge() is
  '0303. app.forbid_mutation for match_events, match_ticket_events and lesson_events, except an UPDATE made while app.merge_profiles_internal holds its transaction-local app.profile_merge flag (it re-points the account columns and nothing else).';

revoke all on function app.trg_append_only_but_merge() from public, anon, authenticated;

drop trigger if exists match_events_append_only on match_events;
create trigger match_events_append_only
  before delete or update or truncate on match_events
  for each statement execute function app.trg_append_only_but_merge();

drop trigger if exists match_ticket_events_append_only on match_ticket_events;
create trigger match_ticket_events_append_only
  before delete or update or truncate on match_ticket_events
  for each statement execute function app.trg_append_only_but_merge();

drop trigger if exists lesson_events_append_only on lesson_events;
create trigger lesson_events_append_only
  before delete or update or truncate on lesson_events
  for each statement execute function app.trg_append_only_but_merge();

-- ---------------------------------------------------------------------------
-- 4. app.profile_merge_columns: what the merge does with each account column
-- ---------------------------------------------------------------------------
-- how:
--   repoint     moved to keep by the generic loop of merge_profiles_internal,
--               in ord order (the lock order: tabs, then reservations, then
--               the rest, match_tickets last)
--   rule        moved by its own statement, which first resolves the unique
--               scope the move would break (§ 5b of the merge)
--   auth        auth.identities: moved per provider keep lacks
--   signout     deleted on the drop (its sessions and one-time tokens)
--   drop_only   stays on the banned drop (second factors, OAuth grants)
--   refuse      a drop with this row is refused (staff: MERGE_REFUSED)
--   record      history of earlier merges: names the account as it was, never moved
-- A table that does not exist yet (tabs.customer_id and the loyalty tables
-- arrive in 0303 loyalty) is skipped. account-merge.test.ts fails when
-- pg_constraint holds an FK to profiles or auth.users this list does not name.
create or replace function app.profile_merge_columns()
returns table (ord int, sch text, tbl text, col text, how text)
language sql immutable set search_path = public as $profile_merge_columns_0303$
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
    (120, 'public', 'lesson_enrolments',     'booked_by_profile_id',  'repoint'),
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
$profile_merge_columns_0303$;

comment on function app.profile_merge_columns() is
  '0303. Every column referencing profiles(id) or auth.users(id) and what app.merge_profiles_internal does with it (repoint | rule | auth | signout | drop_only | refuse | record). The repoint rows ARE the merge''s generic loop; account-merge.test.ts holds the list to pg_constraint.';

revoke all on function app.profile_merge_columns() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.merge_profiles_internal
-- ---------------------------------------------------------------------------
create or replace function app.merge_profiles_internal(p_keep uuid, p_drop uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $merge_profiles_internal_0303$
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
  v_has_c    boolean;
  v_keep_synth boolean;
  v_merge_id uuid;
begin
  if p_keep is null or p_drop is null then
    raise exception 'MERGE_REFUSED' using errcode = 'P0001', detail = 'missing';
  end if;
  if p_keep = p_drop then
    raise exception 'MERGE_REFUSED' using errcode = 'P0001', detail = 'same';
  end if;

  -- 1. Both profiles, in uuid order (two merges of the same pair, or of a
  -- shared keep, queue instead of deadlocking).
  perform 1 from profiles where id in (p_keep, p_drop) order by id for update;
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

  -- The writes below are the merge's own, made for whichever caller: the
  -- branch guard's "staff write only where they work" (0230) must not refuse
  -- the owner a row of a closed branch, so the caller's claims are set aside
  -- (as for a cron or service write) and restored before the audit row.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('app.profile_merge', 'on', true);
  perform set_config('app.loyalty_merge', 'on', true);   -- contracts §1.3: the ledger re-point

  -- 2. The plain re-points, in lock order (tabs → reservations → … →
  -- match_tickets). A column that does not exist yet is skipped.
  for v_c in
    select m.sch, m.tbl, m.col from app.profile_merge_columns() m
     where m.how = 'repoint' order by m.ord
  loop
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

  -- customer_flags (customer_id, type): keep's flag wins.
  delete from customer_flags d
   where d.customer_id = p_drop
     and exists (select 1 from customer_flags k where k.customer_id = p_keep and k.type = d.type);
  update customer_flags set customer_id = p_keep where customer_id = p_drop;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('customer_flags.customer_id', v_n); end if;

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

  -- lesson_enrolments_one_live_lesson / _course: one live place each.
  update lesson_enrolments d set guest_id = p_keep, updated_at = now()
   where d.guest_id = p_drop
     and not (d.status in ('held', 'booked')
              and exists (select 1 from lesson_enrolments k
                           where k.guest_id = p_keep and k.status in ('held', 'booked')
                             and ((d.lesson_id is not null and k.lesson_id = d.lesson_id)
                                  or (d.course_id is not null and k.course_id = d.course_id))));
  get diagnostics v_n = row_count;
  if v_n > 0 then v_moved := v_moved || jsonb_build_object('lesson_enrolments.guest_id', v_n); end if;

  -- tournament_entries_guest_key (tournament_id, guest_id): keep's entry wins.
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

  -- Loyalty (0303 loyalty, created after this file): the drop's card goes
  -- (keep's is made lazily), the drop's cached account goes and keep's is
  -- recomputed from the ledger rows the loop above moved.
  if to_regclass('public.loyalty_cards') is not null then
    execute 'delete from loyalty_cards where profile_id = $1' using p_drop;
  end if;
  if to_regclass('public.loyalty_accounts') is not null then
    execute 'delete from loyalty_accounts where profile_id = $1' using p_drop;
  end if;
  if to_regprocedure('app.loyalty_recompute(uuid)') is not null then
    execute 'select app.loyalty_recompute($1)' using p_keep;
  end if;

  -- 4. The profile fields keep lacks. Not avatar_path: the path is the drop's
  -- own folder (0302 app.avatar_owner), purged by the tombstone below.
  update profiles k
     set full_name       = case when nullif(btrim(k.full_name), '') is null then d.full_name   else k.full_name   end,
         given_name      = case when nullif(btrim(k.full_name), '') is null then d.given_name  else k.given_name  end,
         family_name     = case when nullif(btrim(k.full_name), '') is null then d.family_name else k.family_name end,
         gender          = case when k.gender is null then d.gender        else k.gender        end,
         gender_set_at   = case when k.gender is null then d.gender_set_at else k.gender_set_at end,
         gender_set_by   = case when k.gender is null then d.gender_set_by else k.gender_set_by end,
         birth_date      = coalesce(k.birth_date, d.birth_date),
         terms_version   = case when k.terms_version is null then d.terms_version     else k.terms_version     end,
         terms_accepted_at = case when k.terms_version is null then d.terms_accepted_at else k.terms_accepted_at end,
         expo_push_token = coalesce(k.expo_push_token, d.expo_push_token)
    from profiles d
   where k.id = p_keep and d.id = p_drop;

  -- 5. The drop, tombstoned as app.delete_my_account (latest 0290) does it;
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

  -- Keep takes the drop's phone when it has none and nobody else holds it.
  if v_keep.phone is null and v_drop.phone is not null and v_drop.phone_key is not null
     and not exists (select 1 from profiles p
                      where p.phone_key = v_drop.phone_key and p.deleted_at is null and p.id <> p_keep) then
    update profiles set phone = v_drop.phone where id = p_keep;
    v_moved := v_moved || jsonb_build_object('profile.phone', 1);
  end if;

  -- 6. Auth. The email or phone slot keep lacks comes across (cleared on the
  -- drop first: both are unique in GoTrue), with its identity; any other
  -- provider keep lacks (google, apple) moves; the drop is banned for good and
  -- signed out everywhere.
  select * into v_ku from auth.users where id = p_keep;
  select * into v_du from auth.users where id = p_drop;
  if v_ku.id is not null and v_du.id is not null then
    -- A desk walk-in's synthetic address (and the random password the desk
    -- gave it) counts as an empty slot: an owner keeping the walk-in must not
    -- strand the person's real email on the banned drop. The password moves
    -- with the email when keep has none of its own (a phone sign-up), or the
    -- person could no longer sign in with it.
    v_keep_synth := coalesce(v_ku.email ilike '%@guest.touch.local', false);
    if (nullif(btrim(coalesce(v_ku.email, '')), '') is null or v_keep_synth)
       and nullif(btrim(coalesce(v_du.email, '')), '') is not null
       and v_du.email not ilike '%@guest.touch.local' then
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
    if nullif(btrim(coalesce(v_ku.phone, '')), '') is null
       and nullif(btrim(coalesce(v_du.phone, '')), '') is not null then
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
    update auth.identities d
       set user_id = p_keep, updated_at = now()
     where d.user_id = p_drop
       and d.provider not in ('email', 'phone')
       and not exists (select 1 from auth.identities k where k.user_id = p_keep and k.provider = d.provider);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_moved := v_moved || jsonb_build_object('auth.identities', v_n); end if;

    update auth.users set banned_until = 'infinity', updated_at = now() where id = p_drop;
    delete from auth.sessions where user_id = p_drop;          -- refresh tokens cascade
    delete from auth.one_time_tokens where user_id = p_drop;
  end if;

  perform set_config('app.loyalty_merge', '', true);
  perform set_config('app.profile_merge', '', true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);

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
end $merge_profiles_internal_0303$;

comment on function app.merge_profiles_internal(uuid, uuid, text) is
  '0303 (loyalty contracts §1.1). Internal, granted to nobody. Folds p_drop into p_keep: every column of app.profile_merge_columns() is re-pointed (a unique scope the move would break: a flag, block, report, exclusion or standing keep already has is deleted on the drop; a seat, request, enrolment, entry or ticket payment in flight stays on the drop, counted <table>_left); keep takes the names (when its full_name is empty), gender, birth_date, terms and push token it lacks, then the phone it lacks; the drop is tombstoned as delete_my_account does (0302 purges its avatar). Auth: the email or phone slot keep lacks (a desk walk-in''s synthetic address counts as empty) moves with its identity, the email with its password when keep has none, other providers keep lacks move, the drop is banned (infinity) and signed out. Loyalty, when 0303 loyalty exists: the drop''s card and cached account go and keep''s is recomputed. Writes app.profile_merges and audit_log account.merge. MERGE_REFUSED detail missing | same | staff_drop | staff_both | coach_both. Returns {merge_id, keep_id, drop_id, moved}.';

revoke all on function app.merge_profiles_internal(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Duplicate groups, and the owner's two RPCs
-- ---------------------------------------------------------------------------
-- Activity: reservations, plus tabs.customer_id once 0303 loyalty adds it.
create or replace function app.profile_activity(p_profile uuid) returns bigint
language plpgsql stable security definer set search_path = public as $profile_activity_0303$
declare
  v_n bigint;
  v_t bigint := 0;
begin
  select count(*) into v_n from reservations where guest_id = p_profile;
  if exists (select 1 from pg_attribute
              where attrelid = 'public.tabs'::regclass and attname = 'customer_id' and not attisdropped) then
    execute 'select count(*) from tabs where customer_id = $1' into v_t using p_profile;
  end if;
  return v_n + v_t;
end $profile_activity_0303$;

comment on function app.profile_activity(uuid) is
  '0303. Internal. Reservations plus tabs.customer_id rows (once 0303 loyalty adds the column): the activity tie-break of the duplicate merge.';

revoke all on function app.profile_activity(uuid) from public, anon, authenticated;

-- Live profiles sharing a phone key, or a verified email (the account's own
-- confirmed email, or the email a Google or Apple identity carries; desk
-- walk-in addresses never count).
create or replace function app.duplicate_groups_internal()
returns table (kind text, key text, profile_id uuid)
language sql stable security definer set search_path = public as $duplicate_groups_internal_0303$
  with phones as (
    select p.phone_key as key, p.id
      from profiles p
     where p.deleted_at is null and p.phone_key is not null
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
$duplicate_groups_internal_0303$;

comment on function app.duplicate_groups_internal() is
  '0303. Internal. (kind phone | email, key, profile_id) for every live profile that shares a phone_key or a verified email with another live profile.';

revoke all on function app.duplicate_groups_internal() from public, anon, authenticated;

create or replace function app.duplicate_account_groups() returns jsonb
language plpgsql stable security definer set search_path = public as $duplicate_account_groups_0303$
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('key', g.key, 'kind', g.kind, 'profiles', g.profiles)
                     order by g.kind desc, g.key)
      from (
        select d.kind, d.key,
               jsonb_agg(jsonb_build_object(
                 'id',         p.id,
                 'name',       p.full_name,
                 'phone',      p.phone,
                 'email',      u.email,
                 'created_at', p.created_at,
                 'staff',      exists (select 1 from staff s where s.id = p.id),
                 'coach',      exists (select 1 from coaches c where c.profile_id = p.id),
                 'synthetic',  coalesce(u.email ilike '%@guest.touch.local', false),
                 'activity',   app.profile_activity(p.id))
                 order by p.created_at, p.id) as profiles
          from app.duplicate_groups_internal() d
          join profiles p on p.id = d.profile_id
          left join auth.users u on u.id = p.id
         group by d.kind, d.key
      ) g), '[]'::jsonb);
end $duplicate_account_groups_0303$;

comment on function app.duplicate_account_groups() is
  '0303 (loyalty contracts §1.1). Owner. Read-only: live profiles sharing a phone key or a verified email, as [{key, kind phone|email, profiles:[{id, name, phone, email, created_at, staff, coach, synthetic, activity}]}]. Empty once the 0303 run and the unique phone index hold, except email groups the run kept apart.';

revoke all on function app.duplicate_account_groups() from public, anon;
grant execute on function app.duplicate_account_groups() to authenticated;

create or replace function app.merge_accounts(p_keep uuid, p_drop uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $merge_accounts_0303$
declare
  v_auth   uuid;
  v_result jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_keep is null or p_drop is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'p_keep, p_drop';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  -- 0115: the manager PIN was proved to app.verify_manager_pin a moment ago;
  -- the single-use grant is spent here (PIN_GRANT_REQUIRED without one).
  v_auth := app.consume_pin_grant();

  v_result := app.merge_profiles_internal(p_keep, p_drop, 'owner: ' || btrim(p_reason));
  perform app.write_audit('account.merge_accounts', 'profiles', p_keep::text,
                          jsonb_build_object('drop_id', p_drop), v_result, 'owner_merge', v_auth);
  return v_result;
end $merge_accounts_0303$;

comment on function app.merge_accounts(uuid, uuid, text) is
  '0303 (loyalty contracts §1.1). Owner, behind a manager-PIN grant (0115: app.verify_manager_pin first, PIN_GRANT_REQUIRED without one). Folds p_drop into p_keep through app.merge_profiles_internal (reason ''owner: <p_reason>''). FORBIDDEN, INVALID_ARGUMENT, REASON_REQUIRED, MERGE_REFUSED detail missing | same | staff_drop | staff_both | coach_both. Returns {merge_id, keep_id, drop_id, moved}.';

revoke all on function app.merge_accounts(uuid, uuid, text) from public, anon;
grant execute on function app.merge_accounts(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. The deterministic run over every group
-- ---------------------------------------------------------------------------
-- One pair per pass, the groups re-read each time (a merge can end or change
-- a group). Phone groups first: an email merge may then hand keep a phone.
-- Keep: a staff or coach row, then an auth phone confirmed and equal to the
-- number, then a real (not walk-in) email, then the most activity, then the
-- oldest. A refused or failing phone pair loses the newer profile's phone; a
-- refused or failing email pair is recorded and kept apart. Every pass ends a
-- live member of a phone group or marks an email pair, so the loop ends.
create or replace function app.merge_duplicates_internal() returns jsonb
language plpgsql security definer set search_path = public as $merge_duplicates_internal_0303$
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
      -- Only skipped members are left beside keep.
      v_skip := v_skip || (v_g.kind || ':' || v_g.key || ':' || v_keep::text);
      continue;
    end if;

    begin
      perform app.merge_profiles_internal(v_keep, v_drop, 'duplicate_' || v_g.kind);
      v_merged := v_merged + 1;
    exception when others then
      if v_g.kind = 'phone' then
        -- The newer of the two lets the number go; the index can then build.
        select id into v_newer from profiles where id in (v_keep, v_drop)
         order by created_at desc, id desc limit 1;
        v_older := case when v_newer = v_keep then v_drop else v_keep end;
        update profiles set phone = null where id = v_newer;
        insert into app.profile_merges (keep_id, drop_id, reason, moved)
        values (v_older, v_newer,
                case when sqlerrm = 'MERGE_REFUSED' then 'phone_cleared_conflict' else 'phone_cleared_failed' end,
                jsonb_build_object('key', v_g.key, 'code', sqlerrm, 'sqlstate', sqlstate));
        v_cleared := v_cleared + 1;
      else
        insert into app.profile_merges (keep_id, drop_id, reason, moved)
        values (v_keep, v_drop,
                case when sqlerrm = 'MERGE_REFUSED' then 'email_conflict_kept' else 'email_merge_failed' end,
                jsonb_build_object('code', sqlerrm, 'sqlstate', sqlstate));
        v_skip := v_skip || (v_g.kind || ':' || v_g.key || ':' || v_drop::text);
        v_kept := v_kept + 1;
      end if;
    end;
  end loop;

  return jsonb_build_object('merged', v_merged, 'phones_cleared', v_cleared, 'emails_kept_apart', v_kept);
end $merge_duplicates_internal_0303$;

comment on function app.merge_duplicates_internal() is
  '0303. Internal, granted to nobody; run once by migration 0303 account_identity. Merges every duplicate group (phone groups first) one pair at a time, keep chosen by: staff or coach row, auth phone confirmed and equal to the number, a real email, most activity, oldest. A phone pair that is refused (MERGE_REFUSED) or fails clears the newer profile''s phone (profile_merges reason phone_cleared_conflict | phone_cleared_failed); an email pair is recorded (email_conflict_kept | email_merge_failed) and kept apart. Always completes. Returns {merged, phones_cleared, emails_kept_apart}.';

revoke all on function app.merge_duplicates_internal() from public, anon, authenticated;

do $merge_duplicates_0303$
declare
  v jsonb;
begin
  v := app.merge_duplicates_internal();
  raise notice 'account_identity: %', v;
end $merge_duplicates_0303$;

-- ---------------------------------------------------------------------------
-- 8. Sign-up: handle_new_user re-issued from 0256:180, plus the phone claim
-- ---------------------------------------------------------------------------
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $handle_new_user_0303$
declare
  v_meta   jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_email  text  := coalesce(new.email, '');
  v_name   text;
  v_phone  text;
  v_given  text;
  v_family text;
  v_key    text;
  v_holder uuid;
  v_claim  boolean := false;
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

  -- 0069: a phone sign-up (GoTrue signInWithOtp) has no metadata; the verified
  -- number sits in auth.users.phone as digits without '+'. Metadata still wins
  -- when present (the email/password form sends it).
  v_phone := coalesce(
    nullif(btrim(v_meta->>'phone'), ''),
    case when nullif(btrim(coalesce(new.phone, '')), '') is not null
         then '+' || app.phone_digits(new.phone) end);

  -- 0256: the sign-up's two name parts, clamped to 39, only when they rebuild
  -- the resolved name exactly. A given_name without its surname (or parts that
  -- disagree with full_name) must not cut the stored name short: both stay
  -- NULL and profiles_sync_names splits v_name instead.
  v_given  := nullif(rtrim(left(btrim(v_meta->>'given_name'), 39)), '');
  v_family := nullif(rtrim(left(btrim(v_meta->>'family_name'), 39)), '');
  if v_given is null or concat_ws(' ', v_given, v_family) is distinct from v_name then
    v_given  := null;
    v_family := null;
  end if;

  -- 0303: one live profile per phone, and a sign-up never fails on it. When a
  -- live profile already holds the number, the new profile is stored without
  -- it; a desk walk-in holder is claimed when GoTrue has confirmed this very
  -- number (here, or later in handle_user_phone_confirmed).
  v_key := case when coalesce(app.phone_digits(v_phone), '') ~ '^[0-9]{7,15}$'
                then app.phone_canon(v_phone) end;
  if v_key is not null then
    select p.id into v_holder
      from profiles p
     where p.phone_key = v_key and p.deleted_at is null and p.id <> new.id
     order by p.created_at, p.id
     limit 1;
    if v_holder is not null then
      v_claim := new.phone_confirmed_at is not null
                 and app.phone_canon(new.phone) = v_key
                 and exists (select 1 from auth.users u
                              where u.id = v_holder and u.email ilike '%@guest.touch.local');
      v_phone := null;
    end if;
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
  exception when unique_violation or raise_exception then
    -- 0303: a writer that committed the same number between the check above
    -- and this insert (23505 from profiles_phone_key_live, or PHONE_TAKEN from
    -- zz_phone_key). The sign-up still never fails: stored without the phone.
    if sqlstate = 'P0001' and sqlerrm <> 'PHONE_TAKEN' then
      raise;
    end if;
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
    v_claim := false;
  end;

  if v_claim then
    begin
      perform app.merge_profiles_internal(new.id, v_holder, 'walkin_claim');
    exception when others then
      raise warning 'handle_new_user: walk-in claim of % skipped: % (%)', v_holder, sqlerrm, sqlstate;
    end;
  end if;
  return new;
end $handle_new_user_0303$;
-- Grants + trigger binding unchanged (0004:56, 0004:150): replace preserves them.

-- An OTP sign-up is inserted unconfirmed and confirmed by the verify call: the
-- claim of a walk-in holding the number happens then.
create or replace function app.handle_user_phone_confirmed() returns trigger
language plpgsql security definer set search_path = public as $handle_user_phone_confirmed_0303$
declare
  v_key    text := case when coalesce(app.phone_digits(new.phone), '') ~ '^[0-9]{7,15}$'
                        then app.phone_canon(new.phone) end;
  v_holder uuid;
begin
  if coalesce(new.is_anonymous, false) or v_key is null then
    return new;
  end if;
  if not exists (select 1 from profiles p
                  where p.id = new.id and p.deleted_at is null
                    and (p.phone_key is null or p.phone_key = v_key)) then
    return new;
  end if;
  select p.id into v_holder
    from profiles p
    join auth.users u on u.id = p.id
   where p.phone_key = v_key and p.deleted_at is null and p.id <> new.id
     and u.email ilike '%@guest.touch.local'
   order by p.created_at, p.id
   limit 1;
  if v_holder is not null then
    begin
      perform app.merge_profiles_internal(new.id, v_holder, 'walkin_claim');
    exception when others then
      raise warning 'handle_user_phone_confirmed: walk-in claim of % skipped: % (%)', v_holder, sqlerrm, sqlstate;
    end;
  end if;
  return new;
end $handle_user_phone_confirmed_0303$;

comment on function app.handle_user_phone_confirmed() is
  '0303. Trigger on_auth_user_phone_confirmed (AFTER UPDATE OF phone_confirmed_at on auth.users, NULL -> set): when a desk walk-in (@guest.touch.local) holds the confirmed number and the account''s own profile has no other phone, the walk-in is merged into the account (walkin_claim). Never fails the confirmation: a refused claim is a warning.';

revoke all on function app.handle_user_phone_confirmed() from public, anon, authenticated;

drop trigger if exists on_auth_user_phone_confirmed on auth.users;
create trigger on_auth_user_phone_confirmed
  after update of phone_confirmed_at on auth.users
  for each row
  when (old.phone_confirmed_at is null and new.phone_confirmed_at is not null)
  execute function app.handle_user_phone_confirmed();
