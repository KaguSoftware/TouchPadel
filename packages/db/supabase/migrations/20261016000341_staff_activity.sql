set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 0341 — staff activity monitor (Majed, 2026-10-16).
--
-- The ask: the owner sees, for every staff member, their last action, whether
-- they are active right now and when they were last seen, with the operator
-- (the desktop app) and the mobile app (the staff phone) shown separately.
--
-- What already existed and why it is not enough:
--   * device_heartbeats (0021, 0107, 0229) knows a registered STATION and who
--     was signed in at its last beat. The owner's office PC and every phone
--     are not stations, so they never beat (0229 decision A1), and the beat
--     does degraded-mode work this must not touch.
--   * audit_log knows every recorded action and its actor, but not which app
--     it came from.
--
-- So one row per (person, app) in staff_activity, fed two ways:
--   1. app.staff_activity_ping(p_surface, p_state, p_screen, p_app_version):
--      each app calls it while someone is signed in (every minute in the
--      foreground, once on going to the background, once on signing out).
--      Writes are throttled to one every 20 s per row unless the state or the
--      screen changed, so a burst of pings costs nothing.
--   2. An AFTER INSERT trigger on audit_log stamps the actor's last action on
--      the row of the app that made the request. The app is the request's
--      `x-touch-app` header ('operator' | 'mobile', sent by each client); a
--      request without it that carries `x-station-id` is the operator (the
--      replay function forwards that header for queued offline writes). A
--      request that names neither (an edge function, the cron) is not
--      attributed to an app and leaves the table alone.
--
-- The owner reads it through app.staff_activity_board(), one row per active
-- staff member at the branches in scope (the rail's branch), each with an
-- `operator` and a `mobile` part and a status the server works out against
-- its own clock:
--   online   seen in the last 2 minutes, in the foreground;
--   away     seen in the last 15 minutes, or in the last 2 in the background;
--   offline  signed out, or not seen for 15 minutes;
--   never    no row for that app.
-- `onBreak` comes from staff_breaks (0105) and is about the person, not an app.
--
-- No client reads or writes the table: RLS on, no policies, no grants. The
-- trigger never raises and never waits on a lock (a busy row is skipped): an
-- activity stamp must never cost, slow or deadlock a business write.
-- ===========================================================================

create table if not exists staff_activity (
  staff_id           uuid        not null references staff(id) on delete cascade,
  surface            text        not null,
  state              text        not null default 'active',
  last_seen_at       timestamptz not null default now(),
  state_at           timestamptz not null default now(),
  screen             text,
  app_version        text,
  device_id          text,
  last_action        text,
  last_action_entity text,
  last_action_at     timestamptz,
  primary key (staff_id, surface),
  constraint staff_activity_surface_chk check (surface in ('operator', 'mobile')),
  constraint staff_activity_state_chk check (state in ('active', 'background', 'signed_out')),
  constraint staff_activity_screen_len check (screen is null or char_length(screen) <= 160),
  constraint staff_activity_version_len check (app_version is null or char_length(app_version) <= 40),
  constraint staff_activity_device_len check (device_id is null or char_length(device_id) <= 64),
  constraint staff_activity_action_len check (last_action is null or char_length(last_action) <= 120),
  constraint staff_activity_entity_len check (last_action_entity is null or char_length(last_action_entity) <= 120)
);

comment on table staff_activity is
  '0341: one row per staff member and app (operator | mobile): last seen, foreground/background/'
  'signed-out state, the screen they were on and their last audited action. Written only by '
  'app.staff_activity_ping and the audit_log trigger; read only by app.staff_activity_board (owner).';

alter table staff_activity enable row level security;
revoke all on table staff_activity from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The app a request came from, or NULL when it names none.
-- ---------------------------------------------------------------------------
create or replace function app.request_surface() returns text
language plpgsql stable security definer set search_path = public as $request_surface_0341$
declare
  v_app text := lower(app.req_header('x-touch-app'));
begin
  if v_app in ('operator', 'mobile') then
    return v_app;
  end if;
  if app.req_header('x-station-id') is not null then
    return 'operator';
  end if;
  return null;
end
$request_surface_0341$;

revoke all on function app.request_surface() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The ping.
-- ---------------------------------------------------------------------------
create or replace function app.staff_activity_ping(
  p_surface     text,
  p_state       text default 'active',
  p_screen      text default null,
  p_app_version text default null
) returns jsonb
language plpgsql security definer set search_path = public as $staff_activity_ping_0341$
declare
  v_state  text := coalesce(nullif(btrim(p_state), ''), 'active');
  v_screen text := nullif(left(btrim(coalesce(p_screen, '')), 160), '');
  v_ver    text := nullif(left(btrim(coalesce(p_app_version, '')), 40), '');
  v_device text := left(app.req_header('x-station-id'), 64);
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_surface is null or p_surface not in ('operator', 'mobile') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_surface';
  end if;
  if v_state not in ('active', 'background', 'signed_out') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_state';
  end if;

  insert into staff_activity as a (staff_id, surface, state, last_seen_at, state_at, screen, app_version, device_id)
  values (auth.uid(), p_surface, v_state, now(), now(), v_screen, v_ver, v_device)
  on conflict (staff_id, surface) do update
     set last_seen_at = now(),
         state        = excluded.state,
         state_at     = case when a.state is distinct from excluded.state then now() else a.state_at end,
         screen       = coalesce(excluded.screen, a.screen),
         app_version  = coalesce(excluded.app_version, a.app_version),
         device_id    = coalesce(excluded.device_id, a.device_id)
   where a.last_seen_at < now() - interval '20 seconds'
      or a.state is distinct from excluded.state
      or (excluded.screen is not null and a.screen is distinct from excluded.screen);

  return jsonb_build_object('ok', true, 'server_time', now());
end
$staff_activity_ping_0341$;

revoke all on function app.staff_activity_ping(text, text, text, text) from public, anon;
grant execute on function app.staff_activity_ping(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The audit trigger: the actor's last action, on the app that made it.
-- ---------------------------------------------------------------------------
create or replace function app.trg_audit_log_staff_activity() returns trigger
language plpgsql security definer set search_path = public as $trg_audit_log_staff_activity_0341$
declare
  v_surface text;
begin
  if new.actor_id is null or new.actor_role is null or new.actor_role = 'guest' then
    return null;
  end if;
  v_surface := app.request_surface();
  if v_surface is null then
    return null;
  end if;

  -- This runs in the middle of a business write that already holds its own
  -- locks, so it never WAITS on the activity row: a row another transaction
  -- holds (the same person's overlapping write, or a ping) is skipped, and
  -- that one stamp is lost rather than risking a wait or a deadlock.
  perform 1 from staff_activity
    where staff_id = new.actor_id and surface = v_surface
    for update skip locked;
  if found then
    update staff_activity a
       set last_action        = left(new.action, 120),
           last_action_entity = left(new.entity, 120),
           last_action_at     = new.at,
           last_seen_at       = greatest(a.last_seen_at, new.at),
           state              = case when a.state = 'signed_out' then 'active' else a.state end,
           state_at           = case when a.state = 'signed_out' then new.at else a.state_at end,
           device_id          = coalesce(left(new.device_id, 64), a.device_id)
     where a.staff_id = new.actor_id and a.surface = v_surface;
    return null;
  end if;
  if exists (select 1 from staff_activity where staff_id = new.actor_id and surface = v_surface) then
    return null;  -- there, but locked: skipped
  end if;

  -- The person's first row on this app. insert … select: a non-staff actor
  -- (or one deleted meanwhile) inserts nothing rather than failing the FK and,
  -- with it, the business write; a row inserted meanwhile wins.
  insert into staff_activity
    (staff_id, surface, state, last_seen_at, state_at, device_id,
     last_action, last_action_entity, last_action_at)
  select s.id, v_surface, 'active', new.at, new.at, left(new.device_id, 64),
         left(new.action, 120), left(new.entity, 120), new.at
    from staff s
   where s.id = new.actor_id
  on conflict (staff_id, surface) do nothing;
  return null;
end
$trg_audit_log_staff_activity_0341$;

revoke all on function app.trg_audit_log_staff_activity() from public, anon, authenticated;

drop trigger if exists audit_log_staff_activity on audit_log;
create trigger audit_log_staff_activity
  after insert on audit_log
  for each row execute function app.trg_audit_log_staff_activity();

-- ---------------------------------------------------------------------------
-- The owner's board.
-- ---------------------------------------------------------------------------
create or replace function app.staff_activity_board() returns jsonb
language plpgsql stable security definer set search_path = public as $staff_activity_board_0341$
declare
  v_now    timestamptz := now();
  v_venues uuid[];
  v_rows   jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venues := (select app.visible_venue_ids())::uuid[];

  with people as (
    select s.id, s.display_name, s.role
      from staff s
     where s.is_active
       and (s.role = 'owner'
            or exists (select 1 from staff_venues sv
                        where sv.staff_id = s.id and sv.venue_id = any(v_venues)))
  ),
  parts as (
    select a.staff_id, a.surface,
           jsonb_build_object(
             'status', case
               when a.state = 'signed_out' then 'offline'
               when a.last_seen_at >= v_now - interval '2 minutes' and a.state = 'active' then 'online'
               when a.last_seen_at >= v_now - interval '15 minutes' then 'away'
               else 'offline' end,
             'state', a.state,
             'stateAt', a.state_at,
             'lastSeenAt', a.last_seen_at,
             'screen', a.screen,
             'appVersion', a.app_version,
             'deviceId', a.device_id,
             'lastAction', a.last_action,
             'lastActionEntity', a.last_action_entity,
             'lastActionAt', a.last_action_at) as part
      from staff_activity a
      join people p on p.id = a.staff_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'staffId', p.id,
           'name', p.display_name,
           'role', p.role,
           'onBreak', exists (select 1 from staff_breaks b
                               where b.staff_id = p.id and b.ended_at is null
                                 and b.started_at >= v_now - interval '24 hours'),
           'operator', (select x.part from parts x where x.staff_id = p.id and x.surface = 'operator'),
           'mobile',   (select x.part from parts x where x.staff_id = p.id and x.surface = 'mobile'))
         order by lower(p.display_name), p.id), '[]'::jsonb)
    into v_rows
    from people p;

  return jsonb_build_object('serverTime', v_now, 'rows', v_rows);
end
$staff_activity_board_0341$;

revoke all on function app.staff_activity_board() from public, anon;
grant execute on function app.staff_activity_board() to authenticated;
