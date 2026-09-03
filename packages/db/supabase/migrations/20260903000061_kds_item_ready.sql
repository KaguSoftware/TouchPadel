-- 0061_kds_item_ready — KDS item-level ready marks become SERVER state
-- (operator audit M1; SOW L460-462).
--
-- The KDS ticked items in a component useState<Set> — a reload lost every
-- mark, a second prep station never saw them, and L462's "actual preparation
-- time stored per ticket" was stamped at COMPLETION (bussing), not readiness.
--
--   1. app.set_order_item_ready — idempotent per-item mark/unmark, prep+ roles,
--      refused once the ticket is completed/voided. Returns all_items_ready so
--      the UI can surface the ticket-Ready button; the ticket transition stays
--      a HUMAN action (the chef calls the pass, not a checkbox count).
--   2. order_items ready_at change -> 'item_ready' on the private 'kds' topic
--      (0022 rt pattern) — the second station and the till converge live.
--   3. app.ticket_transition: actual_prep_seconds stamps at READY (pickup ->
--      pass), keeping the completed-time stamp only as a fallback for tickets
--      bumped straight through. 0037's started_at basis is preserved.
--
-- covered by packages/db/tests/kds-item-ready.test.ts

-- ---------------------------------------------------------------------------
-- 1. set_order_item_ready
-- ---------------------------------------------------------------------------
create or replace function app.set_order_item_ready(
  p_order_item_id uuid,
  p_ready         boolean,
  p_device_id     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $item_ready_0061$
declare
  v_oi     order_items%rowtype;
  v_ticket tickets%rowtype;
  v_all    boolean;
begin
  if not app.is_staff('prep','cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_oi from order_items where id = p_order_item_id for update;
  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_oi.voided then
    raise exception 'ITEM_VOIDED' using errcode = 'P0001';
  end if;

  select * into v_ticket from tickets where order_id = v_oi.order_id;
  if found and v_ticket.status in ('completed','voided') then
    raise exception 'TICKET_CLOSED' using errcode = 'P0001',
      hint = 'a finished ticket''s marks are history, not state';
  end if;

  if p_ready then
    -- Idempotent: a double-tap (or a replay) keeps the FIRST timestamp.
    update order_items set ready_at = coalesce(ready_at, now())
     where id = p_order_item_id
     returning * into v_oi;
  else
    update order_items set ready_at = null
     where id = p_order_item_id
     returning * into v_oi;
  end if;

  select bool_and(ready_at is not null) into v_all
    from order_items where order_id = v_oi.order_id and not voided;

  return jsonb_build_object(
    'order_item_id',   v_oi.id,
    'ready_at',        v_oi.ready_at,
    'all_items_ready', coalesce(v_all, false),
    'ticket_id',       v_ticket.id);
end $item_ready_0061$;

revoke all on function app.set_order_item_ready(uuid, boolean, text) from public, anon;
grant execute on function app.set_order_item_ready(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. item_ready realtime event on 'kds' (private topic; 0022 pattern —
--    exception-swallowed so realtime trouble never rolls back the mark)
-- ---------------------------------------------------------------------------
create or replace function app.rt_order_item_ready() returns trigger
language plpgsql security definer set search_path = public as $$
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
  return new;
end $$;

drop trigger if exists order_items_ready_rt on order_items;
create trigger order_items_ready_rt
  after update of ready_at on order_items
  for each row execute function app.rt_order_item_ready();

-- ---------------------------------------------------------------------------
-- 3. ticket_transition — 0037 body; prep time now stamps at READY.
-- ---------------------------------------------------------------------------
create or replace function app.ticket_transition(
  p_ticket_id   uuid,
  p_status      ticket_status,
  p_device_id   text,
  p_actor_label text default null
) returns jsonb
language plpgsql security definer set search_path = public as $tkt_0061$
declare
  v    tickets%rowtype;
  v_ok boolean;
begin
  select * into v from tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'TICKET_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v.status = p_status then                  -- idempotent replay of a bump
    return jsonb_build_object('duplicate', true, 'ticket_id', v.id, 'status', v.status);
  end if;

  v_ok := (p_status = 'preparing' and v.status = 'queued')
       or (p_status = 'ready'     and v.status in ('queued','preparing'))
       or (p_status = 'completed' and v.status = 'ready');
  if not v_ok then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001',
      detail = format('%s -> %s', v.status, p_status);
  end if;

  update tickets
     set status       = p_status,
         started_at   = case when p_status = 'preparing' then coalesce(started_at, now()) else started_at end,
         ready_at     = case when p_status = 'ready'     then coalesce(ready_at, now())   else ready_at end,
         completed_at = case when p_status = 'completed' then coalesce(completed_at, now()) else completed_at end,
         -- 0061: preparation ENDS at the pass. Stamp at 'ready' (from the 0037
         -- pickup basis: started_at pre-update, created_at when never picked
         -- up); the completed branch survives only as a fallback for legacy
         -- rows that reached 'ready' before this migration.
         actual_prep_seconds = case
           when p_status = 'ready'
             then extract(epoch from now() - coalesce(started_at, created_at))::int
           when p_status = 'completed'
             then coalesce(actual_prep_seconds,
                           extract(epoch from now() - coalesce(started_at, created_at))::int)
           else actual_prep_seconds end,
         device_id    = coalesce(p_device_id, device_id),
         last_actor_label = coalesce(p_actor_label, last_actor_label)
   where id = p_ticket_id
   returning * into v;

  -- Mirror onto the order (guest status page reads orders.status).
  update orders
     set status = case p_status
                    when 'preparing' then 'preparing'::order_status
                    when 'ready'     then 'ready'::order_status
                    when 'completed' then 'served'::order_status
                  end
   where id = v.order_id and status <> 'voided';

  if p_status = 'ready' then
    update order_items set ready_at = now()
     where order_id = v.order_id and not voided and ready_at is null;
  end if;

  return jsonb_build_object('duplicate', false, 'ticket_id', v.id, 'status', v.status,
    'actual_prep_seconds', v.actual_prep_seconds);
end $tkt_0061$;
