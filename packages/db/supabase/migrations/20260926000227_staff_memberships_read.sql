set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0227_staff_memberships_read — multi-venue slice 4 (server), step 6.
--
-- staff_venues is read through staff_venues_read_mgmt, which since 0226 follows
-- the branch in scope: the owner looking at branch A sees A's memberships only.
-- The staff record's Branches section needs one person's memberships at every
-- branch to show and change them (app.set_staff_venues, 0218), so the owner
-- gets a narrow read of exactly that.

create or replace function app.staff_memberships(p_staff_id uuid)
returns uuid[]
language plpgsql stable security definer set search_path = public as $staff_memberships_0227$
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return coalesce((select array_agg(sv.venue_id order by v.created_at, v.id)
                     from staff_venues sv join venues v on v.id = sv.venue_id
                    where sv.staff_id = p_staff_id), '{}'::uuid[]);
end
$staff_memberships_0227$;

comment on function app.staff_memberships(uuid) is
  '0227. Owner-only: the branches one staff member works at (every branch, whatever branch is in scope), for the staff record''s Branches section. Read-only.';

revoke all on function app.staff_memberships(uuid) from public, anon;
grant execute on function app.staff_memberships(uuid) to authenticated;
