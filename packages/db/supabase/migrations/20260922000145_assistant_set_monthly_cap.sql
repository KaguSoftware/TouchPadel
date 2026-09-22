-- 0145_assistant_set_monthly_cap — the owner edits the assistant's monthly
-- spend cap from the usage page (owner call, 2026-09-22), behind a
-- confirmation step in the client.
--
-- The cap is venue_settings.llm_monthly_cost_cap_micros (0079). Until now it
-- could only be changed with SQL. app.llm_begin_request reads it on every
-- question, so a new value takes effect on the next question; nothing else
-- caches it.
--
-- Bounds: more than zero (a zero cap refuses every question, and "off" is not
-- what an edit on this page should mean), at most USD 10,000 (catches a typed
-- extra zero before it becomes a bill). The change is audited with the before
-- and after figures.
--
-- No schema change; one function.

set lock_timeout = '3s';
set statement_timeout = '60s';

create or replace function app.assistant_set_monthly_cap(p_cap_micros bigint)
returns jsonb
language plpgsql security definer set search_path = public as $assistant_set_monthly_cap_0145$
declare
  v_before bigint;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_cap_micros is null or p_cap_micros <= 0 or p_cap_micros > 10000000000 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'monthly cap must be more than 0 and at most 10000000000 micros (USD 10,000)';
  end if;

  select llm_monthly_cost_cap_micros into v_before from venue_settings where id is not null limit 1;
  if v_before is null then
    raise exception 'VENUE_SETTINGS_MISSING' using errcode = 'P0001';
  end if;

  update venue_settings set llm_monthly_cost_cap_micros = p_cap_micros where id is not null;

  perform app.write_audit('settings.llm_monthly_cap', 'venue_settings', 'singleton',
    jsonb_build_object('monthly_cap_micros', v_before),
    jsonb_build_object('monthly_cap_micros', p_cap_micros));

  return jsonb_build_object('monthly_cap_micros', p_cap_micros, 'previous_cap_micros', v_before);
end $assistant_set_monthly_cap_0145$;

comment on function app.assistant_set_monthly_cap(bigint) is
  '0145. Owner-only: set the assistant''s monthly spend cap (venue_settings.llm_monthly_cost_cap_micros, USD micros). More than 0, at most USD 10,000. Audited. The singleton row is addressed by its non-null id, as 0140 does, so safeupdate is satisfied.';

revoke all on function app.assistant_set_monthly_cap(bigint) from public, anon;
grant execute on function app.assistant_set_monthly_cap(bigint) to authenticated;
