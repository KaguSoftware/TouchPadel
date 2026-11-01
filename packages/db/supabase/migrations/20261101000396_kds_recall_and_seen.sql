set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0396 kds_recall_and_seen — a kitchen ticket marked Complete by mistake can be
-- brought back, and the till can tell that an order never reached a kitchen
-- screen (Majed, 2026-11-01, the launch findings F-57 "a completed ticket can be
-- brought back for 10 minutes" and F-11 "flag that an order did not reach the
-- kitchen").
--
--   1. tickets.kds_seen_at: when a kitchen screen first showed the ticket.
--      NULL until then. Stamped by app.kds_ack_tickets, never by a bump, so a
--      ticket that went from the till straight to "ready" at the till still
--      reads as never seen on a screen. Not in the 'kds' broadcast (rt_ticket
--      fires on status only) and not money; the till reads it through
--      tickets_staff_read, which already covers the cashier.
--   2. app.kds_ack_tickets(p_ticket_ids uuid[]): the cloud kitchen board calls
--      it, batched, for the tickets it has drawn. The kitchen list of
--      set_ticket_status; only tickets of a branch the caller is in scope for
--      (app.visible_venue_ids()) and works at as a kitchen role are stamped;
--      anything else in the list is skipped, not refused, so one stale id from
--      another branch never loses the rest. coalesce keeps the FIRST sighting,
--      so a board that redraws every five seconds changes nothing. Returns the
--      number of tickets newly stamped. State-idempotent: no key.
--   3. app.recall_ticket(p_ticket_id, p_device_id): Complete undone. Same role
--      list as set_ticket_status (latest 0217); a ticket outside the caller's
--      branch scope is TICKET_NOT_FOUND, one at a branch they do not work at is
--      VENUE_MISMATCH. Only a ticket completed in the last ten minutes:
--      TICKET_RECALL_EXPIRED after that (the board offers the button for the
--      same ten minutes). It goes back to 'ready' (completed_at cleared, the
--      order back from 'served' to 'ready'); a ticket already 'ready' answers
--      {duplicate: true} (a replay of a queued recall, or a second screen), and
--      any other status is INVALID_TRANSITION. State-idempotent, so it rides
--      the offline queue as 'rpc.queued' with no key of its own (0395 lists it
--      in app.queueable_rpcs). Lock order: the order row, then the ticket
--      (orders → tickets, packages/db/CLAUDE.md "RPCs").

-- ===========================================================================
-- 1. The column
-- ===========================================================================
alter table tickets add column if not exists kds_seen_at timestamptz;

comment on column tickets.kds_seen_at is
  '0396 (F-11): when a kitchen screen first showed this ticket (app.kds_ack_tickets); NULL = no '
  'kitchen screen has shown it yet. The till flags an order whose ticket stays NULL.';

-- ===========================================================================
-- 2. app.kds_ack_tickets
-- ===========================================================================
create or replace function app.kds_ack_tickets(p_ticket_ids uuid[])
returns jsonb
language plpgsql security definer set search_path = public as $kds_ack_tickets_0396$
declare
  v_venue uuid;
  v_n     int;
  v_total int := 0;
begin
  if not app.is_staff('prep','cashier','manager','owner','head_barista','barista','assistant_barista','head_chef','chef') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_ticket_ids is null or cardinality(p_ticket_ids) = 0 then
    return jsonb_build_object('acked', 0);
  end if;
  if cardinality(p_ticket_ids) > 500 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'at most 500 tickets per call';
  end if;

  -- One branch at a time: the branch guard (0230) reads app.venue_id for the
  -- rows a definer body writes.
  for v_venue in
    select distinct t.venue_id
      from tickets t
     where t.id = any(p_ticket_ids)
       and t.kds_seen_at is null
       and t.venue_id = any((select app.visible_venue_ids())::uuid[])
  loop
    continue when not app.is_staff_at(v_venue, 'prep','cashier','manager','owner','head_barista','barista','assistant_barista','head_chef','chef');
    perform set_config('app.venue_id', v_venue::text, true);
    update tickets
       set kds_seen_at = coalesce(kds_seen_at, now())
     where id = any(p_ticket_ids)
       and venue_id = v_venue
       and kds_seen_at is null;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end loop;

  return jsonb_build_object('acked', v_total);
end $kds_ack_tickets_0396$;

comment on function app.kds_ack_tickets(uuid[]) is
  '0396 (F-11): the cloud kitchen board says which tickets it has drawn. Stamps tickets.kds_seen_at '
  'once (the first sighting) for tickets of a branch in the caller''s scope where they work as a '
  'kitchen role (the set_ticket_status list); other ids are skipped. Returns {acked: n}. At most '
  '500 ids (INVALID_ARGUMENT).';

revoke all on function app.kds_ack_tickets(uuid[]) from public, anon;
grant execute on function app.kds_ack_tickets(uuid[]) to authenticated;

-- ===========================================================================
-- 3. app.recall_ticket
-- ===========================================================================
create or replace function app.recall_ticket(
  p_ticket_id uuid,
  p_device_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $recall_ticket_0396$
declare
  v_venue uuid;
  v_order uuid;
  v       tickets%rowtype;
begin
  if not app.is_staff('prep','cashier','manager','owner','head_barista','barista','assistant_barista','head_chef','chef') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select t.venue_id, t.order_id into v_venue, v_order from tickets t where t.id = p_ticket_id;
  -- Outside the branch in scope reads as not there, as the board would show it.
  if v_order is null or not (v_venue = any((select app.visible_venue_ids())::uuid[])) then
    raise exception 'TICKET_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_venue, 'prep','cashier','manager','owner','head_barista','barista','assistant_barista','head_chef','chef') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  -- orders → tickets.
  perform 1 from orders where id = v_order for update;
  select * into v from tickets where id = p_ticket_id for update;

  if v.status = 'ready' then
    return jsonb_build_object('duplicate', true, 'ticket_id', v.id, 'status', v.status);
  end if;
  if v.status <> 'completed' then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001',
      detail = format('%s -> recall', v.status);
  end if;
  if v.completed_at is null or v.completed_at <= now() - interval '10 minutes' then
    raise exception 'TICKET_RECALL_EXPIRED' using errcode = 'P0001',
      hint = 'a ticket can be brought back for ten minutes after it was completed';
  end if;

  update tickets
     set status       = 'ready',
         completed_at = null,
         ready_at     = coalesce(ready_at, now()),
         device_id    = coalesce(p_device_id, device_id)
   where id = p_ticket_id
   returning * into v;

  -- The guest's order page reads orders.status: served → ready again.
  update orders
     set status = 'ready'::order_status
   where id = v.order_id and status = 'served'::order_status;

  return jsonb_build_object('duplicate', false, 'ticket_id', v.id, 'status', v.status);
end $recall_ticket_0396$;

comment on function app.recall_ticket(uuid, text) is
  '0396 (F-57): bring a ticket marked Complete back to ready, within ten minutes of completing it '
  '(TICKET_RECALL_EXPIRED after). Kitchen list of set_ticket_status at the ticket''s branch; '
  'outside the caller''s branch scope TICKET_NOT_FOUND, a branch they do not work at '
  'VENUE_MISMATCH. Already ready = {duplicate: true}; any status but completed or ready = '
  'INVALID_TRANSITION. The order goes from served back to ready. Queueable (0395).';

revoke all on function app.recall_ticket(uuid, text) from public, anon;
grant execute on function app.recall_ticket(uuid, text) to authenticated;
