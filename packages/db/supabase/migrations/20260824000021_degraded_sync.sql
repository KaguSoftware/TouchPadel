-- 0021_degraded_sync — heartbeat, degraded-mode detection, replay bookkeeping,
-- pg_cron jobs (design-data.md §1.9).
--
--  * app.is_degraded() stops being the 0008 stub here: no fresh TILL heartbeat
--    within venue_settings.heartbeat_stale_seconds = degraded. The guest write
--    RPCs (hold_slot 0008, create_guest_order 0015, raise_waiter_call 0016)
--    already call the guard inline — replacing the stub flips them live.
--    BOOTSTRAP DEVIATION: a venue where NO till has EVER heartbeated is NOT
--    degraded (fresh stacks / staging would otherwise refuse all guest writes).
--  * app.confirm_booking is re-issued with the horizon guard added for
--    non-staff (a guest confirming a hold inside the protected horizon while
--    degraded is refused; desk keeps working) — body copied from 0008.
--  * sync_replays is append-only; a replayed booking that loses to an online
--    booking is logged result='conflict' + manager_alerts('replay_conflict')
--    — "shows the desk a conflict rather than an overwrite".
--  * pg_cron jobs are best-effort: stacks without the extension still reset.

set check_function_bodies = off;

create table device_heartbeats (
  device_id    text primary key,               -- 'TILL-01', 'DESK-01', 'KDS-01'
  last_seen_at timestamptz not null default now(),
  queue_depth  int not null default 0,         -- unreplayed offline writes on the device
  app_version  text,
  is_till      boolean not null default false  -- 0026: explicit till flag; 'TILL%' names still count (back-compat)
);

create table degraded_periods (
  id          uuid primary key default gen_random_uuid(),
  started_at  timestamptz not null,
  ended_at    timestamptz,
  detected_by text not null default 'heartbeat_timeout'
);

create index degraded_periods_open on degraded_periods (started_at) where ended_at is null;

create table sync_replays (                    -- one row per replayed queued write
  id              bigint generated always as identity primary key,
  device_id       text not null,
  idempotency_key text not null unique,
  entity          text not null,               -- 'order','payment','ticket_status','reservation'
  replayed_at     timestamptz not null default now(),
  result          text not null check (result in ('applied','duplicate','conflict')),
  conflict_detail jsonb
);

-- Append-only, both layers (design §3.4).
revoke update, delete on sync_replays from anon, authenticated;
create trigger sync_replays_ao
  before update or delete on sync_replays
  for each statement execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- app.is_degraded — REAL implementation (replaces the 0008 stub).
-- ---------------------------------------------------------------------------
create or replace function app.is_degraded() returns boolean
language sql stable security definer set search_path = public as $$
  -- A till is a row flagged is_till (0026) OR named 'TILL%' (back-compat with
  -- clients that predate the flag).
  select exists (select 1 from device_heartbeats
                  where is_till or device_id like 'TILL%')
     and not exists (
       select 1 from device_heartbeats
        where (is_till or device_id like 'TILL%')
          and last_seen_at > now() - make_interval(
                secs => (select heartbeat_stale_seconds from venue_settings))
     )
$$;

-- ---------------------------------------------------------------------------
-- app.sweep_degraded_periods — opens/closes degraded_periods on state
-- transitions. Called by heartbeat (immediate recovery) and pg_cron (detects
-- the till going silent without waiting for anyone to write).
-- ---------------------------------------------------------------------------
create or replace function app.sweep_degraded_periods() returns void
language plpgsql security definer set search_path = public as $$
begin
  if app.is_degraded() then
    if not exists (select 1 from degraded_periods where ended_at is null) then
      insert into degraded_periods (started_at, detected_by)
      values (now(), 'heartbeat_timeout');
    end if;
  else
    update degraded_periods set ended_at = now() where ended_at is null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- app.heartbeat — staff devices (till runs under a staff session) report in
-- every ~10s. Closes any open degraded period on recovery; queue_depth gates
-- day close (0020) until the replay queue drains.
-- ---------------------------------------------------------------------------
create or replace function app.heartbeat(
  p_device_id   text,
  p_queue_depth int default 0,
  p_app_version text default null,
  p_is_till     boolean default false           -- 0026: explicit till identification
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not app.is_staff('cashier','prep','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_device_id is null or p_device_id = '' then
    raise exception 'DEVICE_REQUIRED' using errcode = 'P0001';
  end if;

  insert into device_heartbeats (device_id, last_seen_at, queue_depth, app_version, is_till)
  values (p_device_id, now(), greatest(coalesce(p_queue_depth, 0), 0), p_app_version,
          coalesce(p_is_till, false))
  on conflict (device_id) do update
     set last_seen_at = excluded.last_seen_at,
         queue_depth  = excluded.queue_depth,
         app_version  = coalesce(excluded.app_version, device_heartbeats.app_version),
         -- Sticky: once a device has identified as a till it stays one — an
         -- older client build omitting the flag must not undo detection.
         is_till      = device_heartbeats.is_till or excluded.is_till;

  perform app.sweep_degraded_periods();

  return jsonb_build_object('degraded', app.is_degraded(), 'server_time', now());
end $$;

-- ---------------------------------------------------------------------------
-- app.venue_mode — what clients poll/paint on: degraded flag + horizon.
-- Safe for anon (numbers only, no operational data).
-- ---------------------------------------------------------------------------
create or replace function app.venue_mode() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'degraded', app.is_degraded(),
    'degraded_since', (select started_at from degraded_periods
                        where ended_at is null
                        order by started_at desc limit 1),
    'protected_horizon_hours', (select protected_horizon_hours from venue_settings),
    'server_time', now())
$$;

-- ---------------------------------------------------------------------------
-- app.log_replay — the till records the outcome of each replayed queued write
-- (the write itself went through the normal RPC with its idempotency_key).
-- result='conflict' raises a replay_conflict manager alert: the desk sees a
-- conflict, never an overwrite.
-- ---------------------------------------------------------------------------
create or replace function app.log_replay(
  p_device_id       text,
  p_idempotency_key text,
  p_entity          text,
  p_result          text,
  p_conflict_detail jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not app.is_staff('cashier','prep','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_result not in ('applied','duplicate','conflict') then
    raise exception 'INVALID_RESULT' using errcode = 'P0001';
  end if;

  insert into sync_replays (device_id, idempotency_key, entity, result, conflict_detail)
  values (p_device_id, p_idempotency_key, p_entity, p_result, p_conflict_detail)
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('duplicate', true);
  end if;

  if p_result = 'conflict' then
    insert into manager_alerts (kind, payload)
    values ('replay_conflict', jsonb_build_object(
      'device_id', p_device_id, 'entity', p_entity,
      'idempotency_key', p_idempotency_key, 'detail', p_conflict_detail));
  end if;

  return jsonb_build_object('duplicate', false, 'replay_id', v_id);
end $$;

-- ---------------------------------------------------------------------------
-- app.flag_expired_batches — nightly: one open alert per batch entering the
-- expiring-soon window or already expired (kind 'expiring_soon'; payload marks
-- which). Manager confirms write-offs via app.write_off_expired (0018).
-- ---------------------------------------------------------------------------
create or replace function app.flag_expired_batches() returns void
language plpgsql security definer set search_path = public as $$
declare v_days int;
begin
  select expiring_soon_days into v_days from venue_settings;

  insert into manager_alerts (kind, payload)
  select 'expiring_soon',
         jsonb_build_object(
           'batch_id', b.id,
           'ingredient_id', b.ingredient_id,
           'expiry_date', b.expiry_date,
           'qty_remaining', b.qty_remaining,
           'expired', b.expiry_date < current_date)
    from stock_batches b
   where b.qty_remaining > 0
     and b.expiry_date is not null
     and b.expiry_date <= current_date + coalesce(v_days, 3)
     and not exists (
       select 1 from manager_alerts a
        where a.kind = 'expiring_soon'
          and a.acknowledged_at is null
          and a.payload->>'batch_id' = b.id::text);
end $$;

-- ---------------------------------------------------------------------------
-- app.confirm_booking — re-issued from 0008 with ONE addition: a non-staff
-- confirm inside the protected horizon is refused while degraded (the hold
-- was taken before the outage or outside the horizon; the desk can still
-- confirm anything).
-- ---------------------------------------------------------------------------
create or replace function app.confirm_booking(
  p_hold_id     uuid,
  p_guest_name  text default null,
  p_guest_phone text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v        reservations%rowtype;
  v_before jsonb;
  v_rule   uuid;
  v_price  bigint;
  v_dur    int;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v from reservations where id = p_hold_id for update;
  if not found then
    raise exception 'HOLD_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not app.is_staff('court_desk','manager','owner')
     and v.guest_id is distinct from v_uid then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- Idempotent confirm.
  if v.kind = 'booking' and v.status = 'confirmed' then
    return jsonb_build_object('duplicate', true, 'reservation_id', v.id,
      'rate_rule_id', v.rate_rule_id, 'price_iqd', v.price_iqd);
  end if;

  if v.kind <> 'hold' or v.status <> 'pending' or v.hold_expires_at < now() then
    raise exception 'HOLD_EXPIRED' using errcode = 'P0001';
  end if;

  -- DEGRADED GUARD (0021): guests cannot confirm inside the protected horizon
  -- while the venue trades offline; staff paths are unaffected.
  if not app.is_staff('court_desk','manager','owner') then
    perform app.assert_not_degraded_for(v.start_at);
  end if;

  if v.guest_id is null and coalesce(p_guest_name, v.guest_name) is null then
    raise exception 'GUEST_REQUIRED' using errcode = 'P0001',
      hint = 'a booking needs guest_id or guest_name';
  end if;

  v_before := to_jsonb(v);
  v_dur := (extract(epoch from (v.end_at - v.start_at)) / 60)::int;

  select ps.rule_id, ps.price_iqd into v_rule, v_price
    from app.price_slot(v.court_id, v.start_at, v_dur) ps;
  if v_rule is null then
    raise exception 'NO_RATE' using errcode = 'P0001';
  end if;

  update reservations
     set kind            = 'booking',
         status          = 'confirmed',
         rate_rule_id    = v_rule,
         price_iqd       = v_price,
         guest_name      = coalesce(p_guest_name, guest_name),
         guest_phone     = coalesce(p_guest_phone, guest_phone),
         hold_expires_at = null
   where id = p_hold_id
   returning * into v;

  perform app.write_audit('reservation.confirm', 'reservations', v.id::text,
                          v_before, to_jsonb(v), null, null, v.device_id);

  return jsonb_build_object('duplicate', false, 'reservation_id', v.id,
    'rate_rule_id', v.rate_rule_id, 'price_iqd', v.price_iqd);
end $$;

-- ---------------------------------------------------------------------------
-- pg_cron jobs — best-effort: local stacks without the extension still reset.
-- cron.schedule(name, ...) upserts by job name, so re-running is safe.
-- ---------------------------------------------------------------------------
do $cron$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron unavailable (%) - scheduled jobs skipped', sqlerrm;
  end;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('tp_hold_sweep',      '* * * * *', 'select app.expire_stale_holds();');
    perform cron.schedule('tp_degraded_sweep',  '* * * * *', 'select app.sweep_degraded_periods();');
    perform cron.schedule('tp_expiry_flagging', '0 2 * * *', 'select app.flag_expired_batches();');
  end if;
end $cron$;

-- ---------------------------------------------------------------------------
-- Grants + RLS (matrix: heartbeat via RPC; manager/owner read state/replays)
-- ---------------------------------------------------------------------------
alter table device_heartbeats enable row level security;
alter table degraded_periods  enable row level security;
alter table sync_replays      enable row level security;

grant select on device_heartbeats, degraded_periods, sync_replays to authenticated;

create policy device_heartbeats_mgmt_read on device_heartbeats for select to authenticated
  using (app.is_staff('manager','owner'));
create policy degraded_periods_mgmt_read on degraded_periods for select to authenticated
  using (app.is_staff('manager','owner'));
create policy sync_replays_mgmt_read on sync_replays for select to authenticated
  using (app.is_staff('manager','owner'));

-- is_degraded keeps its 0008 grants (anon + authenticated) through the REPLACE;
-- re-assert for clarity/idempotence on fresh runs.
revoke all on function app.is_degraded() from public;
grant execute on function app.is_degraded() to anon, authenticated;

revoke all on function app.sweep_degraded_periods() from public, anon, authenticated;
revoke all on function app.flag_expired_batches() from public, anon, authenticated;

revoke all on function app.heartbeat(text, int, text, boolean) from public, anon;
grant execute on function app.heartbeat(text, int, text, boolean) to authenticated;

revoke all on function app.venue_mode() from public;
grant execute on function app.venue_mode() to anon, authenticated;

revoke all on function app.log_replay(text, text, text, text, jsonb) from public, anon;
grant execute on function app.log_replay(text, text, text, text, jsonb) to authenticated;

-- confirm_booking grants unchanged (0008): replace preserves them.
