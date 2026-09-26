set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0226_staff_reads_follow_scope — multi-venue slice 4 (server), step 5.
--
-- Slice 1 (0136) gave every staff read policy the venue axis
-- `venue_id = any(app.staff_venue_ids())`: every branch the reader works at.
-- Right for a cashier at one branch; wrong for the owner (every branch) and
-- for a manager at two: their till, desk, kitchen board, stock and floor
-- screens would list both branches' tabs, tickets, courts and stock mixed.
--
--   * app.visible_venue_ids(): the branches a staff read covers right now —
--       owner:  the branch named by the x-venue-scope request header (the
--               operator's branch switcher), 'all' for every branch, else the
--               station's branch (x-station-id, 0215), else every branch;
--       member: the header's branch if it is one of theirs, else the branch
--               they are working at (app.resolve_venue: station, only
--               membership), else every branch of theirs;
--       nobody else: none.
--     Always a subset of app.staff_venue_ids(), so no reader ever sees a
--     branch they could not see before; it only narrows.
--   * Every policy whose venue axis read app.staff_venue_ids() (69 of them,
--     every one a SELECT policy) is re-created from its live definition with
--     `(select app.visible_venue_ids())` in its place: one evaluation per
--     statement instead of one per row.
--   * The guest branch of the five catalogue policies (0225) stops applying to
--     staff (`app.staff_role() is null`), so a manager at one branch does not
--     read another open branch's courts, rates or menu through it.
--   * app.report_venues() (0214) becomes: no caller -> every branch, otherwise
--     app.visible_venue_ids(), so a report and the screen around it always
--     agree on the branch.
--   * venue_settings_staff_read (0156), which had no venue axis, follows the
--     scope too; app.resolve_venue (0222) gains step (2c), the x-venue-scope
--     branch, so writes that rely on the column default file at the branch the
--     screens show.

create or replace function app.visible_venue_ids() returns uuid[]
language plpgsql stable security definer set search_path = public as $visible_venue_ids_0226$
declare
  v_raw  text;
  v_one  uuid;
  v_mine uuid[];
begin
  if app.staff_role() is null then
    return '{}'::uuid[];
  end if;
  v_mine := app.staff_venue_ids();

  -- The operator's branch switcher names the scope on every request.
  begin
    v_raw := nullif(btrim(nullif(current_setting('request.headers', true), '')::json ->> 'x-venue-scope'), '');
  exception when others then
    v_raw := null;
  end;
  if v_raw = 'all' and app.is_staff('owner') then
    return v_mine;
  end if;
  if v_raw is not null and v_raw <> 'all' then
    begin
      v_one := v_raw::uuid;
    exception when others then
      v_one := null;
    end;
    if v_one is not null and v_one = any (v_mine) then
      return array[v_one];
    end if;
  end if;

  -- The branch the caller is working at: the station on the request, their
  -- only membership (app.resolve_venue; an owner has none, so a station).
  v_one := app.resolve_venue();
  if v_one is not null and v_one = any (v_mine) then
    return array[v_one];
  end if;
  return v_mine;
end
$visible_venue_ids_0226$;

comment on function app.visible_venue_ids() is
  '0226 (multi-venue). The branches a staff read covers now: the x-venue-scope header''s branch (''all'' = every branch, owner only), else the branch the caller is working at, else every branch of theirs. Always a subset of app.staff_venue_ids(). Called by the staff read policies, so granted to every reading role.';

revoke all on function app.visible_venue_ids() from public;
grant execute on function app.visible_venue_ids() to anon, authenticated, service_role;

create or replace function app.report_venues() returns uuid[]
language plpgsql stable security definer set search_path = public as $report_venues_0226$
begin
  -- No caller (service role, cron): every branch.
  if auth.uid() is null then
    return coalesce((select array_agg(v.id order by v.created_at, v.id) from venues v), '{}'::uuid[]);
  end if;
  return app.visible_venue_ids();
end
$report_venues_0226$;

comment on function app.report_venues() is
  '0214, 0226. The branches a report or analytics read covers: every branch with no caller, else app.visible_venue_ids() (the scope header, the station''s branch, the caller''s branches). Internal.';

revoke all on function app.report_venues() from public, anon, authenticated;

drop policy if exists audit_log_select_mgmt on audit_log;
create policy audit_log_select_mgmt on audit_log for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists cafe_settings_staff_read on cafe_settings;
create policy cafe_settings_staff_read on cafe_settings for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists cafe_tables_staff_read on cafe_tables;
create policy cafe_tables_staff_read on cafe_tables for select to authenticated
  using (((app.staff_role() IS NOT NULL) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists checklist_run_items_mgmt_read on checklist_run_items;
create policy checklist_run_items_mgmt_read on checklist_run_items for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (EXISTS ( SELECT 1
   FROM checklist_runs r
  WHERE ((r.id = checklist_run_items.run_id) AND (r.venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))))));

drop policy if exists checklist_runs_mgmt_read on checklist_runs;
create policy checklist_runs_mgmt_read on checklist_runs for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists checklist_template_items_mgmt_read on checklist_template_items;
create policy checklist_template_items_mgmt_read on checklist_template_items for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (EXISTS ( SELECT 1
   FROM checklist_templates t
  WHERE ((t.id = checklist_template_items.template_id) AND (t.venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))))));

drop policy if exists checklist_templates_mgmt_read on checklist_templates;
create policy checklist_templates_mgmt_read on checklist_templates for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists courts_read on courts;
create policy courts_read on courts for select to anon, authenticated
  using (((is_active AND (app.staff_role() IS NULL) AND (venue_id = ANY (( SELECT app.open_venue_ids() AS open_venue_ids)::uuid[]))) OR ((app.staff_role() IS NOT NULL) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))));

drop policy if exists day_sessions_staff_read on day_sessions;
create policy day_sessions_staff_read on day_sessions for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['cashier'::staff_role, 'court_desk'::staff_role, 'manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists degraded_periods_mgmt_read on degraded_periods;
create policy degraded_periods_mgmt_read on degraded_periods for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists deliveries_mgmt_read on deliveries;
create policy deliveries_mgmt_read on deliveries for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists device_heartbeats_mgmt_read on device_heartbeats;
create policy device_heartbeats_mgmt_read on device_heartbeats for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists guest_sessions_staff_read on guest_sessions;
create policy guest_sessions_staff_read on guest_sessions for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['cashier'::staff_role, 'manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists hiring_candidates_mgmt_read on hiring_candidates;
create policy hiring_candidates_mgmt_read on hiring_candidates for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists incident_reports_mgmt_read on incident_reports;
create policy incident_reports_mgmt_read on incident_reports for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists ingredients_mgmt_read on ingredients;
create policy ingredients_mgmt_read on ingredients for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists manager_alerts_mgmt_read on manager_alerts;
create policy manager_alerts_mgmt_read on manager_alerts for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists marketing_audiences_read on marketing_audiences;
create policy marketing_audiences_read on marketing_audiences for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists marketing_campaigns_read on marketing_campaigns;
create policy marketing_campaigns_read on marketing_campaigns for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists marketing_content_owner_read on marketing_content;
create policy marketing_content_owner_read on marketing_content for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists marketing_content_versions_owner_read on marketing_content_versions;
create policy marketing_content_versions_owner_read on marketing_content_versions for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['owner'::staff_role]) AND (EXISTS ( SELECT 1
   FROM marketing_content c
  WHERE ((c.id = marketing_content_versions.content_id) AND (c.venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))))));

drop policy if exists marketing_notes_mgmt_read on marketing_notes;
create policy marketing_notes_mgmt_read on marketing_notes for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists marketing_requests_mgmt_read on marketing_requests;
create policy marketing_requests_mgmt_read on marketing_requests for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists menu_categories_read on menu_categories;
create policy menu_categories_read on menu_categories for select to anon, authenticated
  using (((is_active AND (app.staff_role() IS NULL) AND (venue_id = ANY (( SELECT app.open_venue_ids() AS open_venue_ids)::uuid[]))) OR ((app.staff_role() IS NOT NULL) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))));

drop policy if exists menu_items_read on menu_items;
create policy menu_items_read on menu_items for select to anon, authenticated
  using (((is_active AND (app.staff_role() IS NULL) AND (venue_id = ANY (( SELECT app.open_venue_ids() AS open_venue_ids)::uuid[]))) OR ((app.staff_role() IS NOT NULL) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))));

drop policy if exists order_item_modifiers_staff_read on order_item_modifiers;
create policy order_item_modifiers_staff_read on order_item_modifiers for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['cashier'::staff_role, 'court_desk'::staff_role, 'manager'::staff_role, 'owner'::staff_role]) AND (EXISTS ( SELECT 1
   FROM (order_items oi
     JOIN orders o ON ((o.id = oi.order_id)))
  WHERE ((oi.id = order_item_modifiers.order_item_id) AND (o.venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))))));

drop policy if exists order_items_staff_read on order_items;
create policy order_items_staff_read on order_items for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['cashier'::staff_role, 'court_desk'::staff_role, 'manager'::staff_role, 'owner'::staff_role]) AND (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND (o.venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))))));

drop policy if exists orders_staff_read on orders;
create policy orders_staff_read on orders for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['cashier'::staff_role, 'court_desk'::staff_role, 'manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists payments_staff_read on payments;
create policy payments_staff_read on payments for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['cashier'::staff_role, 'manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists promotions_staff_read on promotions;
create policy promotions_staff_read on promotions for select to authenticated
  using (((app.staff_role() IS NOT NULL) AND ((venue_id IS NULL) OR (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))));

drop policy if exists protocol_run_items_mgmt_read on protocol_run_items;
create policy protocol_run_items_mgmt_read on protocol_run_items for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (EXISTS ( SELECT 1
   FROM (protocol_run_steps s
     JOIN protocol_runs r ON ((r.id = s.run_id)))
  WHERE ((s.id = protocol_run_items.run_step_id) AND (r.venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))))));

drop policy if exists protocol_run_steps_mgmt_read on protocol_run_steps;
create policy protocol_run_steps_mgmt_read on protocol_run_steps for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (EXISTS ( SELECT 1
   FROM protocol_runs r
  WHERE ((r.id = protocol_run_steps.run_id) AND (r.venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))))));

drop policy if exists protocol_runs_mgmt_read on protocol_runs;
create policy protocol_runs_mgmt_read on protocol_runs for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists protocol_submissions_mgmt_read on protocol_submissions;
create policy protocol_submissions_mgmt_read on protocol_submissions for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (EXISTS ( SELECT 1
   FROM protocol_runs r
  WHERE ((r.id = protocol_submissions.run_id) AND (r.venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))))));

drop policy if exists protocol_template_items_mgmt_read on protocol_template_items;
create policy protocol_template_items_mgmt_read on protocol_template_items for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (EXISTS ( SELECT 1
   FROM (protocol_template_steps s
     JOIN protocol_templates t ON ((t.id = s.template_id)))
  WHERE ((s.id = protocol_template_items.step_id) AND (t.venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))))));

drop policy if exists protocol_template_steps_mgmt_read on protocol_template_steps;
create policy protocol_template_steps_mgmt_read on protocol_template_steps for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (EXISTS ( SELECT 1
   FROM protocol_templates t
  WHERE ((t.id = protocol_template_steps.template_id) AND (t.venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))))));

drop policy if exists protocol_templates_mgmt_read on protocol_templates;
create policy protocol_templates_mgmt_read on protocol_templates for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists purchase_lines_read on purchase_lines;
create policy purchase_lines_read on purchase_lines for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM purchases p
  WHERE ((p.id = purchase_lines.purchase_id) AND ((p.staff_id = auth.uid()) OR (app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (p.venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))))))));

drop policy if exists purchases_mgmt_read on purchases;
create policy purchases_mgmt_read on purchases for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists rate_rules_read on rate_rules;
create policy rate_rules_read on rate_rules for select to anon, authenticated
  using (((is_active AND (app.staff_role() IS NULL) AND (venue_id = ANY (( SELECT app.open_venue_ids() AS open_venue_ids)::uuid[]))) OR ((app.staff_role() IS NOT NULL) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))));

drop policy if exists recipe_change_requests_mgmt_read on recipe_change_requests;
create policy recipe_change_requests_mgmt_read on recipe_change_requests for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists refunds_staff_read on refunds;
create policy refunds_staff_read on refunds for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['cashier'::staff_role, 'manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists release_ideas_mgmt_read on release_ideas;
create policy release_ideas_mgmt_read on release_ideas for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists release_notes_mgmt_read on release_notes;
create policy release_notes_mgmt_read on release_notes for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists release_reviews_mgmt_read on release_reviews;
create policy release_reviews_mgmt_read on release_reviews for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists reservation_series_staff_read on reservation_series;
create policy reservation_series_staff_read on reservation_series for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['court_desk'::staff_role, 'cashier'::staff_role, 'manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists reservations_cashier_read on reservations;
create policy reservations_cashier_read on reservations for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['cashier'::staff_role]) AND (((start_at >= (now() - '1 day'::interval)) AND (start_at < (now() + '1 day'::interval))) OR (EXISTS ( SELECT 1
   FROM tabs t
  WHERE (t.reservation_id = reservations.id)))) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists reservations_staff_read on reservations;
create policy reservations_staff_read on reservations for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['court_desk'::staff_role, 'manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists salary_deductions_mgmt_read on salary_deductions;
create policy salary_deductions_mgmt_read on salary_deductions for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])) AND (staff_id IS DISTINCT FROM auth.uid())));

drop policy if exists shopping_items_mgmt_read on shopping_items;
create policy shopping_items_mgmt_read on shopping_items for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists staff_breaks_read_mgmt on staff_breaks;
create policy staff_breaks_read_mgmt on staff_breaks for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists staff_suggestions_mgmt_read on staff_suggestions;
create policy staff_suggestions_mgmt_read on staff_suggestions for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists staff_venues_read_mgmt on staff_venues;
create policy staff_venues_read_mgmt on staff_venues for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists station_staff_read_mgmt on station_staff;
create policy station_staff_read_mgmt on station_staff for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists stations_read_staff on stations;
create policy stations_read_staff on stations for select to authenticated
  using (((app.staff_role() IS NOT NULL) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists stock_batches_mgmt_read on stock_batches;
create policy stock_batches_mgmt_read on stock_batches for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists stock_counts_mgmt_read on stock_counts;
create policy stock_counts_mgmt_read on stock_counts for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists stock_movements_mgmt_read on stock_movements;
create policy stock_movements_mgmt_read on stock_movements for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists stock_transfer_lines_mgmt_read on stock_transfer_lines;
create policy stock_transfer_lines_mgmt_read on stock_transfer_lines for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (EXISTS ( SELECT 1
   FROM stock_transfers t
  WHERE ((t.id = stock_transfer_lines.transfer_id) AND (t.venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))))));

drop policy if exists stock_transfers_mgmt_read on stock_transfers;
create policy stock_transfers_mgmt_read on stock_transfers for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists suppliers_mgmt_read on suppliers;
create policy suppliers_mgmt_read on suppliers for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists tabs_staff_read on tabs;
create policy tabs_staff_read on tabs for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['cashier'::staff_role, 'court_desk'::staff_role, 'manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists tax_groups_read on tax_groups;
create policy tax_groups_read on tax_groups for select to anon, authenticated
  using (((is_active AND (app.staff_role() IS NULL) AND (venue_id = ANY (( SELECT app.open_venue_ids() AS open_venue_ids)::uuid[]))) OR ((app.staff_role() IS NOT NULL) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])))));

drop policy if exists teachings_mgmt_read on teachings;
create policy teachings_mgmt_read on teachings for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists telegram_actions_mgmt_read on telegram_actions;
create policy telegram_actions_mgmt_read on telegram_actions for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists telegram_outbox_mgmt_read on telegram_outbox;
create policy telegram_outbox_mgmt_read on telegram_outbox for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists tickets_staff_read on tickets;
create policy tickets_staff_read on tickets for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['prep'::staff_role, 'cashier'::staff_role, 'manager'::staff_role, 'owner'::staff_role, 'head_barista'::staff_role, 'barista'::staff_role, 'assistant_barista'::staff_role, 'head_chef'::staff_role, 'chef'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists till_shifts_mgmt_read on till_shifts;
create policy till_shifts_mgmt_read on till_shifts for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

drop policy if exists waiter_calls_staff_read on waiter_calls;
create policy waiter_calls_staff_read on waiter_calls for select to authenticated
  using ((app.is_staff(VARIADIC ARRAY['cashier'::staff_role, 'manager'::staff_role, 'owner'::staff_role, 'waiter'::staff_role]) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[]))));

-- venue_settings_staff_read (0156) had no venue axis at all: one row per branch
-- since 0208, so it follows the scope too (a staff screen reads its branch's row).
drop policy if exists venue_settings_staff_read on venue_settings;
create policy venue_settings_staff_read on venue_settings for select to authenticated
  using ((app.staff_role() IS NOT NULL) AND (venue_id = ANY (( SELECT app.visible_venue_ids() AS visible_venue_ids)::uuid[])));

-- resolve_venue: one more step, (2c), the switcher's branch, so a default-based
-- write on the owner's office machine files at the branch the screens show.
-- resolve_venue: re-issued from 20260926000222_venue_status_and_stations.sql:112
create or replace function app.resolve_venue(p_station_id text default null) returns uuid
language plpgsql stable security definer set search_path = public as $resolve_venue_0226$
declare
  v_station text;
  v_raw     text;
  v_cast    uuid;
  v_venue   uuid;
  v_count   int;
  v_hdr     text;
begin
  -- (1) the asserted station.
  v_station := nullif(coalesce(p_station_id, current_setting('app.station_id', true)), '');
  if v_station is not null then
    select s.venue_id into v_venue
      from stations s
      join venues v on v.id = s.venue_id and v.status <> 'closed'
     where s.id = v_station
       and s.retired_at is null;
    if v_venue is not null then
      return v_venue;
    end if;
  end if;

  -- (2) the asserted venue. A GUC is text, so a malformed value must degrade to
  -- "not asserted" rather than blow up a guest insert.
  v_raw := nullif(current_setting('app.venue_id', true), '');
  if v_raw is not null then
    begin
      v_cast := v_raw::uuid;
    exception when invalid_text_representation then
      v_cast := null;
    end;
    if v_cast is not null then
      select v.id into v_venue from venues v where v.id = v_cast and v.status <> 'closed';
      if v_venue is not null then
        return v_venue;
      end if;
    end if;
  end if;

  -- (2b) 0215: the station the operator names on every request (x-station-id,
  -- exposed by PostgREST in request.headers). Counted only for the owner or a
  -- member of that station's branch.
  begin
    v_hdr := nullif(btrim(nullif(current_setting('request.headers', true), '')::json ->> 'x-station-id'), '');
  exception when others then
    v_hdr := null;
  end;
  if v_hdr is not null and auth.uid() is not null then
    select s.venue_id into v_venue
      from stations s
      join venues v on v.id = s.venue_id and v.status <> 'closed'
     where s.id = v_hdr
       and s.retired_at is null;
    if v_venue is not null
       and (app.is_staff('owner')
            or exists (select 1 from staff_venues sv
                        where sv.staff_id = auth.uid() and sv.venue_id = v_venue)) then
      return v_venue;
    end if;
    v_venue := null;
  end if;

  -- (2c) 0226: the branch the operator's switcher names (x-venue-scope), counted
  -- only for the owner or a member of it, like the station header above.
  begin
    v_hdr := nullif(btrim(nullif(current_setting('request.headers', true), '')::json ->> 'x-venue-scope'), '');
  exception when others then
    v_hdr := null;
  end;
  if v_hdr is not null and v_hdr <> 'all' and auth.uid() is not null then
    begin
      v_cast := v_hdr::uuid;
    exception when invalid_text_representation then
      v_cast := null;
    end;
    if v_cast is not null then
      select v.id into v_venue from venues v where v.id = v_cast and v.status <> 'closed';
      if v_venue is not null
         and (app.is_staff('owner')
              or exists (select 1 from staff_venues sv
                          where sv.staff_id = auth.uid() and sv.venue_id = v_venue)) then
        return v_venue;
      end if;
      v_venue := null;
    end if;
  end if;

  -- (3) the caller's memberships. Exactly one is an answer; more than one is an
  -- ambiguity the caller has to resolve, so stop here rather than fall through
  -- to (4) and pick the oldest venue for a manager who works at two.
  if auth.uid() is not null then
    select count(*), min(sv.venue_id::text)::uuid into v_count, v_venue
      from staff_venues sv
      join venues v on v.id = sv.venue_id and v.status <> 'closed'
     where sv.staff_id = auth.uid();
    if v_count = 1 then
      return v_venue;
    end if;
    if v_count > 1 then
      return null;
    end if;
  end if;

  -- (4) one active venue in the database: production, all of slice 1.
  select count(*), min(v.id::text)::uuid into v_count, v_venue
    from venues v
   where v.is_active;
  if v_count = 1 then
    return v_venue;
  end if;

  return null;
end
$resolve_venue_0226$;
