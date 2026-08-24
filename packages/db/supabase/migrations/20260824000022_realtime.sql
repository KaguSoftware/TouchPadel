-- 0022_realtime — broadcast-from-database (design-data.md §1.10).
--
--  * Trigger functions call realtime.send(...) on private topics; every send is
--    wrapped in BEGIN...EXCEPTION WHEN OTHERS THEN NULL — a missing/unhealthy
--    realtime schema must NEVER break a business write.
--  * Topics: 'kds' (tickets), 'session:{guest_session_id}' (order status),
--    'courts' (slot taken/freed — court + range + state ONLY, no guest PII),
--    'floor' (waiter calls), 'menu' (menu/availability cache-bust).
--  * Authorization = RLS on realtime.messages per topic (created only when the
--    realtime schema exists, so plain `db reset` on stripped stacks still works).

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- tickets insert / status change -> 'kds'
-- ---------------------------------------------------------------------------
create or replace function app.rt_ticket() returns trigger
language plpgsql security definer set search_path = public as $$
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
  return new;
end $$;

create trigger tickets_rt
  after insert or update of status on tickets
  for each row execute function app.rt_ticket();

-- ---------------------------------------------------------------------------
-- order status change -> 'session:{guest_session_id}' (guest's open page)
-- ---------------------------------------------------------------------------
create or replace function app.rt_order_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.guest_session_id is not null then
    begin
      perform realtime.send(
        jsonb_build_object('order_id', new.id, 'status', new.status),
        'order_status',
        'session:' || new.guest_session_id::text,
        true);
    exception when others then null;
    end;
  end if;
  return new;
end $$;

create trigger orders_rt
  after insert or update of status on orders
  for each row execute function app.rt_order_status();

-- ---------------------------------------------------------------------------
-- reservations insert / status change -> 'courts' (mobile grid, desk calendar)
-- Payload is slot-taken/slot-freed only: court + range + kind + status. NO PII.
-- ---------------------------------------------------------------------------
create or replace function app.rt_reservation() returns trigger
language plpgsql security definer set search_path = public as $$
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
  return new;
end $$;

create trigger reservations_rt
  after insert or update on reservations
  for each row execute function app.rt_reservation();

-- ---------------------------------------------------------------------------
-- waiter calls -> 'floor' (till floor view)
-- ---------------------------------------------------------------------------
create or replace function app.rt_waiter_call() returns trigger
language plpgsql security definer set search_path = public as $$
begin
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
  return new;
end $$;

create trigger waiter_calls_rt
  after insert or update of status on waiter_calls
  for each row execute function app.rt_waiter_call();

-- ---------------------------------------------------------------------------
-- menu_items / menu_item_variants change -> 'menu' (website ISR revalidate +
-- clients re-fetch; payload is a cache-bust hint, data comes from the tables)
-- ---------------------------------------------------------------------------
create or replace function app.rt_menu_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('table', tg_table_name, 'id', coalesce(new.id, old.id), 'op', tg_op),
      'menu_changed',
      'menu',
      true);
  exception when others then null;
  end;
  return coalesce(new, old);
end $$;

create trigger menu_items_rt
  after insert or update or delete on menu_items
  for each row execute function app.rt_menu_changed();

create trigger menu_item_variants_rt
  after insert or update or delete on menu_item_variants
  for each row execute function app.rt_menu_changed();

revoke all on function app.rt_ticket() from public, anon, authenticated;
revoke all on function app.rt_order_status() from public, anon, authenticated;
revoke all on function app.rt_reservation() from public, anon, authenticated;
revoke all on function app.rt_waiter_call() from public, anon, authenticated;
revoke all on function app.rt_menu_changed() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- realtime.messages RLS — the per-topic authorization table (design §1.10):
--   kds / floor  -> staff roles (prep, cashier, manager, owner)
--   session:*    -> topic suffix matches a LIVE guest_sessions row of auth.uid()
--   courts       -> any authenticated user (payload carries no PII)
--   menu         -> anon + authenticated
-- Guarded: created only where the realtime schema exists.
-- ---------------------------------------------------------------------------
do $rt$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages absent - skipping broadcast RLS policies';
    return;
  end if;

  execute $p$
    create policy touchpadel_rt_staff_topics on realtime.messages
      for select to authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and realtime.topic() in ('kds','floor')
        and app.is_staff('prep','cashier','manager','owner')
      )
  $p$;

  execute $p$
    create policy touchpadel_rt_guest_session on realtime.messages
      for select to authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and realtime.topic() like 'session:%'
        and exists (
          select 1 from public.guest_sessions gs
           where gs.auth_user_id = (select auth.uid())
             and gs.closed_at is null
             and gs.expires_at > now()
             and 'session:' || gs.id::text = realtime.topic()
        )
      )
  $p$;

  execute $p$
    create policy touchpadel_rt_courts on realtime.messages
      for select to authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and realtime.topic() = 'courts'
      )
  $p$;

  execute $p$
    create policy touchpadel_rt_menu on realtime.messages
      for select to anon, authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and realtime.topic() = 'menu'
      )
  $p$;
exception
  when duplicate_object then
    raise notice 'realtime broadcast policies already exist - skipping';
end $rt$;
