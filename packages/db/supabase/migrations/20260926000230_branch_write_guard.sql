set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0230 (multi-venue audit, 2026-09-26): the branch guard lives on the tables.
--
-- The audit found about seventy staff RPCs that update or delete a branch's
-- rows with a role check and no branch check (set_recipe, upsert_menu_item,
-- upsert_court, delete_court, mark_reservation, cancel_reservation,
-- move_reservation, …), and nothing stopping one branch's row from pointing at
-- another's: a guest order at branch A could carry B's menu items (priced at B,
-- stock taken from B's batches, filed at A), a recipe could consume another
-- branch's ingredient, a series could book another branch's court. Re-issuing
-- every body would leave the next new RPC unguarded, so the rule is enforced
-- once, per row, by app.trg_branch_guard (BEFORE INSERT/UPDATE/DELETE, named
-- zz_ so it runs after every other BEFORE trigger has filled venue_id):
--
--   (1) Same branch (everyone: staff, guests, cron, service role). Each link
--       the trigger is told about (TG_ARGV pairs: parent table, column) must
--       name a row of the row's own branch. A child table without venue_id
--       takes its branch from its first parent. A NULL link, a parent with no
--       branch (a chain-wide promotion) or a parent already gone (cascade) is
--       skipped. Unchanged links are not re-checked on UPDATE.
--   (2) Staff write only where they work. A signed-in staff member may write a
--       row only when its branch is the one a definer body asserted after its
--       own guard (app.venue_id, the 0217 pattern), or the row is their own as
--       a guest (their booking, table session or waiter call), or
--       app.is_staff_at(branch) — the owner at every branch that is not
--       closed, anyone else at their open or preparing branches. The owner may
--       still remove a membership or rota row at a closed branch.
--
-- Guests, cron and the service role pass (2): their paths are anchored by the
-- token, session or row they act on. Both refusals raise VENUE_MISMATCH.
-- System tables written only by cron or the service role (audit_log,
-- degraded_periods, telegram_*, analytics_insights, analytics_patterns) carry
-- no guard; manager_alerts and analytics_insight_rejections are guarded on
-- update and delete (a staff insert lands at the writer's branch by default).
--
-- Cost: one jsonb image of the row and one primary-key lookup per link that
-- changed, plus two small lookups for a staff writer. The hot parents are
-- static queries (cached plans); the rest go through EXECUTE.

-- The branch of one row, by table name and uuid id. Tables without venue_id
-- take their parent's. NULL when the row is gone or has no branch.
create or replace function app.row_venue(p_table text, p_id uuid) returns uuid
language plpgsql stable security definer set search_path = public as $row_venue_0230$
declare
  v uuid;
begin
  if p_id is null then
    return null;
  end if;
  case p_table
    when 'orders'             then select venue_id into v from orders where id = p_id;
    when 'tabs'               then select venue_id into v from tabs where id = p_id;
    when 'tickets'            then select venue_id into v from tickets where id = p_id;
    when 'menu_items'         then select venue_id into v from menu_items where id = p_id;
    when 'ingredients'        then select venue_id into v from ingredients where id = p_id;
    when 'stock_batches'      then select venue_id into v from stock_batches where id = p_id;
    when 'day_sessions'       then select venue_id into v from day_sessions where id = p_id;
    when 'till_shifts'        then select venue_id into v from till_shifts where id = p_id;
    when 'payments'           then select venue_id into v from payments where id = p_id;
    when 'refunds'            then select venue_id into v from refunds where id = p_id;
    when 'modifier_groups'    then select venue_id into v from modifier_groups where id = p_id;
    when 'guest_sessions'     then select venue_id into v from guest_sessions where id = p_id;
    when 'cafe_tables'        then select venue_id into v from cafe_tables where id = p_id;
    when 'menu_item_variants' then
      select mi.venue_id into v from menu_item_variants x join menu_items mi on mi.id = x.item_id where x.id = p_id;
    when 'modifiers' then
      select g.venue_id into v from modifiers x join modifier_groups g on g.id = x.group_id where x.id = p_id;
    when 'order_items' then
      select o.venue_id into v from order_items x join orders o on o.id = x.order_id where x.id = p_id;
    when 'tab_adjustments' then
      select t.venue_id into v from tab_adjustments x join tabs t on t.id = x.tab_id where x.id = p_id;
    when 'protocol_template_steps' then
      select t.venue_id into v from protocol_template_steps x join protocol_templates t on t.id = x.template_id where x.id = p_id;
    when 'protocol_run_steps' then
      select r.venue_id into v from protocol_run_steps x join protocol_runs r on r.id = x.run_id where x.id = p_id;
    else
      execute format('select venue_id from public.%I where id = $1', p_table) into v using p_id;
  end case;
  return v;
end
$row_venue_0230$;

comment on function app.row_venue(text, uuid) is
  '0230. The branch of one row (by table and uuid id); child tables take their parent''s. Internal (trg_branch_guard).';

revoke all on function app.row_venue(text, uuid) from public, anon, authenticated;

create or replace function app.trg_branch_guard() returns trigger
language plpgsql security definer set search_path = public as $trg_branch_guard_0230$
declare
  v_row    jsonb;
  v_old    jsonb;
  v_scoped boolean := tg_argv[0] = 'scoped';
  v_venue  uuid;
  v_prev   uuid;
  v_pv     uuid;
  v_i      int := 1;
  v_col    text;
  v_id     text;
  v_uid    uuid := auth.uid();
  v_staff  boolean;
  v_check  uuid;
begin
  v_staff := v_uid is not null and app.staff_role() is not null;
  -- A delete only needs (2).
  if tg_op = 'DELETE' and not v_staff then
    return old;
  end if;

  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
  end if;
  if v_scoped then
    v_venue := (v_row ->> 'venue_id')::uuid;
    if tg_op = 'UPDATE' then
      v_prev := (v_old ->> 'venue_id')::uuid;
    end if;
  end if;

  -- (1) every link names a row of the same branch.
  while v_i < tg_nargs loop
    v_col := tg_argv[v_i + 1];
    v_id := v_row ->> v_col;
    if v_id is not null
       and (tg_op = 'INSERT'
            or (tg_op = 'UPDATE' and (v_id is distinct from (v_old ->> v_col) or v_venue is distinct from v_prev))
            or v_venue is null) then
      v_pv := app.row_venue(tg_argv[v_i], v_id::uuid);
      if v_pv is not null then
        if v_venue is null then
          v_venue := v_pv;
          exit when tg_op = 'DELETE';
        elsif v_venue <> v_pv and tg_op <> 'DELETE' then
          raise exception 'VENUE_MISMATCH' using errcode = 'P0001',
            detail = format('%s.%s names a row of another branch', tg_table_name, v_col);
        end if;
      end if;
    end if;
    v_i := v_i + 2;
  end loop;

  -- (2) staff write only where they work.
  if v_staff then
    foreach v_check in array array[v_venue, case when v_prev is distinct from v_venue then v_prev end] loop
      continue when v_check is null;
      continue when v_check::text = current_setting('app.venue_id', true);
      continue when tg_table_name in ('reservations', 'reservation_series')
                    and v_row ->> 'guest_id' = v_uid::text;
      continue when tg_table_name = 'guest_sessions' and v_row ->> 'auth_user_id' = v_uid::text;
      continue when tg_table_name = 'waiter_calls'
                    and exists (select 1 from guest_sessions g
                                 where g.id = (v_row ->> 'guest_session_id')::uuid
                                   and g.auth_user_id = v_uid);
      continue when tg_op = 'DELETE' and tg_table_name in ('staff_venues', 'station_staff')
                    and app.is_staff('owner');
      continue when app.is_staff_at(v_check, variadic enum_range(null::staff_role));
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001',
        detail = format('%s: another branch''s row', tg_table_name);
    end loop;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$trg_branch_guard_0230$;

comment on function app.trg_branch_guard() is
  '0230. BEFORE row trigger (zz_branch_guard): links name rows of the same branch (everyone), and staff write only at a branch they work at or one a definer body asserted. TG_ARGV: ''scoped''|''child'', then (parent table, column) pairs. Raises VENUE_MISMATCH.';

revoke all on function app.trg_branch_guard() from public, anon, authenticated;

-- The guarded tables. Generated from the live foreign keys on 2026-09-26: every
-- branch table, and every child table whose parent carries venue_id.

drop trigger if exists zz_branch_guard on public.rate_rules;
create trigger zz_branch_guard before insert or update or delete on public.rate_rules
  for each row execute function app.trg_branch_guard('scoped', 'courts', 'court_id');
drop trigger if exists zz_branch_guard on public.reservations;
create trigger zz_branch_guard before insert or update or delete on public.reservations
  for each row execute function app.trg_branch_guard('scoped', 'rate_rules', 'rate_rule_id', 'reservation_series', 'series_id', 'protocol_runs', 'protocol_run_id');
drop trigger if exists zz_branch_guard on public.menu_categories;
create trigger zz_branch_guard before insert or update or delete on public.menu_categories
  for each row execute function app.trg_branch_guard('scoped', 'tax_groups', 'tax_group_id');
drop trigger if exists zz_branch_guard on public.menu_items;
create trigger zz_branch_guard before insert or update or delete on public.menu_items
  for each row execute function app.trg_branch_guard('scoped', 'menu_categories', 'category_id', 'protocol_runs', 'release_run_id');
drop trigger if exists zz_branch_guard on public.tabs;
create trigger zz_branch_guard before insert or update or delete on public.tabs
  for each row execute function app.trg_branch_guard('scoped', 'cafe_tables', 'table_id', 'day_sessions', 'day_session_id', 'tabs', 'merged_into_tab_id');
drop trigger if exists zz_branch_guard on public.orders;
create trigger zz_branch_guard before insert or update or delete on public.orders
  for each row execute function app.trg_branch_guard('scoped', 'guest_sessions', 'guest_session_id');
drop trigger if exists zz_branch_guard on public.tickets;
create trigger zz_branch_guard before insert or update or delete on public.tickets
  for each row execute function app.trg_branch_guard('scoped', 'orders', 'order_id');
drop trigger if exists zz_branch_guard on public.payments;
create trigger zz_branch_guard before insert or update or delete on public.payments
  for each row execute function app.trg_branch_guard('scoped', 'day_sessions', 'day_session_id', 'tabs', 'tab_id', 'till_shifts', 'till_shift_id');
drop trigger if exists zz_branch_guard on public.refunds;
create trigger zz_branch_guard before insert or update or delete on public.refunds
  for each row execute function app.trg_branch_guard('scoped', 'payments', 'payment_id', 'till_shifts', 'till_shift_id');
drop trigger if exists zz_branch_guard on public.waiter_calls;
create trigger zz_branch_guard before insert or update or delete on public.waiter_calls
  for each row execute function app.trg_branch_guard('scoped', 'cafe_tables', 'table_id', 'guest_sessions', 'guest_session_id');
drop trigger if exists zz_branch_guard on public.ingredients;
create trigger zz_branch_guard before insert or update or delete on public.ingredients
  for each row execute function app.trg_branch_guard('scoped', 'suppliers', 'supplier_id');
drop trigger if exists zz_branch_guard on public.deliveries;
create trigger zz_branch_guard before insert or update or delete on public.deliveries
  for each row execute function app.trg_branch_guard('scoped', 'suppliers', 'supplier_id');
drop trigger if exists zz_branch_guard on public.stock_batches;
create trigger zz_branch_guard before insert or update or delete on public.stock_batches
  for each row execute function app.trg_branch_guard('scoped', 'ingredients', 'ingredient_id', 'stock_batches', 'origin_batch_id');
drop trigger if exists zz_branch_guard on public.stock_movements;
create trigger zz_branch_guard before insert or update or delete on public.stock_movements
  for each row execute function app.trg_branch_guard('scoped', 'tickets', 'ticket_id', 'refunds', 'refund_id', 'ingredients', 'ingredient_id', 'stock_batches', 'batch_id', 'stock_counts', 'count_id');
drop trigger if exists zz_branch_guard on public.reservation_series;
create trigger zz_branch_guard before insert or update or delete on public.reservation_series
  for each row execute function app.trg_branch_guard('scoped', 'courts', 'court_id');
drop trigger if exists zz_branch_guard on public.marketing_campaigns;
create trigger zz_branch_guard before insert or update or delete on public.marketing_campaigns
  for each row execute function app.trg_branch_guard('scoped', 'menu_items', 'menu_item_id', 'promotions', 'promotion_id', 'marketing_audiences', 'audience_id', 'protocol_runs', 'protocol_run_id');
drop trigger if exists zz_branch_guard on public.protocol_runs;
create trigger zz_branch_guard before insert or update or delete on public.protocol_runs
  for each row execute function app.trg_branch_guard('scoped', 'menu_items', 'menu_item_id', 'promotions', 'promotion_id', 'protocol_templates', 'template_id');
drop trigger if exists zz_branch_guard on public.checklist_runs;
create trigger zz_branch_guard before insert or update or delete on public.checklist_runs
  for each row execute function app.trg_branch_guard('scoped', 'checklist_templates', 'template_id');
drop trigger if exists zz_branch_guard on public.purchases;
create trigger zz_branch_guard before insert or update or delete on public.purchases
  for each row execute function app.trg_branch_guard('scoped', 'deliveries', 'delivery_id');
drop trigger if exists zz_branch_guard on public.shopping_items;
create trigger zz_branch_guard before insert or update or delete on public.shopping_items
  for each row execute function app.trg_branch_guard('scoped', 'ingredients', 'ingredient_id', 'purchases', 'purchase_id');
drop trigger if exists zz_branch_guard on public.release_ideas;
create trigger zz_branch_guard before insert or update or delete on public.release_ideas
  for each row execute function app.trg_branch_guard('scoped', 'protocol_runs', 'run_id');
drop trigger if exists zz_branch_guard on public.release_reviews;
create trigger zz_branch_guard before insert or update or delete on public.release_reviews
  for each row execute function app.trg_branch_guard('scoped', 'menu_items', 'menu_item_id', 'protocol_runs', 'run_id');
drop trigger if exists zz_branch_guard on public.release_notes;
create trigger zz_branch_guard before insert or update or delete on public.release_notes
  for each row execute function app.trg_branch_guard('scoped', 'menu_items', 'menu_item_id', 'protocol_runs', 'run_id');
drop trigger if exists zz_branch_guard on public.hiring_candidates;
create trigger zz_branch_guard before insert or update or delete on public.hiring_candidates
  for each row execute function app.trg_branch_guard('scoped', 'protocol_runs', 'run_id');
drop trigger if exists zz_branch_guard on public.recipe_change_requests;
create trigger zz_branch_guard before insert or update or delete on public.recipe_change_requests
  for each row execute function app.trg_branch_guard('scoped', 'ingredients', 'output_ingredient_id');
drop trigger if exists zz_branch_guard on public.marketing_requests;
create trigger zz_branch_guard before insert or update or delete on public.marketing_requests
  for each row execute function app.trg_branch_guard('scoped', 'menu_items', 'menu_item_id');
drop trigger if exists zz_branch_guard on public.incident_reports;
create trigger zz_branch_guard before insert or update or delete on public.incident_reports
  for each row execute function app.trg_branch_guard('scoped', 'courts', 'court_id');
drop trigger if exists zz_branch_guard on public.marketing_content;
create trigger zz_branch_guard before insert or update or delete on public.marketing_content
  for each row execute function app.trg_branch_guard('scoped', 'menu_items', 'menu_item_id', 'marketing_campaigns', 'campaign_id');
drop trigger if exists zz_branch_guard on public.till_shifts;
create trigger zz_branch_guard before insert or update or delete on public.till_shifts
  for each row execute function app.trg_branch_guard('scoped', 'day_sessions', 'day_session_id', 'till_shifts', 'handover_from_shift_id');
drop trigger if exists zz_branch_guard on public.cafe_settings;
create trigger zz_branch_guard before insert or update or delete on public.cafe_settings
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.cafe_tables;
create trigger zz_branch_guard before insert or update or delete on public.cafe_tables
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.checklist_templates;
create trigger zz_branch_guard before insert or update or delete on public.checklist_templates
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.courts;
create trigger zz_branch_guard before insert or update or delete on public.courts
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.day_sessions;
create trigger zz_branch_guard before insert or update or delete on public.day_sessions
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.device_heartbeats;
create trigger zz_branch_guard before insert or update or delete on public.device_heartbeats
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.guest_sessions;
create trigger zz_branch_guard before insert or update or delete on public.guest_sessions
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.marketing_audiences;
create trigger zz_branch_guard before insert or update or delete on public.marketing_audiences
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.marketing_notes;
create trigger zz_branch_guard before insert or update or delete on public.marketing_notes
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.modifier_groups;
create trigger zz_branch_guard before insert or update or delete on public.modifier_groups
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.promotions;
create trigger zz_branch_guard before insert or update or delete on public.promotions
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.protocol_templates;
create trigger zz_branch_guard before insert or update or delete on public.protocol_templates
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.salary_deductions;
create trigger zz_branch_guard before insert or update or delete on public.salary_deductions
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.staff_breaks;
create trigger zz_branch_guard before insert or update or delete on public.staff_breaks
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.staff_media_uploads;
create trigger zz_branch_guard before insert or update or delete on public.staff_media_uploads
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.staff_suggestions;
create trigger zz_branch_guard before insert or update or delete on public.staff_suggestions
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.staff_venues;
create trigger zz_branch_guard before insert or update or delete on public.staff_venues
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.station_staff;
create trigger zz_branch_guard before insert or update or delete on public.station_staff
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.stations;
create trigger zz_branch_guard before insert or update or delete on public.stations
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.stock_counts;
create trigger zz_branch_guard before insert or update or delete on public.stock_counts
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.stock_transfers;
create trigger zz_branch_guard before insert or update or delete on public.stock_transfers
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.suppliers;
create trigger zz_branch_guard before insert or update or delete on public.suppliers
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.tax_groups;
create trigger zz_branch_guard before insert or update or delete on public.tax_groups
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.teachings;
create trigger zz_branch_guard before insert or update or delete on public.teachings
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.venue_settings;
create trigger zz_branch_guard before insert or update or delete on public.venue_settings
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.manager_alerts;
create trigger zz_branch_guard before update or delete on public.manager_alerts
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.analytics_insight_rejections;
create trigger zz_branch_guard before update or delete on public.analytics_insight_rejections
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.rate_rule_prices;
create trigger zz_branch_guard before insert or update or delete on public.rate_rule_prices
  for each row execute function app.trg_branch_guard('child', 'rate_rules', 'rule_id');
drop trigger if exists zz_branch_guard on public.menu_item_variants;
create trigger zz_branch_guard before insert or update or delete on public.menu_item_variants
  for each row execute function app.trg_branch_guard('child', 'menu_items', 'item_id');
drop trigger if exists zz_branch_guard on public.modifiers;
create trigger zz_branch_guard before insert or update or delete on public.modifiers
  for each row execute function app.trg_branch_guard('child', 'modifier_groups', 'group_id');
drop trigger if exists zz_branch_guard on public.menu_item_modifier_groups;
create trigger zz_branch_guard before insert or update or delete on public.menu_item_modifier_groups
  for each row execute function app.trg_branch_guard('child', 'menu_items', 'item_id', 'modifier_groups', 'group_id');
drop trigger if exists zz_branch_guard on public.menu_item_allergens;
create trigger zz_branch_guard before insert or update or delete on public.menu_item_allergens
  for each row execute function app.trg_branch_guard('child', 'menu_items', 'item_id');
drop trigger if exists zz_branch_guard on public.addon_suggestions;
create trigger zz_branch_guard before insert or update or delete on public.addon_suggestions
  for each row execute function app.trg_branch_guard('child', 'menu_items', 'item_id', 'menu_items', 'suggested_item_id');
drop trigger if exists zz_branch_guard on public.order_items;
create trigger zz_branch_guard before insert or update or delete on public.order_items
  for each row execute function app.trg_branch_guard('child', 'orders', 'order_id', 'menu_items', 'menu_item_id', 'menu_item_variants', 'variant_id');
drop trigger if exists zz_branch_guard on public.order_item_modifiers;
create trigger zz_branch_guard before insert or update or delete on public.order_item_modifiers
  for each row execute function app.trg_branch_guard('child', 'order_items', 'order_item_id', 'modifiers', 'modifier_id');
drop trigger if exists zz_branch_guard on public.tab_adjustments;
create trigger zz_branch_guard before insert or update or delete on public.tab_adjustments
  for each row execute function app.trg_branch_guard('child', 'tabs', 'tab_id', 'order_items', 'order_item_id', 'promotions', 'promotion_id');
drop trigger if exists zz_branch_guard on public.refund_items;
create trigger zz_branch_guard before insert or update or delete on public.refund_items
  for each row execute function app.trg_branch_guard('child', 'refunds', 'refund_id', 'order_items', 'order_item_id');
drop trigger if exists zz_branch_guard on public.recipe_lines;
create trigger zz_branch_guard before insert or update or delete on public.recipe_lines
  for each row execute function app.trg_branch_guard('child', 'menu_item_variants', 'variant_id', 'modifiers', 'modifier_id', 'ingredients', 'ingredient_id', 'ingredients', 'output_ingredient_id');
drop trigger if exists zz_branch_guard on public.delivery_lines;
create trigger zz_branch_guard before insert or update or delete on public.delivery_lines
  for each row execute function app.trg_branch_guard('child', 'deliveries', 'delivery_id', 'ingredients', 'ingredient_id');
drop trigger if exists zz_branch_guard on public.stock_count_lines;
create trigger zz_branch_guard before insert or update or delete on public.stock_count_lines
  for each row execute function app.trg_branch_guard('child', 'stock_counts', 'count_id', 'ingredients', 'ingredient_id');
drop trigger if exists zz_branch_guard on public.menu_item_costs;
create trigger zz_branch_guard before insert or update or delete on public.menu_item_costs
  for each row execute function app.trg_branch_guard('child', 'menu_items', 'item_id');
drop trigger if exists zz_branch_guard on public.modifier_reveals;
create trigger zz_branch_guard before insert or update or delete on public.modifier_reveals
  for each row execute function app.trg_branch_guard('child', 'modifier_groups', 'group_id', 'modifiers', 'modifier_id');
drop trigger if exists zz_branch_guard on public.promotion_redemptions;
create trigger zz_branch_guard before insert or update or delete on public.promotion_redemptions
  for each row execute function app.trg_branch_guard('child', 'tabs', 'tab_id', 'promotions', 'promotion_id', 'tab_adjustments', 'adjustment_id');
drop trigger if exists zz_branch_guard on public.marketing_sends;
create trigger zz_branch_guard before insert or update or delete on public.marketing_sends
  for each row execute function app.trg_branch_guard('child', 'marketing_campaigns', 'campaign_id');
drop trigger if exists zz_branch_guard on public.protocol_template_steps;
create trigger zz_branch_guard before insert or update or delete on public.protocol_template_steps
  for each row execute function app.trg_branch_guard('child', 'protocol_templates', 'template_id');
drop trigger if exists zz_branch_guard on public.protocol_template_items;
create trigger zz_branch_guard before insert or update or delete on public.protocol_template_items
  for each row execute function app.trg_branch_guard('child', 'protocol_template_steps', 'step_id');
drop trigger if exists zz_branch_guard on public.protocol_run_steps;
create trigger zz_branch_guard before insert or update or delete on public.protocol_run_steps
  for each row execute function app.trg_branch_guard('child', 'protocol_runs', 'run_id');
drop trigger if exists zz_branch_guard on public.protocol_submissions;
create trigger zz_branch_guard before insert or update or delete on public.protocol_submissions
  for each row execute function app.trg_branch_guard('child', 'protocol_runs', 'run_id');
drop trigger if exists zz_branch_guard on public.protocol_run_items;
create trigger zz_branch_guard before insert or update or delete on public.protocol_run_items
  for each row execute function app.trg_branch_guard('child', 'protocol_run_steps', 'run_step_id');
drop trigger if exists zz_branch_guard on public.checklist_template_items;
create trigger zz_branch_guard before insert or update or delete on public.checklist_template_items
  for each row execute function app.trg_branch_guard('child', 'checklist_templates', 'template_id');
drop trigger if exists zz_branch_guard on public.checklist_run_items;
create trigger zz_branch_guard before insert or update or delete on public.checklist_run_items
  for each row execute function app.trg_branch_guard('child', 'checklist_runs', 'run_id');
drop trigger if exists zz_branch_guard on public.purchase_lines;
create trigger zz_branch_guard before insert or update or delete on public.purchase_lines
  for each row execute function app.trg_branch_guard('child', 'purchases', 'purchase_id', 'ingredients', 'ingredient_id', 'shopping_items', 'shopping_item_id');
drop trigger if exists zz_branch_guard on public.marketing_content_versions;
create trigger zz_branch_guard before insert or update or delete on public.marketing_content_versions
  for each row execute function app.trg_branch_guard('child', 'marketing_content', 'content_id');
drop trigger if exists zz_branch_guard on public.stock_transfer_lines;
create trigger zz_branch_guard before insert or update or delete on public.stock_transfer_lines
  for each row execute function app.trg_branch_guard('child', 'stock_transfers', 'transfer_id', 'ingredients', 'ingredient_id');
