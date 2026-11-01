set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0399 kitchen_reach — "not received by the kitchen" on every station
-- (Majed, 2026-11-01, launch finding F-11: the flag shows wherever an order
-- can be sent to the kitchen, the desk and shop stations too, not only the
-- café till).
--
-- 0396 stamps tickets.kds_seen_at when a kitchen screen first draws a
-- ticket, and the till read its branch's recent tickets straight from the
-- table to flag the orders no kitchen screen has drawn. That read is
-- tickets_staff_read, which admits the kitchen, cashier, manager and owner
-- roles only, so on the court desk (and for any role the policy leaves out)
-- the flag could never appear.
--
-- app.kitchen_reach(p_since) is the one read every station uses instead: any
-- active staff member, the branches in scope (app.visible_venue_ids(), so a
-- station sees its own branch), tickets created since p_since (at most three
-- hours back, at most 500 rows, newest first), with only what the flag needs:
-- the ticket, its status, when it was made and first drawn, its order's tab
-- and the order's idempotency key (the LAN ref). No item, price, guest or
-- staff column leaves it.
--
-- covered by packages/db/tests/kitchen-reach.test.ts

create or replace function app.kitchen_reach(p_since timestamptz default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $kitchen_reach_0399$
declare
  v_since  timestamptz := greatest(coalesce(p_since, now() - interval '2 hours'), now() - interval '3 hours');
  v_venues uuid[];
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venues := (select app.visible_venue_ids())::uuid[];

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',              r.id,
             'status',          r.status,
             'created_at',      r.created_at,
             'kds_seen_at',     r.kds_seen_at,
             'tab_id',          r.tab_id,
             'idempotency_key', r.idempotency_key)
           order by r.created_at desc)
      from (
        select t.id, t.status, t.created_at, t.kds_seen_at, o.tab_id, o.idempotency_key
          from tickets t
          join orders o on o.id = t.order_id
         where t.venue_id = any (v_venues)
           and t.created_at >= v_since
         order by t.created_at desc
         limit 500
      ) r
  ), '[]'::jsonb);
end $kitchen_reach_0399$;

comment on function app.kitchen_reach(timestamptz) is
  '0399 (F-11). Any active staff: the branch''s tickets since p_since (at most 3 h back, 500 rows), each {id, status, created_at, kds_seen_at, tab_id, idempotency_key}: what the operator''s "not received by the kitchen" flag reads on every station. Read-only.';

revoke all on function app.kitchen_reach(timestamptz) from public, anon;
grant execute on function app.kitchen_reach(timestamptz) to authenticated;
