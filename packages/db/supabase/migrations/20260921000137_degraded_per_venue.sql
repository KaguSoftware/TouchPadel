-- ===========================================================================
-- 0137 — degraded mode gets a subject: which venue is degraded?
--
-- app.is_degraded() (latest body 0026:766) asks "does a till row exist, and is
-- none of them fresh?" over the whole device_heartbeats table, and
-- app.venue_mode() (0021:128) wraps it with the open degraded period and the
-- protected horizon. Both are the guest apps' first call, before any identity
-- exists, and both are granted to anon. With two venues the question is
-- meaningless: one site losing its till would put the other site's guests into
-- degraded mode, and a fresh till anywhere would hide a real outage.
--
-- Four functions after this file, two of them new:
--
--   app.is_degraded(p_venue uuid)   the 0026 body, filtered to one venue
--   app.is_degraded()               is_degraded(app.current_venue_or_default())
--   app.venue_mode(p_venue uuid)    the 0021 body, degraded + period + horizon
--   app.venue_mode()                venue_mode(app.current_venue_or_default())
--
-- WHY _or_default AND NOT current_venue (decision R3). These two are called by
-- anon on the guest menu before anything has identified the caller: a raise is
-- not an option, a banner that cannot render is a broken page. current_venue()
-- raises VENUE_REQUIRED when it cannot decide; current_venue_or_default()
-- falls back to the oldest active venue instead. With one venue the answer is
-- bit-identical to 0026/0021 for every caller. With two, an unidentified guest
-- gets venue A's banner — wrong in slice 1, and honestly so: the guest surface
-- learns its own venue in slice 4, from the table token or the station, and
-- these two zero-arg forms become the thin delegations they already look like.
--
-- DELIBERATE OVERLOADS. Both names end this file with two live signatures, so
-- fixtures/rpc-overloads.json gains `is_degraded` and `venue_mode` in the same
-- commit — check-rpc-registry.mjs fails on any name with two signatures that
-- the file does not name, and tests/rpc-overloads.test.ts proves the same list
-- against pg_proc. PostgREST tells them apart by argument name: {} picks the
-- zero-arg form, {p_venue: …} the one-arg form, so no existing client call
-- becomes ambiguous.
--
-- NO DROP NEEDED. `create or replace function app.is_degraded()` replaces the
-- 0026 body in place and keeps its grants; the one-arg form is a genuinely new
-- function. Grants are re-asserted below anyway, because the registry gate
-- replays GRANT/REVOKE in file order and a new function is EXECUTE-able by
-- PUBLIC until something says otherwise.
--
-- ORDER MATTERS: check_function_bodies resolves app.is_degraded(uuid) while
-- parsing the zero-arg delegation, so the one-arg forms are created first.
--
-- STILL GLOBAL: app.sweep_degraded_periods(). It opens and closes
-- degraded_periods rows from the heartbeat table as a whole, and splitting it
-- per venue is a behaviour change (one period per venue, not one period) that
-- belongs with the RPC-family re-issue in slice 3. Until then a degraded_period
-- row carries the venue it was written at, through the column default, and
-- venue_mode below filters on it.
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.is_degraded(p_venue) — the 0026 body with one WHERE clause added.
-- ---------------------------------------------------------------------------
create or replace function app.is_degraded(p_venue uuid) returns boolean
language sql stable security definer set search_path = public as $is_degraded_0137$
  -- A till is a row flagged is_till (0026) OR named 'TILL%' (back-compat with
  -- clients that predate the flag) — now, additionally, one standing in the
  -- venue being asked about.
  select exists (select 1 from device_heartbeats
                  where venue_id = p_venue
                    and (is_till or device_id like 'TILL%'))
     and not exists (
       select 1 from device_heartbeats
        where venue_id = p_venue
          and (is_till or device_id like 'TILL%')
          and last_seen_at > now() - make_interval(
                secs => (select heartbeat_stale_seconds from venue_settings))
     )
$is_degraded_0137$;

comment on function app.is_degraded(uuid) is
  '0137. Is this venue degraded: it has a till and none of its tills is fresh. '
  'heartbeat_stale_seconds still comes from the single venue_settings row until '
  'the slice-2 platform_settings split.';

-- ---------------------------------------------------------------------------
-- 2. app.venue_mode(p_venue) — the 0021 body, degraded period filtered.
-- ---------------------------------------------------------------------------
create or replace function app.venue_mode(p_venue uuid) returns jsonb
language sql stable security definer set search_path = public as $venue_mode_0137$
  select jsonb_build_object(
    'degraded', app.is_degraded(p_venue),
    'degraded_since', (select started_at from degraded_periods
                        where ended_at is null
                          and venue_id = p_venue
                        order by started_at desc limit 1),
    'protected_horizon_hours', (select protected_horizon_hours from venue_settings),
    'server_time', now())
$venue_mode_0137$;

comment on function app.venue_mode(uuid) is
  '0137. What the clients poll and paint on, for one venue: degraded flag, when '
  'it started, the protected booking horizon and server time. Numbers only, safe '
  'for anon.';

-- ---------------------------------------------------------------------------
-- 3. The zero-arg forms: thin delegations that never raise (R3).
-- ---------------------------------------------------------------------------
create or replace function app.is_degraded() returns boolean
language sql stable security definer set search_path = public as $is_degraded_zero_0137$
  select app.is_degraded(app.current_venue_or_default())
$is_degraded_zero_0137$;

comment on function app.is_degraded() is
  '0137. is_degraded for the caller''s venue, or the default venue when nothing '
  'has identified them yet. _or_default, never current_venue: anon calls this on '
  'the guest menu before any identity exists and it must not raise (R3).';

create or replace function app.venue_mode() returns jsonb
language sql stable security definer set search_path = public as $venue_mode_zero_0137$
  select app.venue_mode(app.current_venue_or_default())
$venue_mode_zero_0137$;

comment on function app.venue_mode() is
  '0137. venue_mode for the caller''s venue, or the default venue when nothing '
  'has identified them yet. Same never-raise rule as is_degraded() (R3).';

-- ---------------------------------------------------------------------------
-- 4. Grants. Revoke from public first: a freshly created function is
--    EXECUTE-able by PUBLIC and no gate catches that (0092 precedent).
-- ---------------------------------------------------------------------------
revoke all on function app.is_degraded(uuid) from public;
revoke all on function app.is_degraded()     from public;
revoke all on function app.venue_mode(uuid)  from public;
revoke all on function app.venue_mode()      from public;

grant execute on function app.is_degraded(uuid) to anon, authenticated;
grant execute on function app.is_degraded()     to anon, authenticated;
grant execute on function app.venue_mode(uuid)  to anon, authenticated;
grant execute on function app.venue_mode()      to anon, authenticated;
