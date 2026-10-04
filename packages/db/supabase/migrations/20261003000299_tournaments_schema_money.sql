set lock_timeout = '3s';
set statement_timeout = '60s';

-- tournaments_schema_money — tournaments (Phase 2 milestone 7), staged file 1
-- of 3 (docs/design/tournaments/build-contracts-2026-10-03.md §1.1, §1.2,
-- §1.5, §1.7, §1.12 S1–S7).
--
--   1. venue_settings.tournaments_enabled (off on every branch, TD-3), its
--      column grant (0297: the table has no table-level SELECT), its comment
--      and the assistant's readable column; venue_settings_public gains it,
--      appended last.
--   2. notification_outbox.kind gains tournament_update (send-push deploys
--      first: deploy.yml orders it).
--   3. The five tables: tournaments, tournament_entries, tournament_rounds,
--      tournament_matches, tournament_score_events. Each a branch table:
--      venue_id with no default, RLS on, no policy, no client grant (every
--      read and write is a definer body), a zz_branch_guard with its link
--      pairs, a sanitiser on the text a person types.
--   4. tabs: kind 'tournament', tournament_entry_id and its shape CHECK, the
--      branch guard re-created with the new pair before the lesson pair.
--   5. The money engine: app.tournament_on, app.tournament_entry_money,
--      app.tournament_fee_remaining; compute_tab_totals and cafe_settled_tabs
--      re-issued (0281); app.tournament_settle, the lesson_settle twin.
--
-- No index here beyond primary keys and inline unique constraints. Every
-- CHECK on a new table is inline in its create table; every CHECK or FK on an
-- existing table is NOT VALID with a validate guarded on conname and conrelid.
--
-- A tournament plays on its protocol run's event blocks (0174): there are no
-- kind 'tournament' reservations and no stored standings (this supersedes
-- PHASE-2-PLAN.md §C4). Entry money is paid at the desk on a kind
-- 'tournament' tab, inserted and settled in one call (S5), untaxed (TD-5),
-- and never café money (cafe_settled_tabs). It shows in cash, card and the
-- day close, not in "revenue", until M7.1 re-issues the report functions (S6).

-- ===========================================================================
-- 1. The switch (TD-3)
-- ===========================================================================
alter table venue_settings add column if not exists tournaments_enabled boolean not null default false;

-- 0297 (DB-46): venue_settings is granted column by column; a new column is
-- unreadable by any client until it is granted here.
grant select (tournaments_enabled) on public.venue_settings to authenticated;

comment on column venue_settings.tournaments_enabled is
  'Tournaments (M7). Whether this branch runs tournaments. False (the default, every branch): no publish and no registration (TOURNAMENTS_OFF), the public reads answer off; a published tournament keeps running to its end. Owner-set via app.set_tournaments_enabled.';

-- venue_settings_public, re-created from 20261001000277_coaching_settings.sql:111
-- with tournaments_enabled appended last (create or replace can only append).
create or replace view venue_settings_public with (security_invoker = off) as
select vs.venue_name,
       vs.currency,
       vs.timezone,
       vs.opening_hours,
       vs.closed_dates,
       vs.protected_horizon_hours,
       vs.cancellation_window_hours,
       vs.table_token_ttl_minutes,
       vs.phone,
       vs.max_booking_horizon_days,
       vs.venue_id,
       v.slug       as venue_slug,
       v.name_en    as venue_name_en,
       v.name_ar    as venue_name_ar,
       v.address_en,
       v.address_ar,
       v.map_url,
       vs.matches_enabled,
       vs.match_fill_deadline_minutes,
       vs.coaching_enabled,
       vs.lesson_payment_mode,
       vs.lesson_prices_public,
       vs.tournaments_enabled
  from venue_settings vs
  join venues v on v.id = vs.venue_id and v.is_active;

grant select on venue_settings_public to anon, authenticated;

comment on view venue_settings_public is
  '0006/0048, per branch since 0208, open matches since 0257, coaching since 0277, tournaments since M7. The guest-safe settings of every active branch, with its id, slug, names and address, whether it runs open matches and their fill deadline, whether it offers lessons, how they are paid and whether the website shows their prices, and whether it runs tournaments. The ONLY settings surface for anon.';

-- The assistant's table_read allowlist (0109:94) learns the new column on the
-- table and on the view: the 0277 statement, limited to it.
insert into app.assistant_readable_columns (table_name, column_name, kind, is_default, data_type, ordinal, note)
select c.table_name,
       c.column_name,
       case when t.table_type = 'VIEW' then 'view' else 'table' end,
       c.data_type <> 'jsonb',
       c.data_type,
       c.ordinal_position,
       col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position)
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
 where c.table_schema = 'public'
   and t.table_type in ('BASE TABLE', 'VIEW')
   and c.table_name in ('venue_settings', 'venue_settings_public')
   and c.column_name = 'tournaments_enabled'
on conflict (table_name, column_name) do nothing;

-- ===========================================================================
-- 2. The outbox kind (§1.10): re-created from
--    20261001000274_outbox_lesson_kinds.sql:16 with tournament_update. Its
--    copy is send-push/guestStrings.ts, keyed by payload.title_key;
--    _shared/guest-push.json is the one list. Nothing queues it before
--    app.tournament_notify (tournaments_lifecycle).
-- ===========================================================================
alter table notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table notification_outbox
  add constraint notification_outbox_kind_check
  check (kind in ('booking_confirmed', 'booking_reminder', 'booking_cancelled',
                  'booking_no_show', 'test',
                  'staff_task', 'staff_decide', 'staff_decided', 'staff_info',
                  'deposit_refunded',
                  'match_update', 'match_reminder', 'match_message',
                  'lesson_update', 'lesson_reminder', 'coach_update',
                  'tournament_update'))
  not valid;

do $validate_kind_check_0299$
begin
  if exists (select 1 from pg_constraint
              where conname = 'notification_outbox_kind_check'
                and conrelid = 'public.notification_outbox'::regclass
                and not convalidated) then
    alter table notification_outbox validate constraint notification_outbox_kind_check;
  end if;
end $validate_kind_check_0299$;

-- ===========================================================================
-- 3. The tables (§1.2)
-- ===========================================================================

-- One published tournament per protocol run (T-6). Its courts are the run's
-- event blocks; its money is its entries' tournament tabs.
create table if not exists tournaments (
  id                     uuid primary key default gen_random_uuid(),
  venue_id               uuid not null references venues(id),
  protocol_run_id        uuid not null references protocol_runs(id),
  name_en                text not null,
  name_ar                text not null,
  format                 text not null,
  category               text not null default 'open',
  class                  text not null,
  points_target          smallint not null default 24,
  rounds_planned         smallint,
  max_entries            smallint not null,
  min_entries            smallint not null,
  waitlist_max           smallint not null default 8,
  entry_fee_iqd          bigint not null default 0,
  prize_en               text,
  prize_ar               text,
  starts_at              timestamptz not null,
  ends_at                timestamptz not null,
  registration_closes_at timestamptz not null,
  status                 text not null default 'open',
  cancel_reason          text,
  revision               int not null default 0,
  closed_at              timestamptz,
  finished_at            timestamptz,
  cancelled_at           timestamptz,
  published_by           uuid not null references staff(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint tournaments_protocol_run_id_key unique (protocol_run_id),
  constraint tournaments_names     check (char_length(name_en) between 1 and 80
                                          and char_length(name_ar) between 1 and 80),
  constraint tournaments_format    check (format in ('americano', 'mexicano')),
  constraint tournaments_category  check (category in ('open', 'women', 'men')),
  constraint tournaments_class     check (class in ('A', 'B', 'C')),
  constraint tournaments_points    check (points_target between 8 and 64),
  constraint tournaments_rounds    check (rounds_planned is null or rounds_planned between 1 and 30),
  constraint tournaments_entries   check (max_entries between 4 and 64 and min_entries >= 4
                                          and min_entries <= max_entries),
  constraint tournaments_waitlist  check (waitlist_max between 0 and 64),
  constraint tournaments_fee       check (entry_fee_iqd >= 0),
  constraint tournaments_prizes    check ((prize_en is null or char_length(prize_en) <= 200)
                                          and (prize_ar is null or char_length(prize_ar) <= 200)),
  constraint tournaments_times     check (starts_at < ends_at and registration_closes_at <= starts_at),
  constraint tournaments_status    check (status in ('open', 'closed', 'running', 'finished', 'cancelled')),
  constraint tournaments_cancel_reason check (cancel_reason is null or cancel_reason in ('under_filled', 'staff')),
  constraint tournaments_mexicano_rounds check (format <> 'mexicano' or rounds_planned is not null),
  constraint tournaments_cancelled check ((status = 'cancelled') = (cancelled_at is not null and cancel_reason is not null))
);

-- One guest's place. Live = registered or waitlisted. A withdrawn row is
-- re-used when the guest comes back (unique per tournament and guest).
create table if not exists tournament_entries (
  id                uuid primary key default gen_random_uuid(),
  venue_id          uuid not null references venues(id),
  tournament_id     uuid not null references tournaments(id),
  guest_id          uuid not null references profiles(id),
  status            text not null,
  seed_no           smallint,
  entered_at        timestamptz not null default now(),
  added_by_kind     text not null,
  added_by_staff_id uuid references staff(id),
  withdrawn_reason  text,
  withdrawn_at      timestamptz,
  promoted_at       timestamptz,
  no_show_at        timestamptz,
  substitute_for    uuid references tournament_entries(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint tournament_entries_guest_key unique (tournament_id, guest_id),
  constraint tournament_entries_status    check (status in ('registered', 'waitlisted', 'withdrawn', 'no_show')),
  constraint tournament_entries_seed      check (seed_no is null or seed_no between 1 and 512),
  constraint tournament_entries_added_by  check (added_by_kind in ('guest', 'staff')),
  constraint tournament_entries_withdrawn_reason
    check (withdrawn_reason is null or withdrawn_reason in ('guest', 'staff', 'account_deleted')),
  constraint tournament_entries_withdrawn check ((status = 'withdrawn') = (withdrawn_reason is not null))
);

-- One round of the play; bye_entry_ids are its sit-outs. Only unscored rounds
-- are ever deleted (a regeneration), and their matches go with them.
create table if not exists tournament_rounds (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references venues(id),
  tournament_id uuid not null references tournaments(id),
  round_no      smallint not null,
  bye_entry_ids uuid[] not null default '{}',
  generated_by  uuid not null references staff(id),
  created_at    timestamptz not null default now(),
  constraint tournament_rounds_no_key unique (tournament_id, round_no),
  constraint tournament_rounds_id_no_key unique (id, round_no),
  constraint tournament_rounds_no check (round_no between 1 and 30)
);

-- One match: two teams of two entries on one court of the round.
create table if not exists tournament_matches (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references venues(id),
  tournament_id uuid not null references tournaments(id),
  round_id      uuid not null,
  round_no      smallint not null,
  court_id      uuid not null references courts(id),
  a1            uuid not null references tournament_entries(id),
  a2            uuid not null references tournament_entries(id),
  b1            uuid not null references tournament_entries(id),
  b2            uuid not null references tournament_entries(id),
  points_a      smallint,
  points_b      smallint,
  revision      int not null default 0,
  scored_at     timestamptz,
  scored_by     uuid references staff(id),
  constraint tournament_matches_round_id_round_no_fkey foreign key (round_id, round_no)
    references tournament_rounds(id, round_no) on delete cascade,
  constraint tournament_matches_round_court_key unique (round_id, court_id),
  constraint tournament_matches_no_court_key unique (tournament_id, round_no, court_id),
  constraint tournament_matches_four check (a1 <> a2 and a1 <> b1 and a1 <> b2
                                            and a2 <> b1 and a2 <> b2 and b1 <> b2),
  constraint tournament_matches_points check ((points_a is null) = (points_b is null)
                                              and (points_a is null or (points_a >= 0 and points_b >= 0)))
);

-- Every score and correction of a match, append-only. Its match is never
-- deleted (a scored match's round is never deleted), so the FK restricts.
create table if not exists tournament_score_events (
  id              uuid primary key default gen_random_uuid(),
  venue_id        uuid not null references venues(id),
  tournament_id   uuid not null references tournaments(id),
  match_id        uuid not null references tournament_matches(id),
  points_a_before smallint,
  points_b_before smallint,
  points_a        smallint not null,
  points_b        smallint not null,
  reason          text,
  actor_staff_id  uuid not null references staff(id),
  at              timestamptz not null default now(),
  constraint tournament_score_events_key unique (match_id, at, id),
  constraint tournament_score_events_reason check (reason is null or char_length(reason) <= 300)
);

comment on table tournaments is
  'Tournaments (M7, build contracts §1.2). One published tournament per protocol run of kind tournament (tournament_publish adopts the run''s event blocks). Americano or Mexicano, individual entry. status open -> closed (the cut-off, enough entries) -> running (the first set_rounds) -> finished; cancelled from open, closed or running (cancel_reason under_filled from the sweep, staff from tournament_cancel). revision moves on every play write (rounds, scores, no-shows, entries added or removed once closed): the desk sends it back as based_on_revision. No client grant: every read and write is a definer RPC.';
comment on table tournament_entries is
  'Tournaments (M7). One guest''s place in a tournament: registered or waitlisted (live), withdrawn (guest, staff, account_deleted) or no_show. seed_no is stamped 1..N by entered_at at the cut-off or the first set_rounds, and the next number for a later add or substitute. Desk walk-ins are real profiles (added_by_kind staff). No client grant.';
comment on table tournament_rounds is
  'Tournaments (M7). One round of a tournament''s play, bye_entry_ids its sit-outs. Written only by tournament_set_rounds; only unscored rounds are deleted (a regeneration, a correction or a no-show), their matches with them. No client grant.';
comment on table tournament_matches is
  'Tournaments (M7). One match of a round: entries a1 and a2 against b1 and b2 on court_id. points_a and points_b are the desk''s score (they add up to the points target); revision moves on every score, and a correction sends it back. No client grant.';
comment on table tournament_score_events is
  'Tournaments (M7). Append-only audit of every score and correction of a match: the score before and after, the reason (required for a correction) and who entered it. No client grant.';

-- ===========================================================================
-- 4. Guards, the sanitiser, the append-only trigger, RLS
-- ===========================================================================

-- Links name rows of the same branch; staff write only where a definer body
-- asserted app.venue_id (0230).
drop trigger if exists zz_branch_guard on public.tournaments;
create trigger zz_branch_guard before insert or update or delete on public.tournaments
  for each row execute function app.trg_branch_guard('scoped', 'protocol_runs', 'protocol_run_id');
drop trigger if exists zz_branch_guard on public.tournament_entries;
create trigger zz_branch_guard before insert or update or delete on public.tournament_entries
  for each row execute function app.trg_branch_guard('scoped', 'tournaments', 'tournament_id', 'tournament_entries', 'substitute_for');
drop trigger if exists zz_branch_guard on public.tournament_rounds;
create trigger zz_branch_guard before insert or update or delete on public.tournament_rounds
  for each row execute function app.trg_branch_guard('scoped', 'tournaments', 'tournament_id');
drop trigger if exists zz_branch_guard on public.tournament_matches;
create trigger zz_branch_guard before insert or update or delete on public.tournament_matches
  for each row execute function app.trg_branch_guard('scoped', 'tournaments', 'tournament_id', 'tournament_rounds', 'round_id',
                                                     'courts', 'court_id', 'tournament_entries', 'a1', 'tournament_entries', 'a2',
                                                     'tournament_entries', 'b1', 'tournament_entries', 'b2');
drop trigger if exists zz_branch_guard on public.tournament_score_events;
create trigger zz_branch_guard before insert or update or delete on public.tournament_score_events
  for each row execute function app.trg_branch_guard('scoped', 'tournaments', 'tournament_id', 'tournament_matches', 'match_id');

-- Sanitisers (the 0080 shape), named so they sort before zz_branch_guard.
-- The names come from the plan record and the prizes from the publish dialog;
-- app.safe_line never returns NULL for a non-NULL input.
create or replace function app.trg_sanitise_tournament() returns trigger
language plpgsql security definer set search_path = public as $trg_sanitise_tournament_0299$
begin
  new.name_en  := app.safe_line(new.name_en);
  new.name_ar  := app.safe_line(new.name_ar);
  new.prize_en := nullif(app.safe_line(new.prize_en), '');
  new.prize_ar := nullif(app.safe_line(new.prize_ar), '');
  return new;
end $trg_sanitise_tournament_0299$;

create or replace function app.trg_sanitise_tournament_score_event() returns trigger
language plpgsql security definer set search_path = public as $trg_sanitise_tournament_score_event_0299$
begin
  new.reason := nullif(app.safe_line(new.reason), '');
  return new;
end $trg_sanitise_tournament_score_event_0299$;

revoke all on function app.trg_sanitise_tournament() from public, anon, authenticated;
revoke all on function app.trg_sanitise_tournament_score_event() from public, anon, authenticated;

drop trigger if exists tournaments_sanitise on tournaments;
create trigger tournaments_sanitise
  before insert or update of name_en, name_ar, prize_en, prize_ar on tournaments
  for each row execute function app.trg_sanitise_tournament();
drop trigger if exists tournament_score_events_sanitise on tournament_score_events;
create trigger tournament_score_events_sanitise
  before insert on tournament_score_events
  for each row execute function app.trg_sanitise_tournament_score_event();

-- Append-only (0241:128-131, 0278's lesson_events).
drop trigger if exists tournament_score_events_append_only on tournament_score_events;
create trigger tournament_score_events_append_only
  before update or delete or truncate on tournament_score_events
  for each statement execute function app.forbid_mutation();

-- RLS on, no policy, no client grant (0278:895): Supabase's default
-- privileges grant the client roles every new table, so they are revoked.
alter table tournaments enable row level security;
revoke all on tournaments from anon, authenticated;
grant all on tournaments to service_role;
alter table tournament_entries enable row level security;
revoke all on tournament_entries from anon, authenticated;
grant all on tournament_entries to service_role;
alter table tournament_rounds enable row level security;
revoke all on tournament_rounds from anon, authenticated;
grant all on tournament_rounds to service_role;
alter table tournament_matches enable row level security;
revoke all on tournament_matches from anon, authenticated;
grant all on tournament_matches to service_role;
alter table tournament_score_events enable row level security;
revoke all on tournament_score_events from anon, authenticated;
grant all on tournament_score_events to service_role;

-- ===========================================================================
-- 5. tabs: an entry's desk money (§1.2, S1, S5)
-- ===========================================================================
-- tabs_kind_chk named at 0144:88, widened by 0276. The drop and add take a
-- brief ACCESS EXCLUSIVE (no scan, NOT VALID); the validate takes SHARE
-- UPDATE EXCLUSIVE and does not block the till. open_tab refuses every kind
-- but cafe and shop (0280:1227), so only tournament_settle writes this kind.
alter table tabs drop constraint if exists tabs_kind_chk;
alter table tabs add constraint tabs_kind_chk check (kind in ('cafe', 'shop', 'lesson', 'tournament')) not valid;

alter table tabs add column if not exists tournament_entry_id uuid;

do $tabs_tournament_0299$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'tabs_tournament_entry_fkey'
                    and conrelid = 'public.tabs'::regclass) then
    alter table tabs add constraint tabs_tournament_entry_fkey
      foreign key (tournament_entry_id) references tournament_entries(id) not valid;
  end if;
  -- A tournament tab is the entry's own bill: no table, no booking, no court
  -- cap; every other tab names no entry. It already passes tabs_lesson_shape
  -- (no lesson link, lesson_iqd 0).
  if not exists (select 1 from pg_constraint
                  where conname = 'tabs_tournament_shape'
                    and conrelid = 'public.tabs'::regclass) then
    alter table tabs add constraint tabs_tournament_shape check (
          (kind = 'tournament') = (tournament_entry_id is not null)
      and (kind <> 'tournament' or (reservation_id is null and table_id is null and court_cap_iqd is null))) not valid;
  end if;
end $tabs_tournament_0299$;

do $tabs_tournament_validate_0299$
declare
  v_name text;
begin
  foreach v_name in array array['tabs_kind_chk', 'tabs_tournament_entry_fkey', 'tabs_tournament_shape'] loop
    if exists (select 1 from pg_constraint
                where conname = v_name
                  and conrelid = 'public.tabs'::regclass
                  and not convalidated) then
      execute format('alter table tabs validate constraint %I', v_name);
    end if;
  end loop;
end $tabs_tournament_validate_0299$;

comment on column tabs.tournament_entry_id is
  'Tournaments (M7). The tournament entry a kind ''tournament'' tab takes the entry fee for (one payment, inserted and settled in the same call by app.tournament_settle). NULL on every other tab.';

-- The branch guard, re-created from 20261001000278_coaching_tables.sql:752
-- with the entry pair inserted before the lesson pair (the lesson pair stays
-- last, coaching-schema.test.ts).
drop trigger if exists zz_branch_guard on public.tabs;
create trigger zz_branch_guard before insert or update or delete on public.tabs
  for each row execute function app.trg_branch_guard('scoped', 'cafe_tables', 'table_id', 'day_sessions', 'day_session_id', 'tabs', 'merged_into_tab_id', 'tournament_entries', 'tournament_entry_id', 'lesson_enrolments', 'lesson_enrolment_id');

-- ===========================================================================
-- 6. The money engine (§1.7, S1–S3)
-- ===========================================================================

-- Tournaments at this branch: the switch on and the branch open to guests.
create or replace function app.tournament_on(p_venue uuid) returns boolean
language sql stable security definer set search_path = public as $tournament_on_0299$
  select coalesce((select vs.tournaments_enabled and v.is_active
                     from venues v
                     join venue_settings vs on vs.venue_id = v.id
                    where v.id = p_venue), false)
$tournament_on_0299$;

comment on function app.tournament_on(uuid) is
  'Tournaments (M7). Internal: venue_settings.tournaments_enabled and venues.is_active of one branch; false for an unknown branch or one without settings.';

revoke all on function app.tournament_on(uuid) from public, anon, authenticated;

-- What one entry has paid and owes. Desk money is read from payments and
-- refunds (S3), never from a tab's stamps; the left-out tab is the live tab
-- being totalled, so no tab is added back (S2).
create or replace function app.tournament_entry_money(p_entry_id uuid, p_exclude_tab_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $tournament_entry_money_0299$
declare
  v_e        tournament_entries%rowtype;
  v_t        tournaments%rowtype;
  v_paid     bigint;
  v_refunded bigint;
  v_online   bigint := 0;   -- the Qi seam (T-2): no online entry money in v1
  v_net      bigint;
  v_payable  boolean;
  v_owed     bigint;
  v_due      bigint;
begin
  select * into v_e from tournament_entries where id = p_entry_id;
  if not found then
    return null;
  end if;
  select * into v_t from tournaments where id = v_e.tournament_id;

  select coalesce(sum(p.amount_iqd), 0) into v_paid
    from payments p
    join tabs t on t.id = p.tab_id
   where t.kind = 'tournament'
     and t.tournament_entry_id = v_e.id
     and t.status = 'settled'
     and t.merged_into_tab_id is null
     and t.id is distinct from p_exclude_tab_id;

  select coalesce(sum(rf.amount_iqd), 0) into v_refunded
    from refunds rf
    join payments p on p.id = rf.payment_id
    join tabs t on t.id = p.tab_id
   where t.kind = 'tournament'
     and t.tournament_entry_id = v_e.id
     and t.status = 'settled'
     and t.merged_into_tab_id is null
     and t.id is distinct from p_exclude_tab_id;

  v_net := v_paid - v_refunded + v_online;
  v_payable := v_e.status = 'registered' and v_t.status <> 'cancelled';
  v_owed := case when v_payable then greatest(v_t.entry_fee_iqd - v_net, 0) else 0 end;
  v_due := case when v_e.status = 'withdrawn' or v_t.status = 'cancelled' then v_net else 0 end;

  return jsonb_build_object(
    'entry_id',          v_e.id,
    'tournament_id',     v_t.id,
    'entry_status',      v_e.status,
    'tournament_status', v_t.status,
    'fee_iqd',           v_t.entry_fee_iqd,
    'desk_paid_iqd',     v_paid,
    'desk_refunded_iqd', v_refunded,
    'online_paid_iqd',   v_online,
    'net_iqd',           v_net,
    'payable',           v_payable,
    'owed_iqd',          v_owed,
    'refund_due_iqd',    v_due);
end $tournament_entry_money_0299$;

comment on function app.tournament_entry_money(uuid, uuid) is
  'Tournaments (M7, build contracts §1.7, S2, S3). Internal: the money of one entry, tab p_exclude_tab_id left out: {entry_id, tournament_id, entry_status, tournament_status, fee_iqd, desk_paid_iqd (payments on its settled, unmerged tournament tabs), desk_refunded_iqd (refunds on those payments), online_paid_iqd (0, the Qi seam), net_iqd, payable (registered, tournament not cancelled), owed_iqd (payable ? max(0, fee - net) : 0), refund_due_iqd (withdrawn or tournament cancelled ? net : 0)}. NULL for an unknown entry. Stable, no locks, no name, phone or guest id. Key list: TOURNAMENT_SHAPES.tournament_entry_money (packages/core/src/tournaments/shapes.ts).';

revoke all on function app.tournament_entry_money(uuid, uuid) from public, anon, authenticated;
-- The service role reads it directly (the shapes and money suites); no client.
grant execute on function app.tournament_entry_money(uuid, uuid) to service_role;

-- The till's tournament line (the lesson_fee_remaining place, 0281:426): what
-- the entry owes with the tab being totalled left out. Re-totalling a settled
-- tournament tab gives back its own fee, as the lesson line does (S2).
create or replace function app.tournament_fee_remaining(p_entry_id uuid, p_exclude_tab_id uuid default null)
returns bigint
language sql stable security definer set search_path = public as $tournament_fee_remaining_0299$
  select coalesce((app.tournament_entry_money(p_entry_id, p_exclude_tab_id)->>'owed_iqd')::bigint, 0)
$tournament_fee_remaining_0299$;

comment on function app.tournament_fee_remaining(uuid, uuid) is
  'Tournaments (M7, §1.7, S2). Internal: what an entry owes at the desk with tab p_exclude_tab_id left out (tournament_entry_money owed_iqd); 0 for an unknown entry. compute_tab_totals'' tournament line.';

revoke all on function app.tournament_fee_remaining(uuid, uuid) from public, anon, authenticated;

-- compute_tab_totals: re-issued from 20261001000281_lesson_money.sql:716 with
-- the tournament line (S1): the same six columns (create or replace keeps the
-- signature, so no caller changes); a kind 'tournament' tab bills what its
-- entry still owes, this tab left out, outside subtotal_iqd (no discount) and
-- outside the tax base (TD-5), in total_iqd only. lesson_iqd stays the lesson
-- line (0 on a tournament tab), so settle_tab stamps lesson_iqd = 0 and
-- tabs_lesson_shape holds.
create or replace function app.compute_tab_totals(p_tab_id uuid)
returns table (
  subtotal_iqd bigint,
  discount_iqd bigint,
  tax_iqd      bigint,
  court_iqd    bigint,
  total_iqd    bigint,
  lesson_iqd   bigint   -- 0281
)
language plpgsql stable security definer set search_path = public as $compute_tab_totals_0299$
declare
  v_subtotal  bigint;
  v_disc_line bigint;
  v_disc_tab  bigint;
  v_discount  bigint;
  v_tab_alloc bigint;
  v_tax       bigint;
  v_court     bigint;
  v_inclusive boolean;
  v_lesson    bigint;   -- 0281
  v_tour      bigint;   -- tournaments (M7)
begin
  select coalesce(sum(oi.line_total_iqd), 0) into v_subtotal
    from order_items oi
    join orders o on o.id = oi.order_id
   where o.tab_id = p_tab_id and o.status <> 'voided' and not oi.voided;

  select coalesce(sum(a.amount_iqd), 0) into v_disc_line
    from tab_adjustments a
    join order_items oi on oi.id = a.order_item_id
    join orders o on o.id = oi.order_id
   where a.tab_id = p_tab_id
     and a.kind in ('discount_percent','discount_amount')
     and o.tab_id = p_tab_id
     and o.status <> 'voided'
     and not oi.voided;

  select coalesce(sum(a.amount_iqd), 0) into v_disc_tab
    from tab_adjustments a
   where a.tab_id = p_tab_id
     and a.kind in ('discount_percent','discount_amount')
     and a.order_item_id is null;

  v_discount := least(v_disc_line + v_disc_tab, v_subtotal);

  v_tab_alloc := greatest(least(v_disc_tab, v_discount - least(v_disc_line, v_discount)), 0);

  -- 0106: the court fee still OWED on the booking this tab is charged to (D1,
  -- D3). 'pending' holds, cancelled, expired and no-show bookings owe nothing.
  -- 0262 (R2): a tab with court_cap_iqd bills at most its cap.
  select case when t.court_cap_iqd is null then app.court_fee_remaining(t.reservation_id, t.id)
              else least(t.court_cap_iqd, app.court_fee_remaining(t.reservation_id, t.id)) end
    into v_court
    from tabs t
   where t.id = p_tab_id
     and t.reservation_id is not null;
  v_court := coalesce(v_court, 0);

  -- 0281 (CM-1): a kind 'lesson' tab bills what its enrolment still owes,
  -- this tab left out (lesson_fee_remaining); every other tab 0.
  select case when t.kind = 'lesson' then app.lesson_fee_remaining(t.lesson_enrolment_id, t.id) else 0 end
    into v_lesson
    from tabs t
   where t.id = p_tab_id;
  v_lesson := coalesce(v_lesson, 0);

  -- Tournaments (M7, S1): a kind 'tournament' tab bills what its entry still
  -- owes, this tab left out (tournament_fee_remaining); every other tab 0.
  select case when t.kind = 'tournament' then app.tournament_fee_remaining(t.tournament_entry_id, t.id) else 0 end
    into v_tour
    from tabs t
   where t.id = p_tab_id;
  v_tour := coalesce(v_tour, 0);

  with grp as (
    select mc.tax_group_id, sum(oi.line_total_iqd) as grp_subtotal
      from order_items oi
      join orders o           on o.id  = oi.order_id
      join menu_items mi      on mi.id = oi.menu_item_id
      join menu_categories mc on mc.id = mi.category_id
     where o.tab_id = p_tab_id and o.status <> 'voided' and not oi.voided
     group by mc.tax_group_id
  ),
  line_disc as (
    select mc.tax_group_id, sum(a.amount_iqd) as amt
      from tab_adjustments a
      join order_items oi     on oi.id = a.order_item_id and not oi.voided
      join orders o           on o.id  = oi.order_id
      join menu_items mi      on mi.id = oi.menu_item_id
      join menu_categories mc on mc.id = mi.category_id
     where a.tab_id = p_tab_id
       and a.kind in ('discount_percent','discount_amount')
       and o.tab_id = p_tab_id
       and o.status <> 'voided'
     group by mc.tax_group_id
  ),
  base as (
    select g.tax_group_id,
           greatest(g.grp_subtotal - coalesce(ld.amt, 0), 0) as after_line
      from grp g
      left join line_disc ld on ld.tax_group_id = g.tax_group_id
  ),
  alloc as (
    select b.tax_group_id,
           greatest(
             b.after_line
               - round((v_tab_alloc::numeric * b.after_line)
                       / nullif(sum(b.after_line) over (), 0)),
             0) as taxable
      from base b
  )
  select coalesce(sum(
           case when coalesce((select vs.tax_inclusive from venue_settings vs
                                 where vs.venue_id = (select t.venue_id from tabs t where t.id = p_tab_id)), false)
                then round((a.taxable::numeric * tg.rate_bp) / (10000.0 + tg.rate_bp))
                else round((a.taxable::numeric * tg.rate_bp) / 10000.0)
           end), 0)::bigint
    into v_tax
    from alloc a
    join tax_groups tg on tg.id = a.tax_group_id
   where tg.is_active;

  select vs.tax_inclusive into v_inclusive from venue_settings vs
   where vs.venue_id = (select t.venue_id from tabs t where t.id = p_tab_id);

  subtotal_iqd := v_subtotal;
  discount_iqd := v_discount;
  tax_iqd      := v_tax;
  court_iqd    := v_court;
  total_iqd    := greatest(
    v_subtotal - v_discount
      + case when coalesce(v_inclusive, false) then 0 else v_tax end,
    0) + v_court + v_lesson + v_tour;   -- 0281: the lesson line; M7: the tournament line
  lesson_iqd   := v_lesson;
  return next;
end $compute_tab_totals_0299$;

revoke all on function app.compute_tab_totals(uuid) from public, anon, authenticated;
grant execute on function app.compute_tab_totals(uuid) to service_role;

comment on function app.compute_tab_totals(uuid) is
  '0053, 0106, 0211, 0262: a tab''s subtotal, discount, tax, court line and total. The court line is what the booking still owes (court_fee_remaining, this tab excluded), capped by tabs.court_cap_iqd when set (R2: a seat settle''s tab, or a normal bill closed by match_link_payment). Court time is outside subtotal_iqd (so percentage discounts apply to goods only) and outside the tax base (tax is per item group, L454-455). 0281 (CM-1): a sixth column, lesson_iqd: on a kind lesson tab, what its enrolment still owes (lesson_fee_remaining, this tab left out), outside subtotal_iqd and the tax base like the court line, and in total_iqd; 0 on every other tab. Tournaments (M7, S1): on a kind tournament tab, what its entry still owes (tournament_fee_remaining, this tab left out) is added to total_iqd only, untaxed and undiscounted; no seventh column.';

-- cafe_settled_tabs: re-issued from 20261001000281_lesson_money.sql:1042 with
-- one predicate widened: a tournament tab is entry money, never café money.
-- Without it a settled tournament tab would count its whole total as
-- cafe_gross_iqd in every report and panel (S6).
create or replace function app.cafe_settled_tabs(
  p_ts_from timestamptz default null,
  p_ts_to   timestamptz default null
) returns table (
  tab_id          uuid,
  settled_at      timestamptz,
  reservation_id  uuid,
  subtotal_iqd    bigint,
  discount_iqd    bigint,
  tax_iqd         bigint,
  court_iqd       bigint,
  total_iqd       bigint,
  goods_iqd       bigint,
  cafe_gross_iqd  bigint,
  refunds_iqd     bigint,
  cafe_net_iqd    bigint
) language sql stable security definer set search_path = public as $cafe_settled_tabs_0299$
  select t.id,
         t.settled_at,
         t.reservation_id,
         coalesce(t.subtotal_iqd, 0)::bigint,
         coalesce(t.discount_iqd, 0)::bigint,
         coalesce(t.tax_iqd, 0)::bigint,
         coalesce(t.court_iqd, 0)::bigint,
         coalesce(t.total_iqd, 0)::bigint,
         (coalesce(t.subtotal_iqd, 0) - coalesce(t.discount_iqd, 0))::bigint             as goods_iqd,
         (coalesce(t.total_iqd, 0) - coalesce(t.court_iqd, 0))::bigint                   as cafe_gross_iqd,
         coalesce(r.refunds_iqd, 0)::bigint                                              as refunds_iqd,
         (coalesce(t.total_iqd, 0) - coalesce(t.court_iqd, 0) - coalesce(r.refunds_iqd, 0))::bigint as cafe_net_iqd
    from tabs t
    left join lateral (
      select sum(rf.amount_iqd) as refunds_iqd
        from refunds rf
        join payments p on p.id = rf.payment_id
       where p.venue_id = any((select app.report_venues())::uuid[]) and rf.venue_id = any((select app.report_venues())::uuid[]) and p.tab_id = t.id
    ) r on true
   where t.venue_id = any((select app.report_venues())::uuid[]) and t.status = 'settled'
     and t.kind not in ('lesson', 'tournament')   -- 0281 (CM-1), M7 (S6): lesson and entry money are never café money
     and t.merged_into_tab_id is null
     and t.settled_at is not null
     and (p_ts_from is null or t.settled_at >= p_ts_from)
     and (p_ts_to   is null or t.settled_at <  p_ts_to)
$cafe_settled_tabs_0299$;

comment on function app.cafe_settled_tabs(timestamptz, timestamptz) is
  '0095, 0219, 0281, M7. Internal (report scope): one row per settled, unmerged tab of the branches in scope settled in [p_ts_from, p_ts_to), with its stamped figures, goods_iqd (subtotal less discount), cafe_gross_iqd (total less the court line), the refunds on its payments and cafe_net_iqd. 0281 (CM-1): kind lesson tabs are left out (lesson money is reported on its own line, 0288). Tournaments (M7, S6): kind tournament tabs are left out too (entry money shows in cash, card and the day close only, until M7.1).';

-- ===========================================================================
-- 7. tournament_settle (§1.7): the lesson_settle twin (0281:1993)
-- ===========================================================================
-- One fresh kind 'tournament' tab at the entry's branch and open day, settled
-- in the same call for what the entry owes now. Cashier, court_desk, manager,
-- owner (capability takeTournamentPayment); not shop_staff (S4). Online only:
-- no queued mutation type. A tournament tab is never left open (S5): any
-- refusal after the insert rolls it back, and the entry FOR NO KEY UPDATE
-- serialises two settles (the second reads owed 0, nothing_owed).
-- Lock order: day_sessions (share) -> tournaments (share; N1: no fee taken on
-- a tournament being cancelled) -> the entry (no key update, so a match
-- insert's key share is never blocked) -> tabs -> payments (+ till_shifts
-- share, the stamp trigger).
create or replace function app.tournament_settle(
  p_entry_id          uuid,
  p_method            payment_method,
  p_expected_owed_iqd bigint,
  p_tendered_iqd      bigint,
  p_idempotency_key   text,
  p_device_id         text
) returns jsonb
language plpgsql security definer set search_path = public as $tournament_settle_0299$
declare
  v_e       tournament_entries%rowtype;
  v_t       tournaments%rowtype;
  v_venue   uuid;
  v_day     uuid;
  v_replay  jsonb;
  v_m       jsonb;
  v_owed    bigint;
  v_tab     tabs%rowtype;
  v_totals  record;
  v_settle  jsonb;
  v_payment uuid;
  v_result  jsonb;
begin
  if not app.is_staff('cashier', 'court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_entry_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_entry_id';
  end if;
  if p_method is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_method';
  end if;
  if p_expected_owed_iqd is null or p_expected_owed_iqd < 1 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_expected_owed_iqd';
  end if;
  if p_idempotency_key is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_idempotency_key';
  end if;

  select e.venue_id into v_venue from tournament_entries e where e.id = p_entry_id;
  if v_venue is null or not (v_venue = any ((select app.visible_venue_ids())::uuid[])) then
    raise exception 'TOURNAMENT_ENTRY_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_venue, 'cashier', 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  -- 0049: claim after the guards, before the day lock and any write.
  v_replay := app.claim_replay(p_idempotency_key, 'tournament_settle');
  if v_replay is not null then
    return v_replay;
  end if;

  v_day := app.current_open_day_locked(v_venue);
  if v_day is null then
    raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
  end if;

  select t.* into v_t
    from tournaments t
   where t.id = (select e.tournament_id from tournament_entries e where e.id = p_entry_id)
     for share;
  select * into v_e from tournament_entries where id = p_entry_id for no key update;

  -- S14: the entry's own status first, then the tournament, then the money.
  if v_e.status <> 'registered' then
    raise exception 'TOURNAMENT_NOT_PAYABLE' using errcode = 'P0001', detail = v_e.status,
      hint = 'only a registered entry is paid at the desk';
  end if;
  if v_t.status = 'cancelled' then
    raise exception 'TOURNAMENT_NOT_PAYABLE' using errcode = 'P0001', detail = 'cancelled',
      hint = 'this tournament was cancelled';
  end if;
  v_m := app.tournament_entry_money(v_e.id);
  v_owed := coalesce((v_m->>'owed_iqd')::bigint, 0);
  if v_owed = 0 then
    raise exception 'TOURNAMENT_NOT_PAYABLE' using errcode = 'P0001', detail = 'nothing_owed',
      hint = 'this entry owes nothing';
  end if;
  if v_owed <> p_expected_owed_iqd then
    raise exception 'TOURNAMENT_OWED_CHANGED' using errcode = 'P0001',
      detail = format('expected %s, now %s', p_expected_owed_iqd, v_owed),
      hint = 'what this entry owes changed since it was shown; read it again';
  end if;

  -- The tab: the entry's branch and open day, a fixed label (no guest name on
  -- a till row), no table, booking or court cap (tabs_tournament_shape).
  insert into tabs (venue_id, day_session_id, tournament_entry_id, label, opened_by_staff_id, device_id, kind)
  values (v_venue, v_day, v_e.id, 'Tournament', auth.uid(), p_device_id, 'tournament')
  returning * into v_tab;

  -- S1: the tournament line is in total_iqd only (lesson_iqd stays 0).
  select * into v_totals from app.compute_tab_totals(v_tab.id);
  if v_totals.total_iqd is distinct from v_owed then
    raise exception 'TOURNAMENT_OWED_CHANGED' using errcode = 'P0001',
      detail = format('expected %s, now %s', v_owed, coalesce(v_totals.total_iqd, 0)),
      hint = 'what this entry owes changed since it was shown; read it again';
  end if;

  -- 0106's till path: TENDER_SHORT, TENDER_CARD, the till-shift stamp.
  v_settle := app.settle_tab(v_tab.id, p_method, p_tendered_iqd, v_owed, p_idempotency_key, p_device_id, v_owed);
  if coalesce((v_settle->>'duplicate')::boolean, false) or v_settle->>'status' is distinct from 'settled' then
    -- The key already names another payment: never take this entry's money on it.
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
      hint = 'that key belongs to another payment';
  end if;
  v_payment := (v_settle->>'payment_id')::uuid;

  v_result := jsonb_build_object(
    'duplicate',  false,
    'payment_id', v_payment,
    'tab_id',     v_tab.id,
    'entry_id',   v_e.id,
    'amount_iqd', v_owed,
    'change_iqd', (v_settle->>'change_iqd')::bigint,
    'method',     p_method,
    'owed_iqd',   0,
    'status',     'settled');
  perform app.write_audit('tournament.settle', 'tournament_entries', v_e.id::text, null,
                          jsonb_build_object('entry_id', v_e.id, 'tournament_id', v_t.id,
                                             'payment_id', v_payment, 'tab_id', v_tab.id,
                                             'amount_iqd', v_owed, 'method', p_method),
                          null, null, p_device_id);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $tournament_settle_0299$;

comment on function app.tournament_settle(uuid, payment_method, bigint, bigint, text, text) is
  'Tournaments (M7, build contracts §1.7, S1, S4, S5, S14). Desk payment of an entry fee: cashier, court_desk, manager, owner at the entry''s branch (not shop_staff), online only. Inserts one kind tournament tab (label Tournament, the branch''s open day) and settles it in the same call for what the entry owes now (tournament_entry_money owed_iqd, the compute_tab_totals tournament line). Refusals in order: FORBIDDEN; INVALID_ARGUMENT (detail p_entry_id, p_method, p_expected_owed_iqd >= 1, p_idempotency_key required); TOURNAMENT_ENTRY_NOT_FOUND (unknown or outside the visible branches); VENUE_MISMATCH; a replay returns the stored result (duplicate true), IDEMPOTENCY_CONFLICT; NO_OPEN_DAY; TOURNAMENT_NOT_PAYABLE (detail waitlisted, withdrawn, no_show, cancelled, nothing_owed, in that order); TOURNAMENT_OWED_CHANGED (detail expected X, now Y); settle_tab''s TENDER_SHORT, TENDER_CARD. Audit tournament.settle. Returns {duplicate, payment_id, tab_id, entry_id, amount_iqd, change_iqd, method, owed_iqd, status}. Refunds go through app.refund (no due cap, S7).';

revoke all on function app.tournament_settle(uuid, payment_method, bigint, bigint, text, text) from public, anon;
grant execute on function app.tournament_settle(uuid, payment_method, bigint, bigint, text, text) to authenticated;
