set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0366_branch_counts — Settings › Branches redesign (Sait, 2026-10-22).
--
-- Each branch card shows its courts and café tables. Staff reads of courts and
-- cafe_tables follow the branch in scope (0226), so the list could only count
-- the branch the rail is on. This is the narrow read the cards need: per branch
-- the caller manages, the active courts and active café tables, nothing else.

create or replace function app.branch_counts()
returns jsonb
language plpgsql stable security definer set search_path = public as $branch_counts_0366$
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- An owner counts every branch, closed ones too (their cards still list
  -- them); a manager only the open or preparing branches they work at.
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'venue_id', v.id,
             'courts', (select count(*) from courts c where c.venue_id = v.id and c.is_active),
             'tables', (select count(*) from cafe_tables t where t.venue_id = v.id and t.is_active))
           order by v.created_at, v.id)
      from venues v
     where app.is_staff('owner') or app.is_staff_at(v.id, 'manager', 'owner')
  ), '[]'::jsonb);
end
$branch_counts_0366$;

comment on function app.branch_counts() is
  '0366. Manager or owner: per branch the caller manages (owner: every branch), the active courts and active café tables, [{venue_id, courts, tables}], for the Branches cards. Read-only.';

revoke all on function app.branch_counts() from public, anon;
grant execute on function app.branch_counts() to authenticated;
