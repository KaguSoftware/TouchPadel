set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0258 match_tables — open matches, lanes DB and Money in one file
-- (docs/design/open-matches/db.md §4.4, money.md §4; build contracts §1.1,
-- §1.2, §1.8, §1.12 R7, R15, R23, R29, R34). Never split: the deposit hooks
-- are scoped to purpose 'deposit' here, before any ticket row can exist (0259
-- is the first writer of one).
--
-- DB:
--   1. matches            (branch)  one waits-for-four match on a free slot
--   2. match_requests     (branch)  approve-mode asks to join
--   3. match_seats        (branch)  the four seats; the ticket FK comes after 4
--   4. match_tickets      (chain)   the reusable open-match tickets (DB owns the
--                                   DDL; only Money inserts rows and writes
--                                   cashed_out)
--   5. match_ticket_events (chain, append-only) every ticket move
--   6. match_events       (branch, append-only) every match move
--   7. match_blocks       (chain)   a player hides another
--   8. match_reports      (branch)  a player reports another (kept 12 months)
--   9. match_exclusions   (branch)  removed from one match, cannot rejoin it
--  10. guards, append-only triggers, the seat sanitiser, grants, comments and
--      the assistant's readable columns
-- Money:
--  11. booking_payments: hold_id, reservation_id and venue_id nullable (R7),
--      ticket_count, booking_payments_anchor, _ticket_amount,
--      _reason_by_purpose, _one_active_ticket
--  12. payment_match_seats (branch, append-only)
--  13. tabs.court_cap_iqd (R2)
--  14. the nine 0242 hooks re-issued, scoped to purpose 'deposit', with the R15
--      hoist in deposit_settle_success and R23 in deposit_refund_manual
--
-- Every new table: RLS on, no policy, nothing granted to anon or authenticated;
-- every read and write goes through a definer body (0260 onward). The indexes
-- on the new tables (and one partial index on booking_payments, whose
-- predicate matches no row today) are plain CREATE INDEX: the waiver is in the
-- commit message (R34).

-- ===========================================================================
-- 1. matches (branch)
-- ===========================================================================
create table if not exists matches (
  id                  uuid primary key default gen_random_uuid(),
  venue_id            uuid not null references venues(id),
  status              text not null default 'filling',
  start_at            timestamptz not null,
  end_at              timestamptz not null,
  period              tstzrange generated always as (tstzrange(start_at, end_at, '[)')) stored,
  duration_min        int not null,
  visibility          text not null,
  join_policy         text not null,
  category            text not null,
  price_iqd           iqd not null,
  shares_iqd          bigint[] not null,
  rate_rule_id        uuid references rate_rules(id),
  price_court_id      uuid not null references courts(id),
  fill_deadline_at    timestamptz not null,
  share_token         text not null unique,
  organiser_id        uuid references profiles(id),
  organised_by        text not null,
  created_by_staff_id uuid references staff(id),
  reservation_id      uuid references reservations(id),
  sandbox             boolean not null default false,
  deadline_warned_at  timestamptz,
  ended_at            timestamptz,
  ended_reason        text,
  idempotency_key     text unique,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint matches_status check (status in
    ('filling', 'awaiting_court', 'booked', 'played', 'no_show', 'cancelled', 'bumped', 'expired')),
  constraint matches_enums check (visibility in ('public', 'link') and join_policy in ('open', 'approve')
    and category in ('open', 'women', 'men') and organised_by in ('guest', 'desk')),
  constraint matches_time check (duration_min between 30 and 480
    and end_at - start_at = duration_min * interval '1 minute'),
  constraint matches_shares check (cardinality(shares_iqd) = 4 and shares_iqd[4] >= 0
    and shares_iqd[1] >= shares_iqd[2] and shares_iqd[2] >= shares_iqd[3] and shares_iqd[3] >= shares_iqd[4]
    and shares_iqd[1] - shares_iqd[4] <= 1
    and shares_iqd[1] + shares_iqd[2] + shares_iqd[3] + shares_iqd[4] = price_iqd),
  constraint matches_token check (share_token ~ '^[A-Za-z0-9_-]{22}$'),
  constraint matches_idem check (idempotency_key is null or char_length(idempotency_key) between 1 and 200),
  constraint matches_deadline check (status <> 'filling' or fill_deadline_at < start_at),
  constraint matches_organiser_policy check (organiser_id is not null or join_policy = 'open'),
  constraint matches_organised_by check ((organised_by = 'desk') = (created_by_staff_id is not null)),
  constraint matches_reservation check (
    (status not in ('filling', 'awaiting_court') or reservation_id is null)
    and (status not in ('booked', 'played', 'no_show') or reservation_id is not null or sandbox)
    and (not sandbox or reservation_id is null)),
  constraint matches_ended check (
    (status in ('played', 'no_show', 'cancelled', 'bumped', 'expired')) = (ended_at is not null)
    and (status in ('no_show', 'cancelled', 'bumped', 'expired')) = (ended_reason is not null)
    and (status <> 'bumped'  or ended_reason in ('bumped', 'no_court'))
    and (status <> 'expired' or ended_reason in ('deadline', 'no_court'))
    and (status <> 'no_show' or ended_reason = 'all_no_show')
    and (status <> 'cancelled' or ended_reason in ('organiser_cancelled', 'staff_cancelled',
         'reservation_cancelled', 'called_off_short', 'empty', 'venue_closed')))
);

-- One match per booking; also the probe of the DF-16 wall (R20, 0262).
create unique index if not exists matches_reservation_key
  on matches (reservation_id) where reservation_id is not null;
create index if not exists matches_live
  on matches (venue_id, start_at) where status in ('filling', 'awaiting_court', 'booked');
create index if not exists matches_deadline_due
  on matches (fill_deadline_at) where status = 'filling';
create index if not exists matches_organiser
  on matches (organiser_id) where organiser_id is not null;

-- ===========================================================================
-- 2. match_requests (branch)
-- ===========================================================================
create table if not exists match_requests (
  id              uuid primary key default gen_random_uuid(),
  venue_id        uuid not null references venues(id),
  match_id        uuid not null references matches(id),
  guest_id        uuid not null references profiles(id),
  seats_requested smallint not null check (seats_requested between 1 and 3),
  friend_genders  text[],
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'declined', 'withdrawn', 'expired')),
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  -- NULL in an open match; one entry per friend in a women's or men's one.
  constraint match_requests_friend_genders check (friend_genders is null
    or (cardinality(friend_genders) = seats_requested - 1
        and friend_genders <@ array['female', 'male']::text[])),
  constraint match_requests_decided check ((status = 'pending') = (decided_at is null))
);

create unique index if not exists match_requests_one_pending
  on match_requests (match_id, guest_id) where status = 'pending';
create index if not exists match_requests_guest_pending
  on match_requests (guest_id) where status = 'pending';
create index if not exists match_requests_match
  on match_requests (match_id, status);

-- ===========================================================================
-- 3. match_seats (branch). ticket_id gets its FK after match_tickets (§4).
-- ===========================================================================
create table if not exists match_seats (
  id                      uuid primary key default gen_random_uuid(),
  venue_id                uuid not null references venues(id),
  match_id                uuid not null references matches(id),
  seat_no                 smallint not null check (seat_no between 1 and 4),
  kind                    text not null check (kind in ('account', 'friend', 'desk')),
  guest_id                uuid references profiles(id),
  guest_name              text check (guest_name is null or char_length(guest_name) between 1 and 80),
  guest_phone             text check (guest_phone is null
                            or coalesce(app.phone_digits(guest_phone), '') ~ '^[0-9]{7,15}$'),
  gender                  text check (gender is null or gender in ('female', 'male')),
  status                  text not null default 'in' check (status in
                            ('in', 'left', 'removed', 'cancelled', 'left_late', 'refilled', 'attended', 'no_show')),
  ticket_id               uuid,
  share_iqd               iqd not null,
  request_id              uuid references match_requests(id),
  replaces_seat_id        uuid references match_seats(id),
  created_by_staff_id     uuid references staff(id),
  vouched                 boolean generated always as (created_by_staff_id is not null) stored,
  joined_at               timestamptz not null default now(),
  ended_at                timestamptz,
  end_reason              text check (end_reason is null or end_reason in
                            ('left', 'removed_by_organiser', 'removed_by_staff', 'match_ended', 'refilled',
                             'banned', 'account_deleted')),
  marked_by_staff_id      uuid references staff(id),
  marked_at               timestamptz,
  written_off_by_staff_id uuid references staff(id),
  written_off_at          timestamptz,
  write_off_reason        text check (write_off_reason is null
                            or write_off_reason in ('walked_out', 'staff_error', 'other')),
  constraint match_seats_kind check (
    (kind in ('account', 'friend') and guest_id is not null and ticket_id is not null
       and guest_name is null and guest_phone is null and created_by_staff_id is null)
    or (kind = 'desk' and created_by_staff_id is not null and ticket_id is null
       and (guest_id is null or (guest_name is null and guest_phone is null)))),
  constraint match_seats_ended check ((status in ('left', 'removed', 'cancelled', 'left_late', 'refilled'))
    = (ended_at is not null and end_reason is not null)),
  constraint match_seats_marked check ((status not in ('attended', 'no_show') or marked_at is not null)
    and (status <> 'in' or marked_at is null)),
  constraint match_seats_write_off check ((written_off_at is null) = (written_off_by_staff_id is null)
    and (written_off_at is null) = (write_off_reason is null))
);

-- R4: one occupying seat per number (a walk-in may take a no-show's number
-- after the start), one live account seat per player, one live seat per ticket.
create unique index if not exists match_seats_occupying_no
  on match_seats (match_id, seat_no) where status in ('in', 'attended');
create unique index if not exists match_seats_occupying_account
  on match_seats (match_id, guest_id) where kind = 'account' and status in ('in', 'attended', 'no_show');
create unique index if not exists match_seats_ticket_live
  on match_seats (ticket_id) where status in ('in', 'left_late');
create index if not exists match_seats_match
  on match_seats (match_id);
create index if not exists match_seats_guest
  on match_seats (guest_id, status) where guest_id is not null;
create index if not exists match_seats_request
  on match_seats (request_id) where request_id is not null;

-- ===========================================================================
-- 4. match_tickets (chain-wide: no venue_id, no guard, like customer_flags)
-- ===========================================================================
create table if not exists match_tickets (
  id                  uuid primary key default gen_random_uuid(),
  guest_id            uuid not null references profiles(id),
  status              text not null default 'available'
                        check (status in ('available', 'reserved', 'in_use', 'forfeited', 'cashed_out')),
  price_iqd           iqd not null check (price_iqd > 0),
  purchase_payment_id uuid not null references booking_payments(id),
  sandbox             boolean not null,          -- no default: always the purchase row's flag
  request_id          uuid references match_requests(id),
  seat_id             uuid references match_seats(id),
  forfeited_venue_id  uuid references venues(id),
  forfeited_seat_id   uuid references match_seats(id),
  forfeited_at        timestamptz,
  cashed_out_at       timestamptz,
  cashout_payment_id  uuid references booking_payments(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint match_tickets_reserved   check ((status = 'reserved') = (request_id is not null)),
  constraint match_tickets_in_use     check ((status = 'in_use') = (seat_id is not null)),
  constraint match_tickets_forfeited  check ((status = 'forfeited') = (forfeited_at is not null)
    and (forfeited_at is null) = (forfeited_venue_id is null)
    and (forfeited_at is null) = (forfeited_seat_id is null)),
  constraint match_tickets_cashed_out check ((status = 'cashed_out')
    = (cashed_out_at is not null and cashout_payment_id is not null)),
  -- R8: the cash-out is the purchase's own single refund; nobody reads it as
  -- another payment.
  constraint match_tickets_cashout_same check (cashout_payment_id is null
    or cashout_payment_id = purchase_payment_id)
);

create index if not exists match_tickets_guest
  on match_tickets (guest_id, status);
create index if not exists match_tickets_purchase
  on match_tickets (purchase_payment_id);
create unique index if not exists match_tickets_seat
  on match_tickets (seat_id) where seat_id is not null;
create index if not exists match_tickets_request
  on match_tickets (request_id) where request_id is not null;
create index if not exists match_tickets_forfeited_at
  on match_tickets (forfeited_venue_id, forfeited_at) where status = 'forfeited';

-- The seat's ticket, now that the table exists: NOT VALID, then a VALIDATE
-- guarded on conname and conrelid (R34; the table is empty, so both are free).
do $match_seats_ticket_fk_0258$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'match_seats_ticket_fk'
                    and conrelid = 'public.match_seats'::regclass) then
    alter table match_seats add constraint match_seats_ticket_fk
      foreign key (ticket_id) references match_tickets(id) not valid;
  end if;
end $match_seats_ticket_fk_0258$;

do $match_seats_ticket_fk_validate_0258$
begin
  if exists (select 1 from pg_constraint
              where conname = 'match_seats_ticket_fk'
                and conrelid = 'public.match_seats'::regclass
                and not convalidated) then
    alter table match_seats validate constraint match_seats_ticket_fk;
  end if;
end $match_seats_ticket_fk_validate_0258$;

-- ===========================================================================
-- 5. match_ticket_events (chain-wide, append-only)
-- ===========================================================================
create table if not exists match_ticket_events (
  id             bigint generated always as identity primary key,
  ticket_id      uuid not null references match_tickets(id),
  guest_id       uuid not null references profiles(id),
  type           text not null check (type in
                   ('bought', 'reserved', 'locked', 'released', 'forfeited', 'restored', 'cashed_out')),
  venue_id       uuid references venues(id),
  match_id       uuid references matches(id),
  seat_id        uuid references match_seats(id),
  request_id     uuid references match_requests(id),
  payment_id     uuid references booking_payments(id),
  actor_staff_id uuid references staff(id),
  code           text check (code is null or char_length(code) <= 40),
  at             timestamptz not null default now()
);

create index if not exists match_ticket_events_ticket
  on match_ticket_events (ticket_id, at);
create index if not exists match_ticket_events_guest
  on match_ticket_events (guest_id, at);
create index if not exists match_ticket_events_type
  on match_ticket_events (type, at);

-- ===========================================================================
-- 6. match_events (branch, append-only)
-- ===========================================================================
create table if not exists match_events (
  id             bigint generated always as identity primary key,
  venue_id       uuid not null references venues(id),
  match_id       uuid not null references matches(id),
  type           text not null,
  actor          text not null check (actor in ('guest', 'staff', 'system')),
  actor_guest_id uuid references profiles(id),
  actor_staff_id uuid references staff(id),
  seat_id        uuid references match_seats(id),
  request_id     uuid references match_requests(id),
  code           text check (code is null or char_length(code) <= 40),
  data           jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  at             timestamptz not null default now(),
  -- The §1.3 vocabulary; 'no_show' is the match reaching no_show.
  constraint match_events_type check (type in
    ('started', 'requested', 'approved', 'declined', 'withdrawn', 'request_expired', 'joined', 'left',
     'left_late', 'refilled', 'removed', 'organiser_changed', 'awaiting_court', 'booked', 'bumped',
     'expired', 'cancelled', 'moved', 'deadline_warning', 'message', 'seat_attended', 'seat_no_show',
     'seat_unmarked', 'called_off_short', 'played', 'no_show')),
  constraint match_events_actor check (
    (actor = 'guest'  and actor_guest_id is not null and actor_staff_id is null) or
    (actor = 'staff'  and actor_staff_id is not null) or
    (actor = 'system' and actor_guest_id is null and actor_staff_id is null))
);

create index if not exists match_events_match
  on match_events (match_id, at);
create index if not exists match_events_venue
  on match_events (venue_id, at);

-- ===========================================================================
-- 7. match_blocks (chain-wide)
-- ===========================================================================
create table if not exists match_blocks (
  id         uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references profiles(id),
  blocked_id uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  constraint match_blocks_pair unique (blocker_id, blocked_id),
  constraint match_blocks_not_self check (blocker_id <> blocked_id)
);

create index if not exists match_blocks_blocked
  on match_blocks (blocked_id);

-- ===========================================================================
-- 8. match_reports (branch)
-- ===========================================================================
create table if not exists match_reports (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references venues(id),
  match_id    uuid not null references matches(id),
  reporter_id uuid not null references profiles(id),
  reported_id uuid not null references profiles(id),
  seat_id     uuid references match_seats(id),
  request_id  uuid references match_requests(id),
  reason      text not null check (reason in
                ('offensive_name', 'abusive_behaviour', 'harassment', 'unsafe_play', 'no_show', 'other')),
  status      text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  reviewed_by uuid references staff(id),
  reviewed_at timestamptz,
  created_at  timestamptz not null default now(),
  constraint match_reports_not_self check (reporter_id <> reported_id),
  constraint match_reports_target check (num_nonnulls(seat_id, request_id) = 1),
  constraint match_reports_reviewed check ((status = 'open') = (reviewed_at is null)
    and (reviewed_at is null) = (reviewed_by is null)),
  constraint match_reports_once unique (reporter_id, reported_id, match_id)
);

create index if not exists match_reports_queue
  on match_reports (venue_id, status, created_at);
create index if not exists match_reports_reported
  on match_reports (reported_id);
-- The 12-month purge (R36).
create index if not exists match_reports_created
  on match_reports (created_at);

-- ===========================================================================
-- 9. match_exclusions (branch)
-- ===========================================================================
create table if not exists match_exclusions (
  match_id   uuid not null references matches(id),
  guest_id   uuid not null references profiles(id),
  venue_id   uuid not null references venues(id),
  reason     text not null check (reason in ('removed_by_organiser', 'removed_by_staff')),
  created_at timestamptz not null default now(),
  primary key (match_id, guest_id)
);

-- ===========================================================================
-- 10. Guards, append-only triggers, the seat sanitiser, grants, comments
-- ===========================================================================

-- Links name rows of the same branch; staff write only where a definer body
-- asserted app.venue_id (0230). The chain-wide tables carry none.
drop trigger if exists zz_branch_guard on public.matches;
create trigger zz_branch_guard before insert or update or delete on public.matches
  for each row execute function app.trg_branch_guard('scoped', 'reservations', 'reservation_id', 'rate_rules', 'rate_rule_id', 'courts', 'price_court_id');
drop trigger if exists zz_branch_guard on public.match_requests;
create trigger zz_branch_guard before insert or update or delete on public.match_requests
  for each row execute function app.trg_branch_guard('scoped', 'matches', 'match_id');
drop trigger if exists zz_branch_guard on public.match_seats;
create trigger zz_branch_guard before insert or update or delete on public.match_seats
  for each row execute function app.trg_branch_guard('scoped', 'matches', 'match_id', 'match_requests', 'request_id', 'match_seats', 'replaces_seat_id');
drop trigger if exists zz_branch_guard on public.match_events;
create trigger zz_branch_guard before insert or update or delete on public.match_events
  for each row execute function app.trg_branch_guard('scoped', 'matches', 'match_id', 'match_seats', 'seat_id', 'match_requests', 'request_id');
drop trigger if exists zz_branch_guard on public.match_reports;
create trigger zz_branch_guard before insert or update or delete on public.match_reports
  for each row execute function app.trg_branch_guard('scoped', 'matches', 'match_id', 'match_seats', 'seat_id', 'match_requests', 'request_id');
drop trigger if exists zz_branch_guard on public.match_exclusions;
create trigger zz_branch_guard before insert or update or delete on public.match_exclusions
  for each row execute function app.trg_branch_guard('scoped', 'matches', 'match_id');

-- Append-only (0241:128-131).
drop trigger if exists match_ticket_events_append_only on match_ticket_events;
create trigger match_ticket_events_append_only
  before update or delete or truncate on match_ticket_events
  for each statement execute function app.forbid_mutation();
drop trigger if exists match_events_append_only on match_events;
create trigger match_events_append_only
  before update or delete or truncate on match_events
  for each statement execute function app.forbid_mutation();

-- A walk-in's name and phone, typed at the desk, are single-line fields (the
-- 0080 shape). A value made only of control characters becomes NULL.
create or replace function app.trg_sanitise_match_seat() returns trigger
language plpgsql security definer set search_path = public as $trg_sanitise_match_seat_0258$
begin
  new.guest_name  := nullif(app.safe_line(new.guest_name), '');
  new.guest_phone := nullif(app.safe_line(new.guest_phone), '');
  return new;
end $trg_sanitise_match_seat_0258$;

comment on function app.trg_sanitise_match_seat() is
  '0258. Trigger match_seats_sanitise: app.safe_line on a desk walk-in''s guest_name and guest_phone; empty after cleaning is NULL. Sorts before zz_branch_guard.';

revoke all on function app.trg_sanitise_match_seat() from public, anon, authenticated;

drop trigger if exists match_seats_sanitise on match_seats;
create trigger match_seats_sanitise
  before insert or update of guest_name, guest_phone on match_seats
  for each row execute function app.trg_sanitise_match_seat();

-- RLS on, no policy, no client grant (0241:93-97): every read and write goes
-- through a definer body. The service role bypasses RLS.
alter table matches enable row level security;
revoke all on matches from anon, authenticated;
grant all on matches to service_role;
alter table match_requests enable row level security;
revoke all on match_requests from anon, authenticated;
grant all on match_requests to service_role;
alter table match_seats enable row level security;
revoke all on match_seats from anon, authenticated;
grant all on match_seats to service_role;
alter table match_tickets enable row level security;
revoke all on match_tickets from anon, authenticated;
grant all on match_tickets to service_role;
alter table match_ticket_events enable row level security;
revoke all on match_ticket_events from anon, authenticated;
grant all on match_ticket_events to service_role;
alter table match_events enable row level security;
revoke all on match_events from anon, authenticated;
grant all on match_events to service_role;
alter table match_blocks enable row level security;
revoke all on match_blocks from anon, authenticated;
grant all on match_blocks to service_role;
alter table match_reports enable row level security;
revoke all on match_reports from anon, authenticated;
grant all on match_reports to service_role;
alter table match_exclusions enable row level security;
revoke all on match_exclusions from anon, authenticated;
grant all on match_exclusions to service_role;

comment on table matches is
  '0258. One open match: a waits-for-four game on a free slot at a branch. No court is held while it fills (filling); at the fourth seat it is booked as a normal reservation (guest_id NULL, guest_name ''Open match'') at price_iqd, split into shares_iqd (four shares, largest first, summing to the price). Ends played, no_show, cancelled, bumped (a normal booking took the last court) or expired. Written only by the app.match_* definer functions.';
comment on column matches.status is
  '0258. filling | awaiting_court (four players, the last free court is only held by someone else''s unpaid hold) | booked | played | no_show | cancelled | bumped | expired.';
comment on column matches.visibility is
  '0258. public (listed to every guest of the branch) or link (reached only through share_token).';
comment on column matches.join_policy is
  '0258. open (a player joins at once) or approve (the organiser approves each request).';
comment on column matches.category is
  '0258. open, women or men (players declare their gender once).';
comment on column matches.price_iqd is
  '0258. What the court costs for this match, quoted at start; the booking is created at this price.';
comment on column matches.shares_iqd is
  '0258. The price split in four (largest first, sum = price_iqd): what each seat owes at the desk.';
comment on column matches.fill_deadline_at is
  '0258. A filling match that has not reached four by this time expires (venue_settings.match_fill_deadline_minutes before start).';
comment on column matches.share_token is
  '0258. The secret in the invite link (22 URL-safe characters).';
comment on column matches.organiser_id is
  '0258. The guest who runs the match; NULL for a desk-run match with no account organiser.';
comment on column matches.organised_by is
  '0258. guest (started in the app) or desk (started by staff for a walk-in or a customer).';
comment on column matches.reservation_id is
  '0258. The court booking, once the match is booked; NULL while filling or waiting, and always for a sandbox match.';
comment on column matches.sandbox is
  '0258. A match of the store review account: never books a court, never counts as money.';
comment on column matches.ended_reason is
  '0258. Why it ended: organiser_cancelled, staff_cancelled, reservation_cancelled, called_off_short, bumped, deadline, empty, venue_closed, no_court, all_no_show.';

comment on table match_requests is
  '0258. A guest''s ask to join an approve-mode match, for themselves and up to two friends; their tickets are reserved while it is pending.';
comment on column match_requests.friend_genders is
  '0258. In a women''s or men''s match, the gender the requester declared for each friend; NULL in an open match. Scrubbed on account deletion.';

comment on table match_seats is
  '0258. The seats of an open match (seat_no 1..4). kind account (the player), friend (brought by guest_id) or desk (seated by staff: a walk-in named in guest_name/guest_phone, or a linked customer in guest_id). Each account or friend seat is backed by a ticket; a desk seat is vouched for by staff. Written only by the app.match_* definer functions.';
comment on column match_seats.status is
  '0258. in | left | removed | cancelled | left_late (left after booking, before start: its share stays open until refilled) | refilled | attended | no_show.';
comment on column match_seats.share_iqd is
  '0258. What this seat owes the court at the desk (its share of matches.price_iqd).';
comment on column match_seats.vouched is
  '0258. True when staff seated this player (created_by_staff_id is set).';
comment on column match_seats.guest_name is
  '0258. A desk walk-in''s name, typed by staff; NULL on every other seat.';
comment on column match_seats.guest_phone is
  '0258. A desk walk-in''s phone, typed by staff; NULL on every other seat.';
comment on column match_seats.gender is
  '0258. The seat''s gender in a women''s or men''s match. Scrubbed on account deletion.';
comment on column match_seats.write_off_reason is
  '0258. Why a manager forgave this seat''s share: walked_out, staff_error, other.';

comment on table match_tickets is
  '0258. Open-match tickets, chain-wide: bought once online (booking_payments purpose ticket), reusable, lost only on a no-show. available | reserved (held by a pending request) | in_use (backs a seat) | forfeited (a no-show: revenue of forfeited_venue_id) | cashed_out (refunded to the card). Only Money inserts rows and writes cashed_out; every other move goes through the app.ticket_* helpers.';
comment on column match_tickets.sandbox is
  '0258. Copied from the purchase row: a sandbox ticket is never money and only seats a sandbox match.';

comment on table match_ticket_events is
  '0258. Append-only: every ticket move (bought, reserved, locked, released, forfeited, restored, cashed_out), with the branch, match, seat, request or payment it moved for and a short code saying why.';

comment on table match_events is
  '0258. Append-only: every move of an open match, who made it (guest, staff or system) and a short code. data carries ids and counts only.';

comment on table match_blocks is
  '0258. Chain-wide: blocker_id no longer sees or plays with blocked_id in open matches. Deleted with either account.';

comment on table match_reports is
  '0258. A player''s report about another player of an open match (reason from a fixed list), reviewed by a manager or owner. Deleted after 12 months (R36).';

comment on table match_exclusions is
  '0258. A player removed from one match by the organiser or the desk; they cannot rejoin that match.';

-- The owner's assistant may read the two tables by table_read (0109), without
-- any identity column: names and genders reach the owner through
-- customer_record, never through table_read. The 0207 statement, limited to
-- these columns (ON CONFLICT DO NOTHING adds only what is new).
insert into app.assistant_readable_columns (table_name, column_name, kind, is_default, data_type, ordinal, note)
select c.table_name,
       c.column_name,
       'table',
       c.data_type <> 'jsonb',
       c.data_type,
       c.ordinal_position,
       col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position)
  from information_schema.columns c
 where c.table_schema = 'public'
   and ((c.table_name = 'matches'
         and c.column_name in ('id', 'venue_id', 'status', 'start_at', 'end_at', 'duration_min', 'visibility',
                               'join_policy', 'category', 'price_iqd', 'fill_deadline_at', 'organised_by',
                               'sandbox', 'ended_at', 'ended_reason', 'created_at'))
     or (c.table_name = 'match_seats'
         and c.column_name in ('id', 'venue_id', 'match_id', 'seat_no', 'kind', 'status', 'share_iqd',
                               'vouched', 'joined_at', 'ended_at', 'end_reason', 'marked_at',
                               'written_off_at', 'write_off_reason')))
on conflict (table_name, column_name) do nothing;

-- ===========================================================================
-- 11. booking_payments: a ticket purchase is a chain row (Money, R7)
-- ===========================================================================
-- A ticket purchase has no hold, no booking and no branch. The venue_id
-- default (app.current_venue()) stays for deposits: a ticket insert names
-- venue_id NULL. zz_branch_guard needs no change: its link loop skips a NULL
-- id and its staff check skips a NULL venue (0230).
alter table booking_payments alter column hold_id drop not null;
alter table booking_payments alter column reservation_id drop not null;
alter table booking_payments alter column venue_id drop not null;
alter table booking_payments add column if not exists ticket_count smallint;

do $booking_payments_ticket_checks_0258$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'booking_payments_anchor'
                    and conrelid = 'public.booking_payments'::regclass) then
    alter table booking_payments add constraint booking_payments_anchor check (
      (purpose = 'deposit' and venue_id is not null and hold_id is not null
                           and reservation_id is not null and ticket_count is null)
      or (purpose = 'ticket' and venue_id is null and hold_id is null
                             and reservation_id is null and ticket_count between 1 and 3)) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'booking_payments_ticket_amount'
                    and conrelid = 'public.booking_payments'::regclass) then
    -- For a ticket purchase quoted_price_iqd is the unit price stamped at
    -- prepare (DF-21).
    alter table booking_payments add constraint booking_payments_ticket_amount check (
      purpose <> 'ticket' or amount_iqd = ticket_count * quoted_price_iqd) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'booking_payments_reason_by_purpose'
                    and conrelid = 'public.booking_payments'::regclass) then
    alter table booking_payments add constraint booking_payments_reason_by_purpose check (
      refund_reason is null
      or (purpose = 'ticket'  and refund_reason in ('ticket_cashout', 'account_deleted', 'amount_mismatch'))
      or (purpose = 'deposit' and refund_reason not in ('ticket_cashout', 'account_deleted'))) not valid;
  end if;
end $booking_payments_ticket_checks_0258$;

do $booking_payments_ticket_checks_validate_0258$
declare
  v_name text;
begin
  foreach v_name in array array['booking_payments_anchor', 'booking_payments_ticket_amount',
                                'booking_payments_reason_by_purpose'] loop
    if exists (select 1 from pg_constraint
                where conname = v_name
                  and conrelid = 'public.booking_payments'::regclass
                  and not convalidated) then
      execute format('alter table booking_payments validate constraint %I', v_name);
    end if;
  end loop;
end $booking_payments_ticket_checks_validate_0258$;

-- One live ticket attempt per guest (MD-7). booking_payments_one_active
-- (0241, on hold_id) never matches a ticket row: its hold_id is NULL.
create unique index if not exists booking_payments_one_active_ticket
  on booking_payments (guest_id) where purpose = 'ticket' and status in ('created', 'pending');

comment on table booking_payments is
  '0241, tickets since 0258. One online payment attempt (Qi Card hosted page): a deposit on a court booking (purpose deposit: venue_id, hold_id and reservation_id set) or a purchase of open-match tickets (purpose ticket: a chain row, venue_id, hold_id and reservation_id NULL, ticket_count 1..3, amount = ticket_count x quoted_price_iqd). Written only by the app.deposit_* and app.ticket_* functions; request_id is what Qi gets, provider_payment_id what Qi answered. reservation_id is the booking a deposit is for (it moves when a swept hold is re-created as a booking); hold_id is where the attempt began and never changes. Not a till payment: no recorded_by, no day, not in the cash count.';
comment on column booking_payments.ticket_count is
  '0258. Open-match tickets bought by this payment (1..3); NULL for a deposit.';

-- ===========================================================================
-- 12. payment_match_seats (branch, append-only; Money)
-- ===========================================================================
create table if not exists payment_match_seats (
  payment_id    uuid not null references payments(id),
  match_seat_id uuid not null references match_seats(id),
  venue_id      uuid not null references venues(id),     -- no default: the writer names the match's branch
  amount_iqd    iqd  not null check (amount_iqd > 0),
  linked_by     uuid not null references staff(id),
  created_at    timestamptz not null default now(),
  primary key (payment_id, match_seat_id)
);

create index if not exists payment_match_seats_seat
  on payment_match_seats (match_seat_id);

drop trigger if exists zz_branch_guard on public.payment_match_seats;
create trigger zz_branch_guard before insert or update or delete on public.payment_match_seats
  for each row execute function app.trg_branch_guard('scoped', 'payments', 'payment_id', 'match_seats', 'match_seat_id');

drop trigger if exists payment_match_seats_append_only on payment_match_seats;
create trigger payment_match_seats_append_only
  before update or delete or truncate on payment_match_seats
  for each statement execute function app.forbid_mutation();

alter table payment_match_seats enable row level security;
revoke all on payment_match_seats from anon, authenticated;
grant all on payment_match_seats to service_role;

comment on table payment_match_seats is
  '0258. Which seats of an open match a desk payment paid, and how much of it. Written only by match_seat_settle and match_link_payment. Append-only: a wrong link is never edited.';

-- ===========================================================================
-- 13. tabs.court_cap_iqd (Money, R2)
-- ===========================================================================
-- bigint, not the iqd domain: adding a column of a domain with a CHECK
-- rewrites the whole table (checked on the local PostgreSQL 17), and tabs is
-- the till's table. The named CHECK below is stricter than iqd (> 0, not
-- >= 0); tabs.court_iqd (0053) was added the same way.
alter table tabs add column if not exists court_cap_iqd bigint;

do $tabs_court_cap_positive_0258$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'tabs_court_cap_positive'
                    and conrelid = 'public.tabs'::regclass) then
    alter table tabs add constraint tabs_court_cap_positive
      check (court_cap_iqd is null or court_cap_iqd > 0) not valid;
  end if;
end $tabs_court_cap_positive_0258$;

do $tabs_court_cap_positive_validate_0258$
begin
  if exists (select 1 from pg_constraint
              where conname = 'tabs_court_cap_positive'
                and conrelid = 'public.tabs'::regclass
                and not convalidated) then
    alter table tabs validate constraint tabs_court_cap_positive;
  end if;
end $tabs_court_cap_positive_validate_0258$;

comment on column tabs.court_cap_iqd is
  '0258. On a tab that settles open-match seat shares: the most court money this tab may carry (its court line is least(court_cap_iqd, court_fee_remaining)). Set only by match_seat_settle on the tab it settles and by match_link_payment when it closes a live court-only tab at what was paid (R2). NULL on every other tab.';

-- ===========================================================================
-- 14. The 0242 hooks, scoped to purpose 'deposit' (Money; money.md §4.5).
--     Each re-issued from 20260927000242_online_deposit_rpcs.sql, its latest
--     body. "Explicit" predicates are safe already (they key on
--     reservation_id or hold_id, NULL on a ticket row) and keep it so.
-- ===========================================================================

-- 14a. deposit_net_paid (0242:97): explicit.
create or replace function app.deposit_net_paid(p_reservation_id uuid)
returns bigint
language sql stable security definer set search_path = public as $deposit_net_paid_0258$
  select coalesce(sum(bp.amount_iqd - case when bp.status = 'succeeded' then 0
                                           else coalesce(bp.refund_amount_iqd, 0) end), 0)::bigint
    from booking_payments bp
   where bp.reservation_id = p_reservation_id
     and bp.purpose = 'deposit'
     and bp.status in ('succeeded', 'refund_pending', 'refund_failed', 'refunded')
     and not bp.sandbox
$deposit_net_paid_0258$;

revoke all on function app.deposit_net_paid(uuid) from public, anon, authenticated;

-- 14b. deposit_settle_success (0242:498): the duplicate_success subquery is
--      scoped to deposits (explicit), and the R15 hoist: the swept-hold
--      branch's hold expiry now comes before every reservations write in the
--      text, so the lock walker reads deposit_apply as court_advisory →
--      reservations → … once 0263 adds the match trigger under every
--      reservations write. Same condition as the old call, so nothing
--      changes at run time, except that a later slot_lost or venue_offline no
--      longer rolls the expiry back (it only expires holds that are already
--      stale, which any sweep would expire anyway).
create or replace function app.deposit_settle_success(p_payment_id uuid)
returns text
language plpgsql security definer set search_path = public as $deposit_settle_success_0258$
declare
  v        booking_payments%rowtype;
  r        reservations%rowtype;
  v_new    reservations%rowtype;
  v_before jsonb;
  v_reason text := null;
begin
  select * into v from booking_payments where id = p_payment_id;
  select * into r from reservations where id = v.reservation_id;

  -- 0258 (R15): the swept-hold branch's expiry, hoisted above every
  -- reservations write.
  if r.kind = 'hold' and r.status = 'expired' and r.end_at > now() then
    perform app.expire_stale_holds(r.court_id, tstzrange(r.start_at, r.end_at, '[)'));
  end if;

  -- Another payment already paid for this booking (plan §10 row 30). A
  -- deposit a manager partly refunded still paid for it.
  if exists (select 1 from booking_payments o
              where o.reservation_id = r.id and o.id <> v.id
                and o.purpose = 'deposit'
                and (o.status = 'succeeded'
                     or (o.status in ('refund_pending', 'refund_failed', 'refunded')
                         and o.refund_reason = 'staff_refund'))) then
    v_reason := 'duplicate_success';
  elsif r.kind = 'booking' and r.status in ('confirmed', 'arrived', 'completed')
        and r.guest_id is not distinct from v.guest_id then
    -- Already booked (the guest chose "pay at the desk" while the bank was
    -- still thinking, or this is a replay): the deposit simply counts as paid.
    null;
  elsif r.kind = 'hold' and r.status = 'pending' then
    if r.end_at <= now() then
      v_reason := 'slot_lost';
    else
      begin
        perform app.assert_not_degraded_for(r.start_at, r.venue_id);
      exception when others then
        if sqlerrm = 'DEGRADED_LOCKOUT' then
          v_reason := 'venue_offline';
        else
          raise;
        end if;
      end;
      if v_reason is null then
        v_before := to_jsonb(r);
        -- Quote = charge (0117): the hold carries the price the guest paid a
        -- deposit against; a rate edited mid-payment does not change it.
        update reservations
           set kind            = 'booking',
               status          = 'confirmed',
               hold_expires_at = null
         where id = r.id
         returning * into r;
        perform app.write_audit('reservation.confirm', 'reservations', r.id::text,
                                v_before, to_jsonb(r) || jsonb_build_object('via', 'deposit', 'payment_id', v.id),
                                null, null, r.device_id);
      end if;
    end if;
  elsif r.status = 'expired' and r.kind = 'hold' then
    -- The hold was swept (should not happen: the sweep skips it). Book the
    -- same court and time for the same guest if it is still free. Its stale
    -- holds were expired above (R15).
    if r.end_at <= now() then
      v_reason := 'slot_lost';
    else
      begin
        perform app.assert_not_degraded_for(r.start_at, r.venue_id);
        insert into reservations
          (venue_id, court_id, kind, status, start_at, end_at, guest_id, source,
           rate_rule_id, price_iqd, device_id)
        values
          (r.venue_id, r.court_id, 'booking', 'confirmed', r.start_at, r.end_at, r.guest_id, r.source,
           r.rate_rule_id, r.price_iqd, r.device_id)
        returning * into v_new;
        update booking_payments set reservation_id = v_new.id, updated_at = now() where id = v.id;
        perform app.write_audit('reservation.confirm', 'reservations', v_new.id::text, null,
                                to_jsonb(v_new) || jsonb_build_object('via', 'deposit', 'payment_id', v.id,
                                                                      'recreated_from', r.id));
      exception
        when exclusion_violation then
          v_reason := 'slot_lost';
        when others then
          if sqlerrm = 'DEGRADED_LOCKOUT' then
            v_reason := 'venue_offline';
          else
            raise;
          end if;
      end;
    end if;
  else
    -- Cancelled, no-show, or anything else: the slot is not the guest's.
    v_reason := 'slot_lost';
  end if;

  update booking_payments
     set status       = 'succeeded',
         succeeded_at = coalesce(succeeded_at, now()),
         failure_code = null,
         updated_at   = now()
   where id = v.id;

  if v_reason is not null then
    perform app.deposit_begin_refund(v.id, v_reason);
    perform app.deposit_nudge();
    return 'refund_pending';
  end if;
  return 'succeeded';
end $deposit_settle_success_0258$;

revoke all on function app.deposit_settle_success(uuid) from public, anon, authenticated;

-- 14c. deposits_due_for_reconcile (0242:756): the first loop is scoped to
--      deposits (explicit: a ticket purchase has no booking to lose); every
--      output row carries purpose and ticket_count, which deposit-reconcile
--      needs once ticket rows exist (0259).
create or replace function app.deposits_due_for_reconcile(p_limit int default 50)
returns jsonb
language plpgsql security definer set search_path = public as $deposits_due_0258$
declare
  v_out jsonb;
  v_row record;
begin
  -- A succeeded deposit whose booking is gone and was not forfeited must not
  -- sit on the venue's account (I2). The reservations trigger catches the
  -- normal paths; this catches anything that slipped past it.
  for v_row in
    select bp.id
      from booking_payments bp
      join reservations r on r.id = bp.reservation_id
     where bp.status = 'succeeded'
       and bp.purpose = 'deposit'
       and bp.forfeited_at is null
       and not (r.kind = 'booking' and r.status in ('confirmed', 'arrived', 'completed', 'no_show'))
     order by bp.id
     limit 20
       for update of bp skip locked
  loop
    perform app.deposit_begin_refund(v_row.id, 'slot_lost', null, 'reconciler: booking not live');
  end loop;

  with due as (
    select bp.id,
           case when bp.status = 'refund_pending' then 'refund' else 'check' end as action
      from booking_payments bp
     where (bp.claimed_at is null or bp.claimed_at <= now() - interval '60 seconds')
       and (
         (bp.status in ('created', 'pending') and bp.deadline_at <= now())
         or (bp.status = 'pending' and bp.created_at <= now() - interval '2 minutes'
             and coalesce(bp.last_checked_at, bp.created_at) <= now() - interval '90 seconds')
         or bp.status = 'refund_pending')
     order by bp.deadline_at
     limit greatest(least(coalesce(p_limit, 50), 100), 1)
       for update of bp skip locked
  ), claimed as (
    update booking_payments bp
       set claimed_at = now()
      from due
     where bp.id = due.id
    returning bp.*, due.action
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                  c.id,
           'action',              c.action,
           'request_id',          c.request_id,
           'provider',            c.provider,
           'sandbox',             c.sandbox,
           'provider_payment_id', c.provider_payment_id,
           'status',              c.status,
           'amount_iqd',          c.amount_iqd,
           'deadline_at',         c.deadline_at,
           'cancel_attempts',     c.cancel_attempts,
           'refund_request_id',   c.refund_request_id,
           'refund_amount_iqd',   c.refund_amount_iqd,
           'refund_attempts',     c.refund_attempts,
           'refund_reason',       c.refund_reason,
           'purpose',             c.purpose,
           'ticket_count',        c.ticket_count)), '[]'::jsonb)
    into v_out
    from claimed c;

  return v_out;
end $deposits_due_0258$;

comment on function app.deposits_due_for_reconcile(int) is
  '0242, 0258. Service role (edge deposit-reconcile). Claims up to p_limit (max 100) payments for 60 s: action check (open past its deadline, or pending unheard for 90 s) or refund (refund_pending), deposits and ticket purchases alike; each row carries purpose and ticket_count. First turns any succeeded deposit (never a ticket purchase) whose booking is no longer live (and was not forfeited) into a refund.';

revoke all on function app.deposits_due_for_reconcile(int) from public, anon, authenticated;
grant execute on function app.deposits_due_for_reconcile(int) to service_role;

-- 14d. trg_reservation_deposit (0242:930): explicit.
create or replace function app.trg_reservation_deposit() returns trigger
language plpgsql security definer set search_path = public as $trg_reservation_deposit_0258$
declare
  v_pay    record;
  v_keep   boolean;
  v_reason text;
  v_any    boolean := false;
begin
  if new.status not in ('cancelled', 'no_show') or old.status is not distinct from new.status then
    return null;
  end if;

  for v_pay in
    select id from booking_payments
     where reservation_id = new.id and purpose = 'deposit'
       and status = 'succeeded' and forfeited_at is null
     order by id
     for update
  loop
    if new.status = 'no_show' then
      select deposit_forfeit_no_show into v_keep from venue_settings where venue_id = new.venue_id;
      if coalesce(v_keep, true) then
        update booking_payments set forfeited_at = now(), updated_at = now() where id = v_pay.id;
        perform app.deposit_event(v_pay.id, 'decision', null, null, 'forfeit: no_show', '{}'::jsonb);
        perform app.write_audit('deposit.forfeit', 'booking_payments', v_pay.id::text, null,
                                jsonb_build_object('reservation_id', new.id, 'reason', 'no_show'));
        continue;
      end if;
      v_reason := 'no_show';
    elsif new.cancelled_by::text = 'guest' then
      v_reason := 'guest_cancel';
    else
      v_reason := 'staff_cancel';
    end if;
    perform app.deposit_begin_refund(v_pay.id, v_reason);
    v_any := true;
  end loop;

  if v_any then
    perform app.deposit_nudge();
  end if;
  return null;
end $trg_reservation_deposit_0258$;

revoke all on function app.trg_reservation_deposit() from public, anon, authenticated;
-- Trigger binding reservations_deposit unchanged (0242:979): replace keeps it.

-- 14e. deposit_attention (0242:1116): a ticket purchase has no booking (LEFT
--      join) and no branch: its refund failures and slow refunds are listed
--      at every branch (chain money), except the review account's sandbox
--      rows. "Succeeded, booking not live" is a deposit-only case. Each item
--      gains purpose, ticket_count and customer_id (the payer); the name and
--      phone already fall back to the payer's profile.
create or replace function app.deposit_attention(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $deposit_attention_0258$
declare
  v_venue uuid;
  v_out   jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                  bp.id,
           'request_id',          bp.request_id,
           'reservation_id',      bp.reservation_id,
           'guest_name',          coalesce(r.guest_name, p.full_name),
           'guest_phone',         coalesce(r.guest_phone, p.phone),
           'amount_iqd',          bp.amount_iqd,
           'refund_amount_iqd',   bp.refund_amount_iqd,
           'status',              bp.status,
           'refund_reason',       bp.refund_reason,
           'refund_requested_at', bp.refund_requested_at,
           'refund_attempts',     bp.refund_attempts,
           'succeeded_at',        bp.succeeded_at,
           'sandbox',             bp.sandbox,
           'court_name_en',       c.name_en,
           'court_name_ar',       c.name_ar,
           'start_at',            r.start_at,
           'purpose',             bp.purpose,
           'ticket_count',        bp.ticket_count,
           'customer_id',         bp.guest_id) order by coalesce(bp.refund_requested_at, bp.succeeded_at)),
         '[]'::jsonb)
    into v_out
    from booking_payments bp
    left join reservations r on r.id = bp.reservation_id
    left join courts c on c.id = r.court_id
    left join profiles p on p.id = bp.guest_id
   where (bp.venue_id = v_venue or (bp.purpose = 'ticket' and not bp.sandbox))
     and (bp.status = 'refund_failed'
          or (bp.status = 'refund_pending' and bp.refund_requested_at <= now() - interval '24 hours')
          or (bp.purpose = 'deposit' and bp.status = 'succeeded' and bp.forfeited_at is null
              and not (r.kind = 'booking' and r.status in ('confirmed', 'arrived', 'completed', 'no_show'))));
  return v_out;
end $deposit_attention_0258$;

comment on function app.deposit_attention(uuid) is
  '0242, 0258. Manager, owner. Online payments a person must look at: refund_failed, refund_pending for more than 24 hours, and succeeded deposits whose booking is no longer live. Deposits of the branch, plus every branch''s view of the chain''s open-match ticket purchases (never the review account''s sandbox ones). Items carry purpose, ticket_count and customer_id.';

revoke all on function app.deposit_attention(uuid) from public, anon;
grant execute on function app.deposit_attention(uuid) to authenticated;

-- 14f. deposit_refund_retry (0242:1168): a ticket purchase is chain money with
--      no court or booking: any manager or owner retries it, and there is
--      nothing to lock but the row itself.
create or replace function app.deposit_refund_retry(p_payment_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $deposit_refund_retry_0258$
declare
  v       booking_payments%rowtype;
  v_chain boolean;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v from booking_payments where id = p_payment_id;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_chain := v.purpose = 'ticket';
  if not v_chain and not app.is_staff_at(v.venue_id, 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  if not v_chain then
    -- Lock order court → reservations → booking_payments, as deposit_apply.
    perform app.lock_court((select court_id from reservations where id = v.reservation_id));
    perform 1 from reservations where id = v.reservation_id for update;
  end if;
  select * into v from booking_payments where id = p_payment_id for update;
  if v.status <> 'refund_failed' then
    raise exception 'PAYMENT_STATE' using errcode = 'P0001', detail = v.status;
  end if;
  if not v_chain then
    perform set_config('app.venue_id', v.venue_id::text, true);
  end if;

  update booking_payments
     set status = 'refund_pending', refund_attempts = 0, claimed_at = null,
         refund_requested_at = now(), updated_at = now()
   where id = v.id
   returning * into v;
  perform app.deposit_event(v.id, 'manual', null, null, 'refund retry', '{}'::jsonb);
  perform app.write_audit('deposit.refund_retry', 'booking_payments', v.id::text, null,
                          jsonb_build_object('reservation_id', v.reservation_id, 'purpose', v.purpose));
  perform app.deposit_nudge();
  return jsonb_build_object('id', v.id, 'status', v.status);
end $deposit_refund_retry_0258$;

comment on function app.deposit_refund_retry(uuid) is
  '0242, 0258. Manager, owner. refund_failed → refund_pending: Qi is asked again. A deposit only by a manager of its branch; an open-match ticket purchase (chain money) by any manager or owner.';

revoke all on function app.deposit_refund_retry(uuid) from public, anon;
grant execute on function app.deposit_refund_retry(uuid) to authenticated;

-- 14g. deposit_refund_manual (0242:1208): R23. "Settled another way" only
--      from refund_failed, for deposits and ticket purchases alike: a
--      refund_pending refund may still be paid by Qi (the guest would be paid
--      twice), and a succeeded deposit is refunded with deposit_refund_request.
--      The refund reason is the one the refund started with. A ticket purchase
--      skips the branch check, the court and booking locks and app.venue_id:
--      its tickets are already cashed_out, nothing else moves.
create or replace function app.deposit_refund_manual(
  p_payment_id uuid,
  p_pin        text,
  p_note       text,
  p_device_id  text default null
) returns jsonb
language plpgsql security definer set search_path = public as $deposit_refund_manual_0258$
declare
  v       booking_payments%rowtype;
  v_auth  uuid;
  v_chain boolean;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001',
      hint = 'say how the guest got their money back';
  end if;
  select * into v from booking_payments where id = p_payment_id;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_chain := v.purpose = 'ticket';
  if not v_chain and not app.is_staff_at(v.venue_id, 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  -- 0115: the PIN was proved to app.verify_manager_pin a moment ago (its own
  -- transaction, so the attempt persists and the lockout counts). p_pin is
  -- never read here: no grant is PIN_GRANT_REQUIRED whatever it says.
  v_auth := app.consume_pin_grant(p_device_id);
  if not v_chain then
    -- Lock order court → reservations → booking_payments, as deposit_apply.
    perform app.lock_court((select court_id from reservations where id = v.reservation_id));
    perform 1 from reservations where id = v.reservation_id for update;
  end if;
  select * into v from booking_payments where id = p_payment_id for update;
  -- 0258 (R23): refund_failed only.
  if v.status <> 'refund_failed' then
    raise exception 'PAYMENT_STATE' using errcode = 'P0001', detail = v.status;
  end if;
  if not v_chain then
    perform set_config('app.venue_id', v.venue_id::text, true);
  end if;

  update booking_payments
     set status              = 'refunded',
         refund_amount_iqd   = coalesce(refund_amount_iqd, amount_iqd),
         refund_requested_at = coalesce(refund_requested_at, now()),
         refunded_at         = now(),
         refund_note         = left(btrim(p_note), 300),
         claimed_at          = null,
         updated_at          = now()
   where id = v.id
   returning * into v;
  perform app.deposit_event(v.id, 'manual', null, null, 'settled another way', '{}'::jsonb);
  perform app.write_audit('deposit.refund_manual', 'booking_payments', v.id::text, null,
                          jsonb_build_object('amount_iqd', v.refund_amount_iqd, 'note', v.refund_note,
                                             'reservation_id', v.reservation_id, 'purpose', v.purpose),
                          'manual', v_auth);
  return jsonb_build_object('id', v.id, 'status', v.status);
end $deposit_refund_manual_0258$;

comment on function app.deposit_refund_manual(uuid, text, text, text) is
  '0242, 0258. Manager, owner, with a manager PIN. Marks a refund_failed online payment refunded because the guest got the money back another way (cash at the desk, a bank transfer); the note says how. Nothing is sent to Qi. Only from refund_failed (R23): a refund still pending at Qi may yet be paid, and a succeeded deposit is refunded with deposit_refund_request. A deposit only by a manager of its branch; an open-match ticket purchase by any manager or owner.';

revoke all on function app.deposit_refund_manual(uuid, text, text, text) from public, anon;
grant execute on function app.deposit_refund_manual(uuid, text, text, text) to authenticated;

-- 14h. deposit_refund_request (0242:1271): a ticket purchase is refunded only
--      by a cash-out (0259), never here: PAYMENT_STATE detail ticket (it was
--      VENUE_MISMATCH by accident, its venue being NULL).
create or replace function app.deposit_refund_request(p_payment_id uuid, p_amount_iqd bigint default null)
returns jsonb
language plpgsql security definer set search_path = public as $deposit_refund_request_0258$
declare
  v booking_payments%rowtype;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v from booking_payments where id = p_payment_id;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v.purpose = 'ticket' then
    raise exception 'PAYMENT_STATE' using errcode = 'P0001', detail = 'ticket';
  end if;
  if not app.is_staff_at(v.venue_id, 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  -- Lock order court → reservations → booking_payments, as deposit_apply.
  perform app.lock_court((select court_id from reservations where id = v.reservation_id));
  perform 1 from reservations where id = v.reservation_id for update;
  perform 1 from booking_payments where id = p_payment_id for update;
  perform set_config('app.venue_id', v.venue_id::text, true);
  v := app.deposit_begin_refund(p_payment_id, 'staff_refund', p_amount_iqd);
  perform app.deposit_nudge();
  return jsonb_build_object('id', v.id, 'status', v.status, 'refund_amount_iqd', v.refund_amount_iqd);
end $deposit_refund_request_0258$;

comment on function app.deposit_refund_request(uuid, bigint) is
  '0242, 0258. Manager, owner of the deposit''s branch. succeeded → refund_pending with refund_reason staff_refund (partial when an amount is given). A ticket purchase is refused PAYMENT_STATE detail ticket: tickets go back only by a cash-out.';

revoke all on function app.deposit_refund_request(uuid, bigint) from public, anon;
grant execute on function app.deposit_refund_request(uuid, bigint) to authenticated;

-- 14i. my_reservations (0242:1702): the latest payment of a booking is a
--      deposit (explicit). Same result type, so create or replace.
create or replace function app.my_reservations(p_reservation_id uuid default null)
returns table(id uuid, court_id uuid, kind text, status text, start_at timestamptz, end_at timestamptz,
              price_iqd bigint, hold_expires_at timestamptz, cancelled_by text, cancelled_at timestamptz,
              court_paid_iqd bigint, court_remaining_iqd bigint, venue_id uuid,
              online_paid_iqd bigint, payment_status text, payment_ref uuid)
language sql stable security definer set search_path = public as $my_reservations_0258$
  select r.id,
         r.court_id,
         r.kind::text,
         r.status::text,
         r.start_at,
         r.end_at,
         r.price_iqd::bigint,
         r.hold_expires_at,
         r.cancelled_by::text,
         r.cancelled_at,
         app.court_fee_paid(r.id)      as court_paid_iqd,
         app.court_fee_remaining(r.id) as court_remaining_iqd,
         r.venue_id,
         app.deposit_net_paid(r.id)    as online_paid_iqd,
         lp.status                     as payment_status,
         lp.request_id                 as payment_ref
    from reservations r
    left join lateral (
      select bp.status, bp.request_id
        from booking_payments bp
       where (bp.reservation_id = r.id or bp.hold_id = r.id)
         and bp.purpose = 'deposit'
       order by bp.created_at desc
       limit 1
    ) lp on true
   where auth.uid() is not null
     and r.guest_id = auth.uid()
     and (p_reservation_id is null or r.id = p_reservation_id)
   order by r.start_at desc
   limit 100
$my_reservations_0258$;

revoke all on function app.my_reservations(uuid) from public, anon;
grant execute on function app.my_reservations(uuid) to authenticated;
