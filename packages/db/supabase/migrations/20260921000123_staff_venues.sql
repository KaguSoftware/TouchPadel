-- ===========================================================================
-- 0123 — staff_venues: which venues a staffer works at (multi-venue slice 1).
--
-- WHY. app.is_staff() answers "is this person a manager", globally. From slice
-- 1 on, every staff read policy also asks "at which venue" (0136 adds
-- "and venue_id = any(app.staff_venue_ids())" to ~25 policies), so there has to
-- be a membership table for that question to have an answer. Owners are
-- deliberately NOT members of anything: the owner is the platform, sees every
-- active venue, and holds zero rows here.
--
-- THE TRIGGER (decision R4). A migration-only backfill would be correct on
-- hosted and WRONG locally: `pnpm db:reset` runs every migration and THEN
-- seed.sql, so the seeded dev staffers are created after this file runs and
-- would each end up with zero memberships — which, once 0136 lands, means every
-- venue-scoped staff policy hides everything from every dev account. So
-- membership is maintained by an AFTER INSERT OR UPDATE OF role trigger on
-- staff, and the one-off backfill below exists only for hosted's rows, which
-- predate it. The trigger also covers app.register_staff (0051:251), so a new
-- hire made from the owner screen can read on their first login.
--
-- The trigger files a new staffer at app.default_venue(). That is the honest
-- answer while slice 1 forbids a second active venue; assigning a hire to a
-- chosen venue is a slice-4 screen. app.default_venue() returns NULL when no
-- venue exists — impossible after 0122, but the guard is there because a
-- trigger that raised on "insert into staff" would break auth signup.
--
-- app.staff_venue_ids() and app.is_staff_at() are read by RLS POLICIES, so they
-- are granted to anon as well as authenticated and service_role — the 0121
-- rule: a function reached from a policy, a CHECK or a column default runs as
-- the role doing the query, and a missing grant is a permission-denied on a
-- path nobody tested. 0116 granted app.phone_digits to the two client roles
-- only and every service-role UPDATE on profiles failed until 0121.
--
-- Next in this slice: 0124 stations, 0125 the resolver; 0136 puts
-- staff_venue_ids() into the policies.
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The table. `role` is denormalised from staff so a policy can ask for the
--    role AT a venue without a second join once per-venue roles land; today the
--    trigger keeps it equal to staff.role.
-- ---------------------------------------------------------------------------
create table if not exists staff_venues (
  staff_id   uuid not null references staff(id) on delete cascade,
  venue_id   uuid not null references venues(id),
  role       staff_role not null,
  created_by uuid references staff(id),
  created_at timestamptz not null default now(),
  primary key (staff_id, venue_id)
);

comment on table staff_venues is
  '0123 (multi-venue slice 1): staff membership of a venue. Owners hold NO rows and see every '
  'active venue through app.staff_venue_ids(). Maintained by the trigger staff_default_venue on '
  'staff (R4) — never written by hand outside a migration or a fixture.';

alter table staff_venues enable row level security;

grant select on staff_venues to authenticated;

drop policy if exists staff_venues_read_own on staff_venues;
create policy staff_venues_read_own on staff_venues
  for select to authenticated
  using (staff_id = auth.uid());

drop policy if exists staff_venues_read_mgmt on staff_venues;
create policy staff_venues_read_mgmt on staff_venues
  for select to authenticated
  using (app.is_staff('manager','owner'));

-- ---------------------------------------------------------------------------
-- 2. One-off backfill for rows that predate the trigger (hosted's staff).
--    Idempotent; a re-run only re-syncs the role.
-- ---------------------------------------------------------------------------
insert into staff_venues (staff_id, venue_id, role)
select s.id, app.default_venue(), s.role
  from staff s
 where s.role <> 'owner'
   and app.default_venue() is not null
on conflict (staff_id, venue_id) do update set role = excluded.role;

-- ---------------------------------------------------------------------------
-- 3. The trigger that keeps it true from here on.
-- ---------------------------------------------------------------------------
create or replace function app.trg_staff_default_venue() returns trigger
language plpgsql security definer set search_path = public as $trg_staff_default_venue_0123$
declare
  v_venue uuid;
begin
  v_venue := app.default_venue();
  -- No venue yet (only reachable on a database built before 0122): do nothing
  -- rather than refuse the staff write.
  if v_venue is null then
    return new;
  end if;

  if new.role = 'owner' then
    -- An owner is the platform, not a member. A promotion clears the rows the
    -- person held as a manager.
    delete from staff_venues where staff_id = new.id;
  else
    insert into staff_venues (staff_id, venue_id, role)
    values (new.id, v_venue, new.role)
    on conflict (staff_id, venue_id) do update set role = excluded.role;
  end if;

  return new;
end
$trg_staff_default_venue_0123$;

comment on function app.trg_staff_default_venue() is
  '0123: keeps staff_venues in step with staff.role (R4). Non-owner -> a membership at '
  'app.default_venue(); owner -> none. No client grant: a trigger function is never called '
  'directly.';

revoke all on function app.trg_staff_default_venue() from public, anon, authenticated;

drop trigger if exists staff_default_venue on staff;
create trigger staff_default_venue
  after insert or update of role on staff
  for each row execute function app.trg_staff_default_venue();

-- ---------------------------------------------------------------------------
-- 4. app.staff_venue_ids() — the array the venue-axis policies filter on.
--    Owner: every active venue. Everyone else: their active memberships.
--    A guest gets '{}', which makes "venue_id = any(...)" false, never NULL.
-- ---------------------------------------------------------------------------
create or replace function app.staff_venue_ids() returns uuid[]
language sql stable security definer set search_path = public as $staff_venue_ids_0123$
  select case
    when app.is_staff('owner') then
      coalesce((select array_agg(v.id order by v.created_at, v.id)
                  from venues v
                 where v.is_active), '{}'::uuid[])
    else
      coalesce((select array_agg(sv.venue_id order by sv.venue_id)
                  from staff_venues sv
                  join venues v on v.id = sv.venue_id and v.is_active
                 where sv.staff_id = auth.uid()), '{}'::uuid[])
  end
$staff_venue_ids_0123$;

comment on function app.staff_venue_ids() is
  '0123: the venues the caller may read. Owner -> every active venue; staff -> their active '
  'memberships; anyone else -> {}. Read from RLS policies (0136), hence the anon grant.';

-- The 0121 grant trap: this is evaluated INSIDE policies, as the QUERYING role.
-- anon reads guest-visible tables whose policies carry a staff disjunct, so anon
-- must hold EXECUTE or the policy errors instead of answering false.
revoke all on function app.staff_venue_ids() from public;
grant execute on function app.staff_venue_ids() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. app.is_staff_at(p_venue, variadic roles) — app.is_staff() with a venue.
--    The role test comes first so the answer is never "yes" for someone whose
--    role is wrong; the owner then passes for any venue without holding a row.
-- ---------------------------------------------------------------------------
create or replace function app.is_staff_at(p_venue uuid, variadic roles staff_role[]) returns boolean
language sql stable security definer set search_path = public as $is_staff_at_0123$
  select case
    when not app.is_staff(variadic roles) then false
    when app.is_staff('owner') then true
    else exists (select 1
                   from staff_venues sv
                   join venues v on v.id = sv.venue_id and v.is_active
                  where sv.staff_id = auth.uid()
                    and sv.venue_id = p_venue)
  end
$is_staff_at_0123$;

comment on function app.is_staff_at(uuid, variadic staff_role[]) is
  '0123: app.is_staff() narrowed to one venue. Owners pass everywhere (they hold no '
  'staff_venues rows by design). Policy-callable, so granted to anon too (the 0121 rule).';

revoke all on function app.is_staff_at(uuid, variadic staff_role[]) from public;
grant execute on function app.is_staff_at(uuid, variadic staff_role[]) to anon, authenticated, service_role;
