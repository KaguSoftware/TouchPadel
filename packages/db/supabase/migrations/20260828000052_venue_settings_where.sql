-- ---------------------------------------------------------------------------
-- 0052 — the two venue-settings writers have never worked from a client.
--
-- `app.set_opening_hours` (0013) and `app.set_waiter_call_cooldown` (0031) both
-- do a bare `update venue_settings set ...` with no WHERE clause. That is fine
-- in psql and fine from the service role, and it is REFUSED on every PostgREST
-- connection, because Supabase loads `safeupdate` there:
--
--     ERROR: UPDATE requires a WHERE clause
--
-- SECURITY DEFINER does not help: the guard is a session-level hook on the
-- statement, not a privilege check, so it fires inside the function body too.
--
-- Consequences, both contractual:
--   * SOW L319, "Opening hours and closed days" — /admin/hours has been unable
--     to save since day 1. The screen renders, the button works, the write is
--     refused, and nothing about the venue's trading hours could be changed
--     from the product at all.
--   * The waiter-call cooldown control on /admin/settings, same story since the
--     cafe rebuild.
--
-- It survived this long because no test ever SAVED: the DB suites call these
-- through the service role (no safeupdate), and there was no e2e that pressed
-- the button. The e2e added alongside this migration does.
--
-- `venue_settings.id` is `boolean not null default true` — the singleton
-- pattern this schema uses — so `where id` is both correct and total.
-- ---------------------------------------------------------------------------

create or replace function app.set_opening_hours(
  p_opening_hours jsonb default null,
  p_closed_dates  date[] default null
) returns void
language plpgsql security definer set search_path = public as $set_hours_0052$
declare
  v_before jsonb;
  v_after  jsonb;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_opening_hours is not null and jsonb_typeof(p_opening_hours) <> 'object' then
    raise exception 'INVALID_HOURS' using errcode = 'P0001';
  end if;

  select jsonb_build_object('opening_hours', opening_hours, 'closed_dates', to_jsonb(closed_dates))
    into v_before from venue_settings;

  -- 0052: `where id` added. Without it safeupdate refuses the statement on
  -- every PostgREST connection, which is every client call there is.
  update venue_settings
     set opening_hours = coalesce(p_opening_hours, opening_hours),
         closed_dates  = coalesce(p_closed_dates, closed_dates)
   where id;

  select jsonb_build_object('opening_hours', opening_hours, 'closed_dates', to_jsonb(closed_dates))
    into v_after from venue_settings;

  perform app.write_audit('settings.opening_hours', 'venue_settings', 'singleton',
                          v_before, v_after);
end $set_hours_0052$;

-- Grants are preserved by CREATE OR REPLACE; restated for the reader.
revoke all on function app.set_opening_hours(jsonb, date[]) from public, anon;
grant execute on function app.set_opening_hours(jsonb, date[]) to authenticated;

-- ---------------------------------------------------------------------------
-- app.set_waiter_call_cooldown — same defect, same fix. Body otherwise
-- identical to 0031.
-- ---------------------------------------------------------------------------
create or replace function app.set_waiter_call_cooldown(p_seconds int)
returns void
language plpgsql security definer set search_path = public as $set_cooldown_0052$
declare
  v_before jsonb;
  v_after  jsonb;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_seconds is null or p_seconds < 30 or p_seconds > 600 then
    raise exception 'INVALID_COOLDOWN' using errcode = 'P0001',
      hint = 'cooldown must be between 30 and 600 seconds';
  end if;

  select jsonb_build_object('waiter_call_cooldown_seconds', waiter_call_cooldown_seconds)
    into v_before from venue_settings;

  update venue_settings set waiter_call_cooldown_seconds = p_seconds where id;

  select jsonb_build_object('waiter_call_cooldown_seconds', waiter_call_cooldown_seconds)
    into v_after from venue_settings;

  perform app.write_audit('settings.waiter_cooldown', 'venue_settings', 'singleton',
                          v_before, v_after);
end $set_cooldown_0052$;

revoke all on function app.set_waiter_call_cooldown(int) from public, anon;
grant execute on function app.set_waiter_call_cooldown(int) to authenticated;
