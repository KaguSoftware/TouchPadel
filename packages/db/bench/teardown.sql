-- BENCH TEARDOWN — removes everything bench/seed.sql wrote, plus anything that
-- has since attached itself to a bench row. Apply with:
--
--     pnpm --filter @touch/db bench:teardown
--
-- Safe to run when nothing is seeded: every delete is a predicate that matches
-- no rows. Safe to run twice.
--
-- WHY IT DELETES BY PREFIX AND NOT BY NAME. `bec4` is reserved for bench rows
-- (see seed.sql), so `id::text like 'bec4%'` cannot reach a fixture (f1f7), a
-- test probe (ee57), a client row (70c4) or anything a live suite created
-- elsewhere. A name- or label-based sweep would be one careless LIKE away from
-- deleting real courts.
--
-- THE PART THAT IS NOT A PREFIX MATCH. Two bench rows are open invitations for
-- other code to attach to them:
--
--   * the open bench DAY. tests/helpers.ts ensureOpenDay returns whatever day is
--     already open, so any cafe suite run between bench:seed and bench:teardown
--     opens its tabs, orders, tickets, payments, refunds, adjustments and stock
--     movements on the bench day — with server-generated ids the prefix cannot
--     see.
--   * the bench COURTS, where a bench RUN's hold_slot and confirm_booking write
--     reservations of their own.
--
-- So the day and the courts are torn down by their dependency CLOSURE, not by
-- id. The first version of this file deleted by prefix alone and aborted on
-- stock_movements_order_item_id_fkey, then on refund_items_order_item_id_fkey —
-- and because the whole thing is one transaction, an abort meant NOTHING was
-- removed while the script still looked like it had run.
--
-- APPEND-ONLY TABLES. payments, refunds, stock_movements and sync_replays each
-- carry a trigger (app.forbid_mutation) that raises on any UPDATE or DELETE:
-- they are ledgers, by design. Teardown disables those four for the length of
-- THIS transaction and re-arms them before the commit. ALTER TABLE is
-- transactional, so a rollback re-arms them too. audit_log is append-only as
-- well and is left strictly alone — the record that a bench run happened is not
-- something to erase.

begin;

alter table public.payments        disable trigger payments_ao;
alter table public.refunds         disable trigger refunds_ao;
alter table public.stock_movements disable trigger stock_movements_ao;
alter table public.sync_replays    disable trigger sync_replays_ao;

-- ---------------------------------------------------------------------------
-- The closure, collected once so the delete order below reads as an order and
-- not as nine copies of the same join.
-- ---------------------------------------------------------------------------
create temp table bench_tabs on commit drop as
select t.id
  from tabs t
 where t.id::text like 'bec4%'
    or t.day_session_id::text like 'bec4%';

create temp table bench_orders on commit drop as
select o.id
  from orders o
 where o.id::text like 'bec4%'
    or o.tab_id in (select id from bench_tabs);

create temp table bench_items on commit drop as
select oi.id
  from order_items oi
 where oi.id::text like 'bec4%'
    or oi.order_id in (select id from bench_orders);

create temp table bench_tickets on commit drop as
select tk.id
  from tickets tk
 where tk.id::text like 'bec4%'
    or tk.order_id in (select id from bench_orders);

create temp table bench_payments on commit drop as
select p.id
  from payments p
 where p.id::text like 'bec4%'
    or p.tab_id in (select id from bench_tabs)
    or p.day_session_id::text like 'bec4%';

-- ---------------------------------------------------------------------------
-- Leaves first.
-- ---------------------------------------------------------------------------
delete from refund_items where order_item_id in (select id from bench_items);
delete from refund_items where refund_id in (
  select r.id from refunds r where r.payment_id in (select id from bench_payments));
delete from refunds where payment_id in (select id from bench_payments);

delete from stock_movements where order_item_id in (select id from bench_items);
delete from stock_movements where ticket_id in (select id from bench_tickets);

-- promotion_redemptions points at BOTH the tab and the adjustment that granted
-- the discount (promotion_redemptions_adjustment_id_fkey), so it has to go
-- before tab_adjustments, not after the tabs.
delete from promotion_redemptions where tab_id in (select id from bench_tabs);
delete from promotion_redemptions where adjustment_id in (
  select a.id from tab_adjustments a
   where a.tab_id in (select id from bench_tabs)
      or a.order_item_id in (select id from bench_items));
delete from tab_adjustments where order_item_id in (select id from bench_items);
delete from tab_adjustments where tab_id in (select id from bench_tabs);

delete from order_item_modifiers where order_item_id in (select id from bench_items);
delete from order_items where id in (select id from bench_items);
delete from tickets     where id in (select id from bench_tickets);
delete from payments    where id in (select id from bench_payments);
delete from orders      where id in (select id from bench_orders);

-- tabs.merged_into_tab_id is a self reference with no cascade, so break it
-- before the rows go.
update tabs set merged_into_tab_id = null
 where merged_into_tab_id in (select id from bench_tabs);
delete from tabs where id in (select id from bench_tabs);
delete from day_sessions where id::text like 'bec4%';

-- ---------------------------------------------------------------------------
-- Courts, their reservations and the 300 bench identities.
-- ---------------------------------------------------------------------------
delete from reservations
 where court_id in (select id from courts where id::text like 'bec4%');
delete from reservations where id::text like 'bec4%';
delete from reservations where guest_id::text like 'bec4%';
delete from reservation_series
 where guest_id::text like 'bec4%'
    or court_id in (select id from courts where id::text like 'bec4%');

delete from notification_outbox   where profile_id::text like 'bec4%';
delete from customer_notes        where customer_id::text like 'bec4%';
delete from customer_flags        where customer_id::text like 'bec4%';
delete from promotion_redemptions where customer_id::text like 'bec4%';
update guest_sessions set linked_profile_id = null
 where linked_profile_id::text like 'bec4%';
delete from profiles where id::text like 'bec4%';

delete from analytics_insights where court_id in (select id from courts where id::text like 'bec4%');
delete from analytics_patterns where court_id in (select id from courts where id::text like 'bec4%');
delete from rate_rule_prices
 where rule_id in (select id from rate_rules where id::text like 'bec4%');
delete from rate_rules where id::text like 'bec4%';
delete from courts     where id::text like 'bec4%';

-- ---------------------------------------------------------------------------
-- Bench menu and the bench cafe table.
-- ---------------------------------------------------------------------------
delete from menu_item_modifier_groups
 where item_id::text like 'bec4%' or group_id::text like 'bec4%';
delete from menu_item_allergens where item_id::text like 'bec4%';
delete from menu_item_costs     where item_id::text like 'bec4%';
delete from addon_suggestions
 where item_id::text like 'bec4%' or suggested_item_id::text like 'bec4%';
delete from modifier_reveals where modifier_id::text like 'bec4%';
delete from modifiers          where id::text like 'bec4%';
delete from modifier_groups    where id::text like 'bec4%';
delete from menu_item_variants where id::text like 'bec4%';
delete from menu_items         where id::text like 'bec4%';
delete from menu_categories    where id::text like 'bec4%';

delete from waiter_calls   where table_id::text like 'bec4%';
delete from guest_sessions where table_id::text like 'bec4%';
delete from cafe_tables    where id::text like 'bec4%';

-- Replay bookkeeping written by replay.drain_500. sync_replays is keyed on
-- device_id, not on a uuid, so the BENCH1 station id is the only handle there is.
delete from sync_replays where device_id = 'BENCH1';

-- The fifty throwaway guests bench/areas/booking.ts creates through
-- tests/helpers.ts guestClient(svc, 'bench') — real auth.users with real
-- profiles, one set per run, and nothing else deletes them. The tag is in the
-- address (`guest-bench-<n>-<ms>@test.touch.local`), which is narrow enough
-- that it cannot reach another suite's guests (`guest-conc0-…`, `guest-flow-…`).
-- Their reservations are already gone: every one was on a bench court.
delete from profiles p
 where exists (select 1 from auth.users u
                where u.id = p.id and u.email like 'guest-bench-%@test.touch.local');
delete from auth.users where email like 'guest-bench-%@test.touch.local';

alter table public.payments        enable trigger payments_ao;
alter table public.refunds         enable trigger refunds_ao;
alter table public.stock_movements enable trigger stock_movements_ao;
alter table public.sync_replays    enable trigger sync_replays_ao;

commit;

-- Give the planner back the statistics of an empty bench. Outside the
-- transaction: ANALYZE is allowed inside one, but there is nothing to roll back
-- here and keeping the write transaction short is free.
analyze reservations;
analyze order_items;
analyze orders;
analyze tabs;
analyze payments;
analyze day_sessions;
analyze courts;
analyze profiles;
