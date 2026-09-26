set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0224_realtime_per_venue — multi-venue slice 4 (server), step 3 (plan MV7).
--
-- The staff topics were one per building: every kitchen board heard every
-- ticket, every floor screen every waiter call, whichever branch they belong
-- to. Each broadcast trigger below now ALSO sends on a per-branch topic,
-- '<topic>:<venue_id>', with the same explicit payload:
--   rt_ticket (0022), rt_order_item_ready (0061)   kds:<venue>
--   rt_waiter_call (0033)                           floor:<venue>
--   rt_reservation (0022), rt_court_changed (0062)  courts:<venue>
-- The legacy literal topics keep broadcasting for one operator release, so a
-- station on the previous build keeps working; a later migration drops them.
-- 'menu' stays one topic: it is public, carries only table/key/op, and a
-- client only refetches on it. 'session:<id>' is per guest already.
--
-- touchpadel_rt_staff_topics (0194) learns the per-branch topics: kds:<venue>
-- and floor:<venue> are readable by the same roles, but only at that branch
-- (app.is_staff_at), so a branch's screens stop seeing the other branch.
-- touchpadel_rt_courts (0022) also admits courts:<venue> for the same audience
-- (any signed-in session: the guest app's grid, the desk).
-- check-broadcast-payloads.mjs (SEC-28) matches both topic forms (same commit).

-- rt_ticket: re-issued from 20260824000022_realtime.sql:17 with the per-branch topic
create or replace function app.rt_ticket() returns trigger
language plpgsql security definer set search_path = public as $rt_ticket_0224$
begin
  begin
    perform realtime.send(
      jsonb_build_object(
        'ticket_id', new.id,
        'order_id',  new.order_id,
        'status',    new.status,
        'created_at', new.created_at,
        'target_seconds', new.target_seconds),
      case when tg_op = 'INSERT' then 'ticket_created' else 'ticket_status' end,
      'kds',
      true);
  exception when others then null;
  end;
  -- 0224 (MV7): the same payload on the branch's own topic.
  begin
    perform realtime.send(
      jsonb_build_object(
        'ticket_id', new.id,
        'order_id',  new.order_id,
        'status',    new.status,
        'created_at', new.created_at,
        'target_seconds', new.target_seconds),
      case when tg_op = 'INSERT' then 'ticket_created' else 'ticket_status' end,
      'kds:' || new.venue_id::text,
      true);
  exception when others then null;
  end;
  return new;
end $rt_ticket_0224$;

-- rt_order_item_ready: re-issued from 20260903000061_kds_item_ready.sql:80 with the per-branch topic
create or replace function app.rt_order_item_ready() returns trigger
language plpgsql security definer set search_path = public as $rt_order_item_ready_0224$
begin
  begin
    perform realtime.send(
      jsonb_build_object(
        'order_item_id', new.id,
        'order_id',      new.order_id,
        'ready',         new.ready_at is not null),
      'item_ready',
      'kds',
      true);
  exception when others then null;
  end;
  -- 0224 (MV7): the same payload on the branch's own topic.
  begin
    perform realtime.send(
      jsonb_build_object(
        'order_item_id', new.id,
        'order_id',      new.order_id,
        'ready',         new.ready_at is not null),
      'item_ready',
      'kds:' || (select o.venue_id from orders o where o.id = new.order_id)::text,
      true);
  exception when others then null;
  end;
  return new;
end $rt_order_item_ready_0224$;

-- rt_waiter_call: re-issued from 20260825000033_realtime_cafe.sql:38 with the per-branch topic
create or replace function app.rt_waiter_call() returns trigger
language plpgsql security definer set search_path = public as $rt_waiter_call_0224$
begin
  -- 0022 body, verbatim: staff floor view.
  begin
    perform realtime.send(
      jsonb_build_object(
        'call_id',  new.id,
        'table_id', new.table_id,
        'reason',   new.reason,
        'status',   new.status,
        'raised_at', new.raised_at),
      'waiter_call',
      'floor',
      true);
  exception when others then null;
  end;
  -- 0224 (MV7): the same payload on the branch's own topic.
  begin
    perform realtime.send(
      jsonb_build_object(
        'call_id',  new.id,
        'table_id', new.table_id,
        'reason',   new.reason,
        'status',   new.status,
        'raised_at', new.raised_at),
      'waiter_call',
      'floor:' || new.venue_id::text,
      true);
  exception when others then null;
  end;

  -- NEW: the guest who raised the call (topic authorised by
  -- touchpadel_rt_guest_session while their session is live).
  if new.guest_session_id is not null then
    begin
      perform realtime.send(
        jsonb_build_object(
          'call_id',         new.id,
          'status',          new.status,
          'reason',          new.reason,
          'raised_at',       new.raised_at,
          'acknowledged_at', new.acknowledged_at,
          'resolved_at',     new.resolved_at),
        'waiter_call_status',
        'session:' || new.guest_session_id::text,
        true);
    exception when others then null;
    end;
  end if;

  return new;
end $rt_waiter_call_0224$;

-- rt_reservation: re-issued from 20260824000022_realtime.sql:67 with the per-branch topic
create or replace function app.rt_reservation() returns trigger
language plpgsql security definer set search_path = public as $rt_reservation_0224$
begin
  if tg_op = 'UPDATE'
     and new.status = old.status
     and new.court_id = old.court_id
     and new.start_at = old.start_at
     and new.end_at = old.end_at then
    return new;                               -- nothing grid-relevant changed
  end if;
  begin
    perform realtime.send(
      jsonb_build_object(
        'court_id', new.court_id,
        'start_at', new.start_at,
        'end_at',   new.end_at,
        'kind',     new.kind,
        'status',   new.status,
        'busy',     new.status in ('pending','confirmed','arrived')),
      'slot_changed',
      'courts',
      true);
  exception when others then null;
  end;
  -- 0224 (MV7): the same payload on the branch's own topic.
  begin
    perform realtime.send(
      jsonb_build_object(
        'court_id', new.court_id,
        'start_at', new.start_at,
        'end_at',   new.end_at,
        'kind',     new.kind,
        'status',   new.status,
        'busy',     new.status in ('pending','confirmed','arrived')),
      'slot_changed',
      'courts:' || new.venue_id::text,
      true);
  exception when others then null;
  end;
  return new;
end $rt_reservation_0224$;

-- rt_court_changed: re-issued from 20260903000062_courts_admin.sql:179 with the per-branch topic
create or replace function app.rt_court_changed() returns trigger
language plpgsql security definer set search_path = public as $rt_court_changed_0224$
begin
  begin
    perform realtime.send(
      jsonb_build_object('court_id', new.id, 'active', new.is_active),
      'court_changed',
      'courts',
      true);
  exception when others then null;
  end;
  -- 0224 (MV7): the same payload on the branch's own topic.
  begin
    perform realtime.send(
      jsonb_build_object('court_id', new.id, 'active', new.is_active),
      'court_changed',
      'courts:' || new.venue_id::text,
      true);
  exception when others then null;
  end;
  return new;
end $rt_court_changed_0224$;

-- touchpadel_rt_staff_topics: re-issued from the 0194 DO block with the per-branch topics
do $rt_staff_topics_0224$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages absent - skipping broadcast RLS policies';
    return;
  end if;

  execute $p$
    drop policy if exists touchpadel_rt_staff_topics on realtime.messages
  $p$;

  execute $p$
    create policy touchpadel_rt_staff_topics on realtime.messages
      for select to authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and (
              (realtime.topic() in ('kds','floor')
               and app.is_staff('prep','cashier','manager','owner','head_barista','barista','assistant_barista','head_chef','chef'))
           or (realtime.topic() = 'floor' and app.is_staff('waiter'))
           -- 0224 (MV7): the per-branch topics, at that branch only.
           or (realtime.topic() ~ '^(kds|floor):[0-9a-f-]{36}$'
               and app.is_staff_at(split_part(realtime.topic(), ':', 2)::uuid,
                                   'prep','cashier','manager','owner','head_barista','barista','assistant_barista','head_chef','chef'))
           or (realtime.topic() ~ '^floor:[0-9a-f-]{36}$'
               and app.is_staff_at(split_part(realtime.topic(), ':', 2)::uuid, 'waiter'))
        )
      )
  $p$;
end $rt_staff_topics_0224$;


-- touchpadel_rt_courts (0022): the per-branch courts topic too, for the same
-- audience (any signed-in session: the guest app's grid and the desk).
do $rt_courts_0224$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages absent - skipping broadcast RLS policies';
    return;
  end if;

  execute $p$
    drop policy if exists touchpadel_rt_courts on realtime.messages
  $p$;

  execute $p$
    create policy touchpadel_rt_courts on realtime.messages
      for select to authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and (realtime.topic() = 'courts' or realtime.topic() ~ '^courts:[0-9a-f-]{36}$')
      )
  $p$;
end $rt_courts_0224$;
