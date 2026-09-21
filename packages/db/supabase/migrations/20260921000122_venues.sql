-- ===========================================================================
-- 0122 — venues: the table the whole multi-venue axis hangs off (Phase 2,
-- milestone 1, slice 1; decisions Parsa 2026-09-21).
--
-- WHY. 121 migrations in, there is no venue anywhere. "The venue" is the
-- singleton venue_settings row, and every court, tab, payment and audit row
-- belongs to it by having nowhere else to belong. Every remaining Phase 2 item
-- — a second club, a per-venue till, per-venue analytics, the venue switcher —
-- needs a first-class venue id before it can be written, so slice 1 puts one
-- in and backfills it. This file is step one: the table, the one real row, the
-- read policy and app.default_venue().
--
-- THE DEFAULT ROW is a fixed uuid, c0000000-0000-4000-8000-000000000001, not a
-- generated one: the fixtures, the RLS matrix and the multi-venue test all name
-- venue A as a constant, and a uuid that differs per environment would make
-- every one of them read the database first to find out what it is testing.
-- Its NAME, TIMEZONE and PHONE are copied out of venue_settings rather than
-- hard-coded, and this file sorts after 0056 (the client's confirmed venue
-- configuration), so hosted gets Touch's real values and not the placeholder.
-- name_ar takes venue_name too — the venue has one name today, and slice 2 is
-- where a translated name would come from.
--
-- WHAT THIS FILE DOES NOT DO. venues.name/timezone/phone DUPLICATE the same
-- columns on venue_settings until slice 2 splits platform_settings out and
-- re-issues the 35 functions that read venue_settings unqualified. Until then
-- venue_settings stays the source of truth for those three values; nothing
-- reads them off venues yet.
--
-- SLICE 1 NEVER CREATES A SECOND ACTIVE VENUE ON HOSTED. app.current_venue()
-- (0125) resolves "the single active venue" as its last resort, so the moment a
-- second active venue exists, a guest insert with no station asserted raises
-- VENUE_REQUIRED instead of landing at venue A. The stations GUC that fixes
-- that is set by exactly one RPC in slice 1 (app.heartbeat, 0130); slice 3
-- threads it through the other 41. A second venue is a slice-3 operation.
--
-- Next in this slice: 0123 staff_venues + the staff trigger, 0124 stations,
-- 0125 the resolver, 0126-0129 the venue_id column, backfill, FKs and checks.
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The table. slug is the human handle used by fixtures and ops tooling;
--    the regex is the same shape as a DNS label so it can become a subdomain
--    or a URL segment later without a migration.
-- ---------------------------------------------------------------------------
create table if not exists venues (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name_en    text not null,
  name_ar    text not null,
  timezone   text not null default 'Asia/Baghdad',
  phone      text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  constraint venues_slug_chk    check (slug ~ '^[a-z0-9][a-z0-9-]{1,31}$'),
  constraint venues_name_en_len check (char_length(name_en) between 2 and 80),
  constraint venues_name_ar_len check (char_length(name_ar) between 2 and 80)
);

comment on table venues is
  '0122 (multi-venue slice 1): one row per club. The default venue is the fixed uuid '
  'c0000000-0000-4000-8000-000000000001, written by this migration from the venue_settings '
  'singleton. Rows are migration-written in slice 1 — there is no RPC that creates a venue, '
  'and a second ACTIVE venue on hosted before slice 3 makes guest inserts raise VENUE_REQUIRED '
  '(app.current_venue(), 0125). name/timezone/phone duplicate venue_settings until slice 2.';

-- ---------------------------------------------------------------------------
-- 2. The default venue. Idempotent: a re-run of this file, and a hosted apply
--    after a local one, both find the row and do nothing.
-- ---------------------------------------------------------------------------
insert into venues (id, slug, name_en, name_ar, timezone, phone, is_active)
select 'c0000000-0000-4000-8000-000000000001'::uuid,
       'touch-padel',
       vs.venue_name,
       vs.venue_name,
       vs.timezone,
       vs.phone,
       true
  from venue_settings vs
 where vs.id
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Reads. Guests need the active venue (the booking and menu surfaces read
--    it from slice 4 on); staff of any role see retired venues too, so an
--    owner can still open last year's club in a report.
-- ---------------------------------------------------------------------------
alter table venues enable row level security;

grant select on venues to anon, authenticated;

drop policy if exists venues_read on venues;
create policy venues_read on venues
  for select to anon, authenticated
  using (is_active or app.is_staff('cashier','prep','court_desk','manager','owner'));

-- ---------------------------------------------------------------------------
-- 4. app.default_venue() — the oldest ACTIVE venue.
--
--    This is the "where do rows go when nobody said" answer, and it is used in
--    exactly three places: the one-off backfills in this slice (0123, 0124,
--    0127), the venue_settings default (0126), and as the second half of
--    app.current_venue_or_default() (0125). It is deliberately NOT the default
--    of any business table — R1: a row is filed where the CALLER belongs or the
--    write is refused loudly, never guessed.
--
--    SERVICE ROLE ONLY. anon and authenticated must never be able to ask "which
--    venue would you guess for me"; the functions they may call are
--    current_venue / current_venue_or_default, which go through resolve_venue
--    first. Those are SECURITY DEFINER, so they reach this function as its
--    owner without any client grant.
-- ---------------------------------------------------------------------------
create or replace function app.default_venue() returns uuid
language sql stable security definer set search_path = public as $default_venue_0122$
  select v.id from venues v where v.is_active order by v.created_at, v.id limit 1
$default_venue_0122$;

comment on function app.default_venue() is
  '0122: the oldest active venue, or NULL when none exists. Migration backfills and the '
  'venue_settings default only. Never a business-table default (R1).';

revoke all on function app.default_venue() from public, anon, authenticated;
grant execute on function app.default_venue() to service_role;
