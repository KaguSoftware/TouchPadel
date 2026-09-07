-- 0074_court_delete — app.delete_court. Courts admin could create and edit a
-- court since 0062 but never remove one, so a court typed in by mistake, or a
-- test court from setup day, is on the grid forever.
--
-- WHY A DELETE AND A DEACTIVATE ARE BOTH RIGHT, AND WHICH IS WHICH.
-- courts is referenced by reservations.court_id, rate_rules.court_id and
-- reservation_series.court_id, all NOT NULL except rate_rules. A court with
-- history CANNOT be deleted without taking last month's revenue reports with
-- it — the courts report joins reservations to court names, and a dangling id
-- is a report that no longer adds up. That court gets DEACTIVATED: 0062
-- already does it, the grid drops it, the reports keep it.
--
-- A court with NO history is different. Nothing references it, deleting it
-- takes nothing with it, and leaving it as a permanently greyed row in the
-- admin list is just clutter the owner cannot clear. That is what this deletes.
--
-- So the RPC is a hard delete WITH a refusal that names the reason, and the
-- refusal is the interesting half: COURT_IN_USE carries the counts, and the
-- screen turns it into "12 bookings, 3 price rules — deactivate instead", with
-- the deactivate offered right there. A delete button that silently degrades
-- into a deactivate would be worse than no button: the owner would think the
-- court was gone and it would still be pricing slots.
--
-- Rate rules are the one soft case. A venue-wide rule (court_id is null) is
-- untouched; a rule pinned to THIS court is meaningless once the court is
-- gone, so it counts as history and blocks — deleting someone's pricing as a
-- side effect of a court delete is not a thing this should decide.
--
-- covered by packages/db/tests/courts-admin.test.ts

create or replace function app.delete_court(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $delete_court_0074$
declare
  v_row          courts%rowtype;
  v_reservations int;
  v_series       int;
  v_rate_rules   int;
begin
  -- Same tier as upsert_court/reorder_courts (0062).
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_row from courts where id = p_id for update;
  if not found then
    raise exception 'COURT_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- EVERY reservation, not just live ones: a cancelled booking from March is
  -- still a row the courts report reads a name off.
  select count(*) into v_reservations from reservations where court_id = p_id;
  select count(*) into v_series       from reservation_series where court_id = p_id;
  select count(*) into v_rate_rules   from rate_rules where court_id = p_id;

  if v_reservations > 0 or v_series > 0 or v_rate_rules > 0 then
    raise exception 'COURT_IN_USE' using errcode = 'P0001',
      -- The screen parses this to say what is holding the court and offer the
      -- deactivate instead. Keep the shape if you touch it.
      detail = jsonb_build_object('reservations', v_reservations,
                                  'series',       v_series,
                                  'rate_rules',   v_rate_rules)::text,
      hint = 'deactivate the court instead — its bookings and reports still name it';
  end if;

  -- Audit BEFORE the row goes: write_audit reads the snapshot, and after the
  -- delete there is nothing left to snapshot.
  perform app.write_audit('courts.delete', 'courts', p_id::text, to_jsonb(v_row), null);

  delete from courts where id = p_id;

  -- 0062's courts_rt trigger is AFTER INSERT OR UPDATE only, so a delete emits
  -- nothing and the desk grid, the rate editor and the guest court list would
  -- all keep the court until their next refetch. Same topic, same payload
  -- shape, 'active' false because it is gone.
  begin
    perform realtime.send(
      jsonb_build_object('court_id', p_id, 'active', false, 'deleted', true),
      'court_changed',
      'courts',
      true);
  exception when others then null;
  end;

  return jsonb_build_object('court_id', p_id, 'deleted', true);
end $delete_court_0074$;

comment on function app.delete_court(uuid) is
  '0074: hard-delete a court that nothing references. Raises COURT_IN_USE (detail = {reservations, series, rate_rules}) when it has history — that court is deactivated via app.upsert_court instead, so the reports keep its name.';

revoke all on function app.delete_court(uuid) from public, anon;
grant execute on function app.delete_court(uuid) to authenticated;
